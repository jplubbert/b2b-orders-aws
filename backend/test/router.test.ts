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
    expect(order).toMatchObject({ id: '01JAAAAAAAAAAAAAAAAAB7XQ2M9Z', number: 'B7XQ2M9Z', status: 'RECIBIDO', total: 15500 });
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
