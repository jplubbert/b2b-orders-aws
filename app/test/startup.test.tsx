// App startup with expo-router's real router (not mocked): the root layout mounts the stack and
// the login screen redirects to the catalog if there is a session (REQ-001 E3). Covers the T-12 finding on
// the phone: "Can't perform a React state update on a component that hasn't mounted yet"
// (ExpoRoot, ContextNavigator) from navigating before the root navigator is mounted.
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

// The other screens don't matter here: it's enough that the routes the layout declares exist.
const stub = (name: string) => () => <Text>{name}</Text>;
const routes = {
  _layout: RootLayout,
  index: LoginScreen,
  catalog: stub('Catalog screen'),
  'product/[id]': stub('Product screen'),
  cart: stub('Cart screen'),
  orders: stub('My orders screen'),
  'order/[id]': stub('Order screen'),
  'dist/index': stub('Panel screen'),
  'dist/order/[id]': stub('Distributor order screen'),
};

// On the phone the initial URL arrives asynchronously (Linking.getInitialURL).
const nativeStart = { initialUrl: '/', linking: { getInitialURL: () => Promise.resolve('pedidosb2b:///') } } as never;

let consoleError: jest.SpiedFunction<typeof console.error>;
beforeEach(() => {
  jest.clearAllMocks();
  consoleError = jest.spyOn(console, 'error');
});
afterEach(() => consoleError.mockRestore());

describe('app startup (REQ-001 E3)', () => {
  it('with a live session it opens the catalog without React errors', async () => {
    mockFetchAuthSession.mockResolvedValue(withSession);
    const app = renderRouter(routes, nativeStart);
    await app; // with RNTL 14 `render` is async; `renderRouter` returns that promise with the router getters
    expect(await screen.findByText('Catalog screen')).toBeOnTheScreen();
    expect(app.getPathname()).toBe('/catalog');
    expect(screen.queryByPlaceholderText('Correo')).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('REQ-009 E4: a distributor with a live session opens the "Pedidos" panel without React errors', async () => {
    mockFetchAuthSession.mockResolvedValue(sessionOf(['distribuidores']));
    const app = renderRouter(routes, nativeStart);
    await app;
    expect(await screen.findByText('Panel screen')).toBeOnTheScreen();
    expect(app.getPathname()).toBe('/dist');
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('without a session it stays on the login screen asking for credentials, without React errors', async () => {
    mockFetchAuthSession.mockResolvedValue(withoutSession);
    const app = renderRouter(routes, nativeStart);
    await app; // with RNTL 14 `render` is async; `renderRouter` returns that promise with the router getters
    expect(await screen.findByPlaceholderText('Correo')).toBeOnTheScreen();
    expect(app.getPathname()).toBe('/');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
