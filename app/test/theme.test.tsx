// REQ-007 con jest-expo: tema único (E1), contraste (E2), etiquetas de estado (E3), área táctil (E4) y
// componente de estado (E5). La comparación visual en el teléfono es manual (E6, DEC-011).
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
import { CartProvider, useCart } from '@/lib/CartProvider';
import type { OrderStatus } from '@/lib/generated/graphql';
import { colors, contrastPairs, orderStatus, touchTarget } from '@/theme';

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
// useFocusEffect corre el efecto al montar, como cuando la pantalla gana el foco.
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
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
});

const SRC = join(__dirname, '..', 'src');

function sourcesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourcesIn(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

// REQ-007 E1: todas las pantallas (app/src/app) y componentes (app/src/components).
const MIGRATED = [...sourcesIn(join(SRC, 'app')), ...sourcesIn(join(SRC, 'components'))];

const FORBIDDEN = [
  { name: 'color hexadecimal', re: /['"`]#[0-9a-fA-F]{3,8}['"`]/ },
  { name: 'color rgb()', re: /\brgba?\(/ },
  { name: 'fontSize numérico', re: /fontSize:\s*\d/ },
];

function literalsIn(source: string): string[] {
  return source
    .split('\n')
    .flatMap((line, i) => FORBIDDEN.filter((f) => f.re.test(line)).map((f) => `${i + 1}: ${f.name}: ${line.trim()}`));
}

// WCAG 2.x: luminancia relativa y razón de contraste.
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

// Carga 2 Arroz en el carrito compartido antes de mirar la pantalla Carrito.
function AddArroz() {
  const { setQuantity } = useCart();
  return (
    <Pressable onPress={() => setQuantity(arroz, 2)}>
      <Text>agregar arroz</Text>
    </Pressable>
  );
}

async function renderCartWithArroz() {
  await render(
    <CartProvider>
      <AddArroz />
      <CartScreen />
    </CartProvider>,
  );
  await fireEvent.press(screen.getByText('agregar arroz'));
}

describe('REQ-007 E1: sin colores literales ni fontSize numérico fuera de theme.ts', () => {
  it('la prueba revisa todas las pantallas y los componentes base', () => {
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
    ]) {
      expect(names).toContain(join('app', f));
    }
  });

  it.each(MIGRATED.map((f) => [relative(SRC, f), f]))('%s', (_name, file) => {
    expect(literalsIn(readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('el detector encuentra literales (no es vacío)', () => {
    expect(literalsIn("a: { color: '#555', fontSize: 16 }\nb: { color: 'rgba(0,0,0,0.5)' }")).toHaveLength(3);
    expect(literalsIn('<Text>N° {item.number}</Text>')).toEqual([]);
  });
});

describe('REQ-007 E2: contraste ≥ 4,5:1 de los pares del tema', () => {
  it.each(contrastPairs.map((p) => [p.name, p.text, p.background]))('%s', (_name, text, background) => {
    expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('un par por debajo de 4,5:1 se detecta', () => {
    expect(contrast('#999999', '#FFFFFF')).toBeLessThan(4.5);
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });

  it('los 5 estados tienen su par declarado', () => {
    for (const s of STATUSES) expect(contrastPairs.map((p) => p.name)).toContain(`estado ${s}`);
  });
});

describe('REQ-007 E3: etiquetas de estado (S-17)', () => {
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

  it('cada estado tiene un color distinto', () => {
    expect(new Set(STATUSES.map((s) => orderStatus[s].background)).size).toBe(5);
    expect(new Set(STATUSES.map((s) => orderStatus[s].color)).size).toBe(5);
  });

  it('Mis pedidos muestra pedidos en los 5 estados con su etiqueta, sin el código', async () => {
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

  it('Detalle de pedido muestra el estado como etiqueta', async () => {
    mockParams.mockReturnValue({ id: 'id-1' });
    mockGetOrder.mockResolvedValue({ ...order, status: 'EN_PREPARACION', lines: [] });
    await render(<OrderDetailScreen />);
    expect(await screen.findByText('En preparación')).toBeOnTheScreen();
    expect(screen.getByTestId('status-EN_PREPARACION')).toBeOnTheScreen();
  });

  it('el pedido recién confirmado en Carrito muestra "Recibido"', async () => {
    mockCreateOrder.mockResolvedValue({ ...order, id: 'id-1', number: 'NUM1' });
    await renderCartWithArroz();
    await fireEvent.press(screen.getByText('Confirmar pedido'));
    expect(await screen.findByText('Pedido confirmado')).toBeOnTheScreen();
    expect(screen.getByText('N° NUM1')).toBeOnTheScreen();
    expect(screen.getByTestId('status-RECIBIDO')).toBeOnTheScreen();
    expect(screen.queryByText(/RECIBIDO/)).toBeNull();
  });
});

describe('REQ-007 E4: área táctil ≥ 44 × 44 dp', () => {
  const size = (label: string) => {
    const s = StyleSheet.flatten(screen.getByLabelText(label).props.style);
    return { w: s.width ?? s.minWidth, h: s.height ?? s.minHeight };
  };

  it('− / + del selector de cantidad', async () => {
    await render(<QuantityStepper quantity={1} onChange={() => {}} />);
    for (const label of ['Quitar uno', 'Agregar uno']) {
      expect(size(label).w).toBeGreaterThanOrEqual(touchTarget);
      expect(size(label).h).toBeGreaterThanOrEqual(touchTarget);
    }
    expect(touchTarget).toBeGreaterThanOrEqual(44);
  });

  it.each(['primary', 'secondary', 'link'] as const)('Button %s', async (variant) => {
    await render(<Button title="Acción" variant={variant} onPress={() => {}} accessibilityLabel="acción" />);
    expect(size('acción').w).toBeGreaterThanOrEqual(44);
    expect(size('acción').h).toBeGreaterThanOrEqual(44);
  });

  it('"Cerrar sesión"', async () => {
    await render(
      <CartProvider>
        <SignOutButton />
      </CartProvider>,
    );
    const s = StyleSheet.flatten(screen.getByRole('button', { name: 'Cerrar sesión' }).props.style);
    expect(s.minHeight).toBeGreaterThanOrEqual(44);
    expect(s.minWidth).toBeGreaterThanOrEqual(44);
  });

  it('botón de cuenta y barra del carrito (REQ-006)', async () => {
    mockFetchUserAttributes.mockResolvedValue({ email: 'almacen1@demo.test' });
    await render(
      <CartProvider>
        <AccountMenu />
        <CartBar />
      </CartProvider>,
    );
    expect(size('Cuenta').w).toBeGreaterThanOrEqual(44);
    expect(size('Cuenta').h).toBeGreaterThanOrEqual(44);
    expect(size('Ver carrito').h).toBeGreaterThanOrEqual(44);
    expect(await screen.findByText('A')).toBeOnTheScreen();
  });

  it('fila del catálogo que abre el detalle de producto (REQ-008)', async () => {
    mockListProducts.mockResolvedValue([
      { productId: 'arroz-1kg', name: 'Arroz 1 kg', presentation: 'Paquete 1 kg', unitPrice: 1300 },
    ]);
    await render(
      <CartProvider>
        <CatalogScreen />
      </CartProvider>,
    );
    expect(await screen.findByText('Arroz 1 kg')).toBeOnTheScreen();
    expect(size('Ver detalle de Arroz 1 kg').h).toBeGreaterThanOrEqual(44);
  });

  it('"Ingresar" y campos de Inicio de sesión', async () => {
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

  it('"Confirmar pedido" del Carrito', async () => {
    await renderCartWithArroz();
    expect(size('Confirmar pedido').w).toBeGreaterThanOrEqual(44);
    expect(size('Confirmar pedido').h).toBeGreaterThanOrEqual(44);
  });
});

describe('REQ-007 E5: carga, vacío y error con StateMessage', () => {
  function renderCatalog() {
    return render(
      <CartProvider>
        <CatalogScreen />
      </CartProvider>,
    );
  }

  it('StateMessage: error con el color de error del tema', async () => {
    await render(<StateMessage kind="error" message="Network error" />);
    expect(StyleSheet.flatten(screen.getByText('Network error').props.style).color).toBe(colors.danger);
  });

  it('catálogo cargando → state-loading', async () => {
    mockListProducts.mockReturnValue(new Promise(() => {}));
    await renderCatalog();
    expect(screen.getByTestId('state-loading')).toBeOnTheScreen();
  });

  it('REQ-002 E3: catálogo vacío → "No hay productos disponibles" en state-empty', async () => {
    mockListProducts.mockResolvedValue([]);
    await renderCatalog();
    expect(await screen.findByText('No hay productos disponibles')).toBeOnTheScreen();
    expect(screen.getByTestId('state-empty')).toBeOnTheScreen();
  });

  it('error de red → mensaje de error en state-error (no como lista vacía)', async () => {
    mockListProducts.mockRejectedValue(new Error('Network error'));
    await renderCatalog();
    expect(await screen.findByText('Network error')).toBeOnTheScreen();
    expect(screen.getByTestId('state-error')).toBeOnTheScreen();
    expect(screen.queryByText('No hay productos disponibles')).toBeNull();
  });

  it('REQ-002: el catálogo migrado sigue mostrando nombre, presentación, precio y − / +', async () => {
    mockListProducts.mockResolvedValue([arroz]);
    await renderCatalog();
    expect(await screen.findByText('Arroz 1 kg')).toBeOnTheScreen();
    expect(screen.getByText('Paquete 1 kg')).toBeOnTheScreen();
    expect(screen.getByText(/\$\s*1\.300/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Agregar uno')).toBeOnTheScreen();
  });

  it('Mis pedidos cargando → state-loading', async () => {
    mockMyOrders.mockReturnValue(new Promise(() => {}));
    await render(<OrdersScreen />);
    expect(screen.getByTestId('state-loading')).toBeOnTheScreen();
  });

  it('REQ-004 E4: sin pedidos → "Todavía no hiciste pedidos" en state-empty', async () => {
    mockMyOrders.mockResolvedValue([]);
    await render(<OrdersScreen />);
    expect(await screen.findByText('Todavía no hiciste pedidos')).toBeOnTheScreen();
    expect(screen.getByTestId('state-empty')).toBeOnTheScreen();
  });

  it('Mis pedidos con error de red → state-error', async () => {
    mockMyOrders.mockRejectedValue(new Error('Network error'));
    await render(<OrdersScreen />);
    expect(await screen.findByText('Network error')).toBeOnTheScreen();
    expect(screen.getByTestId('state-error')).toBeOnTheScreen();
  });

  it('Detalle de pedido: cargando, no encontrado y error de red con StateMessage', async () => {
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

  it('Carrito vacío → "El carrito está vacío" en state-empty; rechazo → state-error', async () => {
    await render(
      <CartProvider>
        <CartScreen />
      </CartProvider>,
    );
    expect(screen.getByText('El carrito está vacío')).toBeOnTheScreen();
    expect(screen.getByTestId('state-empty')).toBeOnTheScreen();
    await screen.unmount();

    mockCreateOrder.mockRejectedValue(new Error('Network error'));
    await renderCartWithArroz();
    await fireEvent.press(screen.getByText('Confirmar pedido'));
    expect(await screen.findByText('Network error')).toBeOnTheScreen();
    expect(screen.getByTestId('state-error')).toBeOnTheScreen();
  });

  it('Inicio de sesión: comprobando sesión → state-loading; credenciales inválidas → state-error', async () => {
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
    await fireEvent.changeText(screen.getByPlaceholderText('Contraseña'), 'erronea');
    await fireEvent.press(screen.getByText('Ingresar'));
    expect(await screen.findByText('Correo o contraseña incorrectos')).toBeOnTheScreen();
    expect(screen.getByTestId('state-error')).toBeOnTheScreen();
  });
});
