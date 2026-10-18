export const CUSTOMER_GROUP = 'almaceneros';
export const DISTRIBUTOR_GROUP = 'distribuidores'; // DEC-013

export type Role = 'customer' | 'distributor';

/** Roles in the token; `customerId` only for a customer (almacenero). A user in both groups has both (S-25). */
export interface Identity {
  roles: ReadonlySet<Role>;
  customerId: string | null;
}

// With direct Lambda resolvers, AppSync exposes `error.name` as `errorType` (DEC-005).
export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'Unauthorized';
  }
}

/**
 * Role from `cognito:groups`. The customer always comes from the `custom:customerId` claim, never from the input
 * (DEC-004): without it, the `almaceneros` group grants no role. The distributor has no `customerId` (S-22).
 * With no role at all, `Unauthorized`.
 */
export function identityFromClaims(claims: Record<string, unknown> | undefined): Identity {
  const raw = claims?.['cognito:groups'];
  const groups: unknown[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const claimed = claims?.['custom:customerId'];
  const customerId = typeof claimed === 'string' && claimed !== '' && groups.includes(CUSTOMER_GROUP) ? claimed : null;
  const roles = new Set<Role>();
  if (customerId) roles.add('customer');
  if (groups.includes(DISTRIBUTOR_GROUP)) roles.add('distributor');
  if (roles.size === 0) throw new UnauthorizedError();
  return { roles, customerId };
}

/** `customerId` of the token's customer; `Unauthorized` if it isn't one (double check with `@aws_auth`, DEC-013). */
export function requireCustomer(identity: Identity): string {
  if (!identity.roles.has('customer') || !identity.customerId) throw new UnauthorizedError();
  return identity.customerId;
}

/** `Unauthorized` unless the token belongs to a distributor (DEC-013). */
export function requireDistributor(identity: Identity): void {
  if (!identity.roles.has('distributor')) throw new UnauthorizedError();
}
