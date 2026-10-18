// `npm run acceptance:cleanup`: deletes from `dev` the orders of the acceptance's throwaway customers (T-19)
// and their orders' history (DEC-020).
// It's also the `globalSetup` of vitest.acceptance.config.ts: `teardown` runs at the end of every
// `npm run test:acceptance`, whether the tests pass or fail. Requires `.env.dev`.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { deleteAcceptanceHistory, deleteAcceptanceOrders } from './lib/acceptance-cleanup.ts';
import { loadStageEnv } from './lib/env.ts';

export async function teardown(): Promise<void> {
  const env = loadStageEnv('dev');
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.AWS_REGION }));
  const orders = await deleteAcceptanceOrders(doc, env.TABLE_NAME);
  const events = await deleteAcceptanceHistory(doc, env.TABLE_NAME);
  console.log(
    `Acceptance: deleted ${orders} order(s) and ${events} history event(s) of C-ACEPT-… customers from ${env.TABLE_NAME}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await teardown();
