// Data setup for acceptance against `dev` (DEC-007). There is no catalog API, so test products are
// written straight to the table (DEC-006 keys) and the throwaway users (customers, distributors and
// ungrouped) are created in Cognito the way the seed does it. Everything carries the `acept-` prefix
// and is deleted at the end; `sweep*` cleans up leftovers from interrupted runs.
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
const DISTRIBUTOR_GROUP = 'distribuidores'; // DEC-013

const clients = (env: StageEnv) => ({
  doc: DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.AWS_REGION })),
  idp: new CognitoIdentityProviderClient({ region: env.AWS_REGION }),
});

const rand = () => Math.random().toString(36).slice(2, 10);

// --- Catalog --------------------------------------------------------------------------------

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

/** Creates test products with a unique `productId` (`acept-` prefix). */
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

// --- Throwaway users ------------------------------------------------------------------------

export interface TempUser {
  email: string;
  token: string;
}

export interface TempCustomer extends TempUser {
  customerId: string;
}

/** Creates the user with the demo password; if `group` doesn't exist, deletes the user and rethrows. */
async function createUser(
  env: StageEnv,
  email: string,
  attributes: Array<{ Name: string; Value: string }>,
  group?: string,
): Promise<TempUser> {
  const { idp } = clients(env);
  await idp.send(
    new AdminCreateUserCommand({
      UserPoolId: env.USER_POOL_ID,
      Username: email,
      MessageAction: 'SUPPRESS',
      UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }, ...attributes],
    }),
  );
  try {
    await idp.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: env.USER_POOL_ID,
        Username: email,
        Password: env.DEMO_PASSWORD,
        Permanent: true,
      }),
    );
    if (group) {
      await idp.send(new AdminAddUserToGroupCommand({ UserPoolId: env.USER_POOL_ID, Username: email, GroupName: group }));
    }
  } catch (err) {
    await idp.send(new AdminDeleteUserCommand({ UserPoolId: env.USER_POOL_ID, Username: email }));
    throw err;
  }
  return { email, token: await login(env, email) };
}

/** New user in the `almaceneros` group with its own `custom:customerId` (DEC-004) and no orders. */
export async function createCustomer(env: StageEnv): Promise<TempCustomer> {
  const id = rand();
  const customerId = `C-ACEPT-${id.toUpperCase()}`;
  const user = await createUser(
    env,
    `${PREFIX}${id}@demo.test`,
    [{ Name: 'custom:customerId', Value: customerId }],
    CUSTOMER_GROUP,
  );
  return { ...user, customerId };
}

/** New user in the `distribuidores` group, without `custom:customerId` (S-22, DEC-013). */
export async function createDistributor(env: StageEnv): Promise<TempUser> {
  return createUser(env, `${PREFIX}dist-${rand()}@demo.test`, [], DISTRIBUTOR_GROUP);
}

/** Valid user with no group; it has `custom:customerId` so the group is the only thing missing. */
export async function createUngrouped(env: StageEnv): Promise<TempUser> {
  const id = rand();
  return createUser(env, `${PREFIX}nogrp-${id}@demo.test`, [
    { Name: 'custom:customerId', Value: `C-ACEPT-${id.toUpperCase()}` },
  ]);
}

