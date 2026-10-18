import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { PanelOrder } from './api';

interface PanelContextValue {
  /** Last list of the distributor's panel (null while loading); the detail comes from here (S-19). */
  orders: PanelOrder[] | null;
  setOrders: (orders: PanelOrder[] | null) => void;
  /** Replaces an order in the list with the version the server returned (REQ-011). */
  replaceOrder: (order: PanelOrder) => void;
}

const PanelContext = createContext<PanelContextValue | null>(null);

// REQ-010/REQ-011: the panel and the order detail share the loaded list, so a status change
// in the detail also shows in the panel without a new query (like the catalog in S-19).
export function PanelProvider({ children }: { children: ReactNode }) {
  const [orders, setOrders] = useState<PanelOrder[] | null>(null);
  const value = useMemo<PanelContextValue>(
    () => ({
      orders,
      setOrders,
      replaceOrder: (order) => setOrders((list) => list?.map((o) => (o.id === order.id ? order : o)) ?? null),
    }),
    [orders],
  );
  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}

export function usePanel(): PanelContextValue {
  const ctx = useContext(PanelContext);
  if (!ctx) throw new Error('usePanel outside PanelProvider');
  return ctx;
}
