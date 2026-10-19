import { create } from 'zustand';
import type { HistoryEvent } from '../api';

/** History of one order: `events` null until the first answer; `error` if the last load failed. */
export interface OrderHistoryEntry {
  events: HistoryEvent[] | null;
  error: boolean;
}

interface HistoryState {
  byOrder: Record<string, OrderHistoryEntry>;
  loaded: (id: string, events: HistoryEvent[]) => void;
  /** A failed load keeps the events it already had and only marks the error. */
  failed: (id: string) => void;
  clear: () => void;
}

// DEC-021. REQ-012 E8–E12: the order history, loaded apart from the order (useOrderHistory), so its failure
// doesn't hide the detail. Only data here: the session store clears it on sign-out without importing the API.
export const useHistory = create<HistoryState>()((set) => ({
  byOrder: {},
  loaded: (id, events) => set((s) => ({ byOrder: { ...s.byOrder, [id]: { events, error: false } } })),
  failed: (id) => set((s) => ({ byOrder: { ...s.byOrder, [id]: { events: s.byOrder[id]?.events ?? null, error: true } } })),
  clear: () => set({ byOrder: {} }),
}));
