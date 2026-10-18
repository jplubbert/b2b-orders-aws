// REQ-006 E1–E5 con jest-expo: barra superior del catálogo, menú de cuenta y barra del carrito.
// Stack.Screen va simulado: guarda sus props y dibuja headerLeft/headerRight para poder tocarlos.
// E6 (360 dp sin superposiciones) se verifica a mano en el teléfono (DEC-011).
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { fetchUserAttributes, signOut } from 'aws-amplify/auth';
import { router } from 'expo-router';
import RootLayout from '@/app/_layout';
import CartScreen from '@/app/cart';
import CatalogScreen from '@/app/catalog';
import { listProducts, type Product } from '@/lib/api';
import { CartProvider } from '@/lib/CartProvider';

type ScreenProps = {
  name?: string;
  options?: { title?: string; headerTitleAlign?: string; headerLeft?: () => ReactNode; headerRight?: () => ReactNode };
};
const mockScreens: ScreenProps[] = [];
const mockStacks: { screenOptions?: { headerTitleAlign?: string } }[] = [];

jest.mock('aws-amplify/auth', () => ({ signOut: jest.fn(), fetchUserAttributes: jest.fn() }));
jest.mock('aws-amplify/api', () => ({ generateClient: jest.fn() }));
jest.mock('@/lib/amplify', () => ({ configureAmplify: jest.fn(), isConfigured: true }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual<typeof import('@/lib/api')>('@/lib/api'),
  listProducts: jest.fn(),
}));
jest.mock('expo-router', () => {
  const { createElement, Fragment } = jest.requireActual<typeof import('react')>('react');
  const Stack = ({ children, ...props }: { children?: ReactNode; screenOptions?: object }) => {
    mockStacks.push(props);
    return createElement(Fragment, null, children);
  };
  Stack.Screen = (props: ScreenProps) => {
    mockScreens.push(props);
    return createElement(Fragment, null, props.options?.headerLeft?.(), props.options?.headerRight?.());
  };
  return { router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() }, Stack };
});

const mockListProducts = jest.mocked(listProducts);
const mockFetchUserAttributes = jest.mocked(fetchUserAttributes);
const mockSignOut = jest.mocked(signOut);
const mockPush = jest.mocked(router.push);
const mockReplace = jest.mocked(router.replace);

const arroz: Product = { productId: 'arroz-1kg', name: 'Arroz 1 kg', presentation: 'Paquete 1 kg', unitPrice: 1300 };
const yerba: Product = { productId: 'yerba-1kg', name: 'Yerba 1 kg', presentation: 'Paquete 1 kg', unitPrice: 4500 };

// Intl en Node y en Hermes puede separar con espacios distintos; se compara sin ellos.
const money = (text: string) => new RegExp(text.replace(/[$.]/g, '\\$&').replace(/\s/g, '\\s*'));

beforeEach(() => {
  jest.clearAllMocks();
  mockScreens.length = 0;
  mockStacks.length = 0;
  mockListProducts.mockResolvedValue([arroz, yerba]);
  mockFetchUserAttributes.mockResolvedValue({ email: 'almacen1@demo.test' });
  mockSignOut.mockResolvedValue(undefined);
});

async function renderCatalog() {
  await render(
    <CartProvider>
      <CatalogScreen />
    </CartProvider>,
  );
  expect(await screen.findByText('Arroz 1 kg')).toBeOnTheScreen();
}

// Toca + en la tarjeta del producto (las tarjetas siguen el orden del catálogo).
async function add(index: number, times: number) {
  for (let i = 0; i < times; i++) await fireEvent.press(screen.getAllByLabelText('Agregar uno')[index]);
}

async function openMenu() {
  await fireEvent.press(screen.getByLabelText('Cuenta'));
  expect(await screen.findByText('almacen1@demo.test')).toBeOnTheScreen();
}

