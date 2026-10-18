import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { PanelOrder } from './api';

interface PanelContextValue {
  /** Última lista del panel del distribuidor (null mientras carga); el detalle sale de aquí (S-19). */
  orders: PanelOrder[] | null;
  setOrders: (orders: PanelOrder[] | null) => void;
  /** Reemplaza un pedido de la lista por la versión que devolvió el servidor (REQ-011). */
  replaceOrder: (order: PanelOrder) => void;
}

const PanelContext = createContext<PanelContextValue | null>(null);

// REQ-010/REQ-011: el panel y el detalle del pedido comparten la lista cargada, así un cambio de estado
// en el detalle se ve también en el panel sin consulta nueva (como el catálogo en S-19).
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
  if (!ctx) throw new Error('usePanel fuera de PanelProvider');
  return ctx;
}
