import { fetchAuthSession, signOut } from 'aws-amplify/auth';

// REQ-001: same message for a wrong password and a missing user (doesn't reveal which emails exist).
export const INVALID_CREDENTIALS = 'Correo o contraseña incorrectos';
const INVALID_CREDENTIALS_ERRORS = new Set(['NotAuthorizedException', 'UserNotFoundException']);

// REQ-009 E3: valid user that is in neither `almaceneros` nor `distribuidores`.
export const NO_ACCESS = 'Tu usuario no tiene acceso a la app';

export type Role = 'almacenero' | 'distribuidor';

/** Home screen of each role (REQ-009): the customer's catalog or the distributor's panel. */
export type Home = '/catalog' | '/dist';
export const HOME: Record<Role, Home> = { almacenero: '/catalog', distribuidor: '/dist' };

/** Role from the ID token's `cognito:groups` claim; S-25: in both groups the distributor wins. */
export function roleForGroups(groups: unknown): Role | null {
  const list = Array.isArray(groups) ? groups : [];
  if (list.includes('distribuidores')) return 'distribuidor';
  if (list.includes('almaceneros')) return 'almacenero';
  return null;
}

/** What the app keeps of the session (DEC-021); the tokens themselves stay in Amplify (DEC-003). */
export interface SessionInfo {
  /** `null`: valid user without access to the app (REQ-009 E3). */
  role: Role | null;
  email: string | null;
  customerId: string | null;
}

const claim = (value: unknown) => (typeof value === 'string' ? value : null);

/**
 * REQ-001 E3 / REQ-009 E4: Amplify stores the tokens in AsyncStorage and renews them with the refresh token.
 * No session (or it cannot be renewed) → `null`; with a session → role, email and store from the ID token.
 */
export async function readSession(): Promise<SessionInfo | null> {
  try {
    const idToken = (await fetchAuthSession()).tokens?.idToken;
    if (!idToken) return null;
    const { payload } = idToken;
    return {
      role: roleForGroups(payload['cognito:groups']),
      email: claim(payload.email),
      customerId: claim(payload['custom:customerId']),
    };
  } catch {
    return null;
  }
}

/** REQ-009 E3: closes the local session of a user without access; as in REQ-005, an error doesn't prevent leaving. */
export async function rejectSession(): Promise<void> {
  try {
    await signOut();
  } catch {
    // signOut without `global` already cleared the local tokens
  }
}

export function loginErrorMessage(e: unknown): string {
  if (e instanceof Error && INVALID_CREDENTIALS_ERRORS.has(e.name)) return INVALID_CREDENTIALS;
  return describeError(e);
}

// Amplify wraps network or native-module failures in "An unknown error has occurred";
// the real cause is in `underlyingError`, so it's shown in full (on screen, hence in Spanish).
function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const { recoverySuggestion, underlyingError } = e as Error & {
    recoverySuggestion?: string;
    underlyingError?: unknown;
  };
  const parts = [`${e.name}: ${e.message}`];
  if (underlyingError) {
    parts.push(
      underlyingError instanceof Error
        ? `Causa: ${underlyingError.name}: ${underlyingError.message}`
        : `Causa: ${String(underlyingError)}`,
    );
  }
  if (recoverySuggestion) parts.push(recoverySuggestion);
  return parts.join('\n');
}
