import { describe, expect, it } from 'vitest';
import { route, type Deps, type ResolverEvent } from '../src/router.js';

const deps: Deps = {
  catalog: {
    listProducts: async () => [
      { productId: 'yerba', name: 'Yerba 1 kg', presentation: 'Paquete', unitPrice: 4500, active: true },
      { productId: 'arroz', name: 'Arroz 1 kg', presentation: 'Paquete', unitPrice: 1300, active: true },
    ],
  },
};

const event = (claims?: Record<string, unknown>, fieldName = 'listProducts'): ResolverEvent => ({
  info: { parentTypeName: 'Query', fieldName },
  arguments: {},
  identity: claims ? { claims } : null,
});

const almacen1 = { 'custom:customerId': 'C-ALMACEN1', 'cognito:groups': ['almaceneros'] };

describe('route', () => {
  it('listProducts devuelve el catálogo activo ordenado', async () => {
    const out = (await route(deps, event(almacen1))) as { name: string }[];
    expect(out.map((x) => x.name)).toEqual(['Arroz 1 kg', 'Yerba 1 kg']);
  });

  it.each([
    ['sin identidad', undefined],
    ['sin customerId', { 'cognito:groups': ['almaceneros'] }],
    ['fuera del grupo', { 'custom:customerId': 'C-X', 'cognito:groups': ['otros'] }],
  ])('rechaza %s con Unauthorized (DEC-004)', async (_caso, claims) => {
    await expect(route(deps, event(claims))).rejects.toMatchObject({ name: 'Unauthorized' });
  });

  it('falla en un campo sin resolver', async () => {
    await expect(route(deps, event(almacen1, 'nope'))).rejects.toThrow('Campo sin resolver');
  });
});
