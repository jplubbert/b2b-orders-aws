// REQ-002 Ver catálogo — ejemplos de API (DEC-007). El mensaje de E3 en pantalla es manual (LOG).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Product } from '../../backend/src/domain/catalog.ts';
import type { StageEnv } from '../../scripts/lib/env.ts';
import { SEED_USERS } from '../../scripts/lib/seed-data.ts';
import { gql, login, stageEnv } from '../lib/api.ts';
import { catalogItems, createProduct, deleteProducts, putItems, sweepProducts } from './support/fixtures.ts';

const LIST_PRODUCTS = /* GraphQL */ `
  query { listProducts { productId name presentation unitPrice } }
`;
type CatalogItem = Omit<Product, 'active'>;

let env: StageEnv;
let token: string;
let aceite: Product;

async function listProducts(): Promise<CatalogItem[]> {
  const res = await gql<{ listProducts: CatalogItem[] }>(env, LIST_PRODUCTS, {}, token);
  expect(res.errors).toBeUndefined();
  return res.data!.listProducts;
}

beforeAll(async () => {
  env = stageEnv();
  await sweepProducts(env);
  token = await login(env, SEED_USERS[0]!.email);
  aceite = await createProduct(env, {
    name: 'Aceite 900 ml',
    presentation: 'Botella 900 ml',
    unitPrice: 2900,
    active: false,
  });
}, 60_000);

afterAll(async () => {
  if (aceite) await deleteProducts(env, [aceite.productId]);
});

describe('REQ-002', () => {
  it('E1: lista "Arroz 1 kg" y luego "Yerba 1 kg" con presentación y precio unitario', async () => {
    const products = await listProducts();
    const arroz = products.findIndex((p) => p.name === 'Arroz 1 kg');
    const yerba = products.findIndex((p) => p.name === 'Yerba 1 kg');
    expect(arroz).toBeGreaterThanOrEqual(0);
    expect(yerba).toBeGreaterThan(arroz);
    expect(products[arroz]).toMatchObject({ presentation: 'Paquete 1 kg', unitPrice: 1300 });
    expect(products[yerba]).toMatchObject({ presentation: 'Paquete 1 kg', unitPrice: 4500 });
  });

  it('E1 (borde): toda la lista está ordenada por nombre', async () => {
    const names = (await listProducts()).map((p) => p.name);
    const collator = new Intl.Collator('es-CL', { sensitivity: 'base', numeric: true });
    expect(names).toEqual([...names].sort(collator.compare));
  });

  it('E2: "Aceite 900 ml" con active=false no aparece', async () => {
    const products = await listProducts();
    expect(products.map((p) => p.productId)).not.toContain(aceite.productId);
    expect(products.map((p) => p.name)).not.toContain('Aceite 900 ml');
  });

  it('E3: sin productos activos → lista vacía', async () => {
    // Desactiva todo el catálogo de `dev` y lo restaura tal cual (si se interrumpe: `npm run seed`).
    const original = await catalogItems(env);
    try {
      await putItems(
        env,
        original.map((i) => ({ ...i, active: false })),
      );
      expect(await listProducts()).toEqual([]);
    } finally {
      await putItems(env, original);
    }
  }, 60_000);
});
