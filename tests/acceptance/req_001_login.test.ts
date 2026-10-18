// REQ-001 Sign-in — API examples (DEC-007). E1–E3 are UI examples: manual, recorded in LOG.
import { beforeAll, describe, expect, it } from 'vitest';
import type { StageEnv } from '../../scripts/lib/env.ts';
import { gql, stageEnv } from '../lib/api.ts';

const LIST_PRODUCTS = /* GraphQL */ `
  query { listProducts { productId name presentation unitPrice } }
`;

let env: StageEnv;
beforeAll(() => {
  env = stageEnv();
});

describe('REQ-001', () => {
  it('E4: listProducts without an Authorization header → Unauthorized and no data', async () => {
    const res = await gql<{ listProducts: unknown[] }>(env, LIST_PRODUCTS);
    expect(res.data ?? null).toBeNull();
    expect(res.errors?.[0]?.errorType).toMatch(/Unauthorized/);
  });

  it('E4 (edge): invalid token → Unauthorized and no data', async () => {
    const res = await gql<{ listProducts: unknown[] }>(env, LIST_PRODUCTS, {}, 'eyJhbGciOiJub25lIn0.e30.x');
    expect(res.data ?? null).toBeNull();
    expect(res.errors?.[0]?.errorType).toMatch(/Unauthorized/);
  });
});
