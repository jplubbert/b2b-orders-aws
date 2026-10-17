export const CUSTOMER_GROUP = 'almaceneros';

export interface Identity {
  customerId: string;
}

// Con resolvers Lambda directos, AppSync expone `error.name` como `errorType` (DEC-005).
export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'Unauthorized';
  }
}

/**
 * El cliente sale siempre del claim `custom:customerId` del token, nunca de la entrada (DEC-004).
 * Requiere el grupo `almaceneros`; si falta algo, `Unauthorized`.
 */
export function identityFromClaims(claims: Record<string, unknown> | undefined): Identity {
  const customerId = claims?.['custom:customerId'];
  const groups = claims?.['cognito:groups'];
  const inGroup = Array.isArray(groups)
    ? groups.includes(CUSTOMER_GROUP)
    : typeof groups === 'string' && groups.split(',').includes(CUSTOMER_GROUP);
  if (typeof customerId !== 'string' || customerId === '' || !inGroup) {
    throw new UnauthorizedError();
  }
  return { customerId };
}
