// REQ-012 Order status history — API examples (DEC-007, DEC-020). The history is read through
// `orderHistory(id)` (S-29) with active waiting of up to 30 s, since recording is asynchronous.
// Owners are throwaway customers instead of almacen1/almacen2 (S-14). E5 (duplicate delivery) is
// backend/test, E6 (DLQ) infra/test, E11–E12 and the "Historial" section app/test + manual.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StageEnv } from '../../scripts/lib/env.ts';
import { gql, stageEnv } from '../lib/api.ts';
import {
  type Order,
  type OrderStatusEvent,
  type TempCustomer,
  type TempUser,
  changeOrderStatus,
  createCustomer,
  createDistributor,
  createOrder,
  deleteCustomers,
  listOrderHistory,
  myOrders,
  orderHistory,
  placeOrder,
  sweepCustomers,
  waitForHistory,
} from './support/fixtures.ts';

const ASYNC_TIMEOUT = 120_000;
const MISSING_ID = '01J0000000000000000000NONE';

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

/** Changes the status as the distributor; fails the test if the API rejects it. */
async function change(order: Order, status: string) {
  const res = await changeOrderStatus(env, dist.token, { customerId: owner.customerId, id: order.id, status });
  expect(res.errors).toBeUndefined();
  return res.data!.setOrderStatus!;
}

/** [from, to] pairs, after checking the events are ordered by `at` ascending. */
function transitions(events: OrderStatusEvent[]): Array<[string | null, string]> {
  const times = events.map((e) => Date.parse(e.at));
  expect(times.every((t) => !Number.isNaN(t))).toBe(true);
  expect(times).toEqual([...times].sort((a, b) => a - b));
  return events.map((e) => [e.from ?? null, e.to]);
}

