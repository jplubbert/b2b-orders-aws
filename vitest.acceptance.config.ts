import { defineConfig } from 'vitest/config';

// `npm run test:acceptance`: contra `dev` real (DEC-007). Las pruebas las escribe T-03;
// esta config vive fuera de tests/acceptance/ (carpeta protegida).
export default defineConfig({
  test: {
    include: ['tests/acceptance/**/*.test.ts'],
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
