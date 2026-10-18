// REQ-011 Cambiar estado de un pedido — ejemplos de API (DEC-007, DEC-013). El dueño es un cliente
// desechable en lugar de almacen1 (S-14); `other` presta su `customerId` para E5. E7 (fallo de red en
// la app) es de app/test + manual (S-27).
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

/** Cambia el estado como distribuidor; falla la prueba si la API lo rechaza. */
async function change(order: Order, status: string) {
  const res = await changeOrderStatus(env, dist.token, { customerId: owner.customerId, id: order.id, status });
  expect(res.errors).toBeUndefined();
  return res.data!.setOrderStatus!;
}

describe('REQ-011', () => {
  it('E1: RECIBIDO → EN_PREPARACION; la respuesta y el panel lo muestran', async () => {
    const order = await placeOrder(env, owner.token, [{ productId: 'arroz-1kg', quantity: 1 }]);
    const updated = await change(order, 'EN_PREPARACION');
    expect(updated).toMatchObject({ id: order.id, customerId: owner.customerId, status: 'EN_PREPARACION' });
    expect((await listAllOrders(env, dist.token)).find((o) => o.id === order.id)?.status).toBe('EN_PREPARACION');
  });

  it('E2: el distribuidor pasa el pedido a ENVIADO; el dueño lo ve al refrescar', async () => {
    const order = await placeOrder(env, owner.token, [{ productId: 'yerba-1kg', quantity: 1 }]);
    await change(order, 'ENVIADO');
    expect((await myOrders(env, owner.token)).find((o) => o.id === order.id)?.status).toBe('ENVIADO');
    expect((await ownerView(order.id))?.status).toBe('ENVIADO');
  });

  it('E3: un pedido ENVIADO pasa otra vez a ENVIADO sin error y nada más cambia', async () => {
    const order = await placeOrder(env, owner.token, [{ productId: 'yerba-1kg', quantity: 1 }]);
    const first = await change(order, 'ENVIADO');
    const again = await change(order, 'ENVIADO');
    expect(again).toEqual(first);
    expect((await ownerView(order.id))?.status).toBe('ENVIADO');
  });

  it('E4: tras el cambio, mismas líneas, total, número y createdAt que el original', async () => {
    const order = await placeOrder(env, owner.token, [
      { productId: 'yerba-1kg', quantity: 2 },
      { productId: 'arroz-1kg', quantity: 5 },
    ]);
    const updated = await change(order, 'ENTREGADO');
    expect(updated).toEqual({ ...order, customerId: owner.customerId, status: 'ENTREGADO' });
    expect(await ownerView(order.id)).toEqual({ ...order, status: 'ENTREGADO' });
  });

  it('E5: id inexistente → ORDER_NOT_FOUND; no se crea ningún pedido', async () => {
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

  it('E5: customerId de otro almacén → ORDER_NOT_FOUND; el pedido no cambia y el otro no gana pedidos', async () => {
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

  it('E6: estado PERDIDO (fuera de S-04) → AppSync rechaza la solicitud; el pedido no cambia', async () => {
    const order = await placeOrder(env, owner.token, [{ productId: 'arroz-1kg', quantity: 1 }]);
    const res = await changeOrderStatus(env, dist.token, { customerId: owner.customerId, id: order.id, status: 'PERDIDO' });
    expect(res.data?.setOrderStatus ?? null).toBeNull();
    expect(res.errors?.length).toBeGreaterThan(0);
    expect((await ownerView(order.id))?.status).toBe('RECIBIDO');
  });
});
