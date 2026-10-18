// Cleanup of the data acceptance leaves in `dev` (DEC-007, T-19). The throwaway customers of
// tests/acceptance/support/fixtures.ts have `customerId` `C-ACEPT-…`; each file already deletes their users,
// but not their orders. With the DEC-006 keys, finding them is a Scan (like DEC-009).
import { DeleteCommand, ScanCommand, type DynamoDBDocumentClient, type ScanCommandOutput } from '@aws-sdk/lib-dynamodb';
import { CUSTOMER_PK_PREFIX, ORDER_SK_PREFIX, customerPk } from '../../backend/src/data/keys.ts';

export const ACCEPTANCE_CUSTOMER_PREFIX = 'C-ACEPT-';

/** Deletes the orders of `C-ACEPT-…` customers (walks every page); returns how many it deleted. */
export async function deleteAcceptanceOrders(doc: DynamoDBDocumentClient, tableName: string): Promise<number> {
  let deleted = 0;
  let startKey: ScanCommandOutput['LastEvaluatedKey'];
  do {
    const page = await doc.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'begins_with(PK, :pk) AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': customerPk(ACCEPTANCE_CUSTOMER_PREFIX), ':sk': ORDER_SK_PREFIX },
        ProjectionExpression: 'PK, SK',
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) {
      const key = { PK: String(item.PK), SK: String(item.SK) };
      // Double guard: never touches real customers' orders even if the filter changes.
      if (!key.PK.startsWith(`${CUSTOMER_PK_PREFIX}${ACCEPTANCE_CUSTOMER_PREFIX}`)) continue;
      await doc.send(new DeleteCommand({ TableName: tableName, Key: key }));
      deleted++;
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return deleted;
}
