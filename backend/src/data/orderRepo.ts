import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  type QueryCommandOutput,
  type ScanCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import type { Order, OrderLine, OrderStatus } from '../domain/order.js';
import { ORDER_SK_PREFIX, customerPk, orderSk } from './keys.js';

export interface OrderRepo {
  /** Stores the new order in the customer's partition; never overwrites an existing one. */
  putOrder(customerId: string, order: Order): Promise<void>;
  /** The customer's orders, newest first (ULID order). */
  listOrders(customerId: string): Promise<Order[]>;
  /** Order `orderId` within the customer's partition; `null` if missing (or owned by another customer). */
  getOrder(customerId: string, orderId: string): Promise<Order | null>;
  /** Orders of every customer, newest first; only those in `status` if given (DEC-013). */
  listAllOrders(status?: OrderStatus | null): Promise<Order[]>;
  /**
   * Changes only the order's `status` in the customer's partition; `null` if missing (creates nothing).
   * `previous` is the status this write replaced (REQ-012: the event's `from`).
   */
  setStatus(customerId: string, orderId: string, status: OrderStatus): Promise<StatusChange | null>;
}

export interface StatusChange {
  order: Order;
  previous: OrderStatus;
}

// DEC-006: `PK=CUSTOMER#<customerId>`, `SK=ORDER#<ulid>`, embedded lines with frozen name and price.
export function dynamoOrderRepo(doc: DynamoDBDocumentClient, tableName: string): OrderRepo {
  return {
    async putOrder(customerId, order) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: customerPk(customerId), SK: orderSk(order.id), ...order, customerId },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
    },

    async listOrders(customerId) {
      const orders: Order[] = [];
      let startKey: QueryCommandOutput['LastEvaluatedKey'];
      do {
        const page = await doc.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
            ExpressionAttributeValues: { ':pk': customerPk(customerId), ':sk': ORDER_SK_PREFIX },
            ScanIndexForward: false,
            ExclusiveStartKey: startKey,
          }),
        );
        for (const item of page.Items ?? []) orders.push(toOrder(item));
        startKey = page.LastEvaluatedKey;
      } while (startKey);
      return orders;
    },

    // The key includes the token's customer: another customer's order can't be read or told apart from a missing one.
    async getOrder(customerId, orderId) {
      const { Item } = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: customerPk(customerId), SK: orderSk(orderId) } }),
      );
      return Item ? toOrder(Item) : null;
    },

    // DEC-013: paginated Scan of the table (S-26: tens of orders); the ULID gives the order, not the table.
    async listAllOrders(status) {
      const orders: Order[] = [];
      let startKey: ScanCommandOutput['LastEvaluatedKey'];
      do {
        const page = await doc.send(
          new ScanCommand({
            TableName: tableName,
            ...(status
              ? {
                  FilterExpression: 'begins_with(SK, :sk) AND #status = :status',
                  ExpressionAttributeNames: { '#status': 'status' },
                  ExpressionAttributeValues: { ':sk': ORDER_SK_PREFIX, ':status': status },
                }
              : { FilterExpression: 'begins_with(SK, :sk)', ExpressionAttributeValues: { ':sk': ORDER_SK_PREFIX } }),
            ExclusiveStartKey: startKey,
          }),
        );
        for (const item of page.Items ?? []) orders.push(toOrder(item));
        startKey = page.LastEvaluatedKey;
      } while (startKey);
      return orders.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    },

    // The condition keeps UpdateItem from creating an empty order when the key doesn't exist (REQ-011 E5).
    // ALL_OLD: the previous status comes from the same atomic write, even with concurrent changes.
    async setStatus(customerId, orderId, status) {
      try {
        const { Attributes } = await doc.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { PK: customerPk(customerId), SK: orderSk(orderId) },
            UpdateExpression: 'SET #status = :status',
            ConditionExpression: 'attribute_exists(PK)',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':status': status },
            ReturnValues: 'ALL_OLD',
          }),
        );
        if (!Attributes) return null;
        const old = toOrder(Attributes);
        return { order: { ...old, status }, previous: old.status };
      } catch (e) {
        if (e instanceof ConditionalCheckFailedException) return null;
        throw e;
      }
    },
  };
}

function toOrder(item: Record<string, unknown>): Order {
  return {
    id: String(item.id),
    customerId: String(item.customerId),
    number: String(item.number),
    createdAt: String(item.createdAt),
    total: Number(item.total),
    status: item.status as Order['status'],
    lines: (item.lines as Record<string, unknown>[]).map(toLine),
  };
}

function toLine(line: Record<string, unknown>): OrderLine {
  return {
    productId: String(line.productId),
    name: String(line.name),
    presentation: String(line.presentation),
    quantity: Number(line.quantity),
    unitPrice: Number(line.unitPrice),
    subtotal: Number(line.subtotal),
  };
}