describe('REQ-012', () => {
  it(
    'E1: a confirmed order gets one RECIBIDO event (no previous status) within 30 s',
    async () => {
      const order = await placeOrder(env, owner.token, [{ productId: 'arroz-1kg', quantity: 1 }]);
      const events = await waitForHistory(env, owner.token, order.id, 1);
      expect(events).toEqual([
        {
          eventId: expect.any(String),
          orderId: order.id,
          customerId: owner.customerId,
          from: null,
          to: 'RECIBIDO',
          at: expect.any(String),
        },
      ]);
      expect(Number.isNaN(Date.parse(events[0]!.at))).toBe(false);
    },
    ASYNC_TIMEOUT,
  );

  it(
    'E2: ENVIADO then ENTREGADO → 3 events ordered by time: RECIBIDO, RECIBIDO → ENVIADO, ENVIADO → ENTREGADO',
    async () => {
      const order = await placeOrder(env, owner.token, [{ productId: 'yerba-1kg', quantity: 1 }]);
      await change(order, 'ENVIADO');
      await change(order, 'ENTREGADO');
      const events = await waitForHistory(env, dist.token, order.id, 3);
      expect(transitions(events)).toEqual([
        [null, 'RECIBIDO'],
        ['RECIBIDO', 'ENVIADO'],
        ['ENVIADO', 'ENTREGADO'],
      ]);
      expect(events.every((e) => e.orderId === order.id && e.customerId === owner.customerId)).toBe(true);
      expect(new Set(events.map((e) => e.eventId)).size).toBe(3);
    },
    ASYNC_TIMEOUT,
  );

  it(
    'E3: choosing the same status (ENVIADO → ENVIADO) records an ENVIADO → ENVIADO event',
    async () => {
      const order = await placeOrder(env, owner.token, [{ productId: 'yerba-1kg', quantity: 1 }]);
      await change(order, 'ENVIADO');
      await change(order, 'ENVIADO');
      const events = await waitForHistory(env, dist.token, order.id, 3);
      expect(transitions(events)).toEqual([
        [null, 'RECIBIDO'],
        ['RECIBIDO', 'ENVIADO'],
        ['ENVIADO', 'ENVIADO'],
      ]);
    },
    ASYNC_TIMEOUT,
  );

  it(
    'E4: rejected operations (EMPTY_ORDER, ORDER_NOT_FOUND) record no event',
    async () => {
      const order = await placeOrder(env, owner.token, [{ productId: 'arroz-1kg', quantity: 1 }]);
      await waitForHistory(env, owner.token, order.id, 1);
      const ownerBefore = await myOrders(env, owner.token);

      const empty = await createOrder(env, owner.token, []);
      expect(empty.errors?.[0]?.errorType).toBe('EMPTY_ORDER');
      const wrongCustomer = await changeOrderStatus(env, dist.token, {
        customerId: other.customerId,
        id: order.id,
        status: 'CANCELADO',
      });
      expect(wrongCustomer.errors?.[0]?.errorType).toBe('ORDER_NOT_FOUND');
      const missing = await changeOrderStatus(env, dist.token, {
        customerId: owner.customerId,
        id: MISSING_ID,
        status: 'ENVIADO',
      });
      expect(missing.errors?.[0]?.errorType).toBe('ORDER_NOT_FOUND');

      // A valid change after the rejections: once its event is recorded, earlier ones would be too.
      await change(order, 'ENVIADO');
      const events = await waitForHistory(env, owner.token, order.id, 2);
      expect(transitions(events)).toEqual([
        [null, 'RECIBIDO'],
        ['RECIBIDO', 'ENVIADO'],
      ]);
      expect(await listOrderHistory(env, dist.token, MISSING_ID)).toEqual([]);
      expect(await myOrders(env, owner.token)).toHaveLength(ownerBefore.length);
      expect(await myOrders(env, other.token)).toEqual([]);
    },
    ASYNC_TIMEOUT,
  );

  it('E7: the deployed contract only adds orderHistory and OrderStatusEvent', async () => {
    // REQ-001..011 still passing unchanged is the rest of this suite (req_001..req_011 files).
    const res = await gql<Record<string, { fields: Array<{ name: string }> } | null>>(
      env,
      /* GraphQL */ `
        query Contract {
          query: __type(name: "Query") { fields { name } }
          mutation: __type(name: "Mutation") { fields { name } }
          event: __type(name: "OrderStatusEvent") { fields { name } }
        }
      `,
      {},
      owner.token,
    );
    expect(res.errors).toBeUndefined();
    const names = (key: string) => res.data?.[key]?.fields.map((f) => f.name).sort();
    expect(names('query')).toEqual(['allOrders', 'listProducts', 'myOrders', 'order', 'orderHistory']);
    expect(names('mutation')).toEqual(['createOrder', 'setOrderStatus']);
    expect(names('event')).toEqual(['at', 'customerId', 'eventId', 'from', 'orderId', 'to']);
  });

  describe('reading the history (E8–E10)', () => {
    let order: Order;
    let ownerEvents: OrderStatusEvent[];

    beforeAll(async () => {
      order = await placeOrder(env, owner.token, [{ productId: 'yerba-1kg', quantity: 2 }]);
      await change(order, 'ENVIADO');
      ownerEvents = await waitForHistory(env, owner.token, order.id, 2);
    }, ASYNC_TIMEOUT);

    it("E8: the owner's orderHistory returns RECIBIDO and RECIBIDO → ENVIADO, oldest first", () => {
      expect(transitions(ownerEvents)).toEqual([
        [null, 'RECIBIDO'],
        ['RECIBIDO', 'ENVIADO'],
      ]);
      expect(ownerEvents.every((e) => e.orderId === order.id && e.customerId === owner.customerId)).toBe(true);
    });

    it("E9: the distributor's orderHistory returns the same 2 events", async () => {
      expect(await listOrderHistory(env, dist.token, order.id)).toEqual(ownerEvents);
    });

    it("E10: another store's orderHistory of that order is an empty list, with no error", async () => {
      const res = await orderHistory(env, other.token, order.id);
      expect(res.errors).toBeUndefined();
      expect(res.data?.orderHistory).toEqual([]);
    });
  });
});
