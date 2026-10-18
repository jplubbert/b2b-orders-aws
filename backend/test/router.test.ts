import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Order } from '../src/domain/order.js';
import type { OrderEventMessage, OrderStatusEvent } from '../src/domain/orderEvent.js';
import { DOMAINS, DOMAIN_FIELDS } from '../src/domains.js';
import { domainResolvers, resolvers, route, type Deps, type ResolverEvent } from '../src/router.js';

// In-memory order repository, per customer; `published` records the order events, `history` is what orderHistory reads.
function makeDeps() {
  const saved = new Map<string, Order[]>();
  const published: OrderEventMessage[] = [];
  const history: OrderStatusEvent[] = [];
  let eventSeq = 0;
  const deps: Deps = {
    catalog: {
      listProducts: async () => [
        { productId: 'yerba', name: 'Yerba 1 kg', presentation: 'Paquete', unitPrice: 4500, active: true },
        { productId: 'arroz', name: 'Arroz 1 kg', presentation: 'Paquete', unitPrice: 1300, active: true },
        { productId: 'aceite', name: 'Aceite 900 ml', presentation: 'Botella', unitPrice: 2900, active: false },
      ],
    },
    orders: {
      putOrder: async (customerId, order) => void saved.set(customerId, [...(saved.get(customerId) ?? []), order]),
      listOrders: async (customerId) => [...(saved.get(customerId) ?? [])].reverse(),
      getOrder: async (customerId, orderId) => saved.get(customerId)?.find((o) => o.id === orderId) ?? null,
      listAllOrders: async (status) =>
        [...saved.values()]
          .flat()
          .filter((o) => !status || o.status === status)
          .sort((a, b) => b.id.localeCompare(a.id)),
      setStatus: async (customerId, orderId, status) => {
        const list = saved.get(customerId) ?? [];
        const i = list.findIndex((o) => o.id === orderId);
        if (i < 0) return null;
        const previous = list[i]!.status;
        list[i] = { ...list[i]!, status };
        return { order: list[i]!, previous };
      },
    },
    history: { listEvents: async (orderId) => history.filter((e) => e.orderId === orderId) },
    events: { publish: async (e) => void published.push(e) },
    newOrderId: () => '01JAAAAAAAAAAAAAAAAAB7XQ2M9Z',
    newEventId: (now) => `EVT-${now}-${++eventSeq}`,
    now: () => Date.parse('2026-10-18T12:00:00.000Z'),
  };
  return { deps, saved, published, history };
}

const event = (
  claims?: Record<string, unknown>,
  fieldName = 'listProducts',
  parentTypeName = 'Query',
  args: Record<string, unknown> = {},
): ResolverEvent => ({
  info: { parentTypeName, fieldName },
  arguments: args,
  identity: claims ? { claims } : null,
});

const store1 = { 'custom:customerId': 'C-ALMACEN1', 'cognito:groups': ['almaceneros'] };
const store2 = { 'custom:customerId': 'C-ALMACEN2', 'cognito:groups': ['almaceneros'] };
const distributor = { 'cognito:groups': ['distribuidores'] };

const createOrder = (claims: Record<string, unknown> | undefined, lines: unknown[]) =>
  event(claims, 'createOrder', 'Mutation', { input: { lines } });

describe('route', () => {
  it('listProducts returns the sorted active catalog', async () => {
    const out = (await route(makeDeps().deps, event(store1))) as { name: string }[];
    expect(out.map((x) => x.name)).toEqual(['Arroz 1 kg', 'Yerba 1 kg']);
  });

  it.each([
    ['no identity', undefined],
    ['no customerId', { 'cognito:groups': ['almaceneros'] }],
    ['outside the group', { 'custom:customerId': 'C-X', 'cognito:groups': ['otros'] }],
  ])('rejects %s with Unauthorized (DEC-004)', async (_case, claims) => {
    const { deps, saved } = makeDeps();
    await expect(route(deps, event(claims))).rejects.toMatchObject({ name: 'Unauthorized' });
    await expect(route(deps, createOrder(claims, [{ productId: 'yerba', quantity: 1 }]))).rejects.toMatchObject({
      name: 'Unauthorized',
    });
    expect(saved.size).toBe(0);
  });

  it('fails on a field without a resolver', async () => {
    await expect(route(makeDeps().deps, event(store1, 'nope'))).rejects.toThrow('No resolver for field');
  });
});

