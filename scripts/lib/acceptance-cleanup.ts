// Cleanup of the data acceptance leaves in `dev` (DEC-007, T-19). The throwaway customers of
// tests/acceptance/support/fixtures.ts have `customerId` `C-ACEPT-…`; each file already deletes their users,
// but not their orders nor their orders' history (DEC-020). With the DEC-006 keys, finding them is a Scan (like DEC-009).
import { DeleteCommand, ScanCommand, type DynamoDBDocumentClient, type ScanCommandOutput } from '@aws-sdk/lib-dynamodb';
import {
  CUSTOMER_PK_PREFIX,
  EVENT_SK_PREFIX,
  HISTORY_PK_PREFIX,
  ORDER_SK_PREFIX,
  customerPk,
} from '../../backend/src/data/keys.ts';

export const ACCEPTANCE_CUSTOMER_PREFIX = 'C-ACEPT-';

type Key = { PK: string; SK: string };

/** Deletes every item the Scan finds and `keep` accepts (walks every page); returns how many it deleted. */
async function deleteScanned(
  doc: DynamoDBDocumentClient,
  tableName: string,
  scan: { FilterExpression: string; ExpressionAttributeValues: Record<string, string> },
  keep: (item: Record<string, unknown>) => boolean,
): Promise<number> {
  let deleted = 0;
  let startKey: ScanCommandOutput['LastEvaluatedKey'];
  do {
    const page = await doc.send(
      new ScanCommand({
        TableName: tableName,
        ...scan,
        ProjectionExpression: 'PK, SK, customerId',
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) {
      // Double guard: never touches real customers' data even if the filter changes.
      if (!keep(item)) continue;
      const key: Key = { PK: String(item.PK), SK: String(item.SK) };
      await doc.send(new DeleteCommand({ TableName: tableName, Key: key }));
      deleted++;
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return deleted;
}

/** Deletes the orders of `C-ACEPT-…` customers; returns how many it deleted. */
export function deleteAcceptanceOrders(doc: DynamoDBDocumentClient, tableName: string): Promise<number> {
  return deleteScanned(
    doc,
    tableName,
    {
      FilterExpression: 'begins_with(PK, :pk) AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': customerPk(ACCEPTANCE_CUSTOMER_PREFIX), ':sk': ORDER_SK_PREFIX },
    },
    (item) =>
      String(item.PK).startsWith(`${CUSTOMER_PK_PREFIX}${ACCEPTANCE_CUSTOMER_PREFIX}`) &&
      String(item.SK).startsWith(ORDER_SK_PREFIX),
  );
}

/** Deletes the history events (DEC-020) of `C-ACEPT-…` customers' orders; returns how many it deleted. */
export function deleteAcceptanceHistory(doc: DynamoDBDocumentClient, tableName: string): Promise<number> {
  return deleteScanned(
    doc,
    tableName,
    {
      FilterExpression: 'begins_with(PK, :pk) AND begins_with(SK, :sk) AND begins_with(customerId, :c)',
      ExpressionAttributeValues: { ':pk': HISTORY_PK_PREFIX, ':sk': EVENT_SK_PREFIX, ':c': ACCEPTANCE_CUSTOMER_PREFIX },
    },
    (item) =>
      String(item.PK).startsWith(HISTORY_PK_PREFIX) &&
      String(item.SK).startsWith(EVENT_SK_PREFIX) &&
      String(item.customerId).startsWith(ACCEPTANCE_CUSTOMER_PREFIX),
  );
}
