import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { setQuantity, type Cart, type CartProduct } from './cart';

interface CartContextValue {
  cart: Cart;
  setQuantity: (product: CartProduct, quantity: number) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

// S-09: el carrito vive en memoria mientras la app está abierta.
export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart>([]);
  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      setQuantity: (product, quantity) => setCart((c) => setQuantity(c, product, quantity)),
      clear: () => setCart([]),
    }),
    [cart],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart fuera de CartProvider');
  return ctx;
}
