// REQ-012 E8, E9, E11, E12 and S-37: "Historial" section of the store's and the distributor's order detail,
// with jest-expo. The API and the router are mocked; the real flow against `dev` (E8, E9 with a real order)
// is checked by hand on the phone (DEC-011).
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { useLocalSearchParams } from 'expo-router';
import DistOrderScreen from '@/app/dist/order/[id]';
import OrderDetailScreen from '@/app/order/[id]';
import { formatDate, getOrder, orderHistory, setOrderStatus, type HistoryEvent, type OrderDetail, type PanelOrder } from '@/lib/api';
import { useHistory } from '@/lib/store/history';
import { usePanel } from '@/lib/store/panel';
import { signOut } from '@/lib/store/session';
import { resetStores } from './support/stores';

const mockTitles: (string | undefined)[] = [];

jest.mock('aws-amplify/auth', () => ({ signOut: jest.fn(), fetchUserAttributes: jest.fn() }));
jest.mock('aws-amplify/api', () => ({ generateClient: jest.fn() }));
jest.mock('@/lib/amplify', () => ({ configureAmplify: jest.fn(), isConfigured: true }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual<typeof import('@/lib/api')>('@/lib/api'),
  getOrder: jest.fn(),
  orderHistory: jest.fn(),
  setOrderStatus: jest.fn(),
}));
jest.mock('expo-router', () => {
  const { createElement, Fragment, useEffect } = jest.requireActual<typeof import('react')>('react');
  const Stack = ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children);
  Stack.Screen = ({ options }: { options?: { title?: string } }) => {
    mockTitles.push(options?.title);
    return null;
  };
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() },
    Stack,
    useLocalSearchParams: jest.fn(),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const mockGetOrder = jest.mocked(getOrder);
const mockHistory = jest.mocked(orderHistory);
const mockSetOrderStatus = jest.mocked(setOrderStatus);

// REQ-012 E8: almacen1's order, already moved to ENVIADO by the distributor.
const panelOrder: PanelOrder = {
  id: '01JA0000000000000000ALM1N1',
  customerId: 'C-ALMACEN1',
  number: 'ALM1N1',
  createdAt: '2026-10-15T15:00:00.000Z',
  total: 9000,
  status: 'ENVIADO',
  lines: [{ productId: 'yerba-1kg', name: 'Yerba 1 kg', presentation: 'Paquete 1 kg', quantity: 2, unitPrice: 4500, subtotal: 9000 }],
};
const { customerId: _customerId, ...detail } = panelOrder;
const storeOrder: OrderDetail = detail;

const created: HistoryEvent = { eventId: '01JA00000000000000000EVT01', from: null, to: 'RECIBIDO', at: '2026-10-15T15:00:00.000Z' };
const shipped: HistoryEvent = { eventId: '01JA00000000000000000EVT02', from: 'RECIBIDO', to: 'ENVIADO', at: '2026-10-15T18:30:00.000Z' };

// Intl in Node and in Hermes may separate with different spaces; compare without them.
const money = (text: string) => new RegExp(text.replace(/[$.]/g, '\\$&').replace(/\s/g, '\\s*'));

/** Texts of the history rows, top to bottom: [change, date] each. */
function rows() {
  return within(screen.getByTestId('order-history'))
    .queryAllByTestId('history-row')
    .map((row) => within(row).getAllByText(/./).map((t) => [t.props.children].flat().join('')));
}

beforeEach(() => {
  jest.resetAllMocks(); // also discards `Once` responses a case didn't consume
  resetStores();
  mockTitles.length = 0;
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: panelOrder.id });
});

// The two details: the store's (order from getOrder) and the distributor's (order from the loaded panel, S-19).
const details = [
  {
    name: 'store (order/[id])',
    list: 'order-detail',
    expectNumber: () => expect(screen.getByText('N° ALM1N1')).toBeOnTheScreen(),
    open: async () => {
      mockGetOrder.mockResolvedValue(storeOrder);
      await render(<OrderDetailScreen />);
      await screen.findByText('N° ALM1N1');
    },
  },
  {
    name: 'distributor (dist/order/[id])',
    list: 'dist-order-detail',
    expectNumber: () => expect(mockTitles.at(-1)).toBe('Pedido ALM1N1'),
    open: async () => {
      usePanel.getState().setOrders([panelOrder]);
      await render(<DistOrderScreen />);
      await screen.findByText('Almacén C-ALMACEN1');
    },
  },
];

