import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import { deleteAcceptanceOrders } from '../lib/acceptance-cleanup.ts';

// Fake client: returns the responses in order and records each command.
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
  it('looks only for orders of C-ACEPT-… customers, walks the pages and deletes each one by its key', async () => {
    const a = testOrder('AAA', '01A');
    const b = testOrder('BBB', '01B');
    const { doc, sent } = fakeDoc([{ Items: [a], LastEvaluatedKey: { PK: 'x', SK: 'y' } }, {}, { Items: [b] }, {}]);
    await expect(deleteAcceptanceOrders(doc, 'table')).resolves.toBe(2);
    expect(sent.map((s) => s.name)).toEqual(['ScanCommand', 'DeleteCommand', 'ScanCommand', 'DeleteCommand']);
    expect(sent[0]!.input).toMatchObject({
      TableName: 'table',
      FilterExpression: 'begins_with(PK, :pk) AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': 'CUSTOMER#C-ACEPT-', ':sk': 'ORDER#' },
    });
    expect(sent[2]!.input.ExclusiveStartKey).toEqual({ PK: 'x', SK: 'y' });
    expect(sent[1]!.input).toEqual({ TableName: 'table', Key: a });
    expect(sent[3]!.input).toEqual({ TableName: 'table', Key: b });
  });

  it('never deletes orders of almacen1/almacen2 or products, even if the Scan returns them', async () => {
    const { doc, sent } = fakeDoc([
      { Items: [{ PK: 'CUSTOMER#C-ALMACEN1', SK: 'ORDER#1' }, { PK: 'CATALOG', SK: 'PRODUCT#p' }] },
    ]);
    await expect(deleteAcceptanceOrders(doc, 'table')).resolves.toBe(0);
    expect(sent.map((s) => s.name)).toEqual(['ScanCommand']);
  });
});
