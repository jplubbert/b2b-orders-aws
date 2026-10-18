import { describe, expect, it } from 'vitest';
import type { Order } from '../src/domain/order.js';
import { route, type Deps, type ResolverEvent } from '../src/router.js';

// In-memory order repository, per customer.
function makeDeps() {
  const saved = new Map<string, Order[]>();
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
        list[i] = { ...list[i]!, status };
        return list[i]!;
      },
    },
    newOrderId: () => '01JAAAAAAAAAAAAAAAAAB7XQ2M9Z',
  };
  return { deps, saved };
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
  const { deps, saved } = makeDeps();
  deps.newOrderId = () => '01JAAAAAAAAAAAAAAAAAAAAAA1';
  const first = (await route(deps, createOrder(store1, [{ productId: 'arroz', quantity: 1 }]))) as Order;
  deps.newOrderId = () => '01JAAAAAAAAAAAAAAAAAAAAAA2';
  const second = (await route(deps, createOrder(store2, [{ productId: 'yerba', quantity: 2 }]))) as Order;
  return { deps, saved, first, second };
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
