// REQ-004 screens with jest-expo. The API and the router are mocked; the real flow against `dev`
// (order → RECIBIDO → order:set-status ENVIADO → refresh) is checked by hand on the phone (DEC-011).
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import OrderDetailScreen from '@/app/order/[id]';
import OrdersScreen from '@/app/orders';
import { getOrder, myOrders, type OrderDetail, type OrderSummary } from '@/lib/api';

jest.mock('aws-amplify/api', () => ({ generateClient: jest.fn() }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual<typeof import('@/lib/api')>('@/lib/api'),
  myOrders: jest.fn(),
  getOrder: jest.fn(),
}));
// useFocusEffect runs the effect on mount, like when the screen gains focus.
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: jest.fn(),
  useFocusEffect: (effect: () => void) => jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));

const mockMyOrders = jest.mocked(myOrders);
const mockGetOrder = jest.mocked(getOrder);
const mockPush = jest.mocked(router.push);
const mockParams = jest.mocked(useLocalSearchParams);

const newer: OrderSummary = { id: '01JB0000000000000000NEWER1', number: 'NEWER1', createdAt: '2026-10-16T15:00:00.000Z', total: 15500, status: 'RECIBIDO' };
const older: OrderSummary = { id: '01JA0000000000000000OLDER1', number: 'OLDER1', createdAt: '2026-10-15T15:00:00.000Z', total: 4500, status: 'ENTREGADO' };

const detail: OrderDetail = {
  ...newer,
  lines: [
    { productId: 'yerba-1kg', name: 'Yerba 1 kg', presentation: 'Paquete 1 kg', quantity: 2, unitPrice: 4500, subtotal: 9000 },
    { productId: 'arroz-1kg', name: 'Arroz 1 kg', presentation: 'Paquete 1 kg', quantity: 5, unitPrice: 1300, subtotal: 6500 },
  ],
};

// Intl in Node and in Hermes may separate with different spaces; compare without them.
const money = (text: string) => new RegExp(text.replace(/\$/g, '\\$').replace(/\s/g, '\\s*'));

beforeEach(() => {
  jest.resetAllMocks(); // also discards `Once` responses a case didn't consume
});

describe('REQ-004 My orders', () => {
  it('E1: list in server order (newest first) with number, date, total and status', async () => {
    mockMyOrders.mockResolvedValue([newer, older]);
    await render(<OrdersScreen />);
    const numbers = await screen.findAllByText(/^N° /);
    expect(numbers.map((n) => n.props.children.join(''))).toEqual(['N° NEWER1', 'N° OLDER1']);
    expect(screen.getByText('Recibido')).toBeOnTheScreen();
    expect(screen.getByText('Entregado')).toBeOnTheScreen();
    expect(screen.getByText(money('$15.500'))).toBeOnTheScreen();
    expect(screen.getByText(money('$4.500'))).toBeOnTheScreen();
    expect(screen.getAllByText(/\d{2}-\d{2}-\d{2,4}/)).toHaveLength(2);
  });

  it('opening an order navigates to its detail', async () => {
    mockMyOrders.mockResolvedValue([newer]);
    await render(<OrdersScreen />);
    await fireEvent.press(await screen.findByText('N° NEWER1'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/order/[id]', params: { id: newer.id } });
  });

  it('E2: refreshing shows the current status', async () => {
    mockMyOrders.mockResolvedValueOnce([newer]).mockResolvedValueOnce([{ ...newer, status: 'ENVIADO' }]);
    await render(<OrdersScreen />);
    expect(await screen.findByText('Recibido')).toBeOnTheScreen();
    await fireEvent(screen.getByTestId('orders-list'), 'refresh');
    expect(await screen.findByText('Enviado')).toBeOnTheScreen();
    expect(screen.queryByText('Recibido')).toBeNull();
    expect(mockMyOrders).toHaveBeenCalledTimes(2);
  });

  it('E4: customer without orders → "Todavía no hiciste pedidos"', async () => {
    mockMyOrders.mockResolvedValue([]);
    await render(<OrdersScreen />);
    expect(await screen.findByText('Todavía no hiciste pedidos')).toBeOnTheScreen();
  });

  it('an API error is shown with its cause (not as an empty list)', async () => {
    mockMyOrders.mockRejectedValue(new Error('Network error'));
    await render(<OrdersScreen />);
    expect(await screen.findByText('Network error')).toBeOnTheScreen();
    expect(screen.queryByText('Todavía no hiciste pedidos')).toBeNull();
  });
});

describe('REQ-004 Order detail', () => {
  beforeEach(() => {
    mockParams.mockReturnValue({ id: newer.id });
  });

  it('E5: shows the lines with frozen prices, the total and the current status', async () => {
    mockGetOrder.mockResolvedValue(detail);
    await render(<OrderDetailScreen />);
    expect(await screen.findByText('N° NEWER1')).toBeOnTheScreen();
    expect(mockGetOrder).toHaveBeenCalledWith(newer.id);
    expect(screen.getByText('Recibido')).toBeOnTheScreen();
    expect(screen.getByText('Yerba 1 kg')).toBeOnTheScreen();
    expect(screen.getByText(money('Paquete 1 kg · 2 × $4.500'))).toBeOnTheScreen();
    expect(screen.getByText(money('Subtotal $9.000'))).toBeOnTheScreen();
    expect(screen.getByText(money('Paquete 1 kg · 5 × $1.300'))).toBeOnTheScreen();
    expect(screen.getByText(money('Subtotal $6.500'))).toBeOnTheScreen();
    expect(screen.getByText(money('Total $15.500'))).toBeOnTheScreen();
  });

  it('E2: refreshing the detail shows the current status', async () => {
    mockGetOrder.mockResolvedValueOnce(detail).mockResolvedValueOnce({ ...detail, status: 'ENVIADO' });
    await render(<OrderDetailScreen />);
    expect(await screen.findByText('Recibido')).toBeOnTheScreen();
    await fireEvent(screen.getByTestId('order-detail'), 'refresh');
    await waitFor(() => expect(screen.getByText('Enviado')).toBeOnTheScreen());
  });

  it('E3: another customer\'s or a missing order (null) → "Pedido no encontrado", no data', async () => {
    mockGetOrder.mockResolvedValue(null);
    await render(<OrderDetailScreen />);
    expect(await screen.findByText('Pedido no encontrado')).toBeOnTheScreen();
    expect(screen.queryByText(/^N° /)).toBeNull();
  });
});
