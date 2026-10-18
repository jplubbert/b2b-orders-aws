import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { setQuantity, type Cart, type CartProduct } from './cart';

interface CartContextValue {
  cart: Cart;
  setQuantity: (product: CartProduct, quantity: number) => void;
  clear: () => void;
  /** Último catálogo cargado (null si aún no se cargó); lo usa el detalle de producto (S-19). */
  catalog: CartProduct[] | null;
  setCatalog: (products: CartProduct[]) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

// S-09: el carrito vive en memoria mientras la app está abierta.
// S-19: junto a él, el catálogo que cargó la pantalla Catálogo, para abrir el detalle sin consulta nueva.
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
  if (!ctx) throw new Error('useCart fuera de CartProvider');
  return ctx;
}
