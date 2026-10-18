import { describe, expect, it } from 'vitest';
import {
  MAX_QUANTITY,
  cartTotal,
  cartUnits,
  lineSubtotal,
  quantityOf,
  rejectionMessage,
  setQuantity,
  toOrderLines,
  type Cart,
} from '../src/lib/cart';

const yerba = { productId: 'yerba-1kg', name: 'Yerba 1 kg', presentation: 'Paquete 1 kg', unitPrice: 4500 };
const arroz = { productId: 'arroz-1kg', name: 'Arroz 1 kg', presentation: 'Paquete 1 kg', unitPrice: 1300 };

describe('cart (REQ-003)', () => {
  it('subtotal per line and total: 2 × Yerba + 5 × Arroz = 9000 + 6500 = 15500', () => {
    const cart = setQuantity(setQuantity([], yerba, 2), arroz, 5);
    expect(cart.map(lineSubtotal)).toEqual([9000, 6500]);
    expect(cartTotal(cart)).toBe(15500);
    expect(cartUnits(cart)).toBe(7);
  });

  it('changing the quantity updates the existing line and the amounts', () => {
    let cart = setQuantity(setQuantity([], yerba, 2), arroz, 5);
    cart = setQuantity(cart, yerba, 3);
    expect(cart.map((l) => [l.product.productId, l.quantity])).toEqual([
      ['yerba-1kg', 3],
      ['arroz-1kg', 5],
    ]);
    expect(cartTotal(cart)).toBe(3 * 4500 + 5 * 1300);
    expect(quantityOf(cart, 'yerba-1kg')).toBe(3);
  });

  it('quantity 0 removes the line; the empty cart adds up to 0', () => {
    const cart = setQuantity(setQuantity([], yerba, 1), yerba, 0);
    expect(cart).toEqual([]);
    expect(cartTotal(cart)).toBe(0);
    expect(quantityOf(cart, 'yerba-1kg')).toBe(0);
  });

  it('the quantity stays between 0 and 999', () => {
    expect(setQuantity([], yerba, MAX_QUANTITY + 1)[0]!.quantity).toBe(999);
    expect(setQuantity([], yerba, -3)).toEqual([]);
  });

  it('the createOrder input carries no prices (S-12)', () => {
    const cart: Cart = setQuantity([], yerba, 2);
    expect(toOrderLines(cart)).toEqual([{ productId: 'yerba-1kg', quantity: 2 }]);
  });
});

describe('rejectionMessage', () => {
  const cart = setQuantity([], yerba, 1);

  it('PRODUCT_UNAVAILABLE names the cart product', () => {
    expect(rejectionMessage(cart, 'PRODUCT_UNAVAILABLE', 'Producto no disponible: yerba-1kg')).toBe(
      'Ya no está disponible: Yerba 1 kg. Quítalo del carrito.',
    );
  });

  it.each([
    ['INVALID_QUANTITY', 'Cada cantidad debe estar entre 1 y 999.'],
    ['TOO_MANY_LINES', 'El pedido supera los 50 productos distintos.'],
    ['EMPTY_ORDER', 'El carrito está vacío.'],
  ])('%s → reason in Spanish', (code, text) => {
    expect(rejectionMessage(cart, code, 'x')).toBe(text);
  });

  it('any other error shows the server message', () => {
    expect(rejectionMessage(cart, 'Unauthorized', 'Unauthorized')).toBe('Unauthorized');
    expect(rejectionMessage(cart, undefined, '')).toBe('No se pudo confirmar el pedido.');
  });
});
