// Preparación de datos para la aceptación contra `dev` (DEC-007). El distribuidor no tiene API en el
// corte 1, así que los productos de prueba se escriben directo en la tabla (claves de DEC-006) y los
// clientes desechables se crean en Cognito como lo hace el seed. Todo lleva el prefijo `acept-` y se
// borra al terminar; `sweep*` limpia restos de corridas interrumpidas.
import { spawnSync } from 'node:child_process';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  type QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { CATALOG_PK, PRODUCT_SK_PREFIX, productSk } from '../../../backend/src/data/keys.ts';
import type { Product } from '../../../backend/src/domain/catalog.ts';
import { ROOT, type StageEnv } from '../../../scripts/lib/env.ts';
import { gql, login } from '../../lib/api.ts';

export const PREFIX = 'acept-';
const CUSTOMER_GROUP = 'almaceneros';

const clients = (env: StageEnv) => ({
  doc: DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.AWS_REGION })),
  idp: new CognitoIdentityProviderClient({ region: env.AWS_REGION }),
});

const rand = () => Math.random().toString(36).slice(2, 10);

// --- Catálogo -------------------------------------------------------------------------------

export async function catalogItems(env: StageEnv): Promise<Array<Record<string, unknown>>> {
  const { doc } = clients(env);
  const items: Array<Record<string, unknown>> = [];
  let startKey: QueryCommandOutput['LastEvaluatedKey'];
  do {
    const page = await doc.send(
      new QueryCommand({
        TableName: env.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': CATALOG_PK, ':sk': PRODUCT_SK_PREFIX },
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return items;
}

export async function putItems(env: StageEnv, items: Array<Record<string, unknown>>): Promise<void> {
  const { doc } = clients(env);
  for (let i = 0; i < items.length; i += 25) {
    await doc.send(
      new BatchWriteCommand({
        RequestItems: { [env.TABLE_NAME]: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })) },
      }),
    );
  }
}

/** Crea productos de prueba con `productId` único (prefijo `acept-`). */
export async function createProducts(
  env: StageEnv,
  specs: Array<Omit<Product, 'productId'> & { productId?: string }>,
): Promise<Product[]> {
  const products = specs.map((s) => ({ ...s, productId: s.productId ?? `${PREFIX}${rand()}` }));
  await putItems(
    env,
    products.map((p) => ({ PK: CATALOG_PK, SK: productSk(p.productId), ...p })),
  );
  return products;
}

export async function createProduct(
  env: StageEnv,
  spec: Omit<Product, 'productId'> & { productId?: string },
): Promise<Product> {
  return (await createProducts(env, [spec]))[0]!;
}

export async function setUnitPrice(env: StageEnv, product: Product, unitPrice: number): Promise<void> {
  const { doc } = clients(env);
  await doc.send(
    new PutCommand({
      TableName: env.TABLE_NAME,
      Item: { PK: CATALOG_PK, SK: productSk(product.productId), ...product, unitPrice },
    }),
  );
}

export async function deleteProducts(env: StageEnv, productIds: string[]): Promise<void> {
  const { doc } = clients(env);
  for (const productId of productIds) {
    await doc.send(new DeleteCommand({ TableName: env.TABLE_NAME, Key: { PK: CATALOG_PK, SK: productSk(productId) } }));
  }
}

export async function sweepProducts(env: StageEnv): Promise<void> {
  const leftovers = (await catalogItems(env))
    .map((i) => String(i.productId))
    .filter((id) => id.startsWith(PREFIX));
  await deleteProducts(env, leftovers);
}

// --- Clientes desechables -------------------------------------------------------------------

export interface TempCustomer {
  email: string;
  customerId: string;
  token: string;
}

/** Usuario nuevo del grupo `almaceneros` con su propio `custom:customerId` (DEC-004), sin pedidos. */
export async function createCustomer(env: StageEnv): Promise<TempCustomer> {
  const { idp } = clients(env);
  const id = rand();
  const email = `${PREFIX}${id}@demo.test`;
  const customerId = `C-ACEPT-${id.toUpperCase()}`;
  await idp.send(
    new AdminCreateUserCommand({
      UserPoolId: env.USER_POOL_ID,
      Username: email,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'custom:customerId', Value: customerId },
      ],
    }),
  );
  await idp.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: env.USER_POOL_ID,
      Username: email,
      Password: env.DEMO_PASSWORD,
      Permanent: true,
    }),
  );
  await idp.send(new AdminAddUserToGroupCommand({ UserPoolId: env.USER_POOL_ID, Username: email, GroupName: CUSTOMER_GROUP }));
  return { email, customerId, token: await login(env, email) };
}

export async function deleteCustomers(env: StageEnv, customers: TempCustomer[]): Promise<void> {
  const { idp } = clients(env);
  for (const c of customers) {
    await idp.send(new AdminDeleteUserCommand({ UserPoolId: env.USER_POOL_ID, Username: c.email }));
  }
}

export async function sweepCustomers(env: StageEnv): Promise<void> {
  const { idp } = clients(env);
  const out = await idp.send(
    new ListUsersCommand({ UserPoolId: env.USER_POOL_ID, Filter: `email ^= "${PREFIX}"`, Limit: 60 }),
  );
  for (const u of out.Users ?? []) {
    await idp.send(new AdminDeleteUserCommand({ UserPoolId: env.USER_POOL_ID, Username: u.Username! }));
  }
}

// --- API de pedidos (forma según DEC-009) ---------------------------------------------------

export const ORDER_FIELDS = /* GraphQL */ `
  id number createdAt total status
  lines { productId name presentation quantity unitPrice subtotal }
`;

export const CREATE_ORDER = /* GraphQL */ `
  mutation CreateOrder($input: CreateOrderInput!) { createOrder(input: $input) { ${ORDER_FIELDS} } }
`;
export const MY_ORDERS = /* GraphQL */ `
  query MyOrders { myOrders { id number createdAt total status } }
`;
export const ORDER = /* GraphQL */ `
  query Order($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }
`;

export interface OrderLine {
  productId: string;
  name: string;
  presentation: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}
export interface Order {
  id: string;
  number: string;
  createdAt: string;
  total: number;
  status: string;
  lines: OrderLine[];
}
export type OrderSummary = Omit<Order, 'lines'>;

export type LineInput = { productId: string; quantity: number } & Record<string, unknown>;

export function createOrder(env: StageEnv, token: string, lines: LineInput[]) {
  return gql<{ createOrder: Order | null }>(env, CREATE_ORDER, { input: { lines } }, token);
}

/** `myOrders` del cliente; falla la prueba si la API responde con errores. */
export async function myOrders(env: StageEnv, token: string): Promise<OrderSummary[]> {
  const res = await gql<{ myOrders: OrderSummary[] }>(env, MY_ORDERS, {}, token);
  if (res.errors?.length || !res.data) throw new Error(`myOrders falló: ${JSON.stringify(res.errors)}`);
  return res.data.myOrders;
}

/** Crea un pedido válido; falla la prueba si la API lo rechaza. */
export async function placeOrder(env: StageEnv, token: string, lines: LineInput[]): Promise<Order> {
  const res = await createOrder(env, token, lines);
  if (res.errors?.length || !res.data?.createOrder) throw new Error(`createOrder falló: ${JSON.stringify(res.errors)}`);
  return res.data.createOrder;
}

// --- Script del distribuidor ----------------------------------------------------------------

/** `npm run order:set-status -- <id> <estado>` (SPEC §Plan, DEC-009). */
export function setOrderStatus(orderId: string, status: string) {
  return spawnSync('npm', ['run', '--silent', 'order:set-status', '--', orderId, status], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}
