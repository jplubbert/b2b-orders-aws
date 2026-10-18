// Turns the CDK outputs into `.env.<stage>` (outside git), keeping DEMO_PASSWORD.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ROOT, envPath, readEnvFile, writeEnvFile } from './lib/env.ts';

const stage = process.argv[2] ?? 'dev';
const outputs = JSON.parse(readFileSync(`${ROOT}cdk-outputs.json`, 'utf8')) as Record<string, Record<string, string>>;
const stack = outputs[`PedidosB2B-${stage}`];
if (!stack) throw new Error(`cdk-outputs.json has no PedidosB2B-${stage} stack`);

const previous = readEnvFile(stage);
writeEnvFile(
  {
    AWS_REGION: stack.Region,
    USER_POOL_ID: stack.UserPoolId,
    USER_POOL_CLIENT_ID: stack.UserPoolClientId,
    GRAPHQL_URL: stack.GraphqlUrl,
    TABLE_NAME: stack.TableName,
    // Meets Cognito's default policy: uppercase, lowercase, digit and symbol.
    DEMO_PASSWORD: previous.DEMO_PASSWORD ?? `Demo-${randomBytes(9).toString('base64url')}a1A!`,
  },
  stage,
);
console.log(`Wrote ${envPath(stage)}`);
