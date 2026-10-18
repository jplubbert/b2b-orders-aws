// REQ-011 Change an order's status — API examples (DEC-007, DEC-013). The owner is a throwaway
// customer instead of almacen1 (S-14); `other` lends its `customerId` for E5. E7 (network failure in
// the app) belongs to app/test + manual (S-27).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StageEnv } from '../../scripts/lib/env.ts';
import { gql, stageEnv } from '../lib/api.ts';
import {
  ORDER,
  type Order,
  type TempCustomer,
  type TempUser,
  changeOrderStatus,
  createCustomer,
  createDistributor,
  deleteCustomers,
  listAllOrders,
  myOrders,
  placeOrder,
  sweepCustomers,
} from './support/fixtures.ts';

let env: StageEnv;
let owner: TempCustomer;
let other: TempCustomer;
let dist: TempUser;

beforeAll(async () => {
  env = stageEnv();
  await sweepCustomers(env);
  owner = await createCustomer(env);
  other = await createCustomer(env);
  dist = await createDistributor(env);
}, 60_000);

afterAll(async () => {
  await deleteCustomers(env, [owner, other, dist].filter(Boolean));
}, 60_000);

async function ownerView(id: string): Promise<Order | null | undefined> {
  const res = await gql<{ order: Order | null }>(env, ORDER, { id }, owner.token);
  expect(res.errors).toBeUndefined();
  return res.data?.order;
}

/** Changes the status as the distributor; fails the test if the API rejects it. */
async function change(order: Order, status: string) {
  const res = await changeOrderStatus(env, dist.token, { customerId: owner.customerId, id: order.id, status });
  expect(res.errors).toBeUndefined();
  return res.data!.setOrderStatus!;
}

describe('REQ-011', () => {
  it('E1: RECIBIDO → EN_PREPARACION; the response and the panel show it', async () => {
    const order = await placeOrder(env, owner.token, [{ productId: 'arroz-1kg', quantity: 1 }]);
    const updated = await change(order, 'EN_PREPARACION');
    expect(updated).toMatchObject({ id: order.id, customerId: owner.customerId, status: 'EN_PREPARACION' });
    expect((await listAllOrders(env, dist.token)).find((o) => o.id === order.id)?.status).toBe('EN_PREPARACION');
  });

  it('E2: the distributor moves the order to ENVIADO; the owner sees it after refreshing', async () => {
    const order = await placeOrder(env, owner.token, [{ productId: 'yerba-1kg', quantity: 1 }]);
    await change(order, 'ENVIADO');
    expect((await myOrders(env, owner.token)).find((o) => o.id === order.id)?.status).toBe('ENVIADO');
    expect((await ownerView(order.id))?.status).toBe('ENVIADO');
  });

  it('E3: an ENVIADO order moves to ENVIADO again with no error and nothing else changes', async () => {
    const order = await placeOrder(env, owner.token, [{ productId: 'yerba-1kg', quantity: 1 }]);
    const first = await change(order, 'ENVIADO');
    const again = await change(order, 'ENVIADO');
    expect(again).toEqual(first);
    expect((await ownerView(order.id))?.status).toBe('ENVIADO');
  });

  it('E4: after the change, same lines, total, number and createdAt as the original', async () => {
    const order = await placeOrder(env, owner.token, [
      { productId: 'yerba-1kg', quantity: 2 },
      { productId: 'arroz-1kg', quantity: 5 },
    ]);
    const updated = await change(order, 'ENTREGADO');
    expect(updated).toEqual({ ...order, customerId: owner.customerId, status: 'ENTREGADO' });
    expect(await ownerView(order.id)).toEqual({ ...order, status: 'ENTREGADO' });
  });

  it('E5: nonexistent id → ORDER_NOT_FOUND; no order is created', async () => {
    const before = await listAllOrders(env, dist.token);
    const res = await changeOrderStatus(env, dist.token, {
      customerId: owner.customerId,
      id: '01J0000000000000000000NONE',
      status: 'ENVIADO',
    });
    expect(res.data?.setOrderStatus ?? null).toBeNull();
    expect(res.errors?.[0]?.errorType).toBe('ORDER_NOT_FOUND');
    expect(await listAllOrders(env, dist.token)).toHaveLength(before.length);
  });

  it("E5: another store's customerId → ORDER_NOT_FOUND; the order does not change and the other store gains no orders", async () => {
    const order = await placeOrder(env, owner.token, [{ productId: 'arroz-1kg', quantity: 1 }]);
    const otherBefore = await myOrders(env, other.token);
    const res = await changeOrderStatus(env, dist.token, {
      customerId: other.customerId,
      id: order.id,
      status: 'CANCELADO',
    });
    expect(res.data?.setOrderStatus ?? null).toBeNull();
    expect(res.errors?.[0]?.errorType).toBe('ORDER_NOT_FOUND');
    expect((await ownerView(order.id))?.status).toBe('RECIBIDO');
    expect(await myOrders(env, other.token)).toEqual(otherBefore);
  });

  it('E6: status PERDIDO (outside S-04) → AppSync rejects the request; the order does not change', async () => {
    const order = await placeOrder(env, owner.token, [{ productId: 'arroz-1kg', quantity: 1 }]);
    const res = await changeOrderStatus(env, dist.token, { customerId: owner.customerId, id: order.id, status: 'PERDIDO' });
    expect(res.data?.setOrderStatus ?? null).toBeNull();
    expect(res.errors?.length).toBeGreaterThan(0);
    expect((await ownerView(order.id))?.status).toBe('RECIBIDO');
  });
});
