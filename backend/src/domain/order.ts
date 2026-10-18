import type { Order, OrderLine, OrderLineInput, OrderStatus } from '../generated/graphql.js';
import type { Product } from './catalog.js';

export type { Order, OrderLine, OrderLineInput, OrderStatus };

/** Order statuses (S-04), in contract order. */
export const ORDER_STATUSES = ['RECIBIDO', 'EN_PREPARACION', 'ENVIADO', 'ENTREGADO', 'CANCELADO'] as const satisfies readonly OrderStatus[];

export const isOrderStatus = (s: string): s is OrderStatus => (ORDER_STATUSES as readonly string[]).includes(s);

export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 999;
export const MAX_LINES = 50;

export type OrderErrorCode = 'EMPTY_ORDER' | 'TOO_MANY_LINES' | 'INVALID_QUANTITY' | 'PRODUCT_UNAVAILABLE';

// With direct Lambda resolvers, AppSync exposes `error.name` as `errorType` (DEC-005).
// The messages below travel through the API and the app may show them, so they stay in Spanish (DEC-018 a).
export class OrderRejectedError extends Error {
  constructor(
    readonly code: OrderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}

/** `setOrderStatus` on an order that isn't in the given partition (REQ-011 E5, DEC-013). */
export class OrderNotFoundError extends Error {
  constructor(customerId: string, orderId: string) {
    super(`No existe el pedido ${orderId} del almacén ${customerId}`);
    this.name = 'ORDER_NOT_FOUND';
  }
}

/** Adds up the quantities of lines for the same product, in order of first appearance (REQ-003 E6). */
export function mergeLines(lines: readonly OrderLineInput[]): OrderLineInput[] {
  const merged = new Map<string, number>();
  for (const { productId, quantity } of lines) merged.set(productId, (merged.get(productId) ?? 0) + quantity);
  return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
}

/**
 * New `RECIBIDO` order with the catalog's name, presentation and price frozen (REQ-003, S-05).
 * Merges before validating; any invalid line rejects the whole order. Never uses client prices.
 */
export function buildOrder(
  input: readonly OrderLineInput[],
  catalog: ReadonlyMap<string, Product>,
  meta: { id: string; customerId: string; createdAt: string },
): Order {
  const merged = mergeLines(input);
  if (merged.length === 0) throw new OrderRejectedError('EMPTY_ORDER', 'El pedido no tiene productos');
  if (merged.length > MAX_LINES) {
    throw new OrderRejectedError('TOO_MANY_LINES', `El pedido tiene ${merged.length} productos; el máximo es ${MAX_LINES}`);
  }
  for (const { productId, quantity } of merged) {
    if (!Number.isInteger(quantity) || quantity < MIN_QUANTITY || quantity > MAX_QUANTITY) {
      throw new OrderRejectedError(
        'INVALID_QUANTITY',
        `Cantidad ${quantity} inválida para ${productId}; debe estar entre ${MIN_QUANTITY} y ${MAX_QUANTITY}`,
      );
    }
  }
  const lines: OrderLine[] = merged.map(({ productId, quantity }) => {
    const product = catalog.get(productId);
    if (!product?.active) throw new OrderRejectedError('PRODUCT_UNAVAILABLE', `Producto no disponible: ${productId}`);
    return {
      productId,
      name: product.name,
      presentation: product.presentation,
      quantity,
      unitPrice: product.unitPrice,
      subtotal: product.unitPrice * quantity,
    };
  });
  return {
    id: meta.id,
    customerId: meta.customerId,
    number: orderNumber(meta.id),
    createdAt: meta.createdAt,
    total: lines.reduce((sum, l) => sum + l.subtotal, 0),
    status: 'RECIBIDO',
    lines,
  };
}

/** Last 8 characters of the ULID, uppercased (S-11). */
export const orderNumber = (id: string) => id.slice(-8).toUpperCase();
