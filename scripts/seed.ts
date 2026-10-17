// Siembra el catálogo y los usuarios de prueba en `dev` (idempotente). Requiere `.env.dev`.
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { CATALOG_PK, productSk } from '../backend/src/data/keys.ts';
import { loadStageEnv } from './lib/env.ts';
import { SEED_PRODUCTS, SEED_USERS } from './lib/seed-data.ts';

const env = loadStageEnv(process.argv[2] ?? 'dev');
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.AWS_REGION }));
const idp = new CognitoIdentityProviderClient({ region: env.AWS_REGION });

await doc.send(
  new BatchWriteCommand({
    RequestItems: {
      [env.TABLE_NAME]: SEED_PRODUCTS.map((p) => ({
        PutRequest: { Item: { PK: CATALOG_PK, SK: productSk(p.productId), ...p } },
      })),
    },
  }),
);
console.log(`Productos: ${SEED_PRODUCTS.map((p) => p.name).join(', ')}`);

for (const u of SEED_USERS) {
  try {
    await idp.send(
      new AdminCreateUserCommand({
        UserPoolId: env.USER_POOL_ID,
        Username: u.email,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'email', Value: u.email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'custom:customerId', Value: u.customerId },
        ],
      }),
    );
  } catch (e) {
    if (!(e instanceof UsernameExistsException)) throw e;
  }
  await idp.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: env.USER_POOL_ID,
      Username: u.email,
      Password: env.DEMO_PASSWORD,
      Permanent: true,
    }),
  );
  await idp.send(
    new AdminAddUserToGroupCommand({ UserPoolId: env.USER_POOL_ID, Username: u.email, GroupName: 'almaceneros' }),
  );
  console.log(`Usuario: ${u.email} (${u.customerId})`);
}
console.log('Contraseña de demo: DEMO_PASSWORD en .env.dev');
