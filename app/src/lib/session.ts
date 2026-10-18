import { fetchAuthSession, signOut } from 'aws-amplify/auth';

// REQ-001: mismo mensaje para contraseña errónea y usuario inexistente (no revela qué correos existen).
export const INVALID_CREDENTIALS = 'Correo o contraseña incorrectos';
const INVALID_CREDENTIALS_ERRORS = new Set(['NotAuthorizedException', 'UserNotFoundException']);

// REQ-009 E3: usuario válido que no está en `almaceneros` ni en `distribuidores`.
export const NO_ACCESS = 'Tu usuario no tiene acceso a la app';

/** Pantalla de inicio de cada rol (REQ-009): catálogo del almacenero o panel del distribuidor. */
export type Home = '/catalog' | '/dist';

/** Rol según el claim `cognito:groups` del token de id; S-25: en ambos grupos gana el distribuidor. */
export function homeForGroups(groups: unknown): Home | null {
  const list = Array.isArray(groups) ? groups : [];
  if (list.includes('distribuidores')) return '/dist';
  if (list.includes('almaceneros')) return '/catalog';
  return null;
}

/**
 * REQ-001 E3 / REQ-009 E4: Amplify guarda los tokens en AsyncStorage y los renueva con el refresh token.
 * Sin sesión → `null`; con sesión → la pantalla de su rol (`home: null` si no tiene acceso, REQ-009 E3).
 */
export async function currentSession(): Promise<{ home: Home | null } | null> {
  try {
    const idToken = (await fetchAuthSession()).tokens?.idToken;
    return idToken ? { home: homeForGroups(idToken.payload['cognito:groups']) } : null;
  } catch {
    return null;
  }
}

/** REQ-009 E3: cierra la sesión local de un usuario sin acceso; como en REQ-005, un error no impide salir. */
export async function rejectSession(): Promise<void> {
  try {
    await signOut();
  } catch {
    // signOut sin `global` ya borró los tokens locales
  }
}

export function loginErrorMessage(e: unknown): string {
  if (e instanceof Error && INVALID_CREDENTIALS_ERRORS.has(e.name)) return INVALID_CREDENTIALS;
  return describeError(e);
}

// Amplify envuelve fallos de red o de módulos nativos en "An unknown error has occurred";
// la causa real va en `underlyingError`, así que se muestra completa.
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
