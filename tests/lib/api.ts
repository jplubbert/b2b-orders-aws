// Minimal client for the deployed API: Cognito login (USER_PASSWORD_AUTH) + GraphQL POST.
import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';
import { loadStageEnv, type StageEnv } from '../../scripts/lib/env.ts';

export interface GraphqlResponse<T> {
  data?: T | null;
  errors?: Array<{ errorType?: string; message: string }>;
}

export function stageEnv(): StageEnv {
  return loadStageEnv(process.env.STAGE ?? 'dev');
}

/** Returns the ID token: it's the one that carries `custom:customerId` (DEC-004). */
export async function login(env: StageEnv, email: string, password = env.DEMO_PASSWORD): Promise<string> {
  const idp = new CognitoIdentityProviderClient({ region: env.AWS_REGION });
  const out = await idp.send(
    new InitiateAuthCommand({
      ClientId: env.USER_POOL_CLIENT_ID,
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  );
  const token = out.AuthenticationResult?.IdToken;
  if (!token) throw new Error(`Login returned no IdToken for ${email}`);
  return token;
}

export async function gql<T>(
  env: StageEnv,
  query: string,
  variables: Record<string, unknown> = {},
  token?: string,
): Promise<GraphqlResponse<T>> {
  const res = await fetch(env.GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: token } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  return (await res.json()) as GraphqlResponse<T>;
}