describe('domain Lambdas (DEC-019)', () => {
  it('S-30: every resolver belongs to exactly one domain', () => {
    const fields = DOMAINS.flatMap((d) => [...DOMAIN_FIELDS[d]]);
    expect(new Set(fields).size).toBe(fields.length);
    expect(fields.sort()).toEqual(Object.keys(resolvers).sort());
  });

  it.each(DOMAINS)('%s answers only its own fields', async (domain) => {
    const available = domainResolvers(domain);
    expect(Object.keys(available).sort()).toEqual([...DOMAIN_FIELDS[domain]].sort());
    for (const key of Object.keys(resolvers).filter((k) => !(k in available))) {
      const [parent, field] = key.split('.') as [string, string];
      await expect(route(makeDeps().deps, event(distributor, field, parent), available)).rejects.toThrow(
        `No resolver for field: ${key}`,
      );
    }
  });

  it('a domain resolver behaves like the shared one', async () => {
    const { deps } = makeDeps();
    const orders = domainResolvers('orders');
    const created = (await route(deps, createOrder(store1, [{ productId: 'yerba', quantity: 1 }]), orders)) as Order;
    expect(await route(deps, event(store1, 'myOrders'), orders)).toEqual([created]);
    expect(await route(deps, allOrders(distributor), domainResolvers('distributor'))).toEqual([created]);
    expect(((await route(deps, event(store1), domainResolvers('catalog'))) as unknown[]).length).toBe(2);
  });
});

describe('route: createOrder and myOrders (REQ-003)', () => {
  it("creates the order with the new id and the ULID's date, in the token customer's partition", async () => {
    const { deps, saved } = makeDeps();
    const order = (await route(
      deps,
      createOrder(store1, [
        { productId: 'yerba', quantity: 2 },
        { productId: 'arroz', quantity: 5 },
      ]),
    )) as Order;
    expect(order).toMatchObject({
      id: '01JAAAAAAAAAAAAAAAAAB7XQ2M9Z',
      customerId: 'C-ALMACEN1',
      number: 'B7XQ2M9Z',
      status: 'RECIBIDO',
      total: 15500,
    });
    expect(Date.parse(order.createdAt)).not.toBeNaN();
    expect(saved.get('C-ALMACEN1')).toEqual([order]);
    expect(await route(deps, event(store1, 'myOrders'))).toEqual([order]);
    expect(await route(deps, event(store2, 'myOrders'))).toEqual([]);
  });

  it.each([
    ['EMPTY_ORDER', []],
    ['INVALID_QUANTITY', [{ productId: 'yerba', quantity: 0 }]],
    ['PRODUCT_UNAVAILABLE', [{ productId: 'aceite', quantity: 1 }]],
  ])('a %s rejection arrives as errorType and saves nothing', async (code, lines) => {
    const { deps, saved } = makeDeps();
    await expect(route(deps, createOrder(store1, lines))).rejects.toMatchObject({ name: code });
    expect(saved.size).toBe(0);
  });
});

describe('route: order(id) (REQ-004)', () => {
  const orderOf = (claims: Record<string, unknown> | undefined, id: string) => event(claims, 'order', 'Query', { id });

  it('the owner sees their order with lines and frozen prices', async () => {
    const { deps } = makeDeps();
    const created = (await route(deps, createOrder(store1, [{ productId: 'yerba', quantity: 2 }]))) as Order;
    expect(await route(deps, orderOf(store1, created.id))).toEqual(created);
  });

  it("E3: another customer's order gives null, same as a missing one", async () => {
    const { deps } = makeDeps();
    const created = (await route(deps, createOrder(store1, [{ productId: 'yerba', quantity: 1 }]))) as Order;
    expect(await route(deps, orderOf(store2, created.id))).toBeNull();
    expect(await route(deps, orderOf(store2, '01J0000000000000000000NONE'))).toBeNull();
  });

  it('without a valid identity → Unauthorized (DEC-004)', async () => {
    await expect(route(makeDeps().deps, orderOf(undefined, 'x'))).rejects.toMatchObject({ name: 'Unauthorized' });
  });
});

// Two orders with increasing ULIDs: one from store1 and, after it, one from store2.
async function twoOrders() {
  const { deps, saved, published } = makeDeps();
  deps.newOrderId = () => '01JAAAAAAAAAAAAAAAAAAAAAA1';
  const first = (await route(deps, createOrder(store1, [{ productId: 'arroz', quantity: 1 }]))) as Order;
  deps.newOrderId = () => '01JAAAAAAAAAAAAAAAAAAAAAA2';
  const second = (await route(deps, createOrder(store2, [{ productId: 'yerba', quantity: 2 }]))) as Order;
  return { deps, saved, published, first, second };
}

