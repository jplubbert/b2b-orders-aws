/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

// Lee `.env.<stage>` de la raíz (lo escribe `npm run deploy:dev`) y lo pasa a la app vía `extra`.
function readStageEnv(stage: string): Record<string, string> {
  const path = join(__dirname, '..', `.env.${stage}`);
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1], m[2]]),
  );
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const env = readStageEnv(process.env.STAGE ?? 'dev');
  return {
    ...(config as ExpoConfig),
    extra: {
      ...config.extra,
      aws: {
        region: env.AWS_REGION ?? '',
        userPoolId: env.USER_POOL_ID ?? '',
        userPoolClientId: env.USER_POOL_CLIENT_ID ?? '',
        graphqlUrl: env.GRAPHQL_URL ?? '',
      },
    },
  };
};
