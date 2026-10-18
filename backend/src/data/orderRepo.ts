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
  /** Guarda el pedido nuevo en la partición del cliente; nunca sobrescribe uno existente. */
  putOrder(customerId: string, order: Order): Promise<void>;
  /** Pedidos del cliente, del más reciente al más antiguo (orden del ULID). */
  listOrders(customerId: string): Promise<Order[]>;
  /** Pedido `orderId` dentro de la partición del cliente; `null` si no está (o es de otro cliente). */
  getOrder(customerId: string, orderId: string): Promise<Order | null>;
  /** Pedidos de todos los clientes, del más reciente al más antiguo; solo los de `status` si se indica (DEC-013). */
  listAllOrders(status?: OrderStatus | null): Promise<Order[]>;
  /** Cambia solo `status` del pedido en la partición del cliente; `null` si no está (no crea nada). */
  setStatus(customerId: string, orderId: string, status: OrderStatus): Promise<Order | null>;
}

// DEC-006: `PK=CUSTOMER#<customerId>`, `SK=ORDER#<ulid>`, líneas embebidas con nombre y precio congelados.
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

    // La clave incluye al cliente del token: un pedido ajeno no se puede leer ni distinguir de uno inexistente.
    async getOrder(customerId, orderId) {
      const { Item } = await doc.send(
        new GetCommand({ TableName: tableName, Key: { PK: customerPk(customerId), SK: orderSk(orderId) } }),
      );
      return Item ? toOrder(Item) : null;
    },

    // DEC-013: Scan paginado de la tabla (S-26: decenas de pedidos); el orden lo da el ULID, no la tabla.
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

    // La condición evita que UpdateItem cree un pedido vacío cuando la clave no existe (REQ-011 E5).
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
            ReturnValues: 'ALL_NEW',
          }),
        );
        return Attributes ? toOrder(Attributes) : null;
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
