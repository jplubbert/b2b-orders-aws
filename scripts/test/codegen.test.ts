import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// DEC-002: los tipos de GraphQL de backend y app se generan desde spec/contracts/schema.graphql.
const REPO = fileURLToPath(new URL('../../', import.meta.url));

it('los tipos generados están al día con el contrato (npm run codegen)', () => {
  const r = spawnSync('npx', ['graphql-codegen', '--config', 'codegen.ts', '--check'], { cwd: REPO, encoding: 'utf8' });
  expect(r.status, `${r.stdout}\n${r.stderr}\nCorre \`npm run codegen\` y versiona el resultado.`).toBe(0);
});
