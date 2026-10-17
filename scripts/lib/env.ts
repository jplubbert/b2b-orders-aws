import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const envPath = (stage = 'dev') => `${ROOT}.env.${stage}`;

/** Variables que escribe `npm run deploy:dev` (fuera de git). */
export interface StageEnv {
  AWS_REGION: string;
  USER_POOL_ID: string;
  USER_POOL_CLIENT_ID: string;
  GRAPHQL_URL: string;
  TABLE_NAME: string;
  DEMO_PASSWORD: string;
}

export function readEnvFile(stage = 'dev'): Partial<StageEnv> {
  const path = envPath(stage);
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

export function writeEnvFile(values: Partial<StageEnv>, stage = 'dev'): void {
  const body = Object.entries(values)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  writeFileSync(envPath(stage), `${body}\n`, { mode: 0o600 });
}

export function loadStageEnv(stage = 'dev'): StageEnv {
  const env = { ...readEnvFile(stage), ...pick(process.env) };
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`Faltan ${missing.join(', ')} en ${envPath(stage)}; ejecuta \`npm run deploy:${stage}\`.`);
  }
  return env as StageEnv;
}

const REQUIRED: Array<keyof StageEnv> = [
  'AWS_REGION',
  'USER_POOL_ID',
  'USER_POOL_CLIENT_ID',
  'GRAPHQL_URL',
  'TABLE_NAME',
  'DEMO_PASSWORD',
];

function pick(src: NodeJS.ProcessEnv): Partial<StageEnv> {
  const out: Partial<StageEnv> = {};
  for (const k of REQUIRED) if (src[k]) out[k] = src[k];
  return out;
}
