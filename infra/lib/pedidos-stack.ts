import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import { CATALOG_PK, HISTORY_PK_PREFIX } from '../../backend/src/data/keys.js';
import { DOMAINS, DOMAIN_FIELDS, PUBLISHING_DOMAINS, type Domain } from '../../backend/src/domains.js';
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

/**
 * DEC-019: exact table actions of each domain Lambda. `catalog` only reads the `CATALOG` partition;
 * `orders` writes and reads its customer's partition and reads the catalog; `distributor` scans and changes status.
 */
export const DOMAIN_TABLE_ACTIONS: Record<Domain, string[]> = {
  catalog: ['dynamodb:GetItem', 'dynamodb:Query'],
  orders: ['dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:GetItem'],
  distributor: ['dynamodb:Scan', 'dynamodb:UpdateItem'],
};

/** Construct id prefix and AppSync data source name of each domain Lambda. */
export const domainFunctionId = (domain: Domain) => `${domain[0]!.toUpperCase()}${domain.slice(1)}Function`;

/** DEC-020: the history Lambda only writes events, and only in `HISTORY#…` partitions. */
export const HISTORY_FUNCTION_ID = 'OrderHistoryFunction';
export const HISTORY_TABLE_ACTIONS = ['dynamodb:PutItem'];
/** Timeout of every backend Lambda; the history queue's visibility is 6× this (DEC-020). */
export const FUNCTION_TIMEOUT_SECONDS = 10;
/** DEC-020: tries before a message goes to the DLQ, and how long the DLQ keeps it. */
export const HISTORY_MAX_RECEIVE_COUNT = 3;
export const HISTORY_DLQ_RETENTION_DAYS = 14;

export interface PedidosStackProps extends StackProps {
  stage: string;
}

/** `PedidosB2B-<stage>` stack (DEC-001): Cognito + AppSync + one Lambda per domain (DEC-019) + single table + order events (DEC-020). */
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

    const backendFunction = (id: string, handlerFile: string, environment: Record<string, string>) =>
      new NodejsFunction(this, id, {
        entry: fileURLToPath(new URL(`../../backend/src/handlers/${handlerFile}.ts`, import.meta.url)),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 512,
        timeout: Duration.seconds(FUNCTION_TIMEOUT_SECONDS),
        environment,
        bundling: { format: OutputFormat.ESM, minify: true, sourceMap: true },
        logGroup: new logs.LogGroup(this, `${id}Logs`, {
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy,
        }),
      });

    // DEC-020: standard topic → standard queue (raw delivery) with DLQ → history Lambda.
    const topic = new sns.Topic(this, 'OrderEvents', { topicName: `pedidos-b2b-${props.stage}-order-events` });
    const deadLetters = new sqs.Queue(this, 'OrderHistoryDlq', {
      retentionPeriod: Duration.days(HISTORY_DLQ_RETENTION_DAYS),
      removalPolicy,
    });
    const queue = new sqs.Queue(this, 'OrderHistoryQueue', {
      visibilityTimeout: Duration.seconds(6 * FUNCTION_TIMEOUT_SECONDS),
      deadLetterQueue: { queue: deadLetters, maxReceiveCount: HISTORY_MAX_RECEIVE_COUNT },
      removalPolicy,
    });
    topic.addSubscription(new subscriptions.SqsSubscription(queue, { rawMessageDelivery: true }));
    const historyFn = backendFunction(HISTORY_FUNCTION_ID, 'orderHistory', { TABLE_NAME: table.tableName });
    historyFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: HISTORY_TABLE_ACTIONS,
        resources: [table.tableArn],
        conditions: { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': [`${HISTORY_PK_PREFIX}*`] } },
      }),
    );
    historyFn.addEventSource(new SqsEventSource(queue, { batchSize: 10, reportBatchItemFailures: true }));

    // DEC-019: one Lambda per domain, each with only its own table actions.
    const functions = {} as Record<Domain, NodejsFunction>;
    for (const domain of DOMAINS) {
      const id = domainFunctionId(domain);
      const publishes = PUBLISHING_DOMAINS.includes(domain);
      const fn = backendFunction(id, domain, {
        TABLE_NAME: table.tableName,
        ...(publishes ? { TOPIC_ARN: topic.topicArn } : {}),
      });
      if (publishes) topic.grantPublish(fn);
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: DOMAIN_TABLE_ACTIONS[domain],
          resources: [table.tableArn],
          // The catalog Lambda can't read orders: only keys whose partition is CATALOG.
          ...(domain === 'catalog'
            ? { conditions: { 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': [CATALOG_PK] } } }
            : {}),
        }),
      );
      functions[domain] = fn;
    }

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
    const sources = Object.fromEntries(
      DOMAINS.map((domain) => [domain, api.addLambdaDataSource(domain, functions[domain])]),
    ) as Record<Domain, appsync.LambdaDataSource>;
    for (const [typeName, fieldName] of rootFields()) {
      const key = `${typeName}.${fieldName}`;
      const domain = DOMAINS.find((d) => (DOMAIN_FIELDS[d] as readonly string[]).includes(key));
      if (!domain) throw new Error(`Contract field without a domain Lambda (DEC-019): ${key}`);
      sources[domain].createResolver(`${typeName}${fieldName}Resolver`, { typeName, fieldName });
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