const allOrders = (claims: Record<string, unknown> | undefined, status?: string | null) =>
  event(claims, 'allOrders', 'Query', status === undefined ? {} : { status });
const setStatus = (claims: Record<string, unknown> | undefined, args: Record<string, unknown>) =>
  event(claims, 'setOrderStatus', 'Mutation', args);

describe('route: role per operation (REQ-009, DEC-013)', () => {
  it('E5: a customer cannot call allOrders or setOrderStatus', async () => {
    const { deps, saved, first } = await twoOrders();
    await expect(route(deps, allOrders(store1))).rejects.toMatchObject({ name: 'Unauthorized' });
    await expect(
      route(deps, setStatus(store1, { customerId: 'C-ALMACEN1', id: first.id, status: 'ENVIADO' })),
    ).rejects.toMatchObject({ name: 'Unauthorized' });
    expect(saved.get('C-ALMACEN1')![0]!.status).toBe('RECIBIDO');
  });

  it.each(['listProducts', 'myOrders', 'order', 'createOrder'])('E6: a distributor cannot call %s', async (field) => {
    const { deps, saved } = makeDeps();
    const parent = field === 'createOrder' ? 'Mutation' : 'Query';
    const args = field === 'createOrder' ? { input: { lines: [{ productId: 'yerba', quantity: 1 }] } } : { id: 'x' };
    await expect(route(deps, event(distributor, field, parent, args))).rejects.toMatchObject({ name: 'Unauthorized' });
    expect(saved.size).toBe(0);
  });

  it('a distributor with custom:customerId is still not a customer', async () => {
    const claims = { ...distributor, 'custom:customerId': 'C-ALMACEN1' };
    await expect(route(makeDeps().deps, event(claims, 'myOrders'))).rejects.toMatchObject({ name: 'Unauthorized' });
  });

  it('S-25: a user in both groups has the operations of both roles', async () => {
    const { deps } = await twoOrders();
    const both = { 'custom:customerId': 'C-ALMACEN1', 'cognito:groups': ['almaceneros', 'distribuidores'] };
    expect(await route(deps, event(both, 'myOrders'))).toHaveLength(1);
    expect(await route(deps, allOrders(both))).toHaveLength(2);
  });

  it('accepts cognito:groups as comma-separated text', async () => {
    const { deps } = await twoOrders();
    expect(await route(deps, allOrders({ 'cognito:groups': 'otros,distribuidores' }))).toHaveLength(2);
  });

  it('E3 (edge): without a group no operation is allowed', async () => {
    const { deps } = await twoOrders();
    const nobody = { 'custom:customerId': 'C-X' };
    await expect(route(deps, allOrders(nobody))).rejects.toMatchObject({ name: 'Unauthorized' });
    await expect(route(deps, event(nobody, 'myOrders'))).rejects.toMatchObject({ name: 'Unauthorized' });
  });
});

describe('route: allOrders (REQ-010)', () => {
  it('E1: orders from every store, newest first, with their customerId', async () => {
    const { deps, first, second } = await twoOrders();
    const out = (await route(deps, allOrders(distributor))) as Order[];
    expect(out).toEqual([second, first]);
    expect(out.map((o) => o.customerId)).toEqual(['C-ALMACEN2', 'C-ALMACEN1']);
  });

  it('E2: with status returns only that status; null or missing = all', async () => {
    const { deps, first, second } = await twoOrders();
    await route(deps, setStatus(distributor, { customerId: 'C-ALMACEN2', id: second.id, status: 'ENVIADO' }));
    expect(((await route(deps, allOrders(distributor, 'ENVIADO'))) as Order[]).map((o) => o.id)).toEqual([second.id]);
    expect(((await route(deps, allOrders(distributor, null))) as Order[]).map((o) => o.id)).toEqual([second.id, first.id]);
    expect(await route(deps, allOrders(distributor, 'CANCELADO'))).toEqual([]);
  });

  it('E4 (edge): with no orders, an empty list', async () => {
    expect(await route(makeDeps().deps, allOrders(distributor))).toEqual([]);
  });
});

