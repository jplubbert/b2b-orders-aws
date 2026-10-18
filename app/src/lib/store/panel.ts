import { create } from 'zustand';
import type { PanelOrder } from '../api';

interface PanelState {
  /** Last list of the distributor's panel (null while loading); the detail comes from here (S-19). */
  orders: PanelOrder[] | null;
  setOrders: (orders: PanelOrder[] | null) => void;
  /** Replaces an order in the list with the version the server returned (REQ-011). */
  replaceOrder: (order: PanelOrder) => void;
}

// DEC-021, S-31. REQ-010/REQ-011: the panel and the order detail share the loaded list, so a status change
// in the detail also shows in the panel without a new query (like the catalog in S-19).
export const usePanel = create<PanelState>()((set) => ({
  orders: null,
  setOrders: (orders) => set({ orders }),
  replaceOrder: (order) => set((s) => ({ orders: s.orders?.map((o) => (o.id === order.id ? order : o)) ?? null })),
}));