describe('REQ-006 E1: barra superior del catálogo', () => {
  it('"Catálogo" a la izquierda (título de la pila)', async () => {
    await render(<RootLayout />);
    const catalog = mockScreens.find((s) => s.name === 'catalog');
    expect(catalog?.options?.title).toBe('Catálogo');
    expect(mockStacks.at(-1)?.screenOptions?.headerTitleAlign).toBe('left');
  });

  it('a la derecha "Mis pedidos" y el botón de cuenta con la inicial; "Cerrar sesión" no está en la barra', async () => {
    await renderCatalog();
    const options = mockScreens.at(-1)?.options;
    expect(options?.headerLeft).toBeUndefined();
    expect(options?.title).toBeUndefined();
    expect(options?.headerRight).toBeDefined();
    expect(screen.getByLabelText('Ver mis pedidos')).toBeOnTheScreen();
    expect(screen.getByLabelText('Cuenta')).toBeOnTheScreen();
    expect(await screen.findByText('A')).toBeOnTheScreen();
    expect(screen.queryByText('Cerrar sesión')).toBeNull();
  });

  it('"Mis pedidos" abre la lista de pedidos', async () => {
    await renderCatalog();
    await fireEvent.press(screen.getByLabelText('Ver mis pedidos'));
    expect(mockPush).toHaveBeenCalledWith('/orders');
  });

  it('borde: sin correo (falla fetchUserAttributes) el botón de cuenta sigue y permite cerrar sesión', async () => {
    mockFetchUserAttributes.mockRejectedValue(new Error('Network error'));
    await renderCatalog();
    expect(screen.getByText('?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Cuenta'));
    expect(screen.getByText('Cerrar sesión')).toBeOnTheScreen();
  });
});

describe('REQ-006 E2: botón de cuenta → "Cerrar sesión" (REQ-005 E1)', () => {
  it('vuelve al inicio con la sesión borrada y el carrito vacío', async () => {
    await renderCatalog();
    await add(0, 2);
    await openMenu();
    expect(screen.getByText('Sesión iniciada como')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Cerrar sesión'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(mockSignOut).toHaveBeenCalledWith();
    expect(screen.getByText('Carrito vacío')).toBeOnTheScreen();
  });
});

describe('REQ-006 E3: cerrar el menú sin elegir', () => {
  it.each([
    ['"Cancelar"', () => fireEvent.press(screen.getByText('Cancelar'))],
    ['tocar fuera', () => fireEvent.press(screen.getByLabelText('Cerrar menú de cuenta'))],
    ['atrás de Android', () => fireEvent(screen.getByTestId('account-menu'), 'requestClose')],
  ])('%s → sigue en el catálogo con la sesión y el carrito intactos', async (_how, dismiss) => {
    await renderCatalog();
    await add(1, 1);
    await openMenu();
    await dismiss();
    expect(screen.queryByText('Cerrar sesión')).toBeNull();
    expect(screen.queryByText('almacen1@demo.test')).toBeNull();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByText('Arroz 1 kg')).toBeOnTheScreen();
    expect(screen.getByText(money('Ver carrito · 1 u. · $4.500'))).toBeOnTheScreen();
  });
});

describe('REQ-006 E4–E5: barra inferior del carrito', () => {
  it('E4: 2 Arroz + 1 Yerba → "Ver carrito · 3 u. · $7.100"; al tocarla abre Carrito', async () => {
    await renderCatalog();
    await add(0, 2);
    await add(1, 1);
    await fireEvent.press(screen.getByText(money('Ver carrito · 3 u. · $7.100')));
    expect(mockPush).toHaveBeenCalledWith('/cart');
  });

  it('E5: carrito vacío → "Carrito vacío"; abre Carrito', async () => {
    await renderCatalog();
    expect(screen.queryByText(/Ver carrito ·/)).toBeNull();
    await fireEvent.press(screen.getByText('Carrito vacío'));
    expect(mockPush).toHaveBeenCalledWith('/cart');
  });

  it('E5: el Carrito vacío tiene "Confirmar pedido" deshabilitado (REQ-003 E5)', async () => {
    await render(
      <CartProvider>
        <CartScreen />
      </CartProvider>,
    );
    expect(screen.getByText('Confirmar pedido')).toBeDisabled();
  });

  it('la barra se muestra también mientras carga', async () => {
    mockListProducts.mockReturnValue(new Promise(() => {}));
    await render(
      <CartProvider>
        <CatalogScreen />
      </CartProvider>,
    );
    expect(screen.getByTestId('state-loading')).toBeOnTheScreen();
    expect(screen.getByText('Carrito vacío')).toBeOnTheScreen();
    expect(screen.getByLabelText('Cuenta')).toBeOnTheScreen();
  });

  it('la barra se muestra también con error', async () => {
    mockListProducts.mockRejectedValue(new Error('Network error'));
    await render(
      <CartProvider>
        <CatalogScreen />
      </CartProvider>,
    );
    expect(await screen.findByText('Network error')).toBeOnTheScreen();
    expect(screen.getByText('Carrito vacío')).toBeOnTheScreen();
  });
});
