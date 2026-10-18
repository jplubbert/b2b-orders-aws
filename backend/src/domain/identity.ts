export const CUSTOMER_GROUP = 'almaceneros';
export const DISTRIBUTOR_GROUP = 'distribuidores'; // DEC-013

export type Role = 'almacenero' | 'distribuidor';

/** Roles del token; `customerId` solo si es almacenero. Un usuario en ambos grupos tiene los dos (S-25). */
export interface Identity {
  roles: ReadonlySet<Role>;
  customerId: string | null;
}

// Con resolvers Lambda directos, AppSync expone `error.name` como `errorType` (DEC-005).
export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'Unauthorized';
  }
}

/**
 * Rol desde `cognito:groups`. El cliente sale siempre del claim `custom:customerId`, nunca de la entrada
 * (DEC-004): sin él, el grupo `almaceneros` no da rol. El distribuidor no tiene `customerId` (S-22).
 * Sin ningún rol, `Unauthorized`.
 */
export function identityFromClaims(claims: Record<string, unknown> | undefined): Identity {
  const raw = claims?.['cognito:groups'];
  const groups: unknown[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const claimed = claims?.['custom:customerId'];
  const customerId = typeof claimed === 'string' && claimed !== '' && groups.includes(CUSTOMER_GROUP) ? claimed : null;
  const roles = new Set<Role>();
  if (customerId) roles.add('almacenero');
  if (groups.includes(DISTRIBUTOR_GROUP)) roles.add('distribuidor');
  if (roles.size === 0) throw new UnauthorizedError();
  return { roles, customerId };
}

/** `customerId` del almacenero del token; `Unauthorized` si no lo es (doble control con `@aws_auth`, DEC-013). */
export function requireCustomer(identity: Identity): string {
  if (!identity.roles.has('almacenero') || !identity.customerId) throw new UnauthorizedError();
  return identity.customerId;
}

/** `Unauthorized` si el token no es de un distribuidor (DEC-013). */
export function requireDistributor(identity: Identity): void {
  if (!identity.roles.has('distribuidor')) throw new UnauthorizedError();
}
