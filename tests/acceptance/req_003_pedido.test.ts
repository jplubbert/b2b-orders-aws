// REQ-003 Build and confirm an order — API examples (DEC-007). Orders are placed by a throwaway
// customer so almacen1's history stays clean for the demo. The disabled button of E5, the empty cart
// after confirming and the on-screen subtotal are manual (LOG).
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
const RICE = 'arroz-1kg';

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

/** The order is rejected with `code`, with no data, and the customer keeps the same orders. */
async function expectRejected(lines: LineInput[], code: string): Promise<string> {
  const before = await myOrders(env, customer.token);
  const res = await createOrder(env, customer.token, lines);
  expect(res.data?.createOrder ?? null).toBeNull();
  expect(res.errors?.[0]?.errorType).toBe(code);
  expect(await myOrders(env, customer.token)).toHaveLength(before.length);
  return res.errors![0]!.message;
}

describe('REQ-003', () => {
  it('E1: 2 × Yerba + 5 × Arroz → RECIBIDO order, total 15500, with a number', async () => {
    const order = await placeOrder(env, customer.token, [
      { productId: YERBA, quantity: 2 },
      { productId: RICE, quantity: 5 },
    ]);
    expect(order.status).toBe('RECIBIDO');
    expect(order.total).toBe(15500);
    expect(order.number).toBe(order.id.slice(-8).toUpperCase()); // S-11
    const byId = Object.fromEntries(order.lines.map((l) => [l.productId, l]));
    expect(byId[YERBA]).toMatchObject({ name: 'Yerba 1 kg', quantity: 2, unitPrice: 4500, subtotal: 9000 });
    expect(byId[RICE]).toMatchObject({ name: 'Arroz 1 kg', quantity: 5, unitPrice: 1300, subtotal: 6500 });
    expect((await myOrders(env, customer.token)).map((o) => o.id)).toContain(order.id);
  });

  it('E2: the customer cannot set the price; the order uses $4.500', async () => {
    // The input has no price field (DEC-009): a price sent by the client never reaches the server.
    const before = await myOrders(env, customer.token);
    const withPrice = await createOrder(env, customer.token, [{ productId: YERBA, quantity: 1, unitPrice: 1 }]);
    expect(withPrice.data?.createOrder ?? null).toBeNull();
    expect(withPrice.errors?.length).toBeGreaterThan(0);
    expect(await myOrders(env, customer.token)).toHaveLength(before.length);

    const order = await placeOrder(env, customer.token, [{ productId: YERBA, quantity: 1 }]);
    expect(order.lines).toEqual([expect.objectContaining({ productId: YERBA, unitPrice: 4500, subtotal: 4500 })]);
    expect(order.total).toBe(4500);
  });

  it('E3: quantity 0 → INVALID_QUANTITY; no order', async () => {
    await expectRejected([{ productId: YERBA, quantity: 0 }], 'INVALID_QUANTITY');
  });

  it('E3: quantity 1000 → INVALID_QUANTITY; no order', async () => {
    await expectRejected([{ productId: YERBA, quantity: 1000 }], 'INVALID_QUANTITY');
  });

  it('E3 (edge): quantities 1 and 999 are accepted', async () => {
    const order = await placeOrder(env, customer.token, [
      { productId: YERBA, quantity: 1 },
      { productId: RICE, quantity: 999 },
    ]);
    expect(order.total).toBe(4500 + 999 * 1300);
  });

  it('E3 (edge): one invalid line invalidates the whole order even if another line is valid', async () => {
    await expectRejected(
      [
        { productId: RICE, quantity: 2 },
        { productId: YERBA, quantity: 0 },
      ],
      'INVALID_QUANTITY',
    );
  });

  it('E4: inactive product → PRODUCT_UNAVAILABLE with the productId; no order', async () => {
    const message = await expectRejected(
      [
        { productId: YERBA, quantity: 1 },
        { productId: inactive.productId, quantity: 1 },
      ],
      'PRODUCT_UNAVAILABLE',
    );
    expect(message).toContain(inactive.productId);
  });

  it('E4: nonexistent product → PRODUCT_UNAVAILABLE with the productId; no order', async () => {
    const missing = 'acept-no-existe';
    const message = await expectRejected([{ productId: missing, quantity: 1 }], 'PRODUCT_UNAVAILABLE');
    expect(message).toContain(missing);
  });

  it('E5: empty cart → EMPTY_ORDER; no order', async () => {
    await expectRejected([], 'EMPTY_ORDER');
  });

  it('E6: the same product on two lines (2 and 3) is merged into one line of 5', async () => {
    const order = await placeOrder(env, customer.token, [
      { productId: RICE, quantity: 2 },
      { productId: RICE, quantity: 3 },
    ]);
    expect(order.lines).toEqual([expect.objectContaining({ productId: RICE, quantity: 5, subtotal: 6500 })]);
    expect(order.total).toBe(6500);
  });

  it('E6 (edge): merging happens before validation (500 + 500 → INVALID_QUANTITY)', async () => {
    await expectRejected(
      [
        { productId: RICE, quantity: 500 },
        { productId: RICE, quantity: 500 },
      ],
      'INVALID_QUANTITY',
    );
  });

  it('E7: 51 distinct products, quantity 1 → TOO_MANY_LINES; no order', async () => {
    await expectRejected(
      many.map((p) => ({ productId: p.productId, quantity: 1 })),
      'TOO_MANY_LINES',
    );
  });

  it('E7 (edge): 50 distinct products are accepted', async () => {
    const order = await placeOrder(
      env,
      customer.token,
      many.slice(0, 50).map((p) => ({ productId: p.productId, quantity: 1 })),
    );
    expect(order.lines).toHaveLength(50);
    expect(order.total).toBe(50 * 100);
  });
});
