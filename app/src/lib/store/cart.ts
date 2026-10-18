import { create } from 'zustand';
import { setQuantity, type Cart, type CartProduct } from '../cart';

interface CartState {
  cart: Cart;
  setQuantity: (product: CartProduct, quantity: number) => void;
  clear: () => void;
  /** Last loaded catalog (null if not loaded yet); the product detail uses it (S-19). */
  catalog: CartProduct[] | null;
  setCatalog: (products: CartProduct[]) => void;
}

// DEC-021. S-09: the cart lives in memory while the app is open (no persistence).
// S-19: next to it, the catalog the Catalog screen loaded, to open the detail without a new query.
export const useCart = create<CartState>()((set) => ({
  cart: [],
  setQuantity: (product, quantity) => set((s) => ({ cart: setQuantity(s.cart, product, quantity) })),
  clear: () => set({ cart: [] }),
  catalog: null,
  setCatalog: (catalog) => set({ catalog }),
}));
