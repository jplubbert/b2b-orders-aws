// Distributor order detail and status change (REQ-010 E5, REQ-011 E1, E3, E7, S-24, S-28) with
// jest-expo. The panel and the detail share the panel store as in the app; the API and the router are mocked.
// The real flow against `dev` (cut 3 success criterion) is checked by hand on the phone (DEC-011).
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { useState, type ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import DistOrderScreen from '@/app/dist/order/[id]';
import PanelScreen from '@/app/dist/index';
import { allOrders, setOrderStatus, type PanelOrder } from '@/lib/api';
import { resetStores } from './support/stores';

type ScreenProps = { options?: { title?: string } };
const mockScreens: ScreenProps[] = [];

jest.mock('aws-amplify/auth', () => ({ signOut: jest.fn(), fetchUserAttributes: jest.fn() }));
jest.mock('aws-amplify/api', () => ({ generateClient: jest.fn() }));
jest.mock('@/lib/amplify', () => ({ configureAmplify: jest.fn(), isConfigured: true }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual<typeof import('@/lib/api')>('@/lib/api'),
  allOrders: jest.fn(),
  setOrderStatus: jest.fn(),
}));
jest.mock('expo-router', () => {
  const { createElement, Fragment, useEffect } = jest.requireActual<typeof import('react')>('react');
  const Stack = ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children);
  Stack.Screen = (props: ScreenProps) => {
    mockScreens.push(props);
    return null;
  };
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() },
    Stack,
    useLocalSearchParams: jest.fn(),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const mockAllOrders = jest.mocked(allOrders);
const mockSetOrderStatus = jest.mocked(setOrderStatus);
const mockParams = jest.mocked(useLocalSearchParams);

// REQ-010 E5: almacen1's order of 2 Yerba + 5 Arroz.
const order: PanelOrder = {
  id: '01JA0000000000000000ALM1N1',
  customerId: 'C-ALMACEN1',
  number: 'ALM1N1',
  createdAt: '2026-10-15T15:00:00.000Z',
  total: 15500,
  status: 'RECIBIDO',
  lines: [
    { productId: 'yerba-1kg', name: 'Yerba 1 kg', presentation: 'Paquete 1 kg', quantity: 2, unitPrice: 4500, subtotal: 9000 },
    { productId: 'arroz-1kg', name: 'Arroz 1 kg', presentation: 'Paquete 1 kg', quantity: 5, unitPrice: 1300, subtotal: 6500 },
  ],
};
const other: PanelOrder = { ...order, id: '01JB0000000000000000ALM2N1', customerId: 'C-ALMACEN2', number: 'ALM2N1' };

// Intl in Node and in Hermes may separate with different spaces; compare without them.
const money = (text: string) => new RegExp(text.replace(/[$.]/g, '\\$&').replace(/\s/g, '\\s*'));

// Panel and detail on the same panel store; the panel loads the list and then
// the detail is shown (like tapping a row).
function App() {
  const [detail, setDetail] = useState(false);
  return (
    <>
      {detail ? <DistOrderScreen /> : <PanelScreen />}
      <Pressable onPress={() => setDetail(!detail)} accessibilityLabel="toggle">
        <Text>toggle</Text>
      </Pressable>
    </>
  );
}

async function openDetail(list: PanelOrder[]) {
  mockAllOrders.mockResolvedValue(list);
  await render(<App />);
  await screen.findByText(`N° ${list[0].number}`);
  await fireEvent.press(screen.getByLabelText('toggle'));
}

beforeEach(() => {
  jest.resetAllMocks(); // also discards `Once` responses a case didn't consume
  mockScreens.length = 0;
  resetStores();
  mockParams.mockReturnValue({ id: order.id });
});

describe('REQ-010 E5 order detail (distributor)', () => {
  it('E5: title "Pedido <number>", store, 2 lines with frozen price, total and status', async () => {
    await openDetail([other, order]);
    expect(mockScreens.at(-1)?.options?.title).toBe('Pedido ALM1N1');
    expect(screen.getByText('Almacén C-ALMACEN1')).toBeOnTheScreen();
    expect(screen.getByText('Yerba 1 kg')).toBeOnTheScreen();
    expect(screen.getByText('Arroz 1 kg')).toBeOnTheScreen();
    expect(screen.getByText(money('Paquete 1 kg · 2 × $4.500'))).toBeOnTheScreen();
    expect(screen.getByText(money('Paquete 1 kg · 5 × $1.300'))).toBeOnTheScreen();
    expect(screen.getByText(money('Total $15.500'))).toBeOnTheScreen();
    expect(screen.getByTestId('status-RECIBIDO')).toBeOnTheScreen();
    expect(mockAllOrders).toHaveBeenCalledTimes(1); // no new query (like S-19)
  });

  it('id outside the loaded panel → "Pedido no encontrado" and "Volver a Pedidos"', async () => {
    mockParams.mockReturnValue({ id: 'NO-EXISTE' });
    jest.mocked(router.canGoBack).mockReturnValue(false);
    await openDetail([order]);
    expect(screen.getByText('Pedido no encontrado')).toBeOnTheScreen();
    expect(screen.queryByText('Cambiar estado')).toBeNull();
    await fireEvent.press(screen.getByText('Volver a Pedidos'));
    expect(router.replace).toHaveBeenCalledWith('/dist');
  });
});

