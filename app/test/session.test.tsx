// REQ-001 (E1–E3) and REQ-005 (E1–E2) components with jest-expo. Amplify and the router are mocked:
// the real persistence of the tokens (AsyncStorage) is checked by hand on the phone (DEC-011).
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { fetchAuthSession, fetchUserAttributes, signIn, signOut } from 'aws-amplify/auth';
import { router } from 'expo-router';
import LoginScreen from '@/app/index';
import { AccountMenu } from '@/components/AccountMenu';
import { cartUnits } from '@/lib/cart';
import { useCart } from '@/lib/store/cart';
import { resetStores } from './support/stores';

jest.mock('aws-amplify/auth', () => ({
  fetchAuthSession: jest.fn(),
  fetchUserAttributes: jest.fn(),
  signIn: jest.fn(),
  signOut: jest.fn(),
}));
// `Redirect` records the target separately from `router.replace` to tell the declarative startup redirect apart.
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
// Session with the ID token's `cognito:groups` claim (REQ-009); without groups the claim is absent.
const sessionOf = (groups?: string[]) =>
  ({
    tokens: { idToken: { toString: () => 'id-token', payload: groups ? { 'cognito:groups': groups } : {} } },
  }) as unknown as AuthSession;
const withSession = sessionOf(['almaceneros']);
const withoutSession = {} as AuthSession;

// Startup without a session; after `signIn`, the freshly issued session with these groups.
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
  resetStores();
  mockFetchAuthSession.mockResolvedValue(withoutSession);
});

