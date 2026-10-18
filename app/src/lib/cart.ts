// Carrito en el dispositivo (S-09: solo en memoria). Lógica pura; el estado vive en CartProvider.
// El servidor vuelve a fusionar, validar y calcular con los precios vigentes (REQ-003); esto solo muestra.

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

/** Mismo tope que el servidor (S-03); la app no deja pasar de ahí. */
export const MAX_QUANTITY = 999;

/** Fija la cantidad de un producto: lo agrega si no estaba, lo quita con 0; una línea por producto. */
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

/** Subtotal por línea y total del carrito, en pesos CLP enteros (REQ-003, S-02). */
export const lineSubtotal = (line: CartLine) => line.product.unitPrice * line.quantity;
export const cartTotal = (cart: Cart) => cart.reduce((sum, l) => sum + lineSubtotal(l), 0);
export const cartUnits = (cart: Cart) => cart.reduce((sum, l) => sum + l.quantity, 0);

/** Entrada de `createOrder`: solo producto y cantidad, sin precio (S-12). */
export const toOrderLines = (cart: Cart) =>
  cart.map((l) => ({ productId: l.product.productId, quantity: l.quantity }));

// Motivo de rechazo del servidor (errorType de DEC-005) → mensaje para el almacenero.
const REJECTIONS: Record<string, string> = {
  EMPTY_ORDER: 'El carrito está vacío.',
  TOO_MANY_LINES: 'El pedido supera los 50 productos distintos.',
  INVALID_QUANTITY: 'Cada cantidad debe estar entre 1 y 999.',
  PRODUCT_UNAVAILABLE: 'Un producto del carrito ya no está disponible.',
};

/** El servidor manda el `productId` en el mensaje de PRODUCT_UNAVAILABLE (DEC-009); se muestra el nombre. */
export function rejectionMessage(cart: Cart, errorType: string | undefined, message = ''): string {
  if (errorType === 'PRODUCT_UNAVAILABLE') {
    const line = cart.find((l) => message.includes(l.product.productId));
    if (line) return `Ya no está disponible: ${line.product.name}. Quítalo del carrito.`;
  }
  return (errorType && REJECTIONS[errorType]) || message || 'No se pudo confirmar el pedido.';
}
