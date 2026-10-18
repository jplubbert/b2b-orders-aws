// Pantallas de REQ-004 con jest-expo. La API y el router van simulados; el recorrido real contra `dev`
// (pedido → RECIBIDO → order:set-status ENVIADO → refrescar) se verifica a mano en el teléfono (DEC-011).
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
// useFocusEffect corre el efecto al montar, como cuando la pantalla gana el foco.
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

// Intl en Node y en Hermes puede separar con espacios distintos; se compara sin ellos.
const money = (text: string) => new RegExp(text.replace(/\$/g, '\\$').replace(/\s/g, '\\s*'));

beforeEach(() => {
  jest.resetAllMocks(); // también descarta respuestas `Once` que un caso no consumió
});

describe('REQ-004 Mis pedidos', () => {
  it('E1: lista en el orden del servidor (más reciente primero) con número, fecha, total y estado', async () => {
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

  it('abrir un pedido navega a su detalle', async () => {
    mockMyOrders.mockResolvedValue([newer]);
    await render(<OrdersScreen />);
    await fireEvent.press(await screen.findByText('N° NEWER1'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/order/[id]', params: { id: newer.id } });
  });

  it('E2: al refrescar muestra el estado vigente', async () => {
    mockMyOrders.mockResolvedValueOnce([newer]).mockResolvedValueOnce([{ ...newer, status: 'ENVIADO' }]);
    await render(<OrdersScreen />);
    expect(await screen.findByText('Recibido')).toBeOnTheScreen();
    await fireEvent(screen.getByTestId('orders-list'), 'refresh');
    expect(await screen.findByText('Enviado')).toBeOnTheScreen();
    expect(screen.queryByText('Recibido')).toBeNull();
    expect(mockMyOrders).toHaveBeenCalledTimes(2);
  });

  it('E4: cliente sin pedidos → "Todavía no hiciste pedidos"', async () => {
    mockMyOrders.mockResolvedValue([]);
    await render(<OrdersScreen />);
    expect(await screen.findByText('Todavía no hiciste pedidos')).toBeOnTheScreen();
  });

  it('un error de la API se muestra con su causa (no como lista vacía)', async () => {
    mockMyOrders.mockRejectedValue(new Error('Network error'));
    await render(<OrdersScreen />);
    expect(await screen.findByText('Network error')).toBeOnTheScreen();
    expect(screen.queryByText('Todavía no hiciste pedidos')).toBeNull();
  });
});

describe('REQ-004 Detalle de pedido', () => {
  beforeEach(() => {
    mockParams.mockReturnValue({ id: newer.id });
  });

  it('E5: muestra las líneas con los precios congelados, el total y el estado actual', async () => {
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

  it('E2: al refrescar el detalle muestra el estado vigente', async () => {
    mockGetOrder.mockResolvedValueOnce(detail).mockResolvedValueOnce({ ...detail, status: 'ENVIADO' });
    await render(<OrderDetailScreen />);
    expect(await screen.findByText('Recibido')).toBeOnTheScreen();
    await fireEvent(screen.getByTestId('order-detail'), 'refresh');
    await waitFor(() => expect(screen.getByText('Enviado')).toBeOnTheScreen());
  });

  it('E3: un pedido ajeno o inexistente (null) → "Pedido no encontrado", sin datos', async () => {
    mockGetOrder.mockResolvedValue(null);
    await render(<OrderDetailScreen />);
    expect(await screen.findByText('Pedido no encontrado')).toBeOnTheScreen();
    expect(screen.queryByText(/^N° /)).toBeNull();
  });
});
