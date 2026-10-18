// REQ-010 Distributor order panel — API examples (DEC-007, DEC-013). Orders are placed by two
// throwaway customers instead of almacen1/almacen2 (S-14). The messages of E3–E4 and the detail
// screen belong to the app (app/test + manual, S-27). The status for E2 is set up with the
// order:set-status script so it doesn't depend on REQ-011.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StageEnv } from '../../scripts/lib/env.ts';
import { stageEnv } from '../lib/api.ts';
import {
  type TempCustomer,
  type TempUser,
  createCustomer,
  createDistributor,
  deleteCustomers,
  listAllOrders,
  placeOrder,
  setOrderStatus,
  sweepCustomers,
} from './support/fixtures.ts';

let env: StageEnv;
let store1: TempCustomer;
let store2: TempCustomer;
let dist: TempUser;

beforeAll(async () => {
  env = stageEnv();
  await sweepCustomers(env);
  store1 = await createCustomer(env);
  store2 = await createCustomer(env);
  dist = await createDistributor(env);
}, 60_000);

afterAll(async () => {
  await deleteCustomers(env, [store1, store2, dist].filter(Boolean));
}, 60_000);

describe('REQ-010', () => {
  it('E1: orders from two stores; most recent first, each with its store', async () => {
    const first = await placeOrder(env, store1.token, [{ productId: 'arroz-1kg', quantity: 1 }]);
    await new Promise((r) => setTimeout(r, 1100));
    const second = await placeOrder(env, store2.token, [{ productId: 'yerba-1kg', quantity: 1 }]);

    const list = await listAllOrders(env, dist.token);
    const ids = list.map((o) => o.id);
    expect(ids.indexOf(second.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
    const dates = list.map((o) => Date.parse(o.createdAt));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    expect(list.find((o) => o.id === first.id)).toMatchObject({
      customerId: store1.customerId,
      number: first.number,
      createdAt: first.createdAt,
      total: 1300,
      status: 'RECIBIDO',
    });
    expect(list.find((o) => o.id === second.id)).toMatchObject({
      customerId: store2.customerId,
      number: second.number,
      createdAt: second.createdAt,
      total: 4500,
      status: 'RECIBIDO',
    });
  });

  it('E2: allOrders(status: ENVIADO) returns only the ENVIADO ones; without a filter it returns both', async () => {
    const received = await placeOrder(env, store1.token, [{ productId: 'arroz-1kg', quantity: 1 }]);
    const shipped = await placeOrder(env, store2.token, [{ productId: 'arroz-1kg', quantity: 2 }]);
    const run = setOrderStatus(shipped.id, 'ENVIADO');
    expect(run.status, run.stderr || run.stdout).toBe(0);

    const filtered = await listAllOrders(env, dist.token, 'ENVIADO');
    expect(filtered.map((o) => o.id)).toContain(shipped.id);
    expect(filtered.map((o) => o.id)).not.toContain(received.id);
    expect(filtered.every((o) => o.status === 'ENVIADO')).toBe(true);

    const all = (await listAllOrders(env, dist.token)).map((o) => o.id);
    expect(all).toContain(shipped.id);
    expect(all).toContain(received.id);
  });

  it('E5: order of 2 Yerba + 5 Arroz → store, 2 lines with frozen prices, total 15500 and status', async () => {
    const order = await placeOrder(env, store1.token, [
      { productId: 'yerba-1kg', quantity: 2 },
      { productId: 'arroz-1kg', quantity: 5 },
    ]);

    const seen = (await listAllOrders(env, dist.token)).find((o) => o.id === order.id);
    expect(seen).toMatchObject({ customerId: store1.customerId, number: order.number, total: 15500, status: 'RECIBIDO' });
    const byId = Object.fromEntries((seen?.lines ?? []).map((l) => [l.productId, l]));
    expect(seen?.lines).toHaveLength(2);
    expect(byId['yerba-1kg']).toMatchObject({ name: 'Yerba 1 kg', quantity: 2, unitPrice: 4500, subtotal: 9000 });
    expect(byId['arroz-1kg']).toMatchObject({ name: 'Arroz 1 kg', quantity: 5, unitPrice: 1300, subtotal: 6500 });
  });
});