describe('REQ-001 sign-in', () => {
  it('E1: valid credentials → opens the catalog', async () => {
    signInAs(['almaceneros']);
    await render(<LoginScreen />);
    await submit(' almacen1@demo.test ', 'Correct-123');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/catalog'));
    expect(mockSignIn).toHaveBeenCalledWith({
      username: 'almacen1@demo.test',
      password: 'Correct-123',
      options: { authFlowType: 'USER_PASSWORD_AUTH' },
    });
  });

  it('E2: wrong password → "Correo o contraseña incorrectos" and stays on the login screen', async () => {
    mockSignIn.mockRejectedValue(cognitoError('NotAuthorizedException'));
    await render(<LoginScreen />);
    await submit('almacen1@demo.test', 'wrong');
    expect(await screen.findByText('Correo o contraseña incorrectos')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Correo')).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("E2 (edge): missing email → the same message (doesn't reveal which emails exist)", async () => {
    mockSignIn.mockRejectedValue(cognitoError('UserNotFoundException'));
    await render(<LoginScreen />);
    await submit('nobody@demo.test', 'whatever');
    expect(await screen.findByText('Correo o contraseña incorrectos')).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('E2 (edge): another error (e.g. network) is not disguised as invalid credentials', async () => {
    mockSignIn.mockRejectedValue(cognitoError('NetworkError'));
    await render(<LoginScreen />);
    await submit('almacen1@demo.test', 'Correct-123');
    expect(await screen.findByText(/^NetworkError/)).toBeOnTheScreen();
    expect(screen.queryByText('Correo o contraseña incorrectos')).toBeNull();
  });

  it('E3: reopening the app with a live session → catalog without asking for credentials', async () => {
    mockFetchAuthSession.mockResolvedValue(withSession);
    await render(<LoginScreen />);
    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith('/catalog'));
    // With `<Redirect>` and not `router.replace`: when the app opens the root navigator may not be mounted yet.
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('Correo')).toBeNull();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('E3 (edge): if the session cannot be renewed → asks for credentials', async () => {
    mockFetchAuthSession.mockRejectedValue(cognitoError('NotAuthorizedException'));
    await render(<LoginScreen />);
    expect(await screen.findByPlaceholderText('Correo')).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('E3 (edge): Amplify already has a session on sign-in → opens the catalog instead of showing the error', async () => {
    mockFetchAuthSession.mockResolvedValueOnce(withoutSession).mockResolvedValue(withSession);
    mockSignIn.mockRejectedValue(cognitoError('UserAlreadyAuthenticatedException'));
    await render(<LoginScreen />);
    await submit('almacen1@demo.test', 'Correct-123');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/catalog'));
  });
});

describe('REQ-009 access by role', () => {
  it('E1: distribuidor@demo.test with the right password → "Pedidos" panel (/dist)', async () => {
    signInAs(['distribuidores']);
    await render(<LoginScreen />);
    await submit('distribuidor@demo.test', 'Correct-123');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dist'));
    expect(mockReplace).not.toHaveBeenCalledWith('/catalog');
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('E2: almacen1@demo.test → catalog, unchanged', async () => {
    signInAs(['almaceneros']);
    await render(<LoginScreen />);
    await submit('almacen1@demo.test', 'Correct-123');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/catalog'));
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('E3: valid user without a group → "Tu usuario no tiene acceso a la app", signs out and stays on the login screen', async () => {
    signInAs(undefined);
    mockSignOut.mockResolvedValue(undefined);
    await render(<LoginScreen />);
    await submit('nogroup@demo.test', 'Correct-123');
    expect(await screen.findByText('Tu usuario no tiene acceso a la app')).toBeOnTheScreen();
    expect(mockSignOut).toHaveBeenCalledWith();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Correo')).toBeOnTheScreen();
  });

  it('E3 (edge): groups unrelated to the app count as no group; if the revocation fails the rejection is still shown', async () => {
    signInAs(['otros']);
    mockSignOut.mockRejectedValue(cognitoError('NetworkError'));
    await render(<LoginScreen />);
    await submit('other@demo.test', 'Correct-123');
    expect(await screen.findByText('Tu usuario no tiene acceso a la app')).toBeOnTheScreen();
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('E4: distributor with a session, app reopened → "Pedidos" panel without asking for credentials', async () => {
    mockFetchAuthSession.mockResolvedValue(sessionOf(['distribuidores']));
    await render(<LoginScreen />);
    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith('/dist'));
    expect(screen.queryByPlaceholderText('Correo')).toBeNull();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('E3 on reopening: session of a user without a group → it is closed, rejected and asks for credentials', async () => {
    mockFetchAuthSession.mockResolvedValue(sessionOf(undefined));
    mockSignOut.mockResolvedValue(undefined);
    await render(<LoginScreen />);
    expect(await screen.findByText('Tu usuario no tiene acceso a la app')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Correo')).toBeOnTheScreen();
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("S-25: user in both groups → the distributor's panel", async () => {
    signInAs(['almaceneros', 'distribuidores']);
    await render(<LoginScreen />);
    await submit('both@demo.test', 'Correct-123');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dist'));
  });
});

// Adds units to the cart and shows how many there are, to check that signing out empties it.
function CartProbe() {
  const { cart, setQuantity } = useCart();
  return (
    <>
      <Pressable
        onPress={() =>
          setQuantity({ productId: 'yerba-1kg', name: 'Yerba 1 kg', presentation: 'Paquete 1 kg', unitPrice: 4500 }, 2)
        }
      >
        <Text>add</Text>
      </Pressable>
      <Text>{`units: ${cartUnits(cart)}`}</Text>
    </>
  );
}

// REQ-006 (S-15): "Cerrar sesión" lives in the catalog's account menu.
describe('REQ-005 sign-out', () => {
  async function renderSignedIn() {
    mockFetchUserAttributes.mockResolvedValue({ email: 'almacen1@demo.test' });
    await render(
      <>
        <CartProbe />
        <AccountMenu />
      </>,
    );
    await fireEvent.press(screen.getByText('add'));
    expect(screen.getByText('units: 2')).toBeOnTheScreen();
    await fireEvent.press(screen.getByLabelText('Cuenta'));
    expect(await screen.findByText('almacen1@demo.test')).toBeOnTheScreen();
  }

  it('E1: account menu → "Cerrar sesión" clears the local session, empties the cart and returns to the login screen', async () => {
    mockSignOut.mockResolvedValue(undefined);
    await renderSignedIn();
    await fireEvent.press(screen.getByText('Cerrar sesión'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(mockSignOut).toHaveBeenCalledWith();
    expect(screen.getByText('units: 0')).toBeOnTheScreen();
  });

  it('E1 (edge): if the revocation in Cognito fails it still leaves and empties the cart', async () => {
    mockSignOut.mockRejectedValue(cognitoError('NetworkError'));
    await renderSignedIn();
    await fireEvent.press(screen.getByText('Cerrar sesión'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(screen.getByText('units: 0')).toBeOnTheScreen();
  });

  it('E2: after signing out, reopening the app asks for credentials', async () => {
    mockFetchAuthSession.mockResolvedValue(withoutSession);
    await render(<LoginScreen />);
    expect(await screen.findByPlaceholderText('Correo')).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