describe('REQ-011 change status from the detail', () => {
  it('"Cambiar estado" with the 5 statuses (S-17) and the current one selected', async () => {
    await openDetail([order]);
    expect(screen.getByText('Cambiar estado')).toBeOnTheScreen();
    for (const label of ['Recibido', 'En preparación', 'Enviado', 'Entregado', 'Cancelado']) {
      expect(screen.getByLabelText(`Estado ${label}`)).toBeOnTheScreen();
    }
    expect(screen.getByLabelText('Estado Recibido')).toBeSelected();
    expect(screen.getByLabelText('Estado Enviado')).not.toBeSelected();
  });

  it('E1: RECIBIDO → "En preparación" calls setOrderStatus and updates the detail (no confirmation, S-24)', async () => {
    mockSetOrderStatus.mockResolvedValue({ ...order, status: 'EN_PREPARACION' });
    await openDetail([order]);
    await fireEvent.press(screen.getByLabelText('Estado En preparación'));
    expect(await screen.findByTestId('status-EN_PREPARACION')).toBeOnTheScreen();
    expect(mockSetOrderStatus).toHaveBeenCalledWith('C-ALMACEN1', order.id, 'EN_PREPARACION');
    expect(screen.getByLabelText('Estado En preparación')).toBeSelected();
    expect(screen.queryByTestId('status-RECIBIDO')).toBeNull();
  });

  it('E1 (panel): the panel mounted under the detail shows the new status without a new query', async () => {
    mockAllOrders.mockResolvedValue([other, order]);
    mockSetOrderStatus.mockResolvedValue({ ...order, status: 'ENVIADO' });
    // As in the stack: the panel stays mounted while the detail is on top.
    await render(
      <>
        <PanelScreen />
        <DistOrderScreen />
      </>,
    );
    await fireEvent.press(await screen.findByLabelText('Estado Enviado'));
    const panel = screen.getByTestId('panel-list');
    await waitFor(() => expect(within(panel).getByTestId('status-ENVIADO')).toBeOnTheScreen());
    expect(within(panel).getAllByTestId(/^status-/).map((b) => b.props.testID)).toEqual(['status-RECIBIDO', 'status-ENVIADO']);
    expect(mockAllOrders).toHaveBeenCalledTimes(1);
  });

  it('S-06: going back to the panel requests the current status again', async () => {
    mockSetOrderStatus.mockResolvedValue({ ...order, status: 'ENVIADO' });
    await openDetail([order]);
    await fireEvent.press(screen.getByLabelText('Estado Enviado'));
    await screen.findByTestId('status-ENVIADO');
    mockAllOrders.mockResolvedValue([{ ...order, status: 'ENVIADO' }]);
    await fireEvent.press(screen.getByLabelText('toggle'));
    expect(await screen.findByText('N° ALM1N1')).toBeOnTheScreen();
    expect(screen.getByTestId('status-ENVIADO')).toBeOnTheScreen();
    expect(mockAllOrders).toHaveBeenCalledTimes(2);
  });

  it('E3: choosing the current status is not an error', async () => {
    mockSetOrderStatus.mockResolvedValue(order);
    await openDetail([order]);
    await fireEvent.press(screen.getByLabelText('Estado Recibido'));
    await waitFor(() => expect(mockSetOrderStatus).toHaveBeenCalledWith('C-ALMACEN1', order.id, 'RECIBIDO'));
    expect(screen.getByTestId('status-RECIBIDO')).toBeOnTheScreen();
    expect(screen.queryByText('No se pudo cambiar el estado')).toBeNull();
  });

  it('E7: network failure → "No se pudo cambiar el estado" and the previous status is kept', async () => {
    mockSetOrderStatus.mockRejectedValue(new Error('Network error'));
    await openDetail([order]);
    await fireEvent.press(screen.getByLabelText('Estado Enviado'));
    expect(await screen.findByText('No se pudo cambiar el estado')).toBeOnTheScreen();
    expect(screen.getByTestId('state-error')).toBeOnTheScreen();
    expect(screen.getByTestId('status-RECIBIDO')).toBeOnTheScreen();
    expect(screen.getByLabelText('Estado Recibido')).toBeSelected();
    expect(screen.getByLabelText('Estado Enviado')).not.toBeSelected();
  });

  it('after an error, an attempt that works clears the message', async () => {
    mockSetOrderStatus.mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce({ ...order, status: 'ENVIADO' });
    await openDetail([order]);
    await fireEvent.press(screen.getByLabelText('Estado Enviado'));
    await screen.findByText('No se pudo cambiar el estado');
    await fireEvent.press(screen.getByLabelText('Estado Enviado'));
    expect(await screen.findByTestId('status-ENVIADO')).toBeOnTheScreen();
    expect(screen.queryByText('No se pudo cambiar el estado')).toBeNull();
  });

  it('while saving, the status buttons are disabled (one change at a time)', async () => {
    mockSetOrderStatus.mockReturnValue(new Promise(() => {}));
    await openDetail([order]);
    await fireEvent.press(screen.getByLabelText('Estado Enviado'));
    expect(screen.getByLabelText('Estado Entregado')).toBeDisabled();
    await fireEvent.press(screen.getByLabelText('Estado Entregado'));
    expect(mockSetOrderStatus).toHaveBeenCalledTimes(1);
  });
});
