import { describe, expect, it } from 'vitest';
import type { Product } from '../src/domain/catalog.js';
import { buildOrder, mergeLines, orderNumber } from '../src/domain/order.js';

const product = (productId: string, name: string, unitPrice: number, active = true): Product => ({
  productId,
  name,
  presentation: 'Paquete 1 kg',
  unitPrice,
  active,
});

const catalog = new Map(
  [
    product('yerba', 'Yerba 1 kg', 4500),
    product('arroz', 'Arroz 1 kg', 1300),
    product('aceite', 'Aceite 900 ml', 2900, false),
    ...Array.from({ length: 51 }, (_, i) => product(`p${i}`, `Test ${i}`, 100)),
  ].map((p) => [p.productId, p]),
);

const meta = { id: '01JAAAAAAAAAAAAAAAAAB7XQ2M9Z', customerId: 'C-1', createdAt: '2026-10-17T23:00:00.000Z' };

const build = (lines: { productId: string; quantity: number }[]) => buildOrder(lines, catalog, meta);

describe('buildOrder (REQ-003)', () => {
  it('E1: 2 × Yerba + 5 × Arroz → RECIBIDO, total 15500, lines with frozen price', () => {
    const order = build([
      { productId: 'yerba', quantity: 2 },
      { productId: 'arroz', quantity: 5 },
    ]);
    expect(order).toEqual({
      id: meta.id,
      customerId: 'C-1',
      number: 'B7XQ2M9Z',
      createdAt: meta.createdAt,
      total: 15500,
      status: 'RECIBIDO',
      lines: [
        { productId: 'yerba', name: 'Yerba 1 kg', presentation: 'Paquete 1 kg', quantity: 2, unitPrice: 4500, subtotal: 9000 },
        { productId: 'arroz', name: 'Arroz 1 kg', presentation: 'Paquete 1 kg', quantity: 5, unitPrice: 1300, subtotal: 6500 },
      ],
    });
  });

  it('E2: a price in the input is ignored; the catalog wins', () => {
    const order = build([{ productId: 'yerba', quantity: 1, unitPrice: 1 } as { productId: string; quantity: number }]);
    expect(order.lines[0]).toMatchObject({ unitPrice: 4500, subtotal: 4500 });
    expect(order.total).toBe(4500);
  });

  it.each([0, 1000, -1, 1.5])('E3: quantity %s → INVALID_QUANTITY', (quantity) => {
    expect(() => build([{ productId: 'yerba', quantity }])).toThrow(expect.objectContaining({ name: 'INVALID_QUANTITY' }));
  });

  it('E3 (edge): 1 and 999 are accepted', () => {
    const order = build([
      { productId: 'yerba', quantity: 1 },
      { productId: 'arroz', quantity: 999 },
    ]);
    expect(order.total).toBe(4500 + 999 * 1300);
  });

  it('E3 (edge): one invalid line rejects the whole order', () => {
    expect(() =>
      build([
        { productId: 'arroz', quantity: 2 },
        { productId: 'yerba', quantity: 0 },
      ]),
    ).toThrow(expect.objectContaining({ name: 'INVALID_QUANTITY' }));
  });

  it.each(['aceite', 'no-existe'])('E4: %s → PRODUCT_UNAVAILABLE with the productId in the message', (productId) => {
    expect(() =>
      build([
        { productId: 'yerba', quantity: 1 },
        { productId, quantity: 1 },
      ]),
    ).toThrow(expect.objectContaining({ name: 'PRODUCT_UNAVAILABLE', message: expect.stringContaining(productId) }));
  });

  it('E5: no lines → EMPTY_ORDER', () => {
    expect(() => build([])).toThrow(expect.objectContaining({ name: 'EMPTY_ORDER' }));
  });

  it('E6: the same product in two lines (2 and 3) becomes one line of 5', () => {
    const order = build([
      { productId: 'arroz', quantity: 2 },
      { productId: 'arroz', quantity: 3 },
    ]);
    expect(order.lines).toEqual([expect.objectContaining({ productId: 'arroz', quantity: 5, subtotal: 6500 })]);
  });

  it('E6 (edge): merges before validating: 500 + 500 → INVALID_QUANTITY', () => {
    expect(() =>
      build([
        { productId: 'arroz', quantity: 500 },
        { productId: 'arroz', quantity: 500 },
      ]),
    ).toThrow(expect.objectContaining({ name: 'INVALID_QUANTITY' }));
  });

  it('E7: 51 distinct products → TOO_MANY_LINES; 50 are accepted', () => {
    const lines = Array.from({ length: 51 }, (_, i) => ({ productId: `p${i}`, quantity: 1 }));
    expect(() => build(lines)).toThrow(expect.objectContaining({ name: 'TOO_MANY_LINES' }));
    expect(build(lines.slice(0, 50)).lines).toHaveLength(50);
  });

  it('E7 (edge): merged lines are counted (51 lines of 50 products are accepted)', () => {
    const lines = Array.from({ length: 50 }, (_, i) => ({ productId: `p${i}`, quantity: 1 }));
    expect(build([...lines, { productId: 'p0', quantity: 1 }]).lines).toHaveLength(50);
  });
});

describe('mergeLines and orderNumber', () => {
  it('keeps the order of first appearance', () => {
    expect(
      mergeLines([
        { productId: 'b', quantity: 1 },
        { productId: 'a', quantity: 2 },
        { productId: 'b', quantity: 3 },
      ]),
    ).toEqual([
      { productId: 'b', quantity: 4 },
      { productId: 'a', quantity: 2 },
    ]);
  });

  it('S-11: last 8 characters, uppercased', () => {
    expect(orderNumber('01jaaaaaaaaaaaaaaaaab7xq2m9z')).toBe('B7XQ2M9Z');
  });
});
