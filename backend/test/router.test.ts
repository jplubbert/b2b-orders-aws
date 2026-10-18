import { describe, expect, it } from 'vitest';
import type { Order } from '../src/domain/order.js';
import { route, type Deps, type ResolverEvent } from '../src/router.js';

// Repositorio de pedidos en memoria, por cliente.
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

const almacen1 = { 'custom:customerId': 'C-ALMACEN1', 'cognito:groups': ['almaceneros'] };
const almacen2 = { 'custom:customerId': 'C-ALMACEN2', 'cognito:groups': ['almaceneros'] };
const distribuidor = { 'cognito:groups': ['distribuidores'] };

const createOrder = (claims: Record<string, unknown> | undefined, lines: unknown[]) =>
  event(claims, 'createOrder', 'Mutation', { input: { lines } });

describe('route', () => {
  it('listProducts devuelve el catálogo activo ordenado', async () => {
    const out = (await route(makeDeps().deps, event(almacen1))) as { name: string }[];
    expect(out.map((x) => x.name)).toEqual(['Arroz 1 kg', 'Yerba 1 kg']);
  });

  it.each([
    ['sin identidad', undefined],
    ['sin customerId', { 'cognito:groups': ['almaceneros'] }],
    ['fuera del grupo', { 'custom:customerId': 'C-X', 'cognito:groups': ['otros'] }],
  ])('rechaza %s con Unauthorized (DEC-004)', async (_caso, claims) => {
    const { deps, saved } = makeDeps();
    await expect(route(deps, event(claims))).rejects.toMatchObject({ name: 'Unauthorized' });
    await expect(route(deps, createOrder(claims, [{ productId: 'yerba', quantity: 1 }]))).rejects.toMatchObject({
      name: 'Unauthorized',
    });
    expect(saved.size).toBe(0);
  });

  it('falla en un campo sin resolver', async () => {
    await expect(route(makeDeps().deps, event(almacen1, 'nope'))).rejects.toThrow('Campo sin resolver');
  });
});

