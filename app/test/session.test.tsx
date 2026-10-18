// Componentes de REQ-001 (E1–E3) y REQ-005 (E1–E2) con jest-expo. Amplify y el router van simulados:
// la persistencia real de los tokens (AsyncStorage) se verifica a mano en el teléfono (DEC-011).
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { fetchAuthSession, fetchUserAttributes, signIn, signOut } from 'aws-amplify/auth';
import { router } from 'expo-router';
import LoginScreen from '@/app/index';
import { AccountMenu } from '@/components/AccountMenu';
import { cartUnits } from '@/lib/cart';
import { CartProvider, useCart } from '@/lib/CartProvider';

jest.mock('aws-amplify/auth', () => ({
  fetchAuthSession: jest.fn(),
  fetchUserAttributes: jest.fn(),
  signIn: jest.fn(),
  signOut: jest.fn(),
}));
// `Redirect` registra el destino aparte de `router.replace` para distinguir la redirección declarativa del arranque.
jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
  Redirect: ({ href }: { href: string }) => {
    mockRedirect(href);
    return null;
  },
}));
jest.mock('@/lib/amplify', () => ({ isConfigured: true }));

const mockFetchAuthSession = jest.mocked(fetchAuthSession);
const mockFetchUserAttributes = jest.mocked(fetchUserAttributes);
const mockSignIn = jest.mocked(signIn);
const mockSignOut = jest.mocked(signOut);
const mockReplace = jest.mocked(router.replace);
const mockRedirect = jest.fn<(href: string) => void>();

type AuthSession = Awaited<ReturnType<typeof fetchAuthSession>>;
// Sesión con el claim `cognito:groups` del token de id (REQ-009); sin grupos el claim no viene.
const sessionOf = (groups?: string[]) =>
  ({
    tokens: { idToken: { toString: () => 'id-token', payload: groups ? { 'cognito:groups': groups } : {} } },
  }) as unknown as AuthSession;
const withSession = sessionOf(['almaceneros']);
const withoutSession = {} as AuthSession;

// Inicio sin sesión; tras `signIn`, la sesión recién emitida con estos grupos.
function signInAs(groups?: string[]) {
  mockFetchAuthSession.mockResolvedValueOnce(withoutSession).mockResolvedValue(sessionOf(groups));
  mockSignIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
}

function cognitoError(name: string): Error {
  const e = new Error('Incorrect username or password.');
  e.name = name;
  return e;
}

async function submit(email: string, password: string) {
  await fireEvent.changeText(await screen.findByPlaceholderText('Correo'), email);
  await fireEvent.changeText(screen.getByPlaceholderText('Contraseña'), password);
  await fireEvent.press(screen.getByText('Ingresar'));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchAuthSession.mockResolvedValue(withoutSession);
});