describe('route: setOrderStatus (REQ-011)', () => {
  it('E1/E2/E4: changes only the status and the owner sees it', async () => {
    const { deps, first } = await twoOrders();
    const updated = await route(deps, setStatus(distributor, { customerId: 'C-ALMACEN1', id: first.id, status: 'EN_PREPARACION' }));
    expect(updated).toEqual({ ...first, status: 'EN_PREPARACION' });
    expect(await route(deps, event(store1, 'order', 'Query', { id: first.id }))).toEqual(updated);
  });

  it('E3: the same status again is not an error', async () => {
    const { deps, first } = await twoOrders();
    const args = { customerId: 'C-ALMACEN1', id: first.id, status: 'ENVIADO' };
    const once = await route(deps, setStatus(distributor, args));
    expect(await route(deps, setStatus(distributor, args))).toEqual(once);
  });

  it.each([
    ['missing id', { customerId: 'C-ALMACEN1', id: '01J0000000000000000000NONE' }],
    ["another store's customerId", { customerId: 'C-ALMACEN2', id: '01JAAAAAAAAAAAAAAAAAAAAAA1' }],
  ])('E5: %s → ORDER_NOT_FOUND without changes', async (_case, target) => {
    const { deps, saved } = await twoOrders();
    const before = structuredClone([...saved]);
    await expect(route(deps, setStatus(distributor, { ...target, status: 'CANCELADO' }))).rejects.toMatchObject({
      name: 'ORDER_NOT_FOUND',
    });
    expect([...saved]).toEqual(before);
  });
});

describe('route: order events (REQ-012, DEC-020)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('E1: createOrder publishes one OrderCreated event in RECIBIDO, no previous status, at the order time', async () => {
    const { deps, published } = makeDeps();
    const order = (await route(deps, createOrder(store1, [{ productId: 'yerba', quantity: 1 }]))) as Order;
    expect(published).toEqual([
      {
        type: 'OrderCreated',
        eventId: `EVT-${Date.parse(order.createdAt)}-1`,
        orderId: order.id,
        customerId: 'C-ALMACEN1',
        from: null,
        to: 'RECIBIDO',
        at: order.createdAt,
      },
    ]);
  });

  it('E2/E3: each accepted setOrderStatus publishes from → to, also for the same status', async () => {
    const { deps, published, first } = await twoOrdersWithEvents();
    published.length = 0;
    const target = { customerId: 'C-ALMACEN1', id: first.id };
    await route(deps, setStatus(distributor, { ...target, status: 'ENVIADO' }));
    await route(deps, setStatus(distributor, { ...target, status: 'ENVIADO' }));
    await route(deps, setStatus(distributor, { ...target, status: 'ENTREGADO' }));
    expect(published.map((e) => [e.type, e.from, e.to])).toEqual([
      ['OrderStatusChanged', 'RECIBIDO', 'ENVIADO'],
      ['OrderStatusChanged', 'ENVIADO', 'ENVIADO'],
      ['OrderStatusChanged', 'ENVIADO', 'ENTREGADO'],
    ]);
    expect(published[0]).toMatchObject({ orderId: first.id, customerId: 'C-ALMACEN1', at: '2026-10-18T12:00:00.000Z' });
    expect(new Set(published.map((e) => e.eventId)).size).toBe(3);
  });

  it.each([
    ['EMPTY_ORDER', []],
    ['INVALID_QUANTITY', [{ productId: 'yerba', quantity: 0 }]],
    ['PRODUCT_UNAVAILABLE', [{ productId: 'aceite', quantity: 1 }]],
  ])('E4: a %s rejection publishes nothing', async (code, lines) => {
    const { deps, published } = makeDeps();
    await expect(route(deps, createOrder(store1, lines))).rejects.toMatchObject({ name: code });
    expect(published).toEqual([]);
  });

  it('E4: ORDER_NOT_FOUND and Unauthorized publish nothing', async () => {
    const { deps, published, first } = await twoOrdersWithEvents();
    published.length = 0;
    await expect(
      route(deps, setStatus(distributor, { customerId: 'C-ALMACEN2', id: first.id, status: 'CANCELADO' })),
    ).rejects.toMatchObject({ name: 'ORDER_NOT_FOUND' });
    await expect(
      route(deps, setStatus(store1, { customerId: 'C-ALMACEN1', id: first.id, status: 'CANCELADO' })),
    ).rejects.toMatchObject({ name: 'Unauthorized' });
    await expect(route(deps, createOrder(distributor, [{ productId: 'yerba', quantity: 1 }]))).rejects.toMatchObject({
      name: 'Unauthorized',
    });
    expect(published).toEqual([]);
  });

  it('publishes nothing if the write itself fails', async () => {
    const { deps, published } = makeDeps();
    deps.orders.putOrder = async () => {
      throw new Error('throttled');
    };
    deps.orders.setStatus = async () => {
      throw new Error('throttled');
    };
    await expect(route(deps, createOrder(store1, [{ productId: 'yerba', quantity: 1 }]))).rejects.toThrow('throttled');
    await expect(
      route(deps, setStatus(distributor, { customerId: 'C-ALMACEN1', id: 'x', status: 'ENVIADO' })),
    ).rejects.toThrow('throttled');
    expect(published).toEqual([]);
  });

  it('S-32: if publishing fails, the operation still succeeds and the error is logged', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps, saved } = makeDeps();
    deps.events = {
      publish: async () => {
        throw new Error('SNS down');
      },
    };
    const order = (await route(deps, createOrder(store1, [{ productId: 'yerba', quantity: 1 }]))) as Order;
    expect(saved.get('C-ALMACEN1')).toEqual([order]);
    const updated = await route(deps, setStatus(distributor, { customerId: 'C-ALMACEN1', id: order.id, status: 'ENVIADO' }));
    expect(updated).toEqual({ ...order, status: 'ENVIADO' });
    expect(errors).toHaveBeenCalledTimes(2);
    expect(String(errors.mock.calls[0]![0])).toContain('Order event not published');
    expect(String(errors.mock.calls[0]![0])).toContain('SNS down');
  });
});

