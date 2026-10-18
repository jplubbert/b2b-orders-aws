import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { setQuantity, type Cart, type CartProduct } from './cart';

interface CartContextValue {
  cart: Cart;
  setQuantity: (product: CartProduct, quantity: number) => void;
  clear: () => void;
  /** Last loaded catalog (null if not loaded yet); the product detail uses it (S-19). */
  catalog: CartProduct[] | null;
  setCatalog: (products: CartProduct[]) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

// S-09: the cart lives in memory while the app is open.
// S-19: next to it, the catalog the Catalog screen loaded, to open the detail without a new query.
export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart>([]);
  const [catalog, setCatalog] = useState<CartProduct[] | null>(null);
  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      setQuantity: (product, quantity) => setCart((c) => setQuantity(c, product, quantity)),
      clear: () => setCart([]),
      catalog,
      setCatalog,
    }),
    [cart, catalog],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart outside CartProvider');
  return ctx;
}
