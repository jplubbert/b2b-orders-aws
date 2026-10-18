import { defineConfig } from 'vitest/config';

// `npm run test:acceptance`: against the real `dev` (DEC-007). T-03 writes the tests;
// this config lives outside tests/acceptance/ (protected folder). When done, it deletes the orders of the
// throwaway `C-ACEPT-…` customers (T-19).
export default defineConfig({
  test: {
    include: ['tests/acceptance/**/*.test.ts'],
    testTimeout: 20_000,
    fileParallelism: false,
    globalSetup: ['scripts/acceptance-cleanup.ts'],
  },
});