describe.each(details)('REQ-012 history in the $name detail', ({ list, expectNumber, open }) => {
  it('E8/E9: "Historial" with 2 rows, oldest first: "Recibido" and "Recibido → Enviado", with date and time', async () => {
    mockHistory.mockResolvedValue([created, shipped]);
    await open();
    const section = screen.getByTestId('order-history');
    expect(within(section).getByText('Historial')).toBeOnTheScreen();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows()).toEqual([
      ['Recibido', formatDate(created.at)],
      ['Recibido → Enviado', formatDate(shipped.at)],
    ]);
    expect(rows()[0][1]).toMatch(/\d{2}-\d{2}-\d{2,4}/);
    expect(mockHistory).toHaveBeenCalledWith(panelOrder.id);
  });

  it('S-37: the same status twice reads "Enviado → Enviado" (E3) and the names are those of S-17', async () => {
    mockHistory.mockResolvedValue([
      created,
      { eventId: 'E2', from: 'RECIBIDO', to: 'EN_PREPARACION', at: '2026-10-15T16:00:00.000Z' },
      { eventId: 'E3', from: 'EN_PREPARACION', to: 'ENVIADO', at: '2026-10-15T17:00:00.000Z' },
      { eventId: 'E4', from: 'ENVIADO', to: 'ENVIADO', at: '2026-10-15T17:05:00.000Z' },
      { eventId: 'E5', from: 'ENVIADO', to: 'CANCELADO', at: '2026-10-15T17:10:00.000Z' },
    ]);
    await open();
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(rows().map(([change]) => change)).toEqual([
      'Recibido',
      'Recibido → En preparación',
      'En preparación → Enviado',
      'Enviado → Enviado',
      'Enviado → Cancelado',
    ]);
  });

  it('E11: no events yet → "Sin movimientos registrados todavía"; pulling down shows "Recibido"', async () => {
    mockHistory.mockResolvedValueOnce([]).mockResolvedValueOnce([created]);
    await open();
    const section = screen.getByTestId('order-history');
    expect(await within(section).findByText('Sin movimientos registrados todavía')).toBeOnTheScreen();
    await fireEvent(screen.getByTestId(list), 'refresh');
    await waitFor(() => expect(rows()).toEqual([['Recibido', formatDate(created.at)]]));
    expect(within(section).queryByText('Sin movimientos registrados todavía')).toBeNull();
    expect(mockHistory).toHaveBeenCalledTimes(2);
  });

  it('E10 (screen): another store\'s order answers [] → only the empty text, no rows', async () => {
    mockHistory.mockResolvedValue([]);
    await open();
    expect(await screen.findByText('Sin movimientos registrados todavía')).toBeOnTheScreen();
    expect(rows()).toEqual([]);
  });

  it('E12: network failure → "No se pudo cargar el historial"; number, lines, total and status still visible', async () => {
    mockHistory.mockRejectedValue(new Error('Network error'));
    await open();
    const section = screen.getByTestId('order-history');
    expect(await within(section).findByText('No se pudo cargar el historial')).toBeOnTheScreen();
    expect(within(section).getByTestId('history-error')).toBeOnTheScreen();
    expectNumber();
    expect(screen.getByText('Yerba 1 kg')).toBeOnTheScreen();
    expect(screen.getByText(money('Total $9.000'))).toBeOnTheScreen();
    expect(screen.getByTestId('status-ENVIADO')).toBeOnTheScreen();
    expect(screen.queryByTestId('state-error')).toBeNull(); // the history's failure isn't the order's
  });

  it('E12: after a failure, pulling down with network loads the rows and clears the message', async () => {
    mockHistory.mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce([created, shipped]);
    await open();
    await screen.findByText('No se pudo cargar el historial');
    await fireEvent(screen.getByTestId(list), 'refresh');
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.queryByText('No se pudo cargar el historial')).toBeNull();
  });

  it('while loading, the section shows its title and a loading indicator', async () => {
    mockHistory.mockReturnValue(new Promise(() => {}));
    await open();
    const section = screen.getByTestId('order-history');
    expect(within(section).getByText('Historial')).toBeOnTheScreen();
    expect(within(section).getByTestId('history-loading')).toBeOnTheScreen();
  });
});

