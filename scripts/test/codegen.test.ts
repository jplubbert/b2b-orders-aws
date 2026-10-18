import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// DEC-002: the backend and app GraphQL types are generated from spec/contracts/schema.graphql.
const REPO = fileURLToPath(new URL('../../', import.meta.url));

it('the generated types are up to date with the contract (npm run codegen)', () => {
  const r = spawnSync('npx', ['graphql-codegen', '--config', 'codegen.ts', '--check'], { cwd: REPO, encoding: 'utf8' });
  expect(r.status, `${r.stdout}\n${r.stderr}\nRun \`npm run codegen\` and commit the result.`).toBe(0);
});
