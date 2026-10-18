// REQ-008 E1–E5 con jest-expo: detalle de producto desde el catálogo cargado (S-19) sobre el mismo carrito.
// El router va simulado: `push` a /product/<id> cambia la pantalla dibujada dentro del mismo CartProvider,
// y `back` vuelve al catálogo. La verificación en el teléfono es manual (DEC-011).
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

// Intl en Node y en Hermes puede separar con espacios distintos; se compara sin ellos.
const money = (text: string) => new RegExp(text.replace(/[$.]/g, '\\$&').replace(/\s/g, '\\s*'));

// Pila mínima: catálogo o detalle según la última navegación simulada, con un solo carrito.
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

describe('REQ-008 E1: tocar un producto del catálogo abre su detalle', () => {
  it('"Arroz 1 kg" → detalle con nombre, presentación, $1.300 y cantidad 0', async () => {
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

  it('S-18: recuadro con la inicial del producto (sin imagen)', async () => {
    await renderApp();
    await open('Yerba 1 kg');
    expect(screen.getByTestId('product-initial')).toHaveTextContent('Y');
  });

  it('tocar − / + en el catálogo no abre el detalle', async () => {
    await renderApp();
    await pressTimes('Agregar uno', 1);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('REQ-008 E2: cambiar la cantidad en el detalle actualiza el mismo carrito', () => {
  it('+ dos veces → cantidad 2, subtotal $2.600; al volver, catálogo y barra con 2 u.', async () => {
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

describe('REQ-008 E3: el detalle abre con la cantidad que ya está en el carrito', () => {
  it('"Yerba 1 kg" con 3 en el carrito → cantidad 3, subtotal $13.500', async () => {
    await renderApp();
    await pressTimes('Agregar uno', 3, 1);
    await open('Yerba 1 kg');
    expect(screen.getByText('3')).toBeOnTheScreen();
    expect(screen.getByTestId('product-subtotal')).toHaveTextContent(money('$13.500'));
  });
});

describe('REQ-008 E4: bajar de 1 a 0 en el detalle', () => {
  it('el producto sale del carrito', async () => {
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

describe('REQ-008 E5: id que no está en el catálogo cargado', () => {
  // Pone un carrito y un catálogo sin "aceite" para simular la ruta /product/aceite-900.
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
    ['id fuera del catálogo', [arroz, yerba]],
    ['catálogo aún no cargado', null],
  ])('%s → "Este producto ya no está disponible", sin − / +, con "Volver al catálogo"', async (_case, catalog) => {
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

  it('"Volver al catálogo" vuelve atrás; sin historial (enlace directo) reemplaza por el catálogo', async () => {
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
