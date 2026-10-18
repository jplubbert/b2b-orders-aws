import { signOut as amplifySignOut } from 'aws-amplify/auth';
import { create } from 'zustand';
import { readSession, rejectSession, type SessionInfo } from '../session';
import { useCart } from './cart';
import { usePanel } from './panel';

/** `unknown`: not read yet; `loading`: reading it from Amplify. */
export type SessionStatus = 'unknown' | 'loading' | 'signedIn' | 'signedOut';

interface SessionState extends SessionInfo {
  status: SessionStatus;
  /** Reads the session from Amplify (`fetchAuthSession`) and keeps it; `null` without a session. */
  hydrate: () => Promise<SessionInfo | null>;
  /** REQ-009 E3: closes the session of a user without access. */
  reject: () => Promise<void>;
  /** The email when the ID token didn't carry it (the account menu asks Cognito, REQ-006). */
  setEmail: (email: string | null) => void;
}

const signedOut = { status: 'signedOut', role: null, email: null, customerId: null } as const;

// DEC-021, S-31: role, email, store and loading status of the session. The tokens stay in Amplify (DEC-003).
export const useSession = create<SessionState>()((set) => ({
  status: 'unknown',
  role: null,
  email: null,
  customerId: null,
  hydrate: async () => {
    set({ status: 'loading' });
    const session = await readSession();
    set(session ? { status: 'signedIn', ...session } : signedOut);
    return session;
  },
  reject: async () => {
    await rejectSession();
    set(signedOut);
  },
  setEmail: (email) => set({ email }),
}));

/**
 * REQ-005: clears the local session (Amplify tokens in AsyncStorage), the cart (S-09) and the panel's list.
 * signOut without `global` clears the local tokens even if the revocation in Cognito fails (no network),
 * so an error doesn't prevent leaving.
 */
export async function signOut(): Promise<void> {
  try {
    await amplifySignOut();
  } catch {
    // see above: the local session is no longer used
  }
  useCart.getState().clear();
  usePanel.getState().setOrders(null);
  useSession.setState(signedOut);
}
