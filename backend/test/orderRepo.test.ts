import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import { dynamoOrderRepo } from '../src/data/orderRepo.js';
import type { Order } from '../src/domain/order.js';

// Fake client: returns the responses in order (throws those that are Errors) and records each command's input.
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
  it('putOrder writes to CUSTOMER#<id> / ORDER#<ulid> with embedded lines, without overwriting', async () => {
    const { doc, inputs } = fakeDoc([{}]);
    await dynamoOrderRepo(doc, 'table').putOrder('C-1', order);
    expect(inputs).toEqual([
      {
        TableName: 'table',
        Item: { PK: 'CUSTOMER#C-1', SK: `ORDER#${order.id}`, ...order },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    ]);
  });

  it("listOrders queries the customer's partition newest first and walks the pages", async () => {
    const item = { PK: 'CUSTOMER#C-1', SK: `ORDER#${order.id}`, ...order };
    const { doc, inputs } = fakeDoc([
      { Items: [item], LastEvaluatedKey: { PK: 'CUSTOMER#C-1', SK: `ORDER#${order.id}` } },
      { Items: [{ ...item, id: 'other' }] },
    ]);
    const out = await dynamoOrderRepo(doc, 'table').listOrders('C-1');
    expect(inputs[0]).toMatchObject({
      TableName: 'table',
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': 'CUSTOMER#C-1', ':sk': 'ORDER#' },
      ScanIndexForward: false,
    });
    expect(inputs[0]!.ExclusiveStartKey).toBeUndefined();
    expect(inputs[1]!.ExclusiveStartKey).toEqual({ PK: 'CUSTOMER#C-1', SK: `ORDER#${order.id}` });
    expect(out[0]).toEqual(order); // no table keys
    expect(out.map((o) => o.id)).toEqual([order.id, 'other']);
  });

  it("getOrder reads only the requested customer's key; null if missing", async () => {
    const item = { PK: 'CUSTOMER#C-1', SK: `ORDER#${order.id}`, ...order };
    const { doc, inputs } = fakeDoc([{ Item: item }, {}]);
    const repo = dynamoOrderRepo(doc, 'table');
    expect(await repo.getOrder('C-1', order.id)).toEqual(order);
    expect(await repo.getOrder('C-2', order.id)).toBeNull();
    expect(inputs).toEqual([
      { TableName: 'table', Key: { PK: 'CUSTOMER#C-1', SK: `ORDER#${order.id}` } },
      { TableName: 'table', Key: { PK: 'CUSTOMER#C-2', SK: `ORDER#${order.id}` } },
    ]);
  });
});

describe('dynamoOrderRepo: distributor (DEC-013)', () => {
  const item = (id: string, customerId: string, status = 'RECIBIDO') => ({
    PK: `CUSTOMER#${customerId}`,
    SK: `ORDER#${id}`,
    ...order,
    id,
    customerId,
    status,
  });

  it('listAllOrders walks the paginated Scan of ORDER# and sorts by descending ULID', async () => {
    const { doc, inputs } = fakeDoc([
      { Items: [item('01JA0000000000000000000001', 'C-1')], LastEvaluatedKey: { PK: 'x', SK: 'y' } },
      { Items: [item('01JA0000000000000000000003', 'C-2'), item('01JA0000000000000000000002', 'C-1')] },
    ]);
    const out = await dynamoOrderRepo(doc, 'table').listAllOrders();
    expect(inputs[0]).toEqual({
      TableName: 'table',
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

  it('listAllOrders with a status filters by status in the Scan', async () => {
    const { doc, inputs } = fakeDoc([{ Items: [item('01JA0000000000000000000001', 'C-1', 'ENVIADO')] }]);
    const out = await dynamoOrderRepo(doc, 'table').listAllOrders('ENVIADO');
    expect(inputs[0]).toMatchObject({
      FilterExpression: 'begins_with(SK, :sk) AND #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':sk': 'ORDER#', ':status': 'ENVIADO' },
    });
    expect(out.map((o) => o.status)).toEqual(['ENVIADO']);
  });

  it('setStatus updates only status, provided the order exists in that partition', async () => {
    const { doc, inputs } = fakeDoc([{ Attributes: item(order.id, 'C-1', 'ENVIADO') }]);
    expect(await dynamoOrderRepo(doc, 'table').setStatus('C-1', order.id, 'ENVIADO')).toEqual({ ...order, status: 'ENVIADO' });
    expect(inputs).toEqual([
      {
        TableName: 'table',
        Key: { PK: 'CUSTOMER#C-1', SK: `ORDER#${order.id}` },
        UpdateExpression: 'SET #status = :status',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': 'ENVIADO' },
        ReturnValues: 'ALL_NEW',
      },
    ]);
  });

  it("setStatus returns null if the condition fails (missing order or another customer's)", async () => {
    const failed = new ConditionalCheckFailedException({ message: 'no', $metadata: {} });
    const { doc } = fakeDoc([failed]);
    expect(await dynamoOrderRepo(doc, 'table').setStatus('C-2', order.id, 'ENVIADO')).toBeNull();
  });

  it('setStatus propagates other errors', async () => {
    const { doc } = fakeDoc([new Error('throttled')]);
    await expect(dynamoOrderRepo(doc, 'table').setStatus('C-1', order.id, 'ENVIADO')).rejects.toThrow('throttled');
  });
});
