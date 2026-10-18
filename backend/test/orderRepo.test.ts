import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import { dynamoOrderRepo } from '../src/data/orderRepo.js';
import type { Order } from '../src/domain/order.js';

// Cliente falso: devuelve las respuestas en orden (lanza las que son Error) y guarda la entrada de cada comando.
function fakeDoc(responses: Array<Record<string, unknown> | Error>) {
  const inputs: Record<string, unknown>[] = [];
  const doc = {
    send: async (cmd: { input: Record<string, unknown> }) => {
      inputs.push(cmd.input);
      const res = responses[inputs.length - 1] ?? {};
      if (res instanceof Error) throw res;
      return res;
    },
  } as unknown as DynamoDBDocumentClient;
  return { doc, inputs };
}

const order: Order = {
  id: '01JAAAAAAAAAAAAAAAAAB7XQ2M9Z',
  customerId: 'C-1',
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
        Item: { PK: 'CUSTOMER#C-1', SK: `ORDER#${order.id}`, ...order },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    ]);
  });

  it('listOrders consulta la partición del cliente del más reciente al más antiguo y recorre páginas', async () => {
    const item = { PK: 'CUSTOMER#C-1', SK: `ORDER#${order.id}`, ...order };
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
    expect(out[0]).toEqual(order); // sin claves de tabla
    expect(out.map((o) => o.id)).toEqual([order.id, 'otro']);
  });

  it('getOrder lee solo la clave del cliente pedido; si no está, null', async () => {
    const item = { PK: 'CUSTOMER#C-1', SK: `ORDER#${order.id}`, ...order };
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

describe('dynamoOrderRepo: distribuidor (DEC-013)', () => {
  const item = (id: string, customerId: string, status = 'RECIBIDO') => ({
    PK: `CUSTOMER#${customerId}`,
    SK: `ORDER#${id}`,
    ...order,
    id,
    customerId,
    status,
  });

  it('listAllOrders recorre el Scan paginado de ORDER# y ordena por ULID descendente', async () => {
    const { doc, inputs } = fakeDoc([
      { Items: [item('01JA0000000000000000000001', 'C-1')], LastEvaluatedKey: { PK: 'x', SK: 'y' } },
      { Items: [item('01JA0000000000000000000003', 'C-2'), item('01JA0000000000000000000002', 'C-1')] },
    ]);
    const out = await dynamoOrderRepo(doc, 'tabla').listAllOrders();
    expect(inputs[0]).toEqual({
      TableName: 'tabla',
      FilterExpression: 'begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':sk': 'ORDER#' },
      ExclusiveStartKey: undefined,
    });
    expect(inputs[1]!.ExclusiveStartKey).toEqual({ PK: 'x', SK: 'y' });
    expect(out.map((o) => [o.id.slice(-1), o.customerId])).toEqual([
      ['3', 'C-2'],
      ['2', 'C-1'],
      ['1', 'C-1'],
    ]);
    expect(out[0]).not.toHaveProperty('PK');
  });

  it('listAllOrders con estado filtra por status en el Scan', async () => {
    const { doc, inputs } = fakeDoc([{ Items: [item('01JA0000000000000000000001', 'C-1', 'ENVIADO')] }]);
    const out = await dynamoOrderRepo(doc, 'tabla').listAllOrders('ENVIADO');
    expect(inputs[0]).toMatchObject({
      FilterExpression: 'begins_with(SK, :sk) AND #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':sk': 'ORDER#', ':status': 'ENVIADO' },
    });
    expect(out.map((o) => o.status)).toEqual(['ENVIADO']);
  });

  it('setStatus actualiza solo status, condicionado a que el pedido exista en esa partición', async () => {
    const { doc, inputs } = fakeDoc([{ Attributes: item(order.id, 'C-1', 'ENVIADO') }]);
    expect(await dynamoOrderRepo(doc, 'tabla').setStatus('C-1', order.id, 'ENVIADO')).toEqual({ ...order, status: 'ENVIADO' });
    expect(inputs).toEqual([
      {
        TableName: 'tabla',
        Key: { PK: 'CUSTOMER#C-1', SK: `ORDER#${order.id}` },
        UpdateExpression: 'SET #status = :status',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': 'ENVIADO' },
        ReturnValues: 'ALL_NEW',
      },
    ]);
  });

  it('setStatus devuelve null si la condición falla (pedido inexistente o de otro cliente)', async () => {
    const failed = new ConditionalCheckFailedException({ message: 'no', $metadata: {} });
    const { doc } = fakeDoc([failed]);
    expect(await dynamoOrderRepo(doc, 'tabla').setStatus('C-2', order.id, 'ENVIADO')).toBeNull();
  });

  it('setStatus propaga otros errores', async () => {
    const { doc } = fakeDoc([new Error('throttled')]);
    await expect(dynamoOrderRepo(doc, 'tabla').setStatus('C-1', order.id, 'ENVIADO')).rejects.toThrow('throttled');
  });
});
