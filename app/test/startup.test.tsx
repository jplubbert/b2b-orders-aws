// Arranque de la app con el router real de expo-router (no simulado): el layout raíz monta la pila y
// la pantalla de inicio redirige al catálogo si hay sesión (REQ-001 E3). Cubre el hallazgo de T-12 en
// el teléfono: "Can't perform a React state update on a component that hasn't mounted yet"
// (ExpoRoot, ContextNavigator) por navegar antes de que el navegador raíz esté montado.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';
import { fetchAuthSession } from 'aws-amplify/auth';
import RootLayout from '@/app/_layout';
import LoginScreen from '@/app/index';

jest.mock('aws-amplify/auth', () => ({ fetchAuthSession: jest.fn(), signIn: jest.fn() }));
jest.mock('@/lib/amplify', () => ({ isConfigured: true, configureAmplify: jest.fn() }));

const mockFetchAuthSession = jest.mocked(fetchAuthSession);
const withSession = { tokens: { idToken: { toString: () => 'id-token' } } } as unknown as Awaited<
  ReturnType<typeof fetchAuthSession>
>;
const withoutSession = {} as Awaited<ReturnType<typeof fetchAuthSession>>;

// Las demás pantallas no importan aquí: basta con que existan las rutas que declara el layout.
const stub = (name: string) => () => <Text>{name}</Text>;
const routes = {
  _layout: RootLayout,
  index: LoginScreen,
  catalog: stub('Pantalla catálogo'),
  'product/[id]': stub('Pantalla producto'),
  cart: stub('Pantalla carrito'),
  orders: stub('Pantalla mis pedidos'),
  'order/[id]': stub('Pantalla pedido'),
};

// En el teléfono la URL inicial llega de forma asíncrona (Linking.getInitialURL).
const nativeStart = { initialUrl: '/', linking: { getInitialURL: () => Promise.resolve('pedidosb2b:///') } } as never;

let consoleError: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  jest.clearAllMocks();
  consoleError = jest.spyOn(console, 'error');
});
afterEach(() => consoleError.mockRestore());

describe('arranque de la app (REQ-001 E3)', () => {
  it('con sesión vigente abre el catálogo sin errores de React', async () => {
    mockFetchAuthSession.mockResolvedValue(withSession);
    const app = renderRouter(routes, nativeStart);
    await app; // con RNTL 14 `render` es asíncrono; `renderRouter` devuelve esa promesa con los getters del router
    expect(await screen.findByText('Pantalla catálogo')).toBeOnTheScreen();
    expect(app.getPathname()).toBe('/catalog');
    expect(screen.queryByPlaceholderText('Correo')).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('sin sesión se queda en inicio pidiendo credenciales, sin errores de React', async () => {
    mockFetchAuthSession.mockResolvedValue(withoutSession);
    const app = renderRouter(routes, nativeStart);
    await app; // con RNTL 14 `render` es asíncrono; `renderRouter` devuelve esa promesa con los getters del router
    expect(await screen.findByPlaceholderText('Correo')).toBeOnTheScreen();
    expect(app.getPathname()).toBe('/');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