describe('REQ-012 history in the store detail: failures kept apart', () => {
  it('the order fails but not the history → order error, no history section', async () => {
    mockGetOrder.mockRejectedValue(new Error('Network error'));
    mockHistory.mockResolvedValue([created]);
    await render(<OrderDetailScreen />);
    expect(await screen.findByText('Network error')).toBeOnTheScreen();
    expect(screen.queryByTestId('order-history')).toBeNull();
  });

  it('pulling down requests the order and the history again', async () => {
    mockGetOrder.mockResolvedValueOnce({ ...storeOrder, status: 'RECIBIDO' }).mockResolvedValueOnce(storeOrder);
    mockHistory.mockResolvedValueOnce([created]).mockResolvedValueOnce([created, shipped]);
    await render(<OrderDetailScreen />);
    await waitFor(() => expect(rows()).toHaveLength(1));
    await fireEvent(screen.getByTestId('order-detail'), 'refresh');
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByTestId('status-ENVIADO')).toBeOnTheScreen();
    expect(mockGetOrder).toHaveBeenCalledTimes(2);
    expect(mockHistory).toHaveBeenCalledTimes(2);
  });
});

describe('REQ-012 history in the distributor detail (S-37)', () => {
  it('changing the status adds no optimistic row: the new event appears on refreshing', async () => {
    mockHistory.mockResolvedValueOnce([created]).mockResolvedValueOnce([created, shipped]);
    mockSetOrderStatus.mockResolvedValue({ ...panelOrder, status: 'ENVIADO' });
    usePanel.getState().setOrders([{ ...panelOrder, status: 'RECIBIDO' }]);
    await render(<DistOrderScreen />);
    await waitFor(() => expect(rows()).toHaveLength(1));
    await fireEvent.press(screen.getByLabelText('Estado Enviado'));
    expect(await screen.findByTestId('status-ENVIADO')).toBeOnTheScreen();
    expect(rows()).toHaveLength(1);
    expect(mockHistory).toHaveBeenCalledTimes(1);
    await fireEvent(screen.getByTestId('dist-order-detail'), 'refresh');
    await waitFor(() => expect(rows().map(([change]) => change)).toEqual(['Recibido', 'Recibido → Enviado']));
  });

  it('pulling down refreshes only the history: the order still comes from the loaded panel (S-19)', async () => {
    mockHistory.mockResolvedValue([created]);
    usePanel.getState().setOrders([panelOrder]);
    await render(<DistOrderScreen />);
    await waitFor(() => expect(rows()).toHaveLength(1));
    await fireEvent(screen.getByTestId('dist-order-detail'), 'refresh');
    await waitFor(() => expect(mockHistory).toHaveBeenCalledTimes(2));
    expect(mockGetOrder).not.toHaveBeenCalled();
  });

  it('an order outside the loaded panel requests no history', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ id: 'NO-EXISTE' });
    usePanel.getState().setOrders([panelOrder]);
    await render(<DistOrderScreen />);
    expect(screen.getByText('Pedido no encontrado')).toBeOnTheScreen();
    expect(screen.queryByTestId('order-history')).toBeNull();
    expect(mockHistory).not.toHaveBeenCalled();
  });
});

describe('REQ-005 sign-out also clears the loaded histories (DEC-021)', () => {
  it('signOut empties the history store', async () => {
    useHistory.getState().loaded(panelOrder.id, [created]);
    await signOut();
    expect(useHistory.getState().byOrder).toEqual({});
  });
});
