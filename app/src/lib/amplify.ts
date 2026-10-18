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

/** Configures Amplify v6 as a client library (DEC-003) with the resources from `.env.dev`. */
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
          // Amplify sends the access token by default; `custom:customerId` only travels in the
          // ID token (DEC-004). These headers are applied afterwards and replace it.
          headers: async () => {
            const idToken = (await fetchAuthSession()).tokens?.idToken?.toString();
            return idToken ? { Authorization: idToken } : {};
          },
        },
      },
    },
  );
}
