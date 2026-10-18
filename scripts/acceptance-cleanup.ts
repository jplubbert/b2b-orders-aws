// `npm run acceptance:cleanup`: borra de `dev` los pedidos de clientes desechables de la aceptación (T-19).
// También es el `globalSetup` de vitest.acceptance.config.ts: `teardown` corre al terminar cada
// `npm run test:acceptance`, pasen o fallen las pruebas. Requiere `.env.dev`.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { deleteAcceptanceOrders } from './lib/acceptance-cleanup.ts';
import { loadStageEnv } from './lib/env.ts';

export async function teardown(): Promise<void> {
  const env = loadStageEnv('dev');
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.AWS_REGION }));
  const n = await deleteAcceptanceOrders(doc, env.TABLE_NAME);
  console.log(`Aceptación: ${n} pedido(s) de clientes C-ACEPT-… borrados de ${env.TABLE_NAME}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await teardown();
