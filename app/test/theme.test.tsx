// REQ-007 with jest-expo: single theme (E1), contrast (E2), status labels (E3), touch area (E4) and
// state component (E5). The visual comparison on the phone is manual (E6, DEC-011).
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Pressable, StyleSheet, Text } from 'react-native';
import { fetchAuthSession, fetchUserAttributes, signIn } from 'aws-amplify/auth';
import { useLocalSearchParams } from 'expo-router';
import CartScreen from '@/app/cart';
import CatalogScreen from '@/app/catalog';
import LoginScreen from '@/app/index';
import OrderDetailScreen from '@/app/order/[id]';
import OrdersScreen from '@/app/orders';
import { AccountMenu } from '@/components/AccountMenu';
import { Button } from '@/components/Button';
import { CartBar } from '@/components/CartBar';
import { QuantityStepper } from '@/components/QuantityStepper';
import { SignOutButton } from '@/components/SignOutButton';
import { StateMessage } from '@/components/StateMessage';
import { StatusBadge } from '@/components/StatusBadge';
import { createOrder, getOrder, listProducts, myOrders, type OrderSummary, type Product } from '@/lib/api';
import { useCart } from '@/lib/store/cart';
import type { OrderStatus } from '@/lib/generated/graphql';
import { colors, contrastPairs, orderStatus, touchTarget } from '@/theme';
import { resetStores } from './support/stores';

jest.mock('aws-amplify/auth', () => ({
  signOut: jest.fn(),
  signIn: jest.fn(),
  fetchAuthSession: jest.fn(),
  fetchUserAttributes: jest.fn(),
}));
jest.mock('aws-amplify/api', () => ({ generateClient: jest.fn() }));
jest.mock('@/lib/amplify', () => ({ isConfigured: true }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual<typeof import('@/lib/api')>('@/lib/api'),
  listProducts: jest.fn(),
  myOrders: jest.fn(),
  getOrder: jest.fn(),
  createOrder: jest.fn(),
}));
// useFocusEffect runs the effect on mount, like when the screen gains focus.
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Redirect: () => null,
  Stack: { Screen: () => null },
  useLocalSearchParams: jest.fn(),
  useFocusEffect: (effect: () => void) => jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));

const mockListProducts = jest.mocked(listProducts);
const mockMyOrders = jest.mocked(myOrders);
const mockGetOrder = jest.mocked(getOrder);
const mockCreateOrder = jest.mocked(createOrder);
const mockFetchAuthSession = jest.mocked(fetchAuthSession);
const mockFetchUserAttributes = jest.mocked(fetchUserAttributes);
const mockSignIn = jest.mocked(signIn);
const mockParams = jest.mocked(useLocalSearchParams);

beforeEach(() => {
  jest.resetAllMocks();
  resetStores();
});

const SRC = join(__dirname, '..', 'src');

function sourcesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourcesIn(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

// REQ-007 E1: every screen (app/src/app) and component (app/src/components).
const MIGRATED = [...sourcesIn(join(SRC, 'app')), ...sourcesIn(join(SRC, 'components'))];

const FORBIDDEN = [
  { name: 'hex color', re: /['"`]#[0-9a-fA-F]{3,8}['"`]/ },
  { name: 'rgb() color', re: /\brgba?\(/ },
  { name: 'numeric fontSize', re: /fontSize:\s*\d/ },
];

function literalsIn(source: string): string[] {
  return source
    .split('\n')
    .flatMap((line, i) => FORBIDDEN.filter((f) => f.re.test(line)).map((f) => `${i + 1}: ${f.name}: ${line.trim()}`));
}

// WCAG 2.x: relative luminance and contrast ratio.
function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const full = n.length === 3 ? [...n].map((c) => c + c).join('') : n;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const STATUSES: OrderStatus[] = ['RECIBIDO', 'EN_PREPARACION', 'ENVIADO', 'ENTREGADO', 'CANCELADO'];

const arroz: Product = { productId: 'arroz-1kg', name: 'Arroz 1 kg', presentation: 'Paquete 1 kg', unitPrice: 1300 };
const order: OrderSummary = { id: 'id-1', number: 'NUM1', createdAt: '2026-10-16T15:00:00.000Z', total: 2600, status: 'RECIBIDO' };

// Loads 2 Arroz into the shared cart before looking at the Cart screen.
function AddArroz() {
  const { setQuantity } = useCart();
  return (
    <Pressable onPress={() => setQuantity(arroz, 2)}>
      <Text>add arroz</Text>
    </Pressable>
  );
}

async function renderCartWithArroz() {
  await render(
    <>
      <AddArroz />
      <CartScreen />
    </>,
  );
  await fireEvent.press(screen.getByText('add arroz'));
}

describe('REQ-007 E1: no literal colors or numeric fontSize outside theme.ts', () => {
  it('the test checks every screen and the base components', () => {
    const names = MIGRATED.map((f) => relative(SRC, f));
    for (const f of [
      'Screen',
      'Button',
      'Card',
      'StatusBadge',
      'StateMessage',
      'QuantityStepper',
      'SignOutButton',
      'AccountMenu',
      'CartBar',
    ]) {
      expect(names).toContain(join('components', `${f}.tsx`));
    }
    for (const f of [
      '_layout.tsx',
      'index.tsx',
      'catalog.tsx',
      join('product', '[id].tsx'),
      'cart.tsx',
      'orders.tsx',
      join('order', '[id].tsx'),
      join('dist', 'index.tsx'),
    ]) {
      expect(names).toContain(join('app', f));
    }
  });

  it.each(MIGRATED.map((f) => [relative(SRC, f), f]))('%s', (_name, file) => {
    expect(literalsIn(readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('the detector finds literals (it is not empty)', () => {
    expect(literalsIn("a: { color: '#555', fontSize: 16 }\nb: { color: 'rgba(0,0,0,0.5)' }")).toHaveLength(3);
    expect(literalsIn('<Text>N° {item.number}</Text>')).toEqual([]);
  });
});

describe('REQ-007 E2: contrast ≥ 4.5:1 of the theme pairs', () => {
  it.each(contrastPairs.map((p) => [p.name, p.text, p.background]))('%s', (_name, text, background) => {
    expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('a pair below 4.5:1 is detected', () => {
    expect(contrast('#999999', '#FFFFFF')).toBeLessThan(4.5);
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });

  it('the 5 statuses have their pair declared', () => {
    for (const s of STATUSES) expect(contrastPairs.map((p) => p.name)).toContain(`status ${s}`);
  });
});

describe('REQ-007 E3: status labels (S-17)', () => {
  const labels: Record<OrderStatus, string> = {
    RECIBIDO: 'Recibido',
    EN_PREPARACION: 'En preparación',
    ENVIADO: 'Enviado',
    ENTREGADO: 'Entregado',
    CANCELADO: 'Cancelado',
  };

  it.each(STATUSES)('%s', async (status) => {
    await render(<StatusBadge status={status} />);
    const text = screen.getByText(labels[status]);
    expect(StyleSheet.flatten(text.props.style).color).toBe(orderStatus[status].color);
    expect(StyleSheet.flatten(screen.getByTestId(`status-${status}`).props.style).backgroundColor).toBe(
      orderStatus[status].background,
    );
    expect(screen.queryByText(status)).toBeNull();
  });

  it('each status has a different color', () => {
    expect(new Set(STATUSES.map((s) => orderStatus[s].background)).size).toBe(5);
    expect(new Set(STATUSES.map((s) => orderStatus[s].color)).size).toBe(5);
  });

  it('My orders shows orders in the 5 statuses with their label, without the code', async () => {
    mockMyOrders.mockResolvedValue(
      STATUSES.map((status, i) => ({
        id: `id-${status}`,
        number: `NUM${i}`,
        createdAt: '2026-10-16T15:00:00.000Z',
        total: 1300,
        status,
      })),
    );
    await render(<OrdersScreen />);
    for (const status of STATUSES) {
      expect(await screen.findByTestId(`status-${status}`)).toBeOnTheScreen();
      expect(screen.getByText(labels[status])).toBeOnTheScreen();
      expect(screen.queryByText(status)).toBeNull();
    }
  });

  it('Order detail shows the status as a label', async () => {
    mockParams.mockReturnValue({ id: 'id-1' });
    mockGetOrder.mockResolvedValue({ ...order, status: 'EN_PREPARACION', lines: [] });
    await render(<OrderDetailScreen />);
    expect(await screen.findByText('En preparación')).toBeOnTheScreen();
    expect(screen.getByTestId('status-EN_PREPARACION')).toBeOnTheScreen();
  });

  it('the order just confirmed in the Cart shows "Recibido"', async () => {
    mockCreateOrder.mockResolvedValue({ ...order, id: 'id-1', number: 'NUM1' });
    await renderCartWithArroz();
    await fireEvent.press(screen.getByText('Confirmar pedido'));
    expect(await screen.findByText('Pedido confirmado')).toBeOnTheScreen();
    expect(screen.getByText('N° NUM1')).toBeOnTheScreen();
    expect(screen.getByTestId('status-RECIBIDO')).toBeOnTheScreen();
    expect(screen.queryByText(/RECIBIDO/)).toBeNull();
    // Phone finding: the label stayed on the left while the rest of the block was centered.
    expect(StyleSheet.flatten(screen.getByTestId('status-RECIBIDO').props.style).alignSelf).toBe('center');
  });
});

describe('REQ-007 E4: touch area ≥ 44 × 44 dp', () => {
  const size = (label: string) => {
    const s = StyleSheet.flatten(screen.getByLabelText(label).props.style);
    return { w: s.width ?? s.minWidth, h: s.height ?? s.minHeight };
  };

  it('− / + of the quantity stepper', async () => {
    await render(<QuantityStepper quantity={1} onChange={() => {}} />);
    for (const label of ['Quitar uno', 'Agregar uno']) {
      expect(size(label).w).toBeGreaterThanOrEqual(touchTarget);
      expect(size(label).h).toBeGreaterThanOrEqual(touchTarget);
    }
    expect(touchTarget).toBeGreaterThanOrEqual(44);
  });

  it.each(['primary', 'secondary', 'link'] as const)('Button %s', async (variant) => {
    await render(<Button title="Action" variant={variant} onPress={() => {}} accessibilityLabel="action" />);
    expect(size('action').w).toBeGreaterThanOrEqual(44);
    expect(size('action').h).toBeGreaterThanOrEqual(44);
  });

  it('"Cerrar sesión"', async () => {
    await render(<SignOutButton />);
    const s = StyleSheet.flatten(screen.getByRole('button', { name: 'Cerrar sesión' }).props.style);
    expect(s.minHeight).toBeGreaterThanOrEqual(44);
    expect(s.minWidth).toBeGreaterThanOrEqual(44);
  });

  it('account button and cart bar (REQ-006)', async () => {
    mockFetchUserAttributes.mockResolvedValue({ email: 'almacen1@demo.test' });
    await render(
      <>
        <AccountMenu />
        <CartBar />
      </>,
    );
    expect(size('Cuenta').w).toBeGreaterThanOrEqual(44);
    expect(size('Cuenta').h).toBeGreaterThanOrEqual(44);
    expect(size('Ver carrito').h).toBeGreaterThanOrEqual(44);
    expect(await screen.findByText('A')).toBeOnTheScreen();
  });

  it('catalog row that opens the product detail (REQ-008)', async () => {
    mockListProducts.mockResolvedValue([
      { productId: 'arroz-1kg', name: 'Arroz 1 kg', presentation: 'Paquete 1 kg', unitPrice: 1300 },
    ]);
    await render(<CatalogScreen />);
    expect(await screen.findByText('Arroz 1 kg')).toBeOnTheScreen();
    expect(size('Ver detalle de Arroz 1 kg').h).toBeGreaterThanOrEqual(44);
  });

  it('"Ingresar" and the sign-in fields', async () => {
    mockFetchAuthSession.mockResolvedValue({} as Awaited<ReturnType<typeof fetchAuthSession>>);
    await render(<LoginScreen />);
    expect(await screen.findByText('Pedidos B2B')).toBeOnTheScreen();
    expect(size('Ingresar').w).toBeGreaterThanOrEqual(44);
    expect(size('Ingresar').h).toBeGreaterThanOrEqual(44);
    for (const placeholder of ['Correo', 'Contraseña']) {
      const s = StyleSheet.flatten(screen.getByPlaceholderText(placeholder).props.style);
      expect(s.minHeight).toBeGreaterThanOrEqual(44);
    }
  });

  it('the Cart\'s "Confirmar pedido"', async () => {
    await renderCartWithArroz();
    expect(size('Confirmar pedido').w).toBeGreaterThanOrEqual(44);
    expect(size('Confirmar pedido').h).toBeGreaterThanOrEqual(44);
  });
});

describe('REQ-007 E5: loading, empty and error with StateMessage', () => {
  function renderCatalog() {
    return render(<CatalogScreen />);
  }

  it("StateMessage: error with the theme's error color", async () => {
    await render(<StateMessage kind="error" message="Network error" />);
    expect(StyleSheet.flatten(screen.getByText('Network error').props.style).color).toBe(colors.danger);
  });

  it('catalog loading → state-loading', async () => {
    mockListProducts.mockReturnValue(new Promise(() => {}));
    await renderCatalog();
    expect(screen.getByTestId('state-loading')).toBeOnTheScreen();
  });

  it('REQ-002 E3: empty catalog → "No hay productos disponibles" in state-empty', async () => {
    mockListProducts.mockResolvedValue([]);
    await renderCatalog();
    expect(await screen.findByText('No hay productos disponibles')).toBeOnTheScreen();
    expect(screen.getByTestId('state-empty')).toBeOnTheScreen();
  });

  it('network error → error message in state-error (not as an empty list)', async () => {
    mockListProducts.mockRejectedValue(new Error('Network error'));
    await renderCatalog();
    expect(await screen.findByText('Network error')).toBeOnTheScreen();
    expect(screen.getByTestId('state-error')).toBeOnTheScreen();
    expect(screen.queryByText('No hay productos disponibles')).toBeNull();
  });

  it('REQ-002: the migrated catalog still shows name, presentation, price and − / +', async () => {
    mockListProducts.mockResolvedValue([arroz]);
    await renderCatalog();
    expect(await screen.findByText('Arroz 1 kg')).toBeOnTheScreen();
    expect(screen.getByText('Paquete 1 kg')).toBeOnTheScreen();
    expect(screen.getByText(/\$\s*1\.300/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Agregar uno')).toBeOnTheScreen();
  });

  it('My orders loading → state-loading', async () => {
    mockMyOrders.mockReturnValue(new Promise(() => {}));
    await render(<OrdersScreen />);
    expect(screen.getByTestId('state-loading')).toBeOnTheScreen();
  });

  it('REQ-004 E4: no orders → "Todavía no hiciste pedidos" in state-empty', async () => {
    mockMyOrders.mockResolvedValue([]);
    await render(<OrdersScreen />);
    expect(await screen.findByText('Todavía no hiciste pedidos')).toBeOnTheScreen();
    expect(screen.getByTestId('state-empty')).toBeOnTheScreen();
  });

  it('My orders with a network error → state-error', async () => {
    mockMyOrders.mockRejectedValue(new Error('Network error'));
    await render(<OrdersScreen />);
    expect(await screen.findByText('Network error')).toBeOnTheScreen();
    expect(screen.getByTestId('state-error')).toBeOnTheScreen();
  });

  it('Order detail: loading, not found and network error with StateMessage', async () => {
    mockParams.mockReturnValue({ id: 'id-1' });
    mockGetOrder.mockReturnValueOnce(new Promise(() => {}));
    const view = await render(<OrderDetailScreen />);
    expect(screen.getByTestId('state-loading')).toBeOnTheScreen();
    await view.unmount();

    mockGetOrder.mockResolvedValueOnce(null);
    const notFound = await render(<OrderDetailScreen />);
    expect(await screen.findByText('Pedido no encontrado')).toBeOnTheScreen();
    expect(screen.getByTestId('state-empty')).toBeOnTheScreen();
    await notFound.unmount();

    mockGetOrder.mockRejectedValueOnce(new Error('Network error'));
    await render(<OrderDetailScreen />);
    expect(await screen.findByText('Network error')).toBeOnTheScreen();
    expect(screen.getByTestId('state-error')).toBeOnTheScreen();
  });

  it('empty Cart → "El carrito está vacío" in state-empty; rejection → state-error', async () => {
    await render(<CartScreen />);
    expect(screen.getByText('El carrito está vacío')).toBeOnTheScreen();
    expect(screen.getByTestId('state-empty')).toBeOnTheScreen();
    await screen.unmount();

    mockCreateOrder.mockRejectedValue(new Error('Network error'));
    await renderCartWithArroz();
    await fireEvent.press(screen.getByText('Confirmar pedido'));
    expect(await screen.findByText('Network error')).toBeOnTheScreen();
    expect(screen.getByTestId('state-error')).toBeOnTheScreen();
  });

  it('Sign-in: checking the session → state-loading; invalid credentials → state-error', async () => {
    mockFetchAuthSession.mockReturnValueOnce(new Promise(() => {}));
    const view = await render(<LoginScreen />);
    expect(screen.getByTestId('state-loading')).toBeOnTheScreen();
    expect(screen.getByLabelText('Comprobando sesión')).toBeOnTheScreen();
    await view.unmount();

    mockFetchAuthSession.mockResolvedValue({} as Awaited<ReturnType<typeof fetchAuthSession>>);
    const e = new Error('Incorrect username or password.');
    e.name = 'NotAuthorizedException';
    mockSignIn.mockRejectedValue(e);
    await render(<LoginScreen />);
    await fireEvent.changeText(await screen.findByPlaceholderText('Correo'), 'almacen1@demo.test');
    await fireEvent.changeText(screen.getByPlaceholderText('Contraseña'), 'wrong');
    await fireEvent.press(screen.getByText('Ingresar'));
    expect(await screen.findByText('Correo o contraseña incorrectos')).toBeOnTheScreen();
    expect(screen.getByTestId('state-error')).toBeOnTheScreen();
  });
});
