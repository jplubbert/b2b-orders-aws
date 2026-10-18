// REQ-008 E1–E5 with jest-expo: product detail from the loaded catalog (S-19) on the same cart.
// The router is mocked: `push` to /product/<id> changes the screen rendered inside the same CartProvider,
// and `back` returns to the catalog. The check on the phone is manual (DEC-011).
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import CatalogScreen from '@/app/catalog';
import ProductScreen from '@/app/product/[id]';
import { listProducts, type Product } from '@/lib/api';
import { CartProvider, useCart } from '@/lib/CartProvider';

jest.mock('aws-amplify/auth', () => ({ signOut: jest.fn(), fetchUserAttributes: jest.fn() }));
jest.mock('aws-amplify/api', () => ({ generateClient: jest.fn() }));
jest.mock('@/lib/amplify', () => ({ configureAmplify: jest.fn(), isConfigured: true }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual<typeof import('@/lib/api')>('@/lib/api'),
  listProducts: jest.fn(),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() },
  useLocalSearchParams: jest.fn(),
  Stack: { Screen: () => null },
}));

const mockListProducts = jest.mocked(listProducts);
const mockParams = jest.mocked(useLocalSearchParams);
const mockPush = jest.mocked(router.push);
const mockBack = jest.mocked(router.back);
const mockReplace = jest.mocked(router.replace);
const mockCanGoBack = jest.mocked(router.canGoBack);

const arroz: Product = { productId: 'arroz-1kg', name: 'Arroz 1 kg', presentation: 'Paquete 1 kg', unitPrice: 1300 };
const yerba: Product = { productId: 'yerba-1kg', name: 'Yerba 1 kg', presentation: 'Bolsa 1 kg', unitPrice: 4500 };

// Intl in Node and in Hermes may separate with different spaces; compare without them.
const money = (text: string) => new RegExp(text.replace(/[$.]/g, '\\$&').replace(/\s/g, '\\s*'));

// Minimal stack: catalog or detail depending on the last mocked navigation, with a single cart.
let navigate: (productId: string | null) => void = () => {};
function App() {
  const [id, setId] = useState<string | null>(null);
  navigate = setId;
  if (id) {
    mockParams.mockReturnValue({ id });
    return <ProductScreen />;
  }
  return <CatalogScreen />;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockListProducts.mockResolvedValue([arroz, yerba]);
  mockPush.mockImplementation((href) => {
    if (typeof href === 'object' && href.pathname === '/product/[id]') navigate(String(href.params?.id));
  });
  mockBack.mockImplementation(() => navigate(null));
});

async function renderApp() {
  await render(
    <CartProvider>
      <App />
    </CartProvider>,
  );
  expect(await screen.findByText('Arroz 1 kg')).toBeOnTheScreen();
}

const open = (name: string) => fireEvent.press(screen.getByLabelText(`Ver detalle de ${name}`));
async function pressTimes(label: string, times: number, index = 0) {
  for (let i = 0; i < times; i++) await fireEvent.press(screen.getAllByLabelText(label)[index]);
}