describe('route: createOrder y myOrders (REQ-003)', () => {
  it('crea el pedido con el id nuevo y la fecha del ULID, en la partición del cliente del token', async () => {
    const { deps, saved } = makeDeps();
    const order = (await route(
      deps,
      createOrder(almacen1, [
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
    expect(await route(deps, event(almacen1, 'myOrders'))).toEqual([order]);
    expect(await route(deps, event(almacen2, 'myOrders'))).toEqual([]);
  });

  it.each([
    ['EMPTY_ORDER', []],
    ['INVALID_QUANTITY', [{ productId: 'yerba', quantity: 0 }]],
    ['PRODUCT_UNAVAILABLE', [{ productId: 'aceite', quantity: 1 }]],
  ])('un rechazo %s llega como errorType y no guarda nada', async (code, lines) => {
    const { deps, saved } = makeDeps();
    await expect(route(deps, createOrder(almacen1, lines))).rejects.toMatchObject({ name: code });
    expect(saved.size).toBe(0);
  });
});

describe('route: order(id) (REQ-004)', () => {
  const orderOf = (claims: Record<string, unknown> | undefined, id: string) => event(claims, 'order', 'Query', { id });

  it('el dueño ve su pedido con líneas y precios congelados', async () => {
    const { deps } = makeDeps();
    const created = (await route(deps, createOrder(almacen1, [{ productId: 'yerba', quantity: 2 }]))) as Order;
    expect(await route(deps, orderOf(almacen1, created.id))).toEqual(created);
  });

  it('E3: un pedido de otro cliente da null, igual que uno inexistente', async () => {
    const { deps } = makeDeps();
    const created = (await route(deps, createOrder(almacen1, [{ productId: 'yerba', quantity: 1 }]))) as Order;
    expect(await route(deps, orderOf(almacen2, created.id))).toBeNull();
    expect(await route(deps, orderOf(almacen2, '01J0000000000000000000NONE'))).toBeNull();
  });

  it('sin identidad válida → Unauthorized (DEC-004)', async () => {
    await expect(route(makeDeps().deps, orderOf(undefined, 'x'))).rejects.toMatchObject({ name: 'Unauthorized' });
  });
});

// Dos pedidos con ULID crecientes: uno de almacen1 y, después, uno de almacen2.
async function twoOrders() {
  const { deps, saved } = makeDeps();
  deps.newOrderId = () => '01JAAAAAAAAAAAAAAAAAAAAAA1';
  const first = (await route(deps, createOrder(almacen1, [{ productId: 'arroz', quantity: 1 }]))) as Order;
  deps.newOrderId = () => '01JAAAAAAAAAAAAAAAAAAAAAA2';
  const second = (await route(deps, createOrder(almacen2, [{ productId: 'yerba', quantity: 2 }]))) as Order;
  return { deps, saved, first, second };
}

const allOrders = (claims: Record<string, unknown> | undefined, status?: string | null) =>
  event(claims, 'allOrders', 'Query', status === undefined ? {} : { status });
const setStatus = (claims: Record<string, unknown> | undefined, args: Record<string, unknown>) =>
  event(claims, 'setOrderStatus', 'Mutation', args);

describe('route: rol por operación (REQ-009, DEC-013)', () => {
  it('E5: un almacenero no puede llamar allOrders ni setOrderStatus', async () => {
    const { deps, saved, first } = await twoOrders();
    await expect(route(deps, allOrders(almacen1))).rejects.toMatchObject({ name: 'Unauthorized' });
    await expect(
      route(deps, setStatus(almacen1, { customerId: 'C-ALMACEN1', id: first.id, status: 'ENVIADO' })),
    ).rejects.toMatchObject({ name: 'Unauthorized' });
    expect(saved.get('C-ALMACEN1')![0]!.status).toBe('RECIBIDO');
  });

  it.each(['listProducts', 'myOrders', 'order', 'createOrder'])('E6: un distribuidor no puede llamar %s', async (field) => {
    const { deps, saved } = makeDeps();
    const parent = field === 'createOrder' ? 'Mutation' : 'Query';
    const args = field === 'createOrder' ? { input: { lines: [{ productId: 'yerba', quantity: 1 }] } } : { id: 'x' };
    await expect(route(deps, event(distribuidor, field, parent, args))).rejects.toMatchObject({ name: 'Unauthorized' });
    expect(saved.size).toBe(0);
  });

  it('un distribuidor con custom:customerId sigue sin ser almacenero', async () => {
    const claims = { ...distribuidor, 'custom:customerId': 'C-ALMACEN1' };
    await expect(route(makeDeps().deps, event(claims, 'myOrders'))).rejects.toMatchObject({ name: 'Unauthorized' });
  });

  it('S-25: un usuario en ambos grupos tiene las operaciones de los dos roles', async () => {
    const { deps } = await twoOrders();
    const both = { 'custom:customerId': 'C-ALMACEN1', 'cognito:groups': ['almaceneros', 'distribuidores'] };
    expect(await route(deps, event(both, 'myOrders'))).toHaveLength(1);
    expect(await route(deps, allOrders(both))).toHaveLength(2);
  });

  it('acepta cognito:groups como texto separado por comas', async () => {
    const { deps } = await twoOrders();
    expect(await route(deps, allOrders({ 'cognito:groups': 'otros,distribuidores' }))).toHaveLength(2);
  });

  it('E3 (borde): sin grupo no accede a ninguna operación', async () => {
    const { deps } = await twoOrders();
    const nobody = { 'custom:customerId': 'C-X' };
    await expect(route(deps, allOrders(nobody))).rejects.toMatchObject({ name: 'Unauthorized' });
    await expect(route(deps, event(nobody, 'myOrders'))).rejects.toMatchObject({ name: 'Unauthorized' });
  });
});

describe('route: allOrders (REQ-010)', () => {
  it('E1: pedidos de todos los almacenes, el más reciente primero, con su customerId', async () => {
    const { deps, first, second } = await twoOrders();
    const out = (await route(deps, allOrders(distribuidor))) as Order[];
    expect(out).toEqual([second, first]);
    expect(out.map((o) => o.customerId)).toEqual(['C-ALMACEN2', 'C-ALMACEN1']);
  });

  it('E2: con status trae solo ese estado; null o ausente = todos', async () => {
    const { deps, first, second } = await twoOrders();
    await route(deps, setStatus(distribuidor, { customerId: 'C-ALMACEN2', id: second.id, status: 'ENVIADO' }));
    expect(((await route(deps, allOrders(distribuidor, 'ENVIADO'))) as Order[]).map((o) => o.id)).toEqual([second.id]);
    expect(((await route(deps, allOrders(distribuidor, null))) as Order[]).map((o) => o.id)).toEqual([second.id, first.id]);
    expect(await route(deps, allOrders(distribuidor, 'CANCELADO'))).toEqual([]);
  });

  it('E4 (borde): sin pedidos, lista vacía', async () => {
    expect(await route(makeDeps().deps, allOrders(distribuidor))).toEqual([]);
  });
});

describe('route: setOrderStatus (REQ-011)', () => {
  it('E1/E2/E4: cambia solo el estado y el dueño lo ve', async () => {
    const { deps, first } = await twoOrders();
    const updated = await route(deps, setStatus(distribuidor, { customerId: 'C-ALMACEN1', id: first.id, status: 'EN_PREPARACION' }));
    expect(updated).toEqual({ ...first, status: 'EN_PREPARACION' });
    expect(await route(deps, event(almacen1, 'order', 'Query', { id: first.id }))).toEqual(updated);
  });

  it('E3: el mismo estado otra vez no es error', async () => {
    const { deps, first } = await twoOrders();
    const args = { customerId: 'C-ALMACEN1', id: first.id, status: 'ENVIADO' };
    const once = await route(deps, setStatus(distribuidor, args));
    expect(await route(deps, setStatus(distribuidor, args))).toEqual(once);
  });

  it.each([
    ['id inexistente', { customerId: 'C-ALMACEN1', id: '01J0000000000000000000NONE' }],
    ['customerId de otro almacén', { customerId: 'C-ALMACEN2', id: '01JAAAAAAAAAAAAAAAAAAAAAA1' }],
  ])('E5: %s → ORDER_NOT_FOUND sin cambios', async (_caso, target) => {
    const { deps, saved } = await twoOrders();
    const before = structuredClone([...saved]);
    await expect(route(deps, setStatus(distribuidor, { ...target, status: 'CANCELADO' }))).rejects.toMatchObject({
      name: 'ORDER_NOT_FOUND',
    });
    expect([...saved]).toEqual(before);
  });
});
