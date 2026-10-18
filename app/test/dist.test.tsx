// Panel "Pedidos" del distribuidor (REQ-010 E1–E4, S-28) con jest-expo. La API y el router van simulados;
// Stack.Screen dibuja headerRight para tocar el menú de cuenta. El recorrido real contra `dev` se verifica
// a mano en el teléfono (DEC-011).
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { fetchUserAttributes, signOut } from 'aws-amplify/auth';
import { router } from 'expo-router';
import RootLayout from '@/app/_layout';
import PanelScreen from '@/app/dist/index';
import { allOrders, type PanelOrder } from '@/lib/api';
import { CartProvider } from '@/lib/CartProvider';

type ScreenProps = { name?: string; options?: { title?: string; headerBackVisible?: boolean; headerRight?: () => ReactNode } };
const mockScreens: ScreenProps[] = [];

jest.mock('aws-amplify/auth', () => ({ signOut: jest.fn(), fetchUserAttributes: jest.fn() }));
jest.mock('aws-amplify/api', () => ({ generateClient: jest.fn() }));
jest.mock('@/lib/amplify', () => ({ configureAmplify: jest.fn(), isConfigured: true }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual<typeof import('@/lib/api')>('@/lib/api'),
  allOrders: jest.fn(),
}));
// useFocusEffect corre el efecto al montar y cada vez que cambia, como cuando la pantalla tiene el foco.
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
const fromAlmacen2: PanelOrder = {
  id: '01JB0000000000000000ALM2N1',
  customerId: 'C-ALMACEN2',
  number: 'ALM2N1',
  createdAt: '2026-10-16T15:00:00.000Z',
  total: 4500,
  status: 'ENVIADO',
  lines,
};
const fromAlmacen1: PanelOrder = {
  id: '01JA0000000000000000ALM1N1',
  customerId: 'C-ALMACEN1',
  number: 'ALM1N1',
  createdAt: '2026-10-15T15:00:00.000Z',
  total: 15500,
  status: 'RECIBIDO',
  lines,
};

// Intl en Node y en Hermes puede separar con espacios distintos; se compara sin ellos.
const money = (text: string) => new RegExp(text.replace(/[$.]/g, '\\$&').replace(/\s/g, '\\s*'));

const numbers = async () => (await screen.findAllByText(/^N° /)).map((n) => n.props.children.join(''));

beforeEach(() => {
  jest.resetAllMocks(); // también descarta respuestas `Once` que un caso no consumió
  mockScreens.length = 0;
  mockFetchUserAttributes.mockResolvedValue({ email: 'distribuidor@demo.test' });
  mockSignOut.mockResolvedValue(undefined);
});

