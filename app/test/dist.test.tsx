// The distributor's "Pedidos" panel (REQ-010 E1–E4, S-28) with jest-expo. The API and the router are mocked;
// Stack.Screen renders headerRight so the account menu can be tapped. The real flow against `dev` is checked
// by hand on the phone (DEC-011).
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { fetchUserAttributes, signOut } from 'aws-amplify/auth';
import { router } from 'expo-router';
import RootLayout from '@/app/_layout';
import PanelScreen from '@/app/dist/index';
import { allOrders, type PanelOrder } from '@/lib/api';
import { CartProvider } from '@/lib/CartProvider';
import { PanelProvider } from '@/lib/PanelProvider';

type ScreenProps = { name?: string; options?: { title?: string; headerBackVisible?: boolean; headerRight?: () => ReactNode } };
const mockScreens: ScreenProps[] = [];

jest.mock('aws-amplify/auth', () => ({ signOut: jest.fn(), fetchUserAttributes: jest.fn() }));
jest.mock('aws-amplify/api', () => ({ generateClient: jest.fn() }));
jest.mock('@/lib/amplify', () => ({ configureAmplify: jest.fn(), isConfigured: true }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual<typeof import('@/lib/api')>('@/lib/api'),
  allOrders: jest.fn(),
}));
// useFocusEffect runs the effect on mount and every time it changes, like when the screen has focus.
jest.mock('expo-router', () => {
  const { createElement, Fragment, useEffect } = jest.requireActual<typeof import('react')>('react');
  const Stack = ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children);
  Stack.Screen = (props: ScreenProps) => {
    mockScreens.push(props);
    return createElement(Fragment, null, props.options?.headerRight?.());
  };
  return {
    router: { push: jest.fn(), replace: jest.fn() },
    Stack,
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const mockAllOrders = jest.mocked(allOrders);
const mockFetchUserAttributes = jest.mocked(fetchUserAttributes);
const mockSignOut = jest.mocked(signOut);
const mockReplace = jest.mocked(router.replace);

const lines = [
  { productId: 'yerba-1kg', name: 'Yerba 1 kg', presentation: 'Paquete 1 kg', quantity: 1, unitPrice: 4500, subtotal: 4500 },
];
const fromStore2: PanelOrder = {
  id: '01JB0000000000000000ALM2N1',
  customerId: 'C-ALMACEN2',
  number: 'ALM2N1',
  createdAt: '2026-10-16T15:00:00.000Z',
  total: 4500,
  status: 'ENVIADO',
  lines,
};
const fromStore1: PanelOrder = {
  id: '01JA0000000000000000ALM1N1',
  customerId: 'C-ALMACEN1',
  number: 'ALM1N1',
  createdAt: '2026-10-15T15:00:00.000Z',
  total: 15500,
  status: 'RECIBIDO',
  lines,
};

// Intl in Node and in Hermes may separate with different spaces; compare without them.
const money = (text: string) => new RegExp(text.replace(/[$.]/g, '\\$&').replace(/\s/g, '\\s*'));

const numbers = async () => (await screen.findAllByText(/^N° /)).map((n) => n.props.children.join(''));

beforeEach(() => {
  jest.resetAllMocks(); // also discards `Once` responses a case didn't consume
  mockScreens.length = 0;
  mockFetchUserAttributes.mockResolvedValue({ email: 'distribuidor@demo.test' });
  mockSignOut.mockResolvedValue(undefined);
});

describe('REQ-010 "Pedidos" panel', () => {
  it('the layout declares the panel route with title "Pedidos" and no back button', async () => {
    await render(<RootLayout />);
    const panel = mockScreens.find((s) => s.name === 'dist/index');
    expect(panel?.options?.title).toBe('Pedidos');
    expect(panel?.options?.headerBackVisible).toBe(false);
  });

  it('E1: orders of every store in server order with number, store, date, total and status', async () => {
    mockAllOrders.mockResolvedValue([fromStore2, fromStore1]);
    await render(<PanelScreen />, { wrapper: PanelProvider });
    expect(await numbers()).toEqual(['N° ALM2N1', 'N° ALM1N1']);
    expect(mockAllOrders).toHaveBeenCalledWith(null);
    const stores = screen.getAllByText(/^Almacén /).map((n) => n.props.children.join(''));
    expect(stores).toEqual(['Almacén C-ALMACEN2', 'Almacén C-ALMACEN1']);
    expect(screen.getAllByText(/\d{2}-\d{2}-\d{2,4}/)).toHaveLength(2);
    expect(screen.getByText(money('$4.500'))).toBeOnTheScreen();
    expect(screen.getByText(money('$15.500'))).toBeOnTheScreen();
    expect(screen.getByTestId('status-ENVIADO')).toBeOnTheScreen();
    expect(screen.getByTestId('status-RECIBIDO')).toBeOnTheScreen();
  });

  it('filter: "Todos" + the 5 statuses (S-28), "Todos" selected on open', async () => {
    mockAllOrders.mockResolvedValue([]);
    await render(<PanelScreen />, { wrapper: PanelProvider });
    await screen.findByText('Todavía no hay pedidos');
    for (const label of ['Todos', 'Recibido', 'En preparación', 'Enviado', 'Entregado', 'Cancelado']) {
      expect(screen.getByLabelText(`Filtro ${label}`)).toBeOnTheScreen();
    }
    expect(screen.getByLabelText('Filtro Todos')).toBeSelected();
    expect(screen.getByLabelText('Filtro Enviado')).not.toBeSelected();
  });

  it('E2: the "Enviado" filter requests allOrders(ENVIADO) and shows only those; "Todos" removes the filter', async () => {
    mockAllOrders.mockImplementation(async (status) =>
      [fromStore2, fromStore1].filter((o) => status === null || o.status === status),
    );
    await render(<PanelScreen />, { wrapper: PanelProvider });
    expect(await numbers()).toEqual(['N° ALM2N1', 'N° ALM1N1']);

    await fireEvent.press(screen.getByLabelText('Filtro Enviado'));
    await waitFor(() => expect(screen.queryByText('N° ALM1N1')).toBeNull());
    expect(mockAllOrders).toHaveBeenLastCalledWith('ENVIADO');
    expect(await numbers()).toEqual(['N° ALM2N1']);
    expect(screen.getByLabelText('Filtro Enviado')).toBeSelected();

    await fireEvent.press(screen.getByLabelText('Filtro Todos'));
    await waitFor(() => expect(screen.getByText('N° ALM1N1')).toBeOnTheScreen());
    expect(mockAllOrders).toHaveBeenLastCalledWith(null);
  });

  it('E3: filter with no orders in that status → "No hay pedidos en este estado"', async () => {
    mockAllOrders.mockResolvedValueOnce([fromStore1]).mockResolvedValueOnce([]);
    await render(<PanelScreen />, { wrapper: PanelProvider });
    await screen.findByText('N° ALM1N1');
    await fireEvent.press(screen.getByLabelText('Filtro Cancelado'));
    expect(await screen.findByText('No hay pedidos en este estado')).toBeOnTheScreen();
    expect(mockAllOrders).toHaveBeenLastCalledWith('CANCELADO');
    expect(screen.queryByText('Todavía no hay pedidos')).toBeNull();
  });

  it('E4: no orders in the system → "Todavía no hay pedidos" in state-empty', async () => {
    mockAllOrders.mockResolvedValue([]);
    await render(<PanelScreen />, { wrapper: PanelProvider });
    expect(await screen.findByText('Todavía no hay pedidos')).toBeOnTheScreen();
    expect(screen.getByTestId('state-empty')).toBeOnTheScreen();
  });

  it('loading → state-loading', async () => {
    mockAllOrders.mockReturnValue(new Promise(() => {}));
    await render(<PanelScreen />, { wrapper: PanelProvider });
    expect(screen.getByTestId('state-loading')).toBeOnTheScreen();
  });

  it('an API error is shown with its cause in state-error (not as an empty list)', async () => {
    mockAllOrders.mockRejectedValue(new Error('Network error'));
    await render(<PanelScreen />, { wrapper: PanelProvider });
    expect(await screen.findByText('Network error')).toBeOnTheScreen();
    expect(screen.getByTestId('state-error')).toBeOnTheScreen();
    expect(screen.queryByText('Todavía no hay pedidos')).toBeNull();
  });

  it('S-06: pulling down shows the current status, with the chosen filter', async () => {
    mockAllOrders
      .mockResolvedValueOnce([fromStore1])
      .mockResolvedValueOnce([fromStore1])
      .mockResolvedValueOnce([{ ...fromStore1, status: 'EN_PREPARACION' }]);
    await render(<PanelScreen />, { wrapper: PanelProvider });
    await screen.findByText('N° ALM1N1');
    await fireEvent.press(screen.getByLabelText('Filtro Recibido'));
    await waitFor(() => expect(mockAllOrders).toHaveBeenCalledTimes(2));
    await screen.findByTestId('status-RECIBIDO');
    await fireEvent(screen.getByTestId('panel-list'), 'refresh');
    expect(await screen.findByTestId('status-EN_PREPARACION')).toBeOnTheScreen();
    expect(mockAllOrders).toHaveBeenLastCalledWith('RECIBIDO');
  });

  it("when switching filters fast, the previous filter's response doesn't win", async () => {
    let resolveFirst: (o: PanelOrder[]) => void = () => {};
    mockAllOrders
      .mockResolvedValueOnce([fromStore2, fromStore1])
      .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce([fromStore1]);
    await render(<PanelScreen />, { wrapper: PanelProvider });
    await screen.findByText('N° ALM2N1');
    await fireEvent.press(screen.getByLabelText('Filtro Enviado'));
    await fireEvent.press(screen.getByLabelText('Filtro Recibido'));
    await screen.findByText('N° ALM1N1');
    resolveFirst([fromStore2]);
    await waitFor(() => expect(screen.queryByText('N° ALM2N1')).toBeNull());
    expect(await numbers()).toEqual(['N° ALM1N1']);
  });

  it('the layout declares the dist/order/[id] detail; tapping an order opens it', async () => {
    await render(<RootLayout />);
    expect(mockScreens.find((s) => s.name === 'dist/order/[id]')?.options?.title).toBe('Pedido');

    mockAllOrders.mockResolvedValue([fromStore1]);
    await render(<PanelScreen />, { wrapper: PanelProvider });
    await fireEvent.press(await screen.findByText('N° ALM1N1'));
    expect(jest.mocked(router.push)).toHaveBeenCalledWith({ pathname: '/dist/order/[id]', params: { id: fromStore1.id } });
  });

  it('account menu with "Cerrar sesión" (S-28) → back to the login screen', async () => {
    mockAllOrders.mockResolvedValue([]);
    await render(
      <CartProvider>
        <PanelProvider>
          <PanelScreen />
        </PanelProvider>
      </CartProvider>,
    );
    await fireEvent.press(screen.getByLabelText('Cuenta'));
    expect(await screen.findByText('distribuidor@demo.test')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Cerrar sesión'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(mockSignOut).toHaveBeenCalled();
  });
});
