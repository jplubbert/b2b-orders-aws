// REQ-002 View catalog — API examples (DEC-007). The on-screen message of E3 is manual (LOG).
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
let oil: Product;

async function listProducts(): Promise<CatalogItem[]> {
  const res = await gql<{ listProducts: CatalogItem[] }>(env, LIST_PRODUCTS, {}, token);
  expect(res.errors).toBeUndefined();
  return res.data!.listProducts;
}

beforeAll(async () => {
  env = stageEnv();
  await sweepProducts(env);
  token = await login(env, SEED_USERS[0]!.email);
  oil = await createProduct(env, {
    name: 'Aceite 900 ml',
    presentation: 'Botella 900 ml',
    unitPrice: 2900,
    active: false,
  });
}, 60_000);

afterAll(async () => {
  if (oil) await deleteProducts(env, [oil.productId]);
});

describe('REQ-002', () => {
  it('E1: lists "Arroz 1 kg" and then "Yerba 1 kg" with presentation and unit price', async () => {
    const products = await listProducts();
    const rice = products.findIndex((p) => p.name === 'Arroz 1 kg');
    const yerba = products.findIndex((p) => p.name === 'Yerba 1 kg');
    expect(rice).toBeGreaterThanOrEqual(0);
    expect(yerba).toBeGreaterThan(rice);
    expect(products[rice]).toMatchObject({ presentation: 'Paquete 1 kg', unitPrice: 1300 });
    expect(products[yerba]).toMatchObject({ presentation: 'Paquete 1 kg', unitPrice: 4500 });
  });

  it('E1 (edge): the whole list is sorted by name', async () => {
    const names = (await listProducts()).map((p) => p.name);
    const collator = new Intl.Collator('es-CL', { sensitivity: 'base', numeric: true });
    expect(names).toEqual([...names].sort(collator.compare));
  });

  it('E2: "Aceite 900 ml" with active=false does not appear', async () => {
    const products = await listProducts();
    expect(products.map((p) => p.productId)).not.toContain(oil.productId);
    expect(products.map((p) => p.name)).not.toContain('Aceite 900 ml');
  });

  it('E3: no active products → empty list', async () => {
    // Deactivates the whole `dev` catalog and restores it as it was (if interrupted: `npm run seed`).
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