describe('REQ-001 inicio de sesión', () => {
  it('E1: credenciales válidas → abre el catálogo', async () => {
    signInAs(['almaceneros']);
    await render(<LoginScreen />);
    await submit(' almacen1@demo.test ', 'Correcta-123');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/catalog'));
    expect(mockSignIn).toHaveBeenCalledWith({
      username: 'almacen1@demo.test',
      password: 'Correcta-123',
      options: { authFlowType: 'USER_PASSWORD_AUTH' },
    });
  });

  it('E2: contraseña errónea → "Correo o contraseña incorrectos" y sigue en inicio', async () => {
    mockSignIn.mockRejectedValue(cognitoError('NotAuthorizedException'));
    await render(<LoginScreen />);
    await submit('almacen1@demo.test', 'erronea');
    expect(await screen.findByText('Correo o contraseña incorrectos')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Correo')).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('E2 (borde): correo inexistente → el mismo mensaje (no revela qué correos existen)', async () => {
    mockSignIn.mockRejectedValue(cognitoError('UserNotFoundException'));
    await render(<LoginScreen />);
    await submit('nadie@demo.test', 'loquesea');
    expect(await screen.findByText('Correo o contraseña incorrectos')).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('E2 (borde): otro error (p. ej. red) no se disfraza de credenciales inválidas', async () => {
    mockSignIn.mockRejectedValue(cognitoError('NetworkError'));
    await render(<LoginScreen />);
    await submit('almacen1@demo.test', 'Correcta-123');
    expect(await screen.findByText(/^NetworkError/)).toBeOnTheScreen();
    expect(screen.queryByText('Correo o contraseña incorrectos')).toBeNull();
  });

  it('E3: al reabrir la app con sesión vigente → catálogo sin pedir credenciales', async () => {
    mockFetchAuthSession.mockResolvedValue(withSession);
    await render(<LoginScreen />);
    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith('/catalog'));
    // Con `<Redirect>` y no `router.replace`: al abrir la app el navegador raíz puede no estar montado aún.
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('Correo')).toBeNull();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('E3 (borde): si no se puede renovar la sesión → pide credenciales', async () => {
    mockFetchAuthSession.mockRejectedValue(cognitoError('NotAuthorizedException'));
    await render(<LoginScreen />);
    expect(await screen.findByPlaceholderText('Correo')).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('E3 (borde): Amplify ya tiene sesión al ingresar → abre el catálogo en vez de mostrar el error', async () => {
    mockFetchAuthSession.mockResolvedValueOnce(withoutSession).mockResolvedValue(withSession);
    mockSignIn.mockRejectedValue(cognitoError('UserAlreadyAuthenticatedException'));
    await render(<LoginScreen />);
    await submit('almacen1@demo.test', 'Correcta-123');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/catalog'));
  });
});

describe('REQ-009 acceso por rol', () => {
  it('E1: distribuidor@demo.test con contraseña correcta → panel "Pedidos" (/dist)', async () => {
    signInAs(['distribuidores']);
    await render(<LoginScreen />);
    await submit('distribuidor@demo.test', 'Correcta-123');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dist'));
    expect(mockReplace).not.toHaveBeenCalledWith('/catalog');
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('E2: almacen1@demo.test → catálogo, sin cambios', async () => {
    signInAs(['almaceneros']);
    await render(<LoginScreen />);
    await submit('almacen1@demo.test', 'Correcta-123');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/catalog'));
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('E3: usuario válido sin grupo → "Tu usuario no tiene acceso a la app", cierra la sesión y sigue en inicio', async () => {
    signInAs(undefined);
    mockSignOut.mockResolvedValue(undefined);
    await render(<LoginScreen />);
    await submit('singrupo@demo.test', 'Correcta-123');
    expect(await screen.findByText('Tu usuario no tiene acceso a la app')).toBeOnTheScreen();
    expect(mockSignOut).toHaveBeenCalledWith();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Correo')).toBeOnTheScreen();
  });

  it('E3 (borde): grupos ajenos a la app cuentan como sin grupo; si falla la revocación igual muestra el rechazo', async () => {
    signInAs(['otros']);
    mockSignOut.mockRejectedValue(cognitoError('NetworkError'));
    await render(<LoginScreen />);
    await submit('otro@demo.test', 'Correcta-123');
    expect(await screen.findByText('Tu usuario no tiene acceso a la app')).toBeOnTheScreen();
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('E4: distribuidor con sesión, app reabierta → panel "Pedidos" sin pedir credenciales', async () => {
    mockFetchAuthSession.mockResolvedValue(sessionOf(['distribuidores']));
    await render(<LoginScreen />);
    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith('/dist'));
    expect(screen.queryByPlaceholderText('Correo')).toBeNull();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('E3 al reabrir: sesión de un usuario sin grupo → se cierra, rechazo y pide credenciales', async () => {
    mockFetchAuthSession.mockResolvedValue(sessionOf(undefined));
    mockSignOut.mockResolvedValue(undefined);
    await render(<LoginScreen />);
    expect(await screen.findByText('Tu usuario no tiene acceso a la app')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Correo')).toBeOnTheScreen();
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('S-25: usuario en ambos grupos → panel del distribuidor', async () => {
    signInAs(['almaceneros', 'distribuidores']);
    await render(<LoginScreen />);
    await submit('ambos@demo.test', 'Correcta-123');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dist'));
  });
});

// Agrega una unidad al carrito y muestra cuántas hay, para comprobar que cerrar sesión lo vacía.
function CartProbe() {
  const { cart, setQuantity } = useCart();
  return (
    <>
      <Pressable
        onPress={() =>
          setQuantity({ productId: 'yerba-1kg', name: 'Yerba 1 kg', presentation: 'Paquete 1 kg', unitPrice: 4500 }, 2)
        }
      >
        <Text>agregar</Text>
      </Pressable>
      <Text>{`unidades: ${cartUnits(cart)}`}</Text>
    </>
  );
}

// REQ-006 (S-15): "Cerrar sesión" vive en el menú de cuenta del catálogo.
describe('REQ-005 cerrar sesión', () => {
  async function renderSignedIn() {
    mockFetchUserAttributes.mockResolvedValue({ email: 'almacen1@demo.test' });
    await render(
      <CartProvider>
        <CartProbe />
        <AccountMenu />
      </CartProvider>,
    );
    await fireEvent.press(screen.getByText('agregar'));
    expect(screen.getByText('unidades: 2')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Cuenta'));
    expect(await screen.findByText('almacen1@demo.test')).toBeOnTheScreen();
  }

  it('E1: menú de cuenta → "Cerrar sesión" borra la sesión local, vacía el carrito y vuelve al inicio', async () => {
    mockSignOut.mockResolvedValue(undefined);
    await renderSignedIn();
    await fireEvent.press(screen.getByText('Cerrar sesión'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(mockSignOut).toHaveBeenCalledWith();
    expect(screen.getByText('unidades: 0')).toBeOnTheScreen();
  });

  it('E1 (borde): si falla la revocación en Cognito igual sale y vacía el carrito', async () => {
    mockSignOut.mockRejectedValue(cognitoError('NetworkError'));
    await renderSignedIn();
    await fireEvent.press(screen.getByText('Cerrar sesión'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(screen.getByText('unidades: 0')).toBeOnTheScreen();
  });

  it('E2: tras cerrar sesión, al reabrir la app pide credenciales', async () => {
    mockFetchAuthSession.mockResolvedValue(withoutSession);
    await render(<LoginScreen />);
    expect(await screen.findByPlaceholderText('Correo')).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
