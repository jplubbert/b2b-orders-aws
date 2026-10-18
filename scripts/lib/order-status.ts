// Cambio de estado de un pedido por el distribuidor (SPEC §Plan, DEC-009). El pedido se busca solo por
// `id`: con las claves de DEC-006 eso es un Scan, suficiente para la demo (consecuencia aceptada en DEC-009).
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { ScanCommand, UpdateCommand, type DynamoDBDocumentClient, type ScanCommandOutput } from '@aws-sdk/lib-dynamodb';
import { CUSTOMER_PK_PREFIX, orderSk } from '../../backend/src/data/keys.ts';
import { ORDER_STATUSES, isOrderStatus, type OrderStatus } from '../../backend/src/domain/order.ts';

export class SetStatusError extends Error {}

/** Clave del pedido `orderId` de cualquier cliente; `null` si no existe. */
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

/** Valida el estado (S-04) antes de tocar la tabla y lo escribe; solo cambia `status` (el pedido es inmutable). */
export async function setOrderStatus(
  doc: DynamoDBDocumentClient,
  tableName: string,
  orderId: string,
  status: string,
): Promise<OrderStatus> {
  if (!isOrderStatus(status)) {
    throw new SetStatusError(`Estado inválido: ${status}. Válidos: ${ORDER_STATUSES.join(', ')}`);
  }
  const key = await findOrderKey(doc, tableName, orderId);
  if (!key) throw new SetStatusError(`No existe el pedido ${orderId}`);
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
    if (e instanceof ConditionalCheckFailedException) throw new SetStatusError(`No existe el pedido ${orderId}`);
    throw e;
  }
  return status;
}
