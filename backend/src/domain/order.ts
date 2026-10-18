import type { Order, OrderLine, OrderLineInput, OrderStatus } from '../generated/graphql.js';
import type { Product } from './catalog.js';

export type { Order, OrderLine, OrderLineInput, OrderStatus };

/** Estados del pedido (S-04), en el orden del contrato. */
export const ORDER_STATUSES = ['RECIBIDO', 'EN_PREPARACION', 'ENVIADO', 'ENTREGADO', 'CANCELADO'] as const satisfies readonly OrderStatus[];

export const isOrderStatus = (s: string): s is OrderStatus => (ORDER_STATUSES as readonly string[]).includes(s);

export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 999;
export const MAX_LINES = 50;

export type OrderErrorCode = 'EMPTY_ORDER' | 'TOO_MANY_LINES' | 'INVALID_QUANTITY' | 'PRODUCT_UNAVAILABLE';

// Con resolvers Lambda directos, AppSync expone `error.name` como `errorType` (DEC-005).
export class OrderRejectedError extends Error {
  constructor(
    readonly code: OrderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}

/** `setOrderStatus` sobre un pedido que no está en la partición indicada (REQ-011 E5, DEC-013). */
export class OrderNotFoundError extends Error {
  constructor(customerId: string, orderId: string) {
    super(`No existe el pedido ${orderId} del almacén ${customerId}`);
    this.name = 'ORDER_NOT_FOUND';
  }
}

/** Suma las cantidades de las líneas del mismo producto, en el orden de su primera aparición (REQ-003 E6). */
export function mergeLines(lines: readonly OrderLineInput[]): OrderLineInput[] {
  const merged = new Map<string, number>();
  for (const { productId, quantity } of lines) merged.set(productId, (merged.get(productId) ?? 0) + quantity);
  return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
}

/**
 * Pedido nuevo en `RECIBIDO` con nombre, presentación y precio del catálogo congelados (REQ-003, S-05).
 * Fusiona antes de validar; cualquier línea inválida rechaza el pedido entero. Nunca usa precios del cliente.
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

/** Últimos 8 caracteres del ULID en mayúsculas (S-11). */
export const orderNumber = (id: string) => id.slice(-8).toUpperCase();
