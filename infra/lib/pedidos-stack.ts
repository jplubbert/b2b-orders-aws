import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { SCHEMA_PATH, rootFields } from './contract.js';

export const CUSTOMER_GROUP = 'almaceneros';
export const DISTRIBUTOR_GROUP = 'distribuidores'; // DEC-013
export const TEST_RUNNER_USER = 'autopilot-tests';

/** DEC-010: the minimum the acceptance fixtures use (and the order:set-status script of DEC-009). */
export const TEST_RUNNER_TABLE_ACTIONS = [
  'dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan', 'dynamodb:PutItem',
  'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:BatchWriteItem',
];
export const TEST_RUNNER_USER_POOL_ACTIONS = [
  'cognito-idp:AdminCreateUser', 'cognito-idp:AdminSetUserPassword', 'cognito-idp:AdminAddUserToGroup',
  'cognito-idp:AdminDeleteUser', 'cognito-idp:ListUsers',
];

export interface PedidosStackProps extends StackProps {
  stage: string;
}

/** `PedidosB2B-<stage>` stack (DEC-001): Cognito + AppSync + `api` Lambda + single table. */
export class PedidosStack extends Stack {
  constructor(scope: Construct, id: string, props: PedidosStackProps) {
    super(scope, id, props);
    const removalPolicy = RemovalPolicy.DESTROY; // R-02: `dev` only

    // DEC-004: email + password, no self sign-up; immutable customerId set by the seed.
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `pedidos-b2b-${props.stage}`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: { email: { required: true, mutable: false } },
      customAttributes: { customerId: new cognito.StringAttribute({ mutable: false }) },
      accountRecovery: cognito.AccountRecovery.NONE,
      removalPolicy,
    });
    const userPoolClient = userPool.addClient('AppClient', {
      authFlows: { userSrp: true, userPassword: true }, // username/password for the app (Expo Go), smoke and acceptance
      generateSecret: false,
      preventUserExistenceErrors: true,
      readAttributes: new cognito.ClientAttributes()
        .withStandardAttributes({ email: true })
        .withCustomAttributes('customerId'),
      writeAttributes: new cognito.ClientAttributes(), // the client cannot write customerId
    });
    new cognito.CfnUserPoolGroup(this, 'AlmacenerosGroup', {
      userPoolId: userPool.userPoolId,
      groupName: CUSTOMER_GROUP,
    });
    // DEC-013: the distributor sees and changes the status of every order; no `custom:customerId` (S-22).
    new cognito.CfnUserPoolGroup(this, 'DistribuidoresGroup', {
      userPoolId: userPool.userPoolId,
      groupName: DISTRIBUTOR_GROUP,
    });

    // DEC-006: single on-demand table.
    const table = new dynamodb.TableV2(this, 'Table', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy,
    });

    // DEC-005: one `api` Lambda for every field.
    const apiFn = new NodejsFunction(this, 'ApiFunction', {
      entry: fileURLToPath(new URL('../../backend/src/handler.ts', import.meta.url)),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(10),
      environment: { TABLE_NAME: table.tableName },
      bundling: { format: OutputFormat.ESM, minify: true, sourceMap: true },
      logGroup: new logs.LogGroup(this, 'ApiLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy,
      }),
    });
    table.grantReadWriteData(apiFn); // includes Scan (allOrders) and UpdateItem (setOrderStatus), DEC-013

    const api = new appsync.GraphqlApi(this, 'Api', {
      name: `pedidos-b2b-${props.stage}`,
      definition: appsync.Definition.fromFile(SCHEMA_PATH),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: { userPool },
        },
      },
    });
    const source = api.addLambdaDataSource('api', apiFn);
    for (const [typeName, fieldName] of rootFields()) {
      source.createResolver(`${typeName}${fieldName}Resolver`, { typeName, fieldName });
    }

    // DEC-010/DEC-015: the autopilot's identity for acceptance and smoke, only on this table and user pool.
    // No keys in the template: they're created separately (`aws iam create-access-key`) and live in the `autopilot` profile.
    if (props.stage === 'dev') {
      const testRunner = new iam.User(this, 'AutopilotTestsUser', { userName: TEST_RUNNER_USER });
      table.grant(testRunner, ...TEST_RUNNER_TABLE_ACTIONS);
      userPool.grant(testRunner, ...TEST_RUNNER_USER_POOL_ACTIONS);
    }

    new CfnOutput(this, 'Region', { value: this.region });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, 'GraphqlUrl', { value: api.graphqlUrl });
    new CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
