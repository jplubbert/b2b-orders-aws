import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, type QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { OrderStatusEvent } from '../domain/orderEvent.js';
import { EVENT_SK_PREFIX, eventSk, historyPk } from './keys.js';

export interface HistoryRepo {
  /** Stores the event once: `false` if that `eventId` was already stored (duplicate delivery, REQ-012 E5). */
  putEvent(event: OrderStatusEvent): Promise<boolean>;
  /** Every event of the order, oldest first (by `at`, S-33). */
  listEvents(orderId: string): Promise<OrderStatusEvent[]>;
}

// DEC-020: `PK=HISTORY#<orderId>`, `SK=EVENT#<at>#<eventId>`; `at` is ISO 8601 UTC, so the SK sorts by time.
export function dynamoHistoryRepo(doc: DynamoDBDocumentClient, tableName: string): HistoryRepo {
  return {
    async putEvent(event) {
      try {
        await doc.send(
          new PutCommand({
            TableName: tableName,
            Item: { PK: historyPk(event.orderId), SK: eventSk(event.at, event.eventId), ...event },
            ConditionExpression: 'attribute_not_exists(PK)',
          }),
        );
        return true;
      } catch (e) {
        if (e instanceof ConditionalCheckFailedException) return false;
        throw e;
      }
    },

    async listEvents(orderId) {
      const events: OrderStatusEvent[] = [];
      let startKey: QueryCommandOutput['LastEvaluatedKey'];
      do {
        const page = await doc.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
            ExpressionAttributeValues: { ':pk': historyPk(orderId), ':sk': EVENT_SK_PREFIX },
            ScanIndexForward: true,
            ExclusiveStartKey: startKey,
          }),
        );
        for (const item of page.Items ?? []) events.push(toEvent(item));
        startKey = page.LastEvaluatedKey;
      } while (startKey);
      return events;
    },
  };
}

function toEvent(item: Record<string, unknown>): OrderStatusEvent {
  return {
    eventId: String(item.eventId),
    orderId: String(item.orderId),
    customerId: String(item.customerId),
    from: (item.from ?? null) as OrderStatusEvent['from'],
    to: item.to as OrderStatusEvent['to'],
    at: String(item.at),
  };
}
