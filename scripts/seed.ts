// Seeds the catalog and the test users in `dev` (idempotent). Requires `.env.dev`.
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
import { CUSTOMER_GROUP, DISTRIBUTOR_GROUP } from '../backend/src/domain/identity.ts';
import { loadStageEnv } from './lib/env.ts';
import { SEED_DISTRIBUTORS, SEED_PRODUCTS, SEED_USERS } from './lib/seed-data.ts';

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
console.log(`Products: ${SEED_PRODUCTS.map((p) => p.name).join(', ')}`);

/** Creates the user if missing, sets the demo password and adds it to the group. */
async function seedUser(email: string, group: string, attributes: Array<{ Name: string; Value: string }> = []) {
  try {
    await idp.send(
      new AdminCreateUserCommand({
        UserPoolId: env.USER_POOL_ID,
        Username: email,
        MessageAction: 'SUPPRESS',
        UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }, ...attributes],
      }),
    );
  } catch (e) {
    if (!(e instanceof UsernameExistsException)) throw e;
  }
  await idp.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: env.USER_POOL_ID,
      Username: email,
      Password: env.DEMO_PASSWORD,
      Permanent: true,
    }),
  );
  await idp.send(new AdminAddUserToGroupCommand({ UserPoolId: env.USER_POOL_ID, Username: email, GroupName: group }));
}

for (const u of SEED_USERS) {
  await seedUser(u.email, CUSTOMER_GROUP, [{ Name: 'custom:customerId', Value: u.customerId }]);
  console.log(`User: ${u.email} (${u.customerId})`);
}
for (const u of SEED_DISTRIBUTORS) {
  await seedUser(u.email, DISTRIBUTOR_GROUP);
  console.log(`User: ${u.email} (distributor)`);
}
console.log('Demo password: DEMO_PASSWORD in .env.dev');