export async function deleteCustomers(env: StageEnv, users: TempUser[]): Promise<void> {
  const { idp } = clients(env);
  for (const u of users) {
    await idp.send(new AdminDeleteUserCommand({ UserPoolId: env.USER_POOL_ID, Username: u.email }));
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

// --- Orders API (shape per DEC-009) ---------------------------------------------------------

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

/** The customer's `myOrders`; fails the test if the API responds with errors. */
export async function myOrders(env: StageEnv, token: string): Promise<OrderSummary[]> {
  const res = await gql<{ myOrders: OrderSummary[] }>(env, MY_ORDERS, {}, token);
  if (res.errors?.length || !res.data) throw new Error(`myOrders failed: ${JSON.stringify(res.errors)}`);
  return res.data.myOrders;
}

/** Creates a valid order; fails the test if the API rejects it. */
export async function placeOrder(env: StageEnv, token: string, lines: LineInput[]): Promise<Order> {
  const res = await createOrder(env, token, lines);
  if (res.errors?.length || !res.data?.createOrder) throw new Error(`createOrder failed: ${JSON.stringify(res.errors)}`);
  return res.data.createOrder;
}

// --- Distributor API (shape per DEC-013) ----------------------------------------------------
// Fields kept apart from ORDER_FIELDS: `customerId` doesn't exist before T-14 and req_003/004 must keep passing.

const DIST_ORDER_FIELDS = `customerId ${ORDER_FIELDS}`;

export const ALL_ORDERS = /* GraphQL */ `
  query AllOrders($status: OrderStatus) { allOrders(status: $status) { ${DIST_ORDER_FIELDS} } }
`;
export const SET_ORDER_STATUS = /* GraphQL */ `
  mutation SetOrderStatus($customerId: ID!, $id: ID!, $status: OrderStatus!) {
    setOrderStatus(customerId: $customerId, id: $id, status: $status) { ${DIST_ORDER_FIELDS} }
  }
`;

export type DistOrder = Order & { customerId: string };

export function allOrders(env: StageEnv, token: string, status?: string) {
  return gql<{ allOrders: DistOrder[] | null }>(env, ALL_ORDERS, status ? { status } : {}, token);
}

/** The distributor's `allOrders`; fails the test if the API responds with errors. */
export async function listAllOrders(env: StageEnv, token: string, status?: string): Promise<DistOrder[]> {
  const res = await allOrders(env, token, status);
  if (res.errors?.length || !res.data?.allOrders) throw new Error(`allOrders failed: ${JSON.stringify(res.errors)}`);
  return res.data.allOrders;
}

export function changeOrderStatus(
  env: StageEnv,
  token: string,
  target: { customerId: string; id: string; status: string },
) {
  return gql<{ setOrderStatus: DistOrder | null }>(env, SET_ORDER_STATUS, target, token);
}

// --- Order history (REQ-012, S-29, DEC-020) -------------------------------------------------

export const ORDER_HISTORY = /* GraphQL */ `
  query OrderHistory($id: ID!) { orderHistory(id: $id) { eventId orderId customerId from to at } }
`;

export interface OrderStatusEvent {
  eventId: string;
  orderId: string;
  customerId: string;
  from: string | null;
  to: string;
  at: string;
}

export function orderHistory(env: StageEnv, token: string, id: string) {
  return gql<{ orderHistory: OrderStatusEvent[] | null }>(env, ORDER_HISTORY, { id }, token);
}

/** `orderHistory(id)` as `token`; fails the test if the API responds with errors. */
export async function listOrderHistory(env: StageEnv, token: string, id: string): Promise<OrderStatusEvent[]> {
  const res = await orderHistory(env, token, id);
  if (res.errors?.length || !res.data?.orderHistory) throw new Error(`orderHistory failed: ${JSON.stringify(res.errors)}`);
  return res.data.orderHistory;
}

/**
 * Polls `orderHistory(id)` until it has at least `count` events. Recording is asynchronous and must
 * finish within 30 s of the API response (REQ-012), so call it right after the operation.
 */
export async function waitForHistory(
  env: StageEnv,
  token: string,
  id: string,
  count: number,
  timeoutMs = 30_000,
): Promise<OrderStatusEvent[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const events = await listOrderHistory(env, token, id);
    if (events.length >= count) return events;
    if (Date.now() > deadline) {
      throw new Error(`orderHistory(${id}) has ${events.length} of ${count} event(s) after ${timeoutMs} ms`);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

// --- Distributor script ---------------------------------------------------------------------

/** `npm run order:set-status -- <id> <status>` (SPEC §Plan, DEC-009). */
export function setOrderStatus(orderId: string, status: string) {
  return spawnSync('npm', ['run', '--silent', 'order:set-status', '--', orderId, status], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}
