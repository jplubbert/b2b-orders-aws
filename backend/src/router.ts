import { activeCatalog } from './domain/catalog.js';
import { identityFromClaims, requireCustomer, requireDistributor, type Identity } from './domain/identity.js';
import { OrderNotFoundError, buildOrder } from './domain/order.js';
import { ulid, ulidTime } from './domain/ulid.js';
import type { CatalogRepo } from './data/catalogRepo.js';
import type { OrderRepo } from './data/orderRepo.js';
import type {
  Mutation,
  MutationCreateOrderArgs,
  MutationSetOrderStatusArgs,
  Query,
  QueryAllOrdersArgs,
  QueryOrderArgs,
} from './generated/graphql.js';

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

// Every resolver declares its role (DEC-013), on top of the contract's `@aws_auth`.
const asCustomer =
  <R>(fn: (deps: Deps, customerId: string, args: Record<string, unknown>) => Promise<R>): Resolver<R> =>
  (deps, identity, args) =>
    fn(deps, requireCustomer(identity), args);

const asDistributor =
  <R>(fn: (deps: Deps, args: Record<string, unknown>) => Promise<R>): Resolver<R> =>
  (deps, identity, args) => {
    requireDistributor(identity);
    return fn(deps, args);
  };

// Return types from the generated contract (DEC-002): `Query.<field>` → Query[field].
type QueryResolvers = { [F in keyof Query as `Query.${F & string}`]: Resolver<Query[F]> };
type MutationResolvers = { [F in keyof Mutation as `Mutation.${F & string}`]: Resolver<Mutation[F]> };

// One contract field = one entry (DEC-005). The template test requires all of them to use `api`.
const queryResolvers: QueryResolvers = {
  'Query.listProducts': asCustomer(async (deps) => activeCatalog(await deps.catalog.listProducts())),
  'Query.myOrders': asCustomer(async (deps, customerId) => deps.orders.listOrders(customerId)),
  // REQ-004 E3: looks only in the token customer's partition; another customer's order gives null, like a missing one.
  'Query.order': asCustomer(async (deps, customerId, args) => {
    const { id } = args as unknown as QueryOrderArgs;
    return deps.orders.getOrder(customerId, id);
  }),
  // REQ-010: every store, newest first; missing or null `status` = "Todos".
  'Query.allOrders': asDistributor(async (deps, args) => {
    const { status } = args as unknown as Partial<QueryAllOrdersArgs>;
    return deps.orders.listAllOrders(status ?? null);
  }),
};

const mutationResolvers: MutationResolvers = {
  // REQ-003: current catalog prices; if the domain rejects, nothing is written.
  'Mutation.createOrder': asCustomer(async (deps, customerId, args) => {
    const { input } = args as unknown as MutationCreateOrderArgs;
    const catalog = new Map((await deps.catalog.listProducts()).map((p) => [p.productId, p]));
    const id = (deps.newOrderId ?? ulid)();
    const order = buildOrder(input.lines, catalog, { id, customerId, createdAt: new Date(ulidTime(id)).toISOString() });
    await deps.orders.putOrder(customerId, order);
    return order;
  }),
  // REQ-011: changes only `status`; an order not in that partition gives ORDER_NOT_FOUND without writing anything.
  'Mutation.setOrderStatus': asDistributor(async (deps, args) => {
    const { customerId, id, status } = args as unknown as MutationSetOrderStatusArgs;
    const order = await deps.orders.setStatus(customerId, id, status);
    if (!order) throw new OrderNotFoundError(customerId, id);
    return order;
  }),
};

export const resolvers: Record<string, Resolver> = { ...queryResolvers, ...mutationResolvers };

export async function route(deps: Deps, event: ResolverEvent): Promise<unknown> {
  const identity = identityFromClaims(event.identity?.claims);
  const key = `${event.info.parentTypeName}.${event.info.fieldName}`;
  const resolver = resolvers[key];
  if (!resolver) throw new Error(`No resolver for field: ${key}`);
  return resolver(deps, identity, event.arguments);
}
