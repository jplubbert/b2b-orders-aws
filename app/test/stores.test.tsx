// Zustand stores (DEC-021, S-31) without rendering: cart, panel and session. Amplify is mocked;
// the screens keep their own expectations in the other files.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fetchAuthSession, signOut as amplifySignOut } from 'aws-amplify/auth';
import type { PanelOrder } from '@/lib/api';
import { useCart } from '@/lib/store/cart';
import { usePanel } from '@/lib/store/panel';
import { signOut, useSession } from '@/lib/store/session';
import { resetStores } from './support/stores';

jest.mock('aws-amplify/auth', () => ({ fetchAuthSession: jest.fn(), signOut: jest.fn() }));

const mockFetchAuthSession = jest.mocked(fetchAuthSession);
const mockAmplifySignOut = jest.mocked(amplifySignOut);

type AuthSession = Awaited<ReturnType<typeof fetchAuthSession>>;
const sessionWith = (payload: Record<string, unknown>) =>
  ({ tokens: { idToken: { toString: () => 'id-token', payload } } }) as unknown as AuthSession;

const yerba = { productId: 'yerba-1kg', name: 'Yerba 1 kg', presentation: 'Paquete 1 kg', unitPrice: 4500 };
const arroz = { productId: 'arroz-1kg', name: 'Arroz 1 kg', presentation: 'Paquete 1 kg', unitPrice: 1300 };

const order: PanelOrder = {
  id: '01JA0000000000000000ALM1N1',
  customerId: 'C-ALMACEN1',
  number: 'ALM1N1',
  createdAt: '2026-10-15T15:00:00.000Z',
  total: 4500,
  status: 'RECIBIDO',
  lines: [{ productId: 'yerba-1kg', name: 'Yerba 1 kg', presentation: 'Paquete 1 kg', quantity: 1, unitPrice: 4500, subtotal: 4500 }],
};
const other: PanelOrder = { ...order, id: '01JB0000000000000000ALM2N1', customerId: 'C-ALMACEN2', number: 'ALM2N1' };

beforeEach(() => {
  jest.resetAllMocks();
  resetStores();
});

describe('cart store (S-09, REQ-003)', () => {
  it('starts empty and without a catalog', () => {
    expect(useCart.getState().cart).toEqual([]);
    expect(useCart.getState().catalog).toBeNull();
  });

  it('setQuantity adds, replaces and removes with 0; one line per product', () => {
    const { setQuantity } = useCart.getState();
    setQuantity(yerba, 2);
    setQuantity(arroz, 1);
    setQuantity(yerba, 5);
    expect(useCart.getState().cart).toEqual([
      { product: yerba, quantity: 5 },
      { product: arroz, quantity: 1 },
    ]);
    setQuantity(yerba, 0);
    expect(useCart.getState().cart).toEqual([{ product: arroz, quantity: 1 }]);
  });

  it('edge: the quantity is capped at 999 like the server (S-03)', () => {
    useCart.getState().setQuantity(yerba, 1500);
    expect(useCart.getState().cart).toEqual([{ product: yerba, quantity: 999 }]);
  });

  it('clear empties the cart and keeps the loaded catalog (S-19)', () => {
    useCart.getState().setCatalog([yerba, arroz]);
    useCart.getState().setQuantity(yerba, 2);
    useCart.getState().clear();
    expect(useCart.getState().cart).toEqual([]);
    expect(useCart.getState().catalog).toEqual([yerba, arroz]);
  });
});

describe('panel store (REQ-010, REQ-011)', () => {
  it('replaceOrder swaps only the order with the same id', () => {
    usePanel.getState().setOrders([other, order]);
    usePanel.getState().replaceOrder({ ...order, status: 'ENVIADO' });
    expect(usePanel.getState().orders?.map((o) => [o.number, o.status])).toEqual([
      ['ALM2N1', 'RECIBIDO'],
      ['ALM1N1', 'ENVIADO'],
    ]);
  });

  it('edge: replaceOrder while the list is loading (null) keeps it null', () => {
    usePanel.getState().replaceOrder(order);
    expect(usePanel.getState().orders).toBeNull();
  });
});

