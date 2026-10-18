import { activeCatalog } from './domain/catalog.js';
import { identityFromClaims, type Identity } from './domain/identity.js';
import { buildOrder } from './domain/order.js';
import { ulid, ulidTime } from './domain/ulid.js';
import type { CatalogRepo } from './data/catalogRepo.js';
import type { OrderRepo } from './data/orderRepo.js';
import type { Mutation, MutationCreateOrderArgs, Query } from './generated/graphql.js';

export interface Deps {
  catalog: CatalogRepo;
  orders: OrderRepo;
  newOrderId?: () => string;
}

export interface ResolverEvent {
  info: { parentTypeName: string; fieldName: string };
  arguments: Record<string, unknown>;
  identity?: { claims?: Record<string, unknown> } | null;
}

type Resolver<R = unknown> = (deps: Deps, identity: Identity, args: Record<string, unknown>) => Promise<R>;

// Tipos de retorno desde el contrato generado (DEC-002): `Query.<campo>` → Query[campo].
type QueryResolvers = { [F in keyof Query as `Query.${F & string}`]: Resolver<Query[F]> };
type MutationResolvers = { [F in keyof Mutation as `Mutation.${F & string}`]: Resolver<Mutation[F]> };

// Un campo del contrato = una entrada (DEC-005). La prueba de plantilla exige que todos usen `api`.
const queryResolvers: QueryResolvers = {
  'Query.listProducts': async (deps) => activeCatalog(await deps.catalog.listProducts()),
  'Query.myOrders': async (deps, identity) => deps.orders.listOrders(identity.customerId),
};

const mutationResolvers: MutationResolvers = {
  // REQ-003: precios del catálogo vigente; si el dominio rechaza, no se escribe nada.
  'Mutation.createOrder': async (deps, identity, args) => {
    const { input } = args as unknown as MutationCreateOrderArgs;
    const catalog = new Map((await deps.catalog.listProducts()).map((p) => [p.productId, p]));
    const id = (deps.newOrderId ?? ulid)();
    const order = buildOrder(input.lines, catalog, { id, createdAt: new Date(ulidTime(id)).toISOString() });
    await deps.orders.putOrder(identity.customerId, order);
    return order;
  },
};

export const resolvers: Record<string, Resolver> = { ...queryResolvers, ...mutationResolvers };

export async function route(deps: Deps, event: ResolverEvent): Promise<unknown> {
  const identity = identityFromClaims(event.identity?.claims);
  const key = `${event.info.parentTypeName}.${event.info.fieldName}`;
  const resolver = resolvers[key];
  if (!resolver) throw new Error(`Campo sin resolver: ${key}`);
  return resolver(deps, identity, event.arguments);
}
