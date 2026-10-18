// `npm run order:set-status -- <id> <status>`: the distributor changes an order's status in `dev`
// (DEC-009). Exits with code ≠ 0 if the status isn't one of S-04 or the order doesn't exist. Requires `.env.dev`.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { loadStageEnv } from './lib/env.ts';
import { SetStatusError, setOrderStatus } from './lib/order-status.ts';

const [orderId, status] = process.argv.slice(2);
if (!orderId || !status) {
  console.error('Usage: npm run order:set-status -- <id> <status>');
  process.exit(2);
}

const env = loadStageEnv('dev');
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.AWS_REGION }));

try {
  await setOrderStatus(doc, env.TABLE_NAME, orderId, status);
  console.log(`Order ${orderId} → ${status}`);
} catch (e) {
  if (!(e instanceof SetStatusError)) throw e;
  console.error(e.message);
  process.exit(1);
}
