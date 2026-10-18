// REQ-009 Role-based access — API examples (DEC-007, DEC-013). E1–E4 belong to the app (app/test +
// manual, S-27). Throwaway users: a customer, a distributor and one with no group (S-14, S-22).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StageEnv } from '../../scripts/lib/env.ts';
import { gql, stageEnv } from '../lib/api.ts';
import {
  MY_ORDERS,
  ORDER,
  type Order,
  type TempCustomer,
  type TempUser,
  allOrders,
  changeOrderStatus,
  createCustomer,
  createDistributor,
  createOrder,
  createUngrouped,
  deleteCustomers,
  listAllOrders,
  myOrders,
  placeOrder,
  sweepCustomers,
} from './support/fixtures.ts';

let env: StageEnv;
let customer: TempCustomer;
let order: Order;

beforeAll(async () => {
  env = stageEnv();
  await sweepCustomers(env);
  customer = await createCustomer(env);
  order = await placeOrder(env, customer.token, [{ productId: 'arroz-1kg', quantity: 1 }]);
}, 60_000);

afterAll(async () => {
  if (customer) await deleteCustomers(env, [customer]);
}, 60_000);

/** No data and `Unauthorized` as the first error. */
function expectUnauthorized(res: { data?: Record<string, unknown> | null; errors?: Array<{ errorType?: string }> }, field: string) {
  expect(res.data?.[field] ?? null).toBeNull();
  expect(res.errors?.[0]?.errorType).toMatch(/Unauthorized/);
}

describe('REQ-009', () => {
  describe('customer (almacenero)', () => {
    it('E5: customer calls allOrders → Unauthorized and no data', async () => {
      expectUnauthorized(await allOrders(env, customer.token), 'allOrders');
    });

    it('E5: customer calls setOrderStatus on their own order → Unauthorized; the order does not change', async () => {
      const res = await changeOrderStatus(env, customer.token, {
        customerId: customer.customerId,
        id: order.id,
        status: 'ENVIADO',
      });
      expectUnauthorized(res, 'setOrderStatus');
      const detail = await gql<{ order: Order | null }>(env, ORDER, { id: order.id }, customer.token);
      expect(detail.data?.order?.status).toBe('RECIBIDO');
    });
  });

  describe('distributor', () => {
    let dist: TempUser;

    beforeAll(async () => {
      dist = await createDistributor(env);
    }, 60_000);

    afterAll(async () => {
      if (dist) await deleteCustomers(env, [dist]);
    }, 60_000);

    it('E6: distributor calls myOrders → Unauthorized and no data', async () => {
      expectUnauthorized(await gql(env, MY_ORDERS, {}, dist.token), 'myOrders');
    });

    it('E6: distributor calls order(id) on an existing order → Unauthorized and no data', async () => {
      expectUnauthorized(await gql(env, ORDER, { id: order.id }, dist.token), 'order');
    });

    it('E6: distributor calls createOrder → Unauthorized; no order is created', async () => {
      const before = await listAllOrders(env, dist.token);
      expectUnauthorized(await createOrder(env, dist.token, [{ productId: 'arroz-1kg', quantity: 1 }]), 'createOrder');
      expect(await listAllOrders(env, dist.token)).toHaveLength(before.length);
    });
  });

  describe('user with no group', () => {
    let nobody: TempUser;

    beforeAll(async () => {
      nobody = await createUngrouped(env);
    }, 60_000);

    afterAll(async () => {
      if (nobody) await deleteCustomers(env, [nobody]);
    }, 60_000);

    it('E3 (API, edge): with no group there is no access to any role operation', async () => {
      expectUnauthorized(await gql(env, MY_ORDERS, {}, nobody.token), 'myOrders');
      expectUnauthorized(await allOrders(env, nobody.token), 'allOrders');
      const res = await changeOrderStatus(env, nobody.token, {
        customerId: customer.customerId,
        id: order.id,
        status: 'ENVIADO',
      });
      expectUnauthorized(res, 'setOrderStatus');
      expect((await myOrders(env, customer.token)).find((o) => o.id === order.id)?.status).toBe('RECIBIDO');
    });
  });
});
