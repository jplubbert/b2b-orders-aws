import type { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import { dynamoCatalogRepo } from '../src/data/catalogRepo.js';

// Cliente falso: devuelve las páginas en orden y guarda la entrada de cada Query.
function fakeDoc(pages: { Items: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> }[]) {
  const inputs: QueryCommand['input'][] = [];
  const doc = {
    send: async (cmd: QueryCommand) => {
      inputs.push(cmd.input);
      return pages[inputs.length - 1];
    },
  } as unknown as DynamoDBDocumentClient;
  return { doc, inputs };
}

const item = (productId: string, extra: Record<string, unknown> = {}) => ({
  PK: 'CATALOG',
  SK: `PRODUCT#${productId}`,
  productId,
  name: productId,
  presentation: 'Paquete 1 kg',
  unitPrice: 1300,
  active: true,
  ...extra,
});

describe('dynamoCatalogRepo (DEC-006)', () => {
  it('consulta la partición CATALOG con prefijo PRODUCT# en la tabla dada', async () => {
    const { doc, inputs } = fakeDoc([{ Items: [] }]);
    await dynamoCatalogRepo(doc, 'tabla').listProducts();
    expect(inputs).toEqual([
      expect.objectContaining({
        TableName: 'tabla',
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': 'CATALOG', ':sk': 'PRODUCT#' },
      }),
    ]);
  });

  it('recorre todas las páginas (catálogo completo)', async () => {
    const { doc, inputs } = fakeDoc([
      { Items: [item('a')], LastEvaluatedKey: { PK: 'CATALOG', SK: 'PRODUCT#a' } },
      { Items: [item('b')] },
    ]);
    const out = await dynamoCatalogRepo(doc, 'tabla').listProducts();
    expect(out.map((p) => p.productId)).toEqual(['a', 'b']);
    expect(inputs[0]!.ExclusiveStartKey).toBeUndefined();
    expect(inputs[1]!.ExclusiveStartKey).toEqual({ PK: 'CATALOG', SK: 'PRODUCT#a' });
  });

  it('mapea el ítem a Product sin claves de tabla; active solo si es true', async () => {
    const { doc } = fakeDoc([{ Items: [item('a'), item('b', { active: false }), item('c', { active: undefined })] }]);
    const out = await dynamoCatalogRepo(doc, 'tabla').listProducts();
    expect(out[0]).toEqual({
      productId: 'a',
      name: 'a',
      presentation: 'Paquete 1 kg',
      unitPrice: 1300,
      active: true,
    });
    expect(out.map((p) => p.active)).toEqual([true, false, false]);
  });
});
