// T-01 smoke test: the app end to end without UI (Cognito → AppSync → Lambda → DynamoDB).
import { beforeAll, describe, expect, it } from 'vitest';
import { SEED_PRODUCTS, SEED_USERS } from '../../scripts/lib/seed-data.ts';
import { gql, login, stageEnv } from '../lib/api.ts';
import type { StageEnv } from '../../scripts/lib/env.ts';

const LIST_PRODUCTS = /* GraphQL */ `
  query { listProducts { productId name presentation unitPrice } }
`;

type ListProducts = { listProducts: Array<{ productId: string; name: string; unitPrice: number }> };

let env: StageEnv;
beforeAll(() => {
  env = stageEnv();
});

describe('smoke dev', () => {
  it('almacen1 signs in and listProducts returns the seeded products', async () => {
    const token = await login(env, SEED_USERS[0]!.email);
    const t0 = performance.now();
    const first = await gql<ListProducts>(env, LIST_PRODUCTS, {}, token);
    const t1 = performance.now();
    await gql<ListProducts>(env, LIST_PRODUCTS, {}, token);
    const t2 = performance.now();
    console.log(`listProducts latency: first ${Math.round(t1 - t0)} ms, next ${Math.round(t2 - t1)} ms`);

    expect(first.errors).toBeUndefined();
    const names = first.data!.listProducts.map((p) => p.name);
    for (const p of SEED_PRODUCTS) expect(names).toContain(p.name);
    const arroz = first.data!.listProducts.find((p) => p.productId === 'arroz-1kg');
    expect(arroz?.unitPrice).toBe(1300);
  });

  it('no token → Unauthorized and no data', async () => {
    const res = await gql<ListProducts>(env, LIST_PRODUCTS);
    expect(res.data ?? null).toBeNull();
    expect(res.errors?.[0]?.errorType).toMatch(/Unauthorized/);
  });
});