describe('session store (DEC-021, DEC-003)', () => {
  it('starts unknown and loading while it reads the session', async () => {
    expect(useSession.getState().status).toBe('unknown');
    let resolve: (s: AuthSession) => void = () => {};
    mockFetchAuthSession.mockReturnValue(new Promise((r) => (resolve = r)));
    const hydrating = useSession.getState().hydrate();
    expect(useSession.getState().status).toBe('loading');
    resolve(sessionWith({ 'cognito:groups': ['almaceneros'] }));
    await hydrating;
    expect(useSession.getState().status).toBe('signedIn');
  });

  it('almacenero: role, email and customerId from the ID token', async () => {
    mockFetchAuthSession.mockResolvedValue(
      sessionWith({ 'cognito:groups': ['almaceneros'], email: 'almacen1@demo.test', 'custom:customerId': 'C-ALMACEN1' }),
    );
    const session = await useSession.getState().hydrate();
    expect(session).toEqual({ role: 'almacenero', email: 'almacen1@demo.test', customerId: 'C-ALMACEN1' });
    expect(useSession.getState()).toMatchObject({ status: 'signedIn', ...session });
  });

  it('distributor (also S-25: in both groups the distributor wins), without customerId', async () => {
    mockFetchAuthSession.mockResolvedValue(
      sessionWith({ 'cognito:groups': ['almaceneros', 'distribuidores'], email: 'distribuidor@demo.test' }),
    );
    await useSession.getState().hydrate();
    expect(useSession.getState()).toMatchObject({ status: 'signedIn', role: 'distribuidor', customerId: null });
  });

  it('only role and claims are kept, not the tokens (they stay in Amplify)', async () => {
    mockFetchAuthSession.mockResolvedValue(sessionWith({ 'cognito:groups': ['almaceneros'] }));
    await useSession.getState().hydrate();
    expect(JSON.stringify(useSession.getState())).not.toContain('id-token');
  });

  it.each([
    ['no session', () => mockFetchAuthSession.mockResolvedValue({} as AuthSession)],
    ['session that cannot be renewed', () => mockFetchAuthSession.mockRejectedValue(new Error('NotAuthorizedException'))],
  ])('%s → null and signedOut', async (_case, arrange) => {
    arrange();
    expect(await useSession.getState().hydrate()).toBeNull();
    expect(useSession.getState()).toMatchObject({ status: 'signedOut', role: null, email: null, customerId: null });
  });

  it('REQ-009 E3: user without a group → role null; reject closes the session even if the revocation fails', async () => {
    mockFetchAuthSession.mockResolvedValue(sessionWith({ 'cognito:groups': ['otros'], email: 'other@demo.test' }));
    expect((await useSession.getState().hydrate())?.role).toBeNull();
    mockAmplifySignOut.mockRejectedValue(new Error('NetworkError'));
    await useSession.getState().reject();
    expect(mockAmplifySignOut).toHaveBeenCalledWith();
    expect(useSession.getState()).toMatchObject({ status: 'signedOut', email: null });
  });
});

describe('signOut (REQ-005)', () => {
  async function signedInWithState() {
    mockFetchAuthSession.mockResolvedValue(
      sessionWith({ 'cognito:groups': ['almaceneros'], email: 'almacen1@demo.test', 'custom:customerId': 'C-ALMACEN1' }),
    );
    await useSession.getState().hydrate();
    useCart.getState().setQuantity(yerba, 2);
    usePanel.getState().setOrders([order]);
  }

  it('E1: clears the Amplify session, the cart, the panel list and the session store', async () => {
    mockAmplifySignOut.mockResolvedValue(undefined);
    await signedInWithState();
    await signOut();
    expect(mockAmplifySignOut).toHaveBeenCalledWith();
    expect(useCart.getState().cart).toEqual([]);
    expect(usePanel.getState().orders).toBeNull();
    expect(useSession.getState()).toMatchObject({ status: 'signedOut', role: null, email: null, customerId: null });
  });

  it('E1 (edge): if the revocation in Cognito fails it still clears everything', async () => {
    mockAmplifySignOut.mockRejectedValue(new Error('NetworkError'));
    await signedInWithState();
    await signOut();
    expect(useCart.getState().cart).toEqual([]);
    expect(usePanel.getState().orders).toBeNull();
    expect(useSession.getState().status).toBe('signedOut');
  });
});
