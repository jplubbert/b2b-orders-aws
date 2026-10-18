import { activeCatalog } from './domain/catalog.js';
import { identityFromClaims, requireCustomer, requireDistributor, type Identity } from './domain/identity.js';
import { OrderNotFoundError, buildOrder } from './domain/order.js';
import { orderCreatedEvent, orderStatusChangedEvent, type OrderEventMessage } from './domain/orderEvent.js';
import { ulid, ulidTime } from './domain/ulid.js';
import { DOMAIN_FIELDS, type Domain } from './domains.js';
import type { CatalogRepo } from './data/catalogRepo.js';
import type { OrderEventPublisher } from './data/eventPublisher.js';
import type { HistoryRepo } from './data/historyRepo.js';
import type { OrderRepo } from './data/orderRepo.js';
import type {
  Mutation,
  MutationCreateOrderArgs,
  MutationSetOrderStatusArgs,
  Query,
  QueryAllOrdersArgs,
  QueryOrderArgs,
  QueryOrderHistoryArgs,
} from './generated/graphql.js';

export interface Deps {
  catalog: CatalogRepo;
  orders: OrderRepo;
  history: Pick<HistoryRepo, 'listEvents'>;
  events: OrderEventPublisher;
  newOrderId?: () => string;
  newEventId?: (now: number) => string;
  now?: () => number;
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

// DEC-020 (S-32): only after a successful write; if publishing fails, the operation still succeeds and the error is logged.
async function publish(deps: Deps, event: OrderEventMessage): Promise<void> {
  try {
    await deps.events.publish(event);
  } catch (err) {
    console.error(JSON.stringify({ msg: 'Order event not published', event, error: String(err) }));
  }
}

// Return types from the generated contract (DEC-002): `Query.<field>` → Query[field].
type QueryResolvers = { [F in keyof Query as `Query.${F & string}`]: Resolver<Query[F]> };
type MutationResolvers = { [F in keyof Mutation as `Mutation.${F & string}`]: Resolver<Mutation[F]> };

// One contract field = one entry; DOMAIN_FIELDS says which Lambda serves it (DEC-019).
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
  // REQ-012 (S-29): the distributor sees any order's history; a customer only events with their token's customerId,
  // so another store's order gives an empty list, like REQ-004 E3. A user in both groups has the distributor's (S-25).
  'Query.orderHistory': async (deps, identity, args) => {
    const { id } = args as unknown as QueryOrderHistoryArgs;
    if (identity.roles.has('distributor')) return deps.history.listEvents(id);
    const customerId = requireCustomer(identity);
    return (await deps.history.listEvents(id)).filter((e) => e.customerId === customerId);
  },
};

const mutationResolvers: MutationResolvers = {
  // REQ-003: current catalog prices; if the domain rejects, nothing is written.
  'Mutation.createOrder': asCustomer(async (deps, customerId, args) => {
    const { input } = args as unknown as MutationCreateOrderArgs;
    const catalog = new Map((await deps.catalog.listProducts()).map((p) => [p.productId, p]));
    const id = (deps.newOrderId ?? ulid)();
    const order = buildOrder(input.lines, catalog, { id, customerId, createdAt: new Date(ulidTime(id)).toISOString() });
    await deps.orders.putOrder(customerId, order);
    await publish(deps, orderCreatedEvent(order, deps.newEventId));
    return order;
  }),
  // REQ-011: changes only `status`; an order not in that partition gives ORDER_NOT_FOUND without writing anything.
  // REQ-012 E3: the same status again is an accepted change, so it publishes too.
  'Mutation.setOrderStatus': asDistributor(async (deps, args) => {
    const { customerId, id, status } = args as unknown as MutationSetOrderStatusArgs;
    const change = await deps.orders.setStatus(customerId, id, status);
    if (!change) throw new OrderNotFoundError(customerId, id);
    const now = (deps.now ?? Date.now)();
    await publish(deps, orderStatusChangedEvent(change.order, change.previous, now, deps.newEventId));
    return change.order;
  }),
};

const allResolvers: QueryResolvers & MutationResolvers = { ...queryResolvers, ...mutationResolvers };
export const resolvers: Record<string, Resolver> = allResolvers;

/** Only the domain's fields: any other field fails as if it had no resolver (DEC-019). */
export function domainResolvers(domain: Domain): Record<string, Resolver> {
  const fields: readonly (keyof typeof allResolvers)[] = DOMAIN_FIELDS[domain];
  return Object.fromEntries(fields.map((key) => [key, allResolvers[key]]));
}

export async function route(
  deps: Deps,
  event: ResolverEvent,
  available: Record<string, Resolver> = resolvers,
): Promise<unknown> {
  const identity = identityFromClaims(event.identity?.claims);
  const key = `${event.info.parentTypeName}.${event.info.fieldName}`;
  const resolver = available[key];
  if (!resolver) throw new Error(`No resolver for field: ${key}`);
  return resolver(deps, identity, event.arguments);
}
