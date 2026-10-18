// REQ-004 Ver estado de mis pedidos — ejemplos de API (DEC-007). Los pedidos los hace un cliente
// desechable; almacen2 solo intenta leer (E3). El mensaje de E4 en pantalla es manual (LOG).
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
  it('E1: se lista primero el pedido más reciente, con número, fecha, total y estado', async () => {
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

  it('E2: el distribuidor pasa el pedido a ENVIADO por script; al refrescar se ve ENVIADO', async () => {
    const order = await placeOrder(env, owner.token, [{ productId: 'arroz-1kg', quantity: 2 }]);
    const run = setOrderStatus(order.id, 'ENVIADO');
    expect(run.status, run.stderr || run.stdout).toBe(0);

    expect((await myOrders(env, owner.token)).find((o) => o.id === order.id)?.status).toBe('ENVIADO');
    const detail = await getOrder(owner.token, order.id);
    expect(detail.errors).toBeUndefined();
    expect(detail.data?.order?.status).toBe('ENVIADO');
  });

  it('E2 (borde): el script rechaza un estado fuera de S-04 y no cambia el pedido', async () => {
    const order = await placeOrder(env, owner.token, [{ productId: 'arroz-1kg', quantity: 1 }]);
    const run = setOrderStatus(order.id, 'PERDIDO');
    expect(run.status).not.toBe(0);
    expect((await getOrder(owner.token, order.id)).data?.order?.status).toBe('RECIBIDO');
  });

  it('E3: almacen2 pide order(id) de un pedido ajeno → null, igual que uno inexistente', async () => {
    const order = await placeOrder(env, owner.token, [{ productId: 'yerba-1kg', quantity: 1 }]);
    const intruder = await login(env, SEED_USERS[1]!.email);

    const foreign = await getOrder(intruder, order.id);
    const missing = await getOrder(intruder, '01J0000000000000000000NONE');
    expect(foreign.data).toEqual({ order: null });
    expect(foreign).toEqual(missing);
    expect((await myOrders(env, intruder)).map((o) => o.id)).not.toContain(order.id);

    // El dueño sí lo ve: el null de arriba no es porque `order` no exista.
    expect((await getOrder(owner.token, order.id)).data?.order?.id).toBe(order.id);
  });

  it('E4: cliente sin pedidos → lista vacía', async () => {
    expect(await myOrders(env, empty.token)).toEqual([]);
  });

  it('E5: si el precio de catálogo cambia después de confirmar, el detalle mantiene el precio congelado', async () => {
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
