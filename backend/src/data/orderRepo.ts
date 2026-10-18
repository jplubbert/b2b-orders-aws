import { DynamoDBDocumentClient, PutCommand, QueryCommand, type QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { Order, OrderLine } from '../domain/order.js';
import { ORDER_SK_PREFIX, customerPk, orderSk } from './keys.js';

export interface OrderRepo {
  /** Guarda el pedido nuevo en la partición del cliente; nunca sobrescribe uno existente. */
  putOrder(customerId: string, order: Order): Promise<void>;
  /** Pedidos del cliente, del más reciente al más antiguo (orden del ULID). */
  listOrders(customerId: string): Promise<Order[]>;
}

// DEC-006: `PK=CUSTOMER#<customerId>`, `SK=ORDER#<ulid>`, líneas embebidas con nombre y precio congelados.
export function dynamoOrderRepo(doc: DynamoDBDocumentClient, tableName: string): OrderRepo {
  return {
    async putOrder(customerId, order) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: customerPk(customerId), SK: orderSk(order.id), customerId, ...order },
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
  };
}

function toOrder(item: Record<string, unknown>): Order {
  return {
    id: String(item.id),
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
