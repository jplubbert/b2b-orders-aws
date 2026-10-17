import Constants from 'expo-constants';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';

interface AwsExtra {
  region: string;
  userPoolId: string;
  userPoolClientId: string;
  graphqlUrl: string;
}

const aws = Constants.expoConfig?.extra?.aws as AwsExtra | undefined;

export const isConfigured = Boolean(aws?.userPoolId && aws.userPoolClientId && aws.graphqlUrl);

/** Configura Amplify v6 como librería cliente (DEC-003) con los recursos de `.env.dev`. */
export function configureAmplify(): void {
  if (!aws || !isConfigured) return;
  Amplify.configure(
    {
      Auth: { Cognito: { userPoolId: aws.userPoolId, userPoolClientId: aws.userPoolClientId } },
      API: { GraphQL: { endpoint: aws.graphqlUrl, region: aws.region, defaultAuthMode: 'userPool' } },
    },
    {
      API: {
        GraphQL: {
          // Amplify envía el access token por defecto; `custom:customerId` solo viaja en el
          // ID token (DEC-004). Estas cabeceras se aplican después y lo reemplazan.
          headers: async () => {
            const idToken = (await fetchAuthSession()).tokens?.idToken?.toString();
            return idToken ? { Authorization: idToken } : {};
          },
        },
      },
    },
  );
}
