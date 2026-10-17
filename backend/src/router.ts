import { activeCatalog } from './domain/catalog.js';
import { identityFromClaims, type Identity } from './domain/identity.js';
import type { CatalogRepo } from './data/catalogRepo.js';

export interface Deps {
  catalog: CatalogRepo;
}

export interface ResolverEvent {
  info: { parentTypeName: string; fieldName: string };
  arguments: Record<string, unknown>;
  identity?: { claims?: Record<string, unknown> } | null;
}

type Resolver = (deps: Deps, identity: Identity, args: Record<string, unknown>) => Promise<unknown>;

// Un campo del contrato = una entrada (DEC-005). La prueba de plantilla exige que todos usen `api`.
export const resolvers: Record<string, Resolver> = {
  'Query.listProducts': async (deps) => activeCatalog(await deps.catalog.listProducts()),
};

export async function route(deps: Deps, event: ResolverEvent): Promise<unknown> {
  const identity = identityFromClaims(event.identity?.claims);
  const key = `${event.info.parentTypeName}.${event.info.fieldName}`;
  const resolver = resolvers[key];
  if (!resolver) throw new Error(`Campo sin resolver: ${key}`);
  return resolver(deps, identity, event.arguments);
}
