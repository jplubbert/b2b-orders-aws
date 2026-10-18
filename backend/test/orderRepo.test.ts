import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import { dynamoOrderRepo } from '../src/data/orderRepo.js';
import type { Order } from '../src/domain/order.js';

// Cliente falso: devuelve las respuestas en orden y guarda la entrada de cada comando.
function fakeDoc(responses: Record<string, unknown>[]) {
  const inputs: Record<string, unknown>[] = [];
  const doc = {
    send: async (cmd: { input: Record<string, unknown> }) => {
      inputs.push(cmd.input);
      return responses[inputs.length - 1] ?? {};
    },
  } as unknown as DynamoDBDocumentClient;
  return { doc, inputs };
}

const order: Order = {
  id: '01JAAAAAAAAAAAAAAAAAB7XQ2M9Z',
  number: 'B7XQ2M9Z',
  createdAt: '2026-10-17T23:00:00.000Z',
  total: 9000,
  status: 'RECIBIDO',
  lines: [{ productId: 'yerba', name: 'Yerba 1 kg', presentation: 'Paquete', quantity: 2, unitPrice: 4500, subtotal: 9000 }],
};

describe('dynamoOrderRepo (DEC-006)', () => {
  it('putOrder escribe en CUSTOMER#<id> / ORDER#<ulid> con las líneas embebidas, sin sobrescribir', async () => {
    const { doc, inputs } = fakeDoc([{}]);
    await dynamoOrderRepo(doc, 'tabla').putOrder('C-1', order);
    expect(inputs).toEqual([
      {
        TableName: 'tabla',
        Item: { PK: 'CUSTOMER#C-1', SK: `ORDER#${order.id}`, customerId: 'C-1', ...order },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    ]);
  });

  it('listOrders consulta la partición del cliente del más reciente al más antiguo y recorre páginas', async () => {
    const item = { PK: 'CUSTOMER#C-1', SK: `ORDER#${order.id}`, customerId: 'C-1', ...order };
    const { doc, inputs } = fakeDoc([
      { Items: [item], LastEvaluatedKey: { PK: 'CUSTOMER#C-1', SK: `ORDER#${order.id}` } },
      { Items: [{ ...item, id: 'otro' }] },
    ]);
    const out = await dynamoOrderRepo(doc, 'tabla').listOrders('C-1');
    expect(inputs[0]).toMatchObject({
      TableName: 'tabla',
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': 'CUSTOMER#C-1', ':sk': 'ORDER#' },
      ScanIndexForward: false,
    });
    expect(inputs[0]!.ExclusiveStartKey).toBeUndefined();
    expect(inputs[1]!.ExclusiveStartKey).toEqual({ PK: 'CUSTOMER#C-1', SK: `ORDER#${order.id}` });
    expect(out[0]).toEqual(order); // sin claves de tabla ni customerId
    expect(out.map((o) => o.id)).toEqual([order.id, 'otro']);
  });

  it('getOrder lee solo la clave del cliente pedido; si no está, null', async () => {
    const item = { PK: 'CUSTOMER#C-1', SK: `ORDER#${order.id}`, customerId: 'C-1', ...order };
    const { doc, inputs } = fakeDoc([{ Item: item }, {}]);
    const repo = dynamoOrderRepo(doc, 'tabla');
    expect(await repo.getOrder('C-1', order.id)).toEqual(order);
    expect(await repo.getOrder('C-2', order.id)).toBeNull();
    expect(inputs).toEqual([
      { TableName: 'tabla', Key: { PK: 'CUSTOMER#C-1', SK: `ORDER#${order.id}` } },
      { TableName: 'tabla', Key: { PK: 'CUSTOMER#C-2', SK: `ORDER#${order.id}` } },
    ]);
  });
});
