import { defineConfig } from 'vitest/config';

// `npm test`: unitarias sin AWS (DEC-007). Humo y aceptación tienen su propia config.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'backend', root: './backend', include: ['test/**/*.test.ts'] } },
      { test: { name: 'infra', root: './infra', include: ['test/**/*.test.ts'], testTimeout: 60_000 } },
    ],
  },
});
