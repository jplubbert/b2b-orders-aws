import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import { deleteAcceptanceOrders } from '../lib/acceptance-cleanup.ts';

// Cliente falso: devuelve las respuestas en orden y guarda cada comando.
function fakeDoc(responses: unknown[]) {
  const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
  const doc = {
    send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: cmd.constructor.name, input: cmd.input });
      return responses[sent.length - 1] ?? {};
    },
  } as unknown as DynamoDBDocumentClient;
  return { doc, sent };
}

const testOrder = (c: string, id: string) => ({ PK: `CUSTOMER#C-ACEPT-${c}`, SK: `ORDER#${id}` });

describe('acceptance:cleanup (T-19)', () => {
  it('busca solo pedidos de clientes C-ACEPT-…, recorre páginas y borra cada uno por su clave', async () => {
    const a = testOrder('AAA', '01A');
    const b = testOrder('BBB', '01B');
    const { doc, sent } = fakeDoc([{ Items: [a], LastEvaluatedKey: { PK: 'x', SK: 'y' } }, {}, { Items: [b] }, {}]);
    await expect(deleteAcceptanceOrders(doc, 'tabla')).resolves.toBe(2);
    expect(sent.map((s) => s.name)).toEqual(['ScanCommand', 'DeleteCommand', 'ScanCommand', 'DeleteCommand']);
    expect(sent[0]!.input).toMatchObject({
      TableName: 'tabla',
      FilterExpression: 'begins_with(PK, :pk) AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': 'CUSTOMER#C-ACEPT-', ':sk': 'ORDER#' },
    });
    expect(sent[2]!.input.ExclusiveStartKey).toEqual({ PK: 'x', SK: 'y' });
    expect(sent[1]!.input).toEqual({ TableName: 'tabla', Key: a });
    expect(sent[3]!.input).toEqual({ TableName: 'tabla', Key: b });
  });

  it('nunca borra pedidos de almacen1/almacen2 ni productos, aunque el Scan los devuelva', async () => {
    const { doc, sent } = fakeDoc([
      { Items: [{ PK: 'CUSTOMER#C-ALMACEN1', SK: 'ORDER#1' }, { PK: 'CATALOG', SK: 'PRODUCT#p' }] },
    ]);
    await expect(deleteAcceptanceOrders(doc, 'tabla')).resolves.toBe(0);
    expect(sent.map((s) => s.name)).toEqual(['ScanCommand']);
  });
});