describe('REQ-010 panel "Pedidos"', () => {
  it('el layout declara la ruta del panel con título "Pedidos" y sin volver atrás', async () => {
    await render(<RootLayout />);
    const panel = mockScreens.find((s) => s.name === 'dist/index');
    expect(panel?.options?.title).toBe('Pedidos');
    expect(panel?.options?.headerBackVisible).toBe(false);
  });

  it('E1: pedidos de todos los almacenes en el orden del servidor con número, almacén, fecha, total y estado', async () => {
    mockAllOrders.mockResolvedValue([fromAlmacen2, fromAlmacen1]);
    await render(<PanelScreen />);
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

  it('filtro: "Todos" + los 5 estados (S-28), "Todos" marcado al abrir', async () => {
    mockAllOrders.mockResolvedValue([]);
    await render(<PanelScreen />);
    await screen.findByText('Todavía no hay pedidos');
    for (const label of ['Todos', 'Recibido', 'En preparación', 'Enviado', 'Entregado', 'Cancelado']) {
      expect(screen.getByLabelText(`Filtro ${label}`)).toBeOnTheScreen();
    }
    expect(screen.getByLabelText('Filtro Todos')).toBeSelected();
    expect(screen.getByLabelText('Filtro Enviado')).not.toBeSelected();
  });

  it('E2: filtro "Enviado" pide allOrders(ENVIADO) y muestra solo esos; "Todos" quita el filtro', async () => {
    mockAllOrders.mockImplementation(async (status) =>
      [fromAlmacen2, fromAlmacen1].filter((o) => status === null || o.status === status),
    );
    await render(<PanelScreen />);
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

  it('E3: filtro sin pedidos en ese estado → "No hay pedidos en este estado"', async () => {
    mockAllOrders.mockResolvedValueOnce([fromAlmacen1]).mockResolvedValueOnce([]);
    await render(<PanelScreen />);
    await screen.findByText('N° ALM1N1');
    await fireEvent.press(screen.getByLabelText('Filtro Cancelado'));
    expect(await screen.findByText('No hay pedidos en este estado')).toBeOnTheScreen();
    expect(mockAllOrders).toHaveBeenLastCalledWith('CANCELADO');
    expect(screen.queryByText('Todavía no hay pedidos')).toBeNull();
  });

  it('E4: ningún pedido en el sistema → "Todavía no hay pedidos" en state-empty', async () => {
    mockAllOrders.mockResolvedValue([]);
    await render(<PanelScreen />);
    expect(await screen.findByText('Todavía no hay pedidos')).toBeOnTheScreen();
    expect(screen.getByTestId('state-empty')).toBeOnTheScreen();
  });

  it('cargando → state-loading', async () => {
    mockAllOrders.mockReturnValue(new Promise(() => {}));
    await render(<PanelScreen />);
    expect(screen.getByTestId('state-loading')).toBeOnTheScreen();
  });

  it('un error de la API se muestra con su causa en state-error (no como lista vacía)', async () => {
    mockAllOrders.mockRejectedValue(new Error('Network error'));
    await render(<PanelScreen />);
    expect(await screen.findByText('Network error')).toBeOnTheScreen();
    expect(screen.getByTestId('state-error')).toBeOnTheScreen();
    expect(screen.queryByText('Todavía no hay pedidos')).toBeNull();
  });

  it('S-06: al deslizar hacia abajo muestra el estado vigente, con el filtro elegido', async () => {
    mockAllOrders
      .mockResolvedValueOnce([fromAlmacen1])
      .mockResolvedValueOnce([fromAlmacen1])
      .mockResolvedValueOnce([{ ...fromAlmacen1, status: 'EN_PREPARACION' }]);
    await render(<PanelScreen />);
    await screen.findByText('N° ALM1N1');
    await fireEvent.press(screen.getByLabelText('Filtro Recibido'));
    await waitFor(() => expect(mockAllOrders).toHaveBeenCalledTimes(2));
    await screen.findByTestId('status-RECIBIDO');
    await fireEvent(screen.getByTestId('panel-list'), 'refresh');
    expect(await screen.findByTestId('status-EN_PREPARACION')).toBeOnTheScreen();
    expect(mockAllOrders).toHaveBeenLastCalledWith('RECIBIDO');
  });

  it('al cambiar rápido de filtro no gana la respuesta del filtro anterior', async () => {
    let resolveFirst: (o: PanelOrder[]) => void = () => {};
    mockAllOrders
      .mockResolvedValueOnce([fromAlmacen2, fromAlmacen1])
      .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce([fromAlmacen1]);
    await render(<PanelScreen />);
    await screen.findByText('N° ALM2N1');
    await fireEvent.press(screen.getByLabelText('Filtro Enviado'));
    await fireEvent.press(screen.getByLabelText('Filtro Recibido'));
    await screen.findByText('N° ALM1N1');
    resolveFirst([fromAlmacen2]);
    await waitFor(() => expect(screen.queryByText('N° ALM2N1')).toBeNull());
    expect(await numbers()).toEqual(['N° ALM1N1']);
  });

  it('menú de cuenta con "Cerrar sesión" (S-28) → vuelve al inicio', async () => {
    mockAllOrders.mockResolvedValue([]);
    await render(
      <CartProvider>
        <PanelScreen />
      </CartProvider>,
    );
    await fireEvent.press(screen.getByLabelText('Cuenta'));
    expect(await screen.findByText('distribuidor@demo.test')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Cerrar sesión'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(mockSignOut).toHaveBeenCalled();
  });
});