// Two orders (store1, store2) whose events are stored as soon as they're published, as the history Lambda would.
async function twoOrdersWithEvents() {
  const base = await twoOrders();
  const published: OrderEventMessage[] = [];
  const history: OrderStatusEvent[] = [];
  const publish = async ({ type, ...e }: OrderEventMessage) => {
    published.push({ type, ...e });
    history.push(e);
  };
  for (const e of base.published) await publish(e);
  base.deps.events = { publish };
  base.deps.history = { listEvents: async (orderId) => history.filter((e) => e.orderId === orderId) };
  return { ...base, published, history };
}

describe('route: orderHistory (REQ-012, S-29)', () => {
  const historyOf = (claims: Record<string, unknown> | undefined, id: string) =>
    event(claims, 'orderHistory', 'Query', { id });

  it("E8: the owner gets their order's events in the repository's order (oldest first)", async () => {
    const { deps, first } = await twoOrdersWithEvents();
    await route(deps, setStatus(distributor, { customerId: 'C-ALMACEN1', id: first.id, status: 'ENVIADO' }));
    const events = (await route(deps, historyOf(store1, first.id))) as OrderStatusEvent[];
    expect(events.map((e) => [e.from, e.to])).toEqual([
      [null, 'RECIBIDO'],
      ['RECIBIDO', 'ENVIADO'],
    ]);
    expect(events[1]).not.toHaveProperty('type');
  });

  it('E9: the distributor gets the same events of any order', async () => {
    const { deps, first, second } = await twoOrdersWithEvents();
    expect(await route(deps, historyOf(distributor, first.id))).toEqual(await route(deps, historyOf(store1, first.id)));
    expect(await route(deps, historyOf(distributor, second.id))).toHaveLength(1);
  });

  it("E10: another store's order gives an empty list, with no error; a missing order too", async () => {
    const { deps, first } = await twoOrdersWithEvents();
    expect(await route(deps, historyOf(store2, first.id))).toEqual([]);
    expect(await route(deps, historyOf(store1, '01J0000000000000000000NONE'))).toEqual([]);
  });

  it('S-25: a user in both groups reads it as the distributor', async () => {
    const { deps, second } = await twoOrdersWithEvents();
    const both = { 'custom:customerId': 'C-ALMACEN1', 'cognito:groups': ['almaceneros', 'distribuidores'] };
    expect(await route(deps, historyOf(both, second.id))).toHaveLength(1);
  });

  it('without a group or customerId → Unauthorized (DEC-004)', async () => {
    const { deps, first } = await twoOrdersWithEvents();
    await expect(route(deps, historyOf(undefined, first.id))).rejects.toMatchObject({ name: 'Unauthorized' });
    await expect(route(deps, historyOf({ 'cognito:groups': ['almaceneros'] }, first.id))).rejects.toMatchObject({
      name: 'Unauthorized',
    });
  });

  it('is served by the orders Lambda (DEC-019)', () => {
    expect(DOMAIN_FIELDS.orders).toContain('Query.orderHistory');
  });
});
