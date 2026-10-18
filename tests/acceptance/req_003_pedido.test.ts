// REQ-003 Armar y confirmar pedido — ejemplos de API (DEC-007). Los pedidos los hace un cliente
// desechable para no ensuciar el historial de almacen1 en la demo. El botón deshabilitado de E5, el
// carrito vacío tras confirmar y el subtotal en pantalla son manuales (LOG).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Product } from '../../backend/src/domain/catalog.ts';
import type { StageEnv } from '../../scripts/lib/env.ts';
import { stageEnv } from '../lib/api.ts';
import {
  type LineInput,
  type TempCustomer,
  createCustomer,
  createOrder,
  createProduct,
  createProducts,
  deleteCustomers,
  deleteProducts,
  myOrders,
  placeOrder,
  sweepCustomers,
  sweepProducts,
} from './support/fixtures.ts';

const YERBA = 'yerba-1kg';
const ARROZ = 'arroz-1kg';

let env: StageEnv;
let customer: TempCustomer;
let inactive: Product;
let many: Product[];

beforeAll(async () => {
  env = stageEnv();
  await sweepProducts(env);
  await sweepCustomers(env);
  customer = await createCustomer(env);
  inactive = await createProduct(env, {
    name: 'Aceite 900 ml',
    presentation: 'Botella 900 ml',
    unitPrice: 2900,
    active: false,
  });
  many = await createProducts(
    env,
    Array.from({ length: 51 }, (_, i) => ({
      name: `Prueba ${String(i + 1).padStart(2, '0')}`,
      presentation: 'Unidad',
      unitPrice: 100,
      active: true,
    })),
  );
}, 60_000);

afterAll(async () => {
  await deleteProducts(env, [inactive, ...(many ?? [])].filter(Boolean).map((p) => p.productId));
  if (customer) await deleteCustomers(env, [customer]);
}, 60_000);

/** El pedido se rechaza con `code`, sin datos, y el cliente sigue con los mismos pedidos. */
async function expectRejected(lines: LineInput[], code: string): Promise<string> {
  const before = await myOrders(env, customer.token);
  const res = await createOrder(env, customer.token, lines);
  expect(res.data?.createOrder ?? null).toBeNull();
  expect(res.errors?.[0]?.errorType).toBe(code);
  expect(await myOrders(env, customer.token)).toHaveLength(before.length);
  return res.errors![0]!.message;
}

describe('REQ-003', () => {
  it('E1: 2 × Yerba + 5 × Arroz → pedido RECIBIDO, total 15500, con número', async () => {
    const order = await placeOrder(env, customer.token, [
      { productId: YERBA, quantity: 2 },
      { productId: ARROZ, quantity: 5 },
    ]);
    expect(order.status).toBe('RECIBIDO');
    expect(order.total).toBe(15500);
    expect(order.number).toBe(order.id.slice(-8).toUpperCase()); // S-11
    const byId = Object.fromEntries(order.lines.map((l) => [l.productId, l]));
    expect(byId[YERBA]).toMatchObject({ name: 'Yerba 1 kg', quantity: 2, unitPrice: 4500, subtotal: 9000 });
    expect(byId[ARROZ]).toMatchObject({ name: 'Arroz 1 kg', quantity: 5, unitPrice: 1300, subtotal: 6500 });
    expect((await myOrders(env, customer.token)).map((o) => o.id)).toContain(order.id);
  });

  it('E2: el cliente no puede fijar el precio; el pedido usa $4.500', async () => {
    // La entrada no tiene campo de precio (DEC-009): un precio enviado no llega al servidor.
    const before = await myOrders(env, customer.token);
    const withPrice = await createOrder(env, customer.token, [{ productId: YERBA, quantity: 1, unitPrice: 1 }]);
    expect(withPrice.data?.createOrder ?? null).toBeNull();
    expect(withPrice.errors?.length).toBeGreaterThan(0);
    expect(await myOrders(env, customer.token)).toHaveLength(before.length);

    const order = await placeOrder(env, customer.token, [{ productId: YERBA, quantity: 1 }]);
    expect(order.lines).toEqual([expect.objectContaining({ productId: YERBA, unitPrice: 4500, subtotal: 4500 })]);
    expect(order.total).toBe(4500);
  });

  it('E3: cantidad 0 → INVALID_QUANTITY; sin pedido', async () => {
    await expectRejected([{ productId: YERBA, quantity: 0 }], 'INVALID_QUANTITY');
  });

  it('E3: cantidad 1000 → INVALID_QUANTITY; sin pedido', async () => {
    await expectRejected([{ productId: YERBA, quantity: 1000 }], 'INVALID_QUANTITY');
  });

  it('E3 (borde): cantidades 1 y 999 se aceptan', async () => {
    const order = await placeOrder(env, customer.token, [
      { productId: YERBA, quantity: 1 },
      { productId: ARROZ, quantity: 999 },
    ]);
    expect(order.total).toBe(4500 + 999 * 1300);
  });

  it('E3 (borde): una línea válida invalida el pedido entero si otra no lo es', async () => {
    await expectRejected(
      [
        { productId: ARROZ, quantity: 2 },
        { productId: YERBA, quantity: 0 },
      ],
      'INVALID_QUANTITY',
    );
  });

  it('E4: producto inactivo → PRODUCT_UNAVAILABLE con el productId; sin pedido', async () => {
    const message = await expectRejected(
      [
        { productId: YERBA, quantity: 1 },
        { productId: inactive.productId, quantity: 1 },
      ],
      'PRODUCT_UNAVAILABLE',
    );
    expect(message).toContain(inactive.productId);
  });

  it('E4: producto inexistente → PRODUCT_UNAVAILABLE con el productId; sin pedido', async () => {
    const missing = 'acept-no-existe';
    const message = await expectRejected([{ productId: missing, quantity: 1 }], 'PRODUCT_UNAVAILABLE');
    expect(message).toContain(missing);
  });

  it('E5: carrito vacío → EMPTY_ORDER; sin pedido', async () => {
    await expectRejected([], 'EMPTY_ORDER');
  });

  it('E6: el mismo producto en dos líneas (2 y 3) se fusiona en una línea de 5', async () => {
    const order = await placeOrder(env, customer.token, [
      { productId: ARROZ, quantity: 2 },
      { productId: ARROZ, quantity: 3 },
    ]);
    expect(order.lines).toEqual([expect.objectContaining({ productId: ARROZ, quantity: 5, subtotal: 6500 })]);
    expect(order.total).toBe(6500);
  });

  it('E6 (borde): la fusión ocurre antes de validar (500 + 500 → INVALID_QUANTITY)', async () => {
    await expectRejected(
      [
        { productId: ARROZ, quantity: 500 },
        { productId: ARROZ, quantity: 500 },
      ],
      'INVALID_QUANTITY',
    );
  });

  it('E7: 51 productos distintos, cantidad 1 → TOO_MANY_LINES; sin pedido', async () => {
    await expectRejected(
      many.map((p) => ({ productId: p.productId, quantity: 1 })),
      'TOO_MANY_LINES',
    );
  });

  it('E7 (borde): 50 productos distintos se aceptan', async () => {
    const order = await placeOrder(
      env,
      customer.token,
      many.slice(0, 50).map((p) => ({ productId: p.productId, quantity: 1 })),
    );
    expect(order.lines).toHaveLength(50);
    expect(order.total).toBe(50 * 100);
  });
});
