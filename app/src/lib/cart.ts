// On-device cart (S-09: in memory only). Pure logic; the state lives in CartProvider.
// The server merges, validates and computes again with the current prices (REQ-003); this only displays.

export interface CartProduct {
  productId: string;
  name: string;
  presentation: string;
  unitPrice: number;
}

export interface CartLine {
  product: CartProduct;
  quantity: number;
}

export type Cart = CartLine[];

/** Same cap as the server (S-03); the app never goes past it. */
export const MAX_QUANTITY = 999;

/** Sets a product's quantity: adds it if missing, removes it with 0; one line per product. */
export function setQuantity(cart: Cart, product: CartProduct, quantity: number): Cart {
  const q = Math.min(Math.max(Math.trunc(quantity), 0), MAX_QUANTITY);
  const rest = cart.filter((l) => l.product.productId !== product.productId);
  if (q === 0) return rest;
  const i = cart.findIndex((l) => l.product.productId === product.productId);
  const line = { product, quantity: q };
  return i === -1 ? [...cart, line] : cart.map((l, j) => (j === i ? line : l));
}

export const quantityOf = (cart: Cart, productId: string) =>
  cart.find((l) => l.product.productId === productId)?.quantity ?? 0;

/** Subtotal per line and cart total, in whole CLP pesos (REQ-003, S-02). */
export const lineSubtotal = (line: CartLine) => line.product.unitPrice * line.quantity;
export const cartTotal = (cart: Cart) => cart.reduce((sum, l) => sum + lineSubtotal(l), 0);
export const cartUnits = (cart: Cart) => cart.reduce((sum, l) => sum + l.quantity, 0);

/** `createOrder` input: only product and quantity, no price (S-12). */
export const toOrderLines = (cart: Cart) =>
  cart.map((l) => ({ productId: l.product.productId, quantity: l.quantity }));

// Server rejection reason (DEC-005 errorType) → message for the customer.
const REJECTIONS: Record<string, string> = {
  EMPTY_ORDER: 'El carrito está vacío.',
  TOO_MANY_LINES: 'El pedido supera los 50 productos distintos.',
  INVALID_QUANTITY: 'Cada cantidad debe estar entre 1 y 999.',
  PRODUCT_UNAVAILABLE: 'Un producto del carrito ya no está disponible.',
};

/** The server sends the `productId` in the PRODUCT_UNAVAILABLE message (DEC-009); the name is shown. */
export function rejectionMessage(cart: Cart, errorType: string | undefined, message = ''): string {
  if (errorType === 'PRODUCT_UNAVAILABLE') {
    const line = cart.find((l) => message.includes(l.product.productId));
    if (line) return `Ya no está disponible: ${line.product.name}. Quítalo del carrito.`;
  }
  return (errorType && REJECTIONS[errorType]) || message || 'No se pudo confirmar el pedido.';
}
