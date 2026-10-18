// `npm run order:set-status -- <id> <estado>`: el distribuidor cambia el estado de un pedido en `dev`
// (DEC-009). Sale con código ≠ 0 si el estado no es de S-04 o el pedido no existe. Requiere `.env.dev`.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { loadStageEnv } from './lib/env.ts';
import { SetStatusError, setOrderStatus } from './lib/order-status.ts';

const [orderId, status] = process.argv.slice(2);
if (!orderId || !status) {
  console.error('Uso: npm run order:set-status -- <id> <estado>');
  process.exit(2);
}

const env = loadStageEnv('dev');
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.AWS_REGION }));

try {
  await setOrderStatus(doc, env.TABLE_NAME, orderId, status);
  console.log(`Pedido ${orderId} → ${status}`);
} catch (e) {
  if (!(e instanceof SetStatusError)) throw e;
  console.error(e.message);
  process.exit(1);
}
