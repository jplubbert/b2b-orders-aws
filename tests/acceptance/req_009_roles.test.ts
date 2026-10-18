// REQ-009 Acceso por rol — ejemplos de API (DEC-007, DEC-013). E1–E4 son de la app (app/test + manual,
// S-27). Usuarios desechables: un cliente, un distribuidor y uno sin grupo (S-14, S-22).
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

/** Sin datos y con `Unauthorized` como primer error. */
function expectUnauthorized(res: { data?: Record<string, unknown> | null; errors?: Array<{ errorType?: string }> }, field: string) {
  expect(res.data?.[field] ?? null).toBeNull();
  expect(res.errors?.[0]?.errorType).toMatch(/Unauthorized/);
}

describe('REQ-009', () => {
  describe('almacenero', () => {
    it('E5: almacenero llama allOrders → Unauthorized y sin datos', async () => {
      expectUnauthorized(await allOrders(env, customer.token), 'allOrders');
    });

    it('E5: almacenero llama setOrderStatus sobre su propio pedido → Unauthorized; el pedido no cambia', async () => {
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

  describe('distribuidor', () => {
    let dist: TempUser;

    beforeAll(async () => {
      dist = await createDistributor(env);
    }, 60_000);

    afterAll(async () => {
      if (dist) await deleteCustomers(env, [dist]);
    }, 60_000);

    it('E6: distribuidor llama myOrders → Unauthorized y sin datos', async () => {
      expectUnauthorized(await gql(env, MY_ORDERS, {}, dist.token), 'myOrders');
    });

    it('E6: distribuidor llama order(id) de un pedido existente → Unauthorized y sin datos', async () => {
      expectUnauthorized(await gql(env, ORDER, { id: order.id }, dist.token), 'order');
    });

    it('E6: distribuidor llama createOrder → Unauthorized; no se crea ningún pedido', async () => {
      const before = await listAllOrders(env, dist.token);
      expectUnauthorized(await createOrder(env, dist.token, [{ productId: 'arroz-1kg', quantity: 1 }]), 'createOrder');
      expect(await listAllOrders(env, dist.token)).toHaveLength(before.length);
    });
  });

  describe('usuario sin grupo', () => {
    let nobody: TempUser;

    beforeAll(async () => {
      nobody = await createUngrouped(env);
    }, 60_000);

    afterAll(async () => {
      if (nobody) await deleteCustomers(env, [nobody]);
    }, 60_000);

    it('E3 (API, borde): sin grupo no accede a operaciones de ningún rol', async () => {
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
