import { fetchAuthSession } from 'aws-amplify/auth';

// REQ-001: mismo mensaje para contraseña errónea y usuario inexistente (no revela qué correos existen).
export const INVALID_CREDENTIALS = 'Correo o contraseña incorrectos';
const INVALID_CREDENTIALS_ERRORS = new Set(['NotAuthorizedException', 'UserNotFoundException']);

/** REQ-001 E3: Amplify guarda los tokens en AsyncStorage y los renueva con el refresh token. */
export async function hasSession(): Promise<boolean> {
  try {
    return Boolean((await fetchAuthSession()).tokens?.idToken);
  } catch {
    return false;
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