describe('REQ-008 E1: tapping a catalog product opens its detail', () => {
  it('"Arroz 1 kg" → detail with name, presentation, $1.300 and quantity 0', async () => {
    await renderApp();
    await open('Arroz 1 kg');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/product/[id]', params: { id: 'arroz-1kg' } });
    expect(screen.getByText('Arroz 1 kg')).toBeOnTheScreen();
    expect(screen.getByText('Paquete 1 kg')).toBeOnTheScreen();
    expect(screen.getByText(money('$1.300'))).toBeOnTheScreen();
    expect(screen.getByText('0')).toBeOnTheScreen();
    expect(screen.getByTestId('product-subtotal')).toHaveTextContent(money('$0'));
    expect(screen.getByLabelText('Quitar uno')).toBeDisabled();
    expect(screen.queryByText('Yerba 1 kg')).toBeNull();
  });

  it("S-18: a box with the product's initial (no image)", async () => {
    await renderApp();
    await open('Yerba 1 kg');
    expect(screen.getByTestId('product-initial')).toHaveTextContent('Y');
  });

  it('tapping − / + in the catalog does not open the detail', async () => {
    await renderApp();
    await pressTimes('Agregar uno', 1);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('REQ-008 E2: changing the quantity in the detail updates the same cart', () => {
  it('+ twice → quantity 2, subtotal $2.600; going back, catalog and bar with 2 u.', async () => {
    await renderApp();
    await open('Arroz 1 kg');
    await pressTimes('Agregar uno', 2);
    expect(screen.getByText('2')).toBeOnTheScreen();
    expect(screen.getByTestId('product-subtotal')).toHaveTextContent(money('$2.600'));
    expect(screen.getByText(money('Ver carrito · 2 u. · $2.600'))).toBeOnTheScreen();
    await act(() => router.back());
    expect(screen.getByText('Yerba 1 kg')).toBeOnTheScreen();
    expect(screen.getByText('2')).toBeOnTheScreen();
    expect(screen.getByText(money('Ver carrito · 2 u. · $2.600'))).toBeOnTheScreen();
  });
});

describe('REQ-008 E3: the detail opens with the quantity already in the cart', () => {
  it('"Yerba 1 kg" with 3 in the cart → quantity 3, subtotal $13.500', async () => {
    await renderApp();
    await pressTimes('Agregar uno', 3, 1);
    await open('Yerba 1 kg');
    expect(screen.getByText('3')).toBeOnTheScreen();
    expect(screen.getByTestId('product-subtotal')).toHaveTextContent(money('$13.500'));
  });
});

describe('REQ-008 E4: going from 1 to 0 in the detail', () => {
  it('the product leaves the cart', async () => {
    await renderApp();
    await open('Arroz 1 kg');
    await pressTimes('Agregar uno', 1);
    expect(screen.getByText(money('Ver carrito · 1 u. · $1.300'))).toBeOnTheScreen();
    await pressTimes('Quitar uno', 1);
    expect(screen.getByText('0')).toBeOnTheScreen();
    expect(screen.getByText('Carrito vacío')).toBeOnTheScreen();
    await act(() => router.back());
    expect(screen.getAllByText('0')).toHaveLength(2);
  });
});

describe('REQ-008 E5: id that is not in the loaded catalog', () => {
  // Sets up a cart and a catalog without "aceite" to simulate the /product/aceite-900 route.
  function Seeded({ catalog }: { catalog: Product[] | null }) {
    const { setCatalog } = useCart();
    const [ready, setReady] = useState(false);
    useEffect(() => {
      if (catalog) setCatalog(catalog);
      setReady(true);
    }, [catalog, setCatalog]);
    return ready ? <ProductScreen /> : null;
  }

  it.each([
    ['id outside the catalog', [arroz, yerba]],
    ['catalog not loaded yet', null],
  ])('%s → "Este producto ya no está disponible", no − / +, with "Volver al catálogo"', async (_case, catalog) => {
    mockParams.mockReturnValue({ id: 'aceite-900' });
    await render(
      <CartProvider>
        <Seeded catalog={catalog} />
      </CartProvider>,
    );
    expect(screen.getByText('Este producto ya no está disponible')).toBeOnTheScreen();
    expect(screen.getByTestId('state-empty')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Agregar uno')).toBeNull();
    expect(screen.queryByLabelText('Quitar uno')).toBeNull();
    expect(screen.getByText('Volver al catálogo')).toBeOnTheScreen();
  });

  it('"Volver al catálogo" goes back; without history (direct link) it replaces with the catalog', async () => {
    mockParams.mockReturnValue({ id: 'aceite-900' });
    await render(
      <CartProvider>
        <ProductScreen />
      </CartProvider>,
    );
    mockCanGoBack.mockReturnValue(true);
    mockBack.mockImplementation(() => {});
    await fireEvent.press(screen.getByText('Volver al catálogo'));
    expect(mockBack).toHaveBeenCalled();
    mockCanGoBack.mockReturnValue(false);
    await fireEvent.press(screen.getByText('Volver al catálogo'));
    expect(mockReplace).toHaveBeenCalledWith('/catalog');
  });
});
