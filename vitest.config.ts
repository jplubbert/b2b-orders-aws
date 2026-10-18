import { defineConfig } from 'vitest/config';

// `npm test`: unit tests without AWS (DEC-007). Smoke and acceptance have their own config.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'backend', root: './backend', include: ['test/**/*.test.ts'] } },
      // Only the app's pure logic (no React Native); components (*.test.tsx) run with jest-expo
      // (`npm test -w app`, which `npm test` runs afterwards).
      { test: { name: 'app', root: './app', include: ['test/**/*.test.ts'] } },
      { test: { name: 'scripts', root: './scripts', include: ['test/**/*.test.ts'], testTimeout: 30_000 } },
      { test: { name: 'infra', root: './infra', include: ['test/**/*.test.ts'], testTimeout: 60_000 } },
    ],
  },
});
