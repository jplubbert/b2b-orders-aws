import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import { dynamoHistoryRepo } from '../src/data/historyRepo.js';
import type { OrderStatusEvent } from '../src/domain/orderEvent.js';

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

const created: OrderStatusEvent = {
  eventId: '01JAAAAAAAAAAAAAAAAAAAEVT1',
  orderId: '01JAAAAAAAAAAAAAAAAAB7XQ2M9Z',
  customerId: 'C-1',
  from: null,
  to: 'RECIBIDO',
  at: '2026-10-18T12:00:00.000Z',
};
const shipped: OrderStatusEvent = { ...created, eventId: '01JAAAAAAAAAAAAAAAAAAAEVT2', from: 'RECIBIDO', to: 'ENVIADO', at: '2026-10-18T12:05:00.000Z' };

describe('dynamoHistoryRepo (DEC-020)', () => {
  it('putEvent writes HISTORY#<orderId> / EVENT#<at>#<eventId> conditionally, outside the customer partition', async () => {
    const { doc, inputs } = fakeDoc([{}]);
    await expect(dynamoHistoryRepo(doc, 'table').putEvent(created)).resolves.toBe(true);
    expect(inputs).toEqual([
      {
        TableName: 'table',
        Item: { PK: `HISTORY#${created.orderId}`, SK: `EVENT#${created.at}#${created.eventId}`, ...created },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    ]);
  });

  it('E5: a second write of the same event is a no-op that reports false', async () => {
    const { doc } = fakeDoc([new ConditionalCheckFailedException({ message: 'exists', $metadata: {} })]);
    await expect(dynamoHistoryRepo(doc, 'table').putEvent(created)).resolves.toBe(false);
  });

  it('putEvent propagates other errors (the message is retried)', async () => {
    const { doc } = fakeDoc([new Error('throttled')]);
    await expect(dynamoHistoryRepo(doc, 'table').putEvent(created)).rejects.toThrow('throttled');
  });

  it("listEvents queries the order's history ascending (oldest first), walks the pages and drops the keys", async () => {
    const row = (e: OrderStatusEvent) => ({ PK: `HISTORY#${e.orderId}`, SK: `EVENT#${e.at}#${e.eventId}`, type: 'x', ...e });
    const { from: _omit, ...createdWithoutFrom } = created;
    const { doc, inputs } = fakeDoc([
      { Items: [row(createdWithoutFrom as OrderStatusEvent)], LastEvaluatedKey: { PK: 'x', SK: 'y' } },
      { Items: [row(shipped)] },
    ]);
    const out = await dynamoHistoryRepo(doc, 'table').listEvents(created.orderId);
    expect(inputs[0]).toEqual({
      TableName: 'table',
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `HISTORY#${created.orderId}`, ':sk': 'EVENT#' },
      ScanIndexForward: true,
      ExclusiveStartKey: undefined,
    });
    expect(inputs[1]!.ExclusiveStartKey).toEqual({ PK: 'x', SK: 'y' });
    expect(out).toEqual([created, shipped]);
  });

  it('the sort key orders by time: ISO 8601 UTC sorts lexicographically', () => {
    const sk = (at: string) => `EVENT#${at}#01J`;
    const times = ['2026-10-18T09:59:59.999Z', '2026-10-18T10:00:00.000Z', '2026-10-19T00:00:00.000Z'];
    expect(times.map(sk).sort()).toEqual(times.map(sk));
  });
});
