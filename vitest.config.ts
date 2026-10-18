import { defineConfig } from 'vitest/config';

// `npm test`: unitarias sin AWS (DEC-007). Humo y aceptación tienen su propia config.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'backend', root: './backend', include: ['test/**/*.test.ts'] } },
      // Solo lógica pura de la app (sin React Native); los componentes llegan con jest-expo (T-07).
      { test: { name: 'app', root: './app', include: ['test/**/*.test.ts'] } },
      { test: { name: 'scripts', root: './scripts', include: ['test/**/*.test.ts'], testTimeout: 30_000 } },
      { test: { name: 'infra', root: './infra', include: ['test/**/*.test.ts'], testTimeout: 60_000 } },
    ],
  },
});
