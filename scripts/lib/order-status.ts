// The distributor changes an order's status (SPEC §Plan, DEC-009). The order is looked up by `id` only:
// with the DEC-006 keys that's a Scan, enough for the demo (consequence accepted in DEC-009).
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { ScanCommand, UpdateCommand, type DynamoDBDocumentClient, type ScanCommandOutput } from '@aws-sdk/lib-dynamodb';
import { CUSTOMER_PK_PREFIX, orderSk } from '../../backend/src/data/keys.ts';
import { ORDER_STATUSES, isOrderStatus, type OrderStatus } from '../../backend/src/domain/order.ts';

export class SetStatusError extends Error {}

/** Key of order `orderId` of any customer; `null` if it doesn't exist. */
export async function findOrderKey(
  doc: DynamoDBDocumentClient,
  tableName: string,
  orderId: string,
): Promise<{ PK: string; SK: string } | null> {
  let startKey: ScanCommandOutput['LastEvaluatedKey'];
  do {
    const page = await doc.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'SK = :sk AND begins_with(PK, :pk)',
        ExpressionAttributeValues: { ':sk': orderSk(orderId), ':pk': CUSTOMER_PK_PREFIX },
        ProjectionExpression: 'PK, SK',
        ExclusiveStartKey: startKey,
      }),
    );
    const item = page.Items?.[0];
    if (item) return { PK: String(item.PK), SK: String(item.SK) };
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return null;
}

/** Validates the status (S-04) before touching the table and writes it; changes only `status` (the order is immutable). */
export async function setOrderStatus(
  doc: DynamoDBDocumentClient,
  tableName: string,
  orderId: string,
  status: string,
): Promise<OrderStatus> {
  if (!isOrderStatus(status)) {
    throw new SetStatusError(`Invalid status: ${status}. Valid: ${ORDER_STATUSES.join(', ')}`);
  }
  const key = await findOrderKey(doc, tableName, orderId);
  if (!key) throw new SetStatusError(`Order ${orderId} does not exist`);
  try {
    await doc.send(
      new UpdateCommand({
        TableName: tableName,
        Key: key,
        UpdateExpression: 'SET #status = :status',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': status },
      }),
    );
  } catch (e) {
    if (e instanceof ConditionalCheckFailedException) throw new SetStatusError(`Order ${orderId} does not exist`);
    throw e;
  }
  return status;
}
