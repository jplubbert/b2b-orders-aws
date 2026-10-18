// REQ-004 View the status of my orders — API examples (DEC-007). Orders are placed by a throwaway
// customer; almacen2 only tries to read (E3). The on-screen message of E4 is manual (LOG).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Product } from '../../backend/src/domain/catalog.ts';
import type { StageEnv } from '../../scripts/lib/env.ts';
import { SEED_USERS } from '../../scripts/lib/seed-data.ts';
import { gql, login, stageEnv } from '../lib/api.ts';
import {
  ORDER,
  type Order,
  type TempCustomer,
  createCustomer,
  createProduct,
  deleteCustomers,
  deleteProducts,
  myOrders,
  placeOrder,
  setOrderStatus,
  setUnitPrice,
  sweepCustomers,
  sweepProducts,
} from './support/fixtures.ts';

let env: StageEnv;
let owner: TempCustomer;
let empty: TempCustomer;
let temp: Product;

beforeAll(async () => {
  env = stageEnv();
  await sweepProducts(env);
  await sweepCustomers(env);
  owner = await createCustomer(env);
  empty = await createCustomer(env);
  temp = await createProduct(env, { name: 'Fideos 400 g', presentation: 'Paquete 400 g', unitPrice: 1000, active: true });
}, 60_000);

afterAll(async () => {
  if (temp) await deleteProducts(env, [temp.productId]);
  await deleteCustomers(env, [owner, empty].filter(Boolean));
}, 60_000);

async function getOrder(token: string, id: string) {
  return gql<{ order: Order | null }>(env, ORDER, { id }, token);
}

describe('REQ-004', () => {
  it('E1: the most recent order is listed first, with number, date, total and status', async () => {
    const older = await placeOrder(env, owner.token, [{ productId: 'arroz-1kg', quantity: 1 }]);
    await new Promise((r) => setTimeout(r, 1100));
    const newer = await placeOrder(env, owner.token, [{ productId: 'yerba-1kg', quantity: 1 }]);

    const list = await myOrders(env, owner.token);
    const ids = list.map((o) => o.id);
    expect(ids.indexOf(newer.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
    const dates = list.map((o) => Date.parse(o.createdAt));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    expect(list.find((o) => o.id === newer.id)).toMatchObject({
      number: newer.number,
      createdAt: newer.createdAt,
      total: 4500,
      status: 'RECIBIDO',
    });
  });

  it('E2: the distributor moves the order to ENVIADO via script; after refreshing it shows ENVIADO', async () => {
    const order = await placeOrder(env, owner.token, [{ productId: 'arroz-1kg', quantity: 2 }]);
    const run = setOrderStatus(order.id, 'ENVIADO');
    expect(run.status, run.stderr || run.stdout).toBe(0);

    expect((await myOrders(env, owner.token)).find((o) => o.id === order.id)?.status).toBe('ENVIADO');
    const detail = await getOrder(owner.token, order.id);
    expect(detail.errors).toBeUndefined();
    expect(detail.data?.order?.status).toBe('ENVIADO');
  });

  it('E2 (edge): the script rejects a status outside S-04 and does not change the order', async () => {
    const order = await placeOrder(env, owner.token, [{ productId: 'arroz-1kg', quantity: 1 }]);
    const run = setOrderStatus(order.id, 'PERDIDO');
    expect(run.status).not.toBe(0);
    expect((await getOrder(owner.token, order.id)).data?.order?.status).toBe('RECIBIDO');
  });

  it("E3: almacen2 requests order(id) of someone else's order → null, same as a nonexistent one", async () => {
    const order = await placeOrder(env, owner.token, [{ productId: 'yerba-1kg', quantity: 1 }]);
    const intruder = await login(env, SEED_USERS[1]!.email);

    const foreign = await getOrder(intruder, order.id);
    const missing = await getOrder(intruder, '01J0000000000000000000NONE');
    expect(foreign.data).toEqual({ order: null });
    expect(foreign).toEqual(missing);
    expect((await myOrders(env, intruder)).map((o) => o.id)).not.toContain(order.id);

    // The owner does see it: the null above is not because `order` doesn't exist.
    expect((await getOrder(owner.token, order.id)).data?.order?.id).toBe(order.id);
  });

  it('E4: customer with no orders → empty list', async () => {
    expect(await myOrders(env, empty.token)).toEqual([]);
  });

  it('E5: if the catalog price changes after confirming, the detail keeps the frozen price', async () => {
    const order = await placeOrder(env, owner.token, [{ productId: temp.productId, quantity: 3 }]);
    expect(order.total).toBe(3000);
    await setUnitPrice(env, temp, 2000);

    const detail = await getOrder(owner.token, order.id);
    expect(detail.errors).toBeUndefined();
    expect(detail.data?.order?.lines).toEqual([
      expect.objectContaining({ productId: temp.productId, name: 'Fideos 400 g', quantity: 3, unitPrice: 1000, subtotal: 3000 }),
    ]);
    expect(detail.data?.order?.total).toBe(3000);
    expect((await myOrders(env, owner.token)).find((o) => o.id === order.id)?.total).toBe(3000);
  });
});
