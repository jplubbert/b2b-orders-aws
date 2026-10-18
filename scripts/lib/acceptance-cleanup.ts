// Limpieza de los datos que deja la aceptación en `dev` (DEC-007, T-19). Los clientes desechables de
// tests/acceptance/support/fixtures.ts tienen `customerId` `C-ACEPT-…`; sus usuarios ya se borran en cada
// archivo, sus pedidos no. Con las claves de DEC-006 encontrarlos es un Scan (como DEC-009).
import { DeleteCommand, ScanCommand, type DynamoDBDocumentClient, type ScanCommandOutput } from '@aws-sdk/lib-dynamodb';
import { CUSTOMER_PK_PREFIX, ORDER_SK_PREFIX, customerPk } from '../../backend/src/data/keys.ts';

export const ACCEPTANCE_CUSTOMER_PREFIX = 'C-ACEPT-';

/** Borra los pedidos de clientes `C-ACEPT-…` (recorre todas las páginas); devuelve cuántos borró. */
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
      // Doble guarda: nunca toca pedidos de clientes reales aunque el filtro cambie.
      if (!key.PK.startsWith(`${CUSTOMER_PK_PREFIX}${ACCEPTANCE_CUSTOMER_PREFIX}`)) continue;
      await doc.send(new DeleteCommand({ TableName: tableName, Key: key }));
      deleted++;
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return deleted;
}
