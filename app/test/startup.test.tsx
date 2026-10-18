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
type AuthSession = Awaited<ReturnType<typeof fetchAuthSession>>;
const sessionOf = (groups: string[]) =>
  ({ tokens: { idToken: { toString: () => 'id-token', payload: { 'cognito:groups': groups } } } }) as unknown as AuthSession;
const withSession = sessionOf(['almaceneros']);
const withoutSession = {} as AuthSession;

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
  'dist/index': stub('Pantalla panel'),
  'dist/order/[id]': stub('Pantalla pedido del distribuidor'),
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

  it('REQ-009 E4: distribuidor con sesión vigente abre el panel "Pedidos" sin errores de React', async () => {
    mockFetchAuthSession.mockResolvedValue(sessionOf(['distribuidores']));
    const app = renderRouter(routes, nativeStart);
    await app;
    expect(await screen.findByText('Pantalla panel')).toBeOnTheScreen();
    expect(app.getPathname()).toBe('/dist');
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
