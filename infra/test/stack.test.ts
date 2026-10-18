import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { DOMAINS, PUBLISHING_DOMAINS, type Domain } from '../../backend/src/domains.js';
import { rootFieldGroups, rootFields } from '../lib/contract.js';
import {
  DOMAIN_TABLE_ACTIONS,
  FUNCTION_TIMEOUT_SECONDS,
  HISTORY_FUNCTION_ID,
  HISTORY_TABLE_ACTIONS,
  PedidosStack,
  domainFunctionId,
  TEST_RUNNER_TABLE_ACTIONS,
  TEST_RUNNER_USER,
  TEST_RUNNER_USER_POOL_ACTIONS,
} from '../lib/pedidos-stack.js';

let template: Template;

beforeAll(() => {
  const app = new App();
  const stack = new PedidosStack(app, 'PedidosB2B-test', { stage: 'test', env: { region: 'us-east-1' } });
  template = Template.fromStack(stack);
});

type Statement = { Action: string | string[]; Resource: unknown; Effect: string; Condition?: unknown };

// Statements of every policy attached to the role of the Lambda whose construct id is `fnId`.
function fnStatements(t: Template, fnId: string): Statement[] {
  const fnRole = Object.keys(t.findResources('AWS::IAM::Role')).find((id) => id.startsWith(fnId));
  expect(fnRole).toBeDefined();
  return Object.values(t.findResources('AWS::IAM::Policy'))
    .filter((p) => JSON.stringify(p.Properties.Roles ?? []).includes(fnRole!))
    .flatMap((p) => p.Properties.PolicyDocument.Statement as Statement[]);
}

const roleStatements = (t: Template, domain: Domain) => fnStatements(t, domainFunctionId(domain));
const isOn = (s: Statement, logicalIdPrefix: string) => JSON.stringify(s.Resource).includes(logicalIdPrefix);
const actionsOf = (statements: Statement[]) => statements.flatMap((s) => [s.Action].flat()).sort();

// Logical id of the only resource of `type` whose id starts with `prefix`.
function logicalId(t: Template, type: string, prefix: string): string {
  const ids = Object.keys(t.findResources(type)).filter((id) => id.startsWith(prefix));
  expect(ids).toHaveLength(1);
  return ids[0]!;
}

describe('PedidosStack', () => {
  it('DEC-019: each root field of the contract uses the data source of its domain Lambda', () => {
    const fields = rootFields();
    expect(fields).toHaveLength(7);
    const resolvers = template.findResources('AWS::AppSync::Resolver');
    expect(Object.keys(resolvers)).toHaveLength(fields.length);
    const expected: Record<string, string> = {
      'Query.listProducts': 'catalog',
      'Query.myOrders': 'orders',
      'Query.order': 'orders',
      'Query.orderHistory': 'orders', // S-29, DEC-019
      'Mutation.createOrder': 'orders',
      'Query.allOrders': 'distributor',
      'Mutation.setOrderStatus': 'distributor',
    };
    for (const [typeName, fieldName] of fields) {
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: typeName,
        FieldName: fieldName,
        DataSourceName: expected[`${typeName}.${fieldName}`],
      });
    }
    const sources = Object.values(template.findResources('AWS::AppSync::DataSource'));
    expect(sources.map((s) => s.Properties.Name).sort()).toEqual(['catalog', 'distributor', 'orders']);
    for (const s of sources) {
      expect(s.Properties.Type).toBe('AWS_LAMBDA');
      expect(JSON.stringify(s.Properties.LambdaConfig)).toContain(domainFunctionId(s.Properties.Name));
    }
  });

  it('DEC-019/DEC-020: three API Lambdas, one per domain handler, plus the history Lambda', () => {
    template.resourceCountIs('AWS::Lambda::Function', 4);
    for (const domain of DOMAINS) logicalId(template, 'AWS::Lambda::Function', domainFunctionId(domain));
    logicalId(template, 'AWS::Lambda::Function', HISTORY_FUNCTION_ID);
  });

  it.each(DOMAINS)('DEC-019: the %s Lambda has exactly its table actions, on the table, without "*"', (domain) => {
    const statements = roleStatements(template, domain).filter((s) => isOn(s, 'Table'));
    expect(actionsOf(statements)).toEqual([...DOMAIN_TABLE_ACTIONS[domain]].sort());
    for (const s of statements) {
      expect(s.Effect).toBe('Allow');
      expect(JSON.stringify(s.Resource)).not.toContain('"*"');
      expect(JSON.stringify(s.Resource)).toMatch(/Table/);
      expect(JSON.stringify(s.Resource)).not.toMatch(/index/);
    }
  });

  it('DEC-019: the catalog Lambda reaches only the CATALOG partition; the action sets are the approved ones', () => {
    const [catalog] = roleStatements(template, 'catalog');
    expect(catalog!.Condition).toEqual({ 'ForAllValues:StringEquals': { 'dynamodb:LeadingKeys': ['CATALOG'] } });
    expect(DOMAIN_TABLE_ACTIONS).toEqual({
      catalog: ['dynamodb:GetItem', 'dynamodb:Query'],
      orders: ['dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:GetItem'],
      distributor: ['dynamodb:Scan', 'dynamodb:UpdateItem'],
    });
  });

  it('DEC-004: user pool without self sign-up, almaceneros group and AppSync with user pool', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      Schema: Match.arrayWith([Match.objectLike({ Name: 'customerId', Mutable: false })]),
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: 'almaceneros' });
    template.hasResourceProperties('AWS::AppSync::GraphQLApi', { AuthenticationType: 'AMAZON_COGNITO_USER_POOLS' });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', { WriteAttributes: [] });
  });

  it('DEC-013: distribuidores group and every root field authorized only for its group', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: 'distribuidores' });
    expect(rootFieldGroups()).toEqual({
      'Query.listProducts': ['almaceneros'],
      'Query.myOrders': ['almaceneros'],
      'Query.order': ['almaceneros'],
      'Query.allOrders': ['distribuidores'],
      'Query.orderHistory': ['almaceneros', 'distribuidores'], // S-29
      'Mutation.createOrder': ['almaceneros'],
      'Mutation.setOrderStatus': ['distribuidores'],
    });
  });

  it('DEC-006: single PK/SK on-demand table', () => {
    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
    });
  });

  it('DEC-019: every backend Lambda on Node.js 24 with TABLE_NAME', () => {
    const fns = template.findResources('AWS::Lambda::Function', {
      Properties: { Runtime: 'nodejs24.x', Environment: { Variables: { TABLE_NAME: Match.anyValue() } } },
    });
    expect(Object.keys(fns)).toHaveLength(4);
  });

  it('exposes the outputs scripts/write-env.ts uses', () => {
    const outputs = Object.keys(template.toJSON().Outputs ?? {});
    expect(outputs).toEqual(expect.arrayContaining(['Region', 'UserPoolId', 'UserPoolClientId', 'GraphqlUrl', 'TableName']));
  });

  it('DEC-010: no test user outside dev', () => {
    template.resourceCountIs('AWS::IAM::User', 0);
  });
});

describe('PedidosStack: order events (DEC-020, REQ-012)', () => {
  it('one standard topic, subscribed by the history queue with raw delivery', () => {
    template.resourceCountIs('AWS::SNS::Topic', 1);
    template.hasResourceProperties('AWS::SNS::Topic', { TopicName: 'pedidos-b2b-test-order-events' });
    expect(template.findResources('AWS::SNS::Topic', { Properties: { FifoTopic: true } })).toEqual({});
    template.resourceCountIs('AWS::SNS::Subscription', 1);
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'sqs',
      RawMessageDelivery: true,
      TopicArn: { Ref: logicalId(template, 'AWS::SNS::Topic', 'OrderEvents') },
      Endpoint: { 'Fn::GetAtt': [logicalId(template, 'AWS::SQS::Queue', 'OrderHistoryQueue'), 'Arn'] },
    });
  });

  it('E6: the queue sends a message to the DLQ after 3 receives; the DLQ keeps it 14 days', () => {
    template.resourceCountIs('AWS::SQS::Queue', 2);
    const dlq = logicalId(template, 'AWS::SQS::Queue', 'OrderHistoryDlq');
    template.hasResourceProperties('AWS::SQS::Queue', {
      RedrivePolicy: { deadLetterTargetArn: { 'Fn::GetAtt': [dlq, 'Arn'] }, maxReceiveCount: 3 },
      VisibilityTimeout: 6 * FUNCTION_TIMEOUT_SECONDS,
    });
    expect(template.findResources('AWS::SQS::Queue')[dlq]!.Properties).toMatchObject({ MessageRetentionPeriod: 14 * 24 * 3600 });
    expect(template.findResources('AWS::SQS::Queue', { Properties: { FifoQueue: true } })).toEqual({});
  });

  it('only SNS can send to the queue, and only from the order events topic', () => {
    template.resourceCountIs('AWS::SQS::QueuePolicy', 1);
    template.hasResourceProperties('AWS::SQS::QueuePolicy', {
      PolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: 'sqs:SendMessage',
            Principal: { Service: 'sns.amazonaws.com' },
            Condition: { ArnEquals: { 'aws:SourceArn': { Ref: logicalId(template, 'AWS::SNS::Topic', 'OrderEvents') } } },
          }),
        ],
      },
    });
  });

  it('the history Lambda reads the queue in batches and reports each failed message', () => {
    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      EventSourceArn: { 'Fn::GetAtt': [logicalId(template, 'AWS::SQS::Queue', 'OrderHistoryQueue'), 'Arn'] },
      FunctionName: { Ref: logicalId(template, 'AWS::Lambda::Function', HISTORY_FUNCTION_ID) },
      BatchSize: 10,
      FunctionResponseTypes: ['ReportBatchItemFailures'],
    });
  });

  it('the history Lambda only puts items in HISTORY#… partitions and only consumes its queue', () => {
    const statements = fnStatements(template, HISTORY_FUNCTION_ID);
    const table = statements.filter((s) => isOn(s, 'Table'));
    expect(actionsOf(table)).toEqual(HISTORY_TABLE_ACTIONS);
    expect(table[0]!.Condition).toEqual({ 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': ['HISTORY#*'] } });
    const queue = statements.filter((s) => !isOn(s, 'Table'));
    expect(queue.every((s) => isOn(s, 'OrderHistoryQueue') && !isOn(s, 'OrderHistoryDlq'))).toBe(true);
    expect(actionsOf(queue)).toEqual(
      ['sqs:ChangeMessageVisibility', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes', 'sqs:GetQueueUrl', 'sqs:ReceiveMessage'].sort(),
    );
    for (const s of statements) expect(JSON.stringify(s.Resource)).not.toContain('"*"');
  });

  it.each(DOMAINS)('the %s Lambda can publish to the topic only if it publishes order events', (domain) => {
    const publishes = PUBLISHING_DOMAINS.includes(domain);
    const others = roleStatements(template, domain).filter((s) => !isOn(s, 'Table'));
    expect(actionsOf(others)).toEqual(publishes ? ['sns:Publish'] : []);
    for (const s of others) expect(s.Resource).toEqual({ Ref: logicalId(template, 'AWS::SNS::Topic', 'OrderEvents') });
    const fn = template.findResources('AWS::Lambda::Function')[logicalId(template, 'AWS::Lambda::Function', domainFunctionId(domain))]!;
    expect(Object.keys(fn.Properties.Environment.Variables).sort()).toEqual(
      publishes ? ['TABLE_NAME', 'TOPIC_ARN'] : ['TABLE_NAME'],
    );
  });

  it('DEC-020: orders and distributor are the publishers', () => {
    expect([...PUBLISHING_DOMAINS].sort()).toEqual(['distributor', 'orders']);
  });
});

describe('PedidosStack dev: autopilot-tests user (DEC-010, DEC-015)', () => {
  let dev: Template;
  beforeAll(() => {
    dev = Template.fromStack(new PedidosStack(new App(), 'PedidosB2B-dev', { stage: 'dev', env: { region: 'us-east-1' } }));
  });

  it('exists, with no access keys or console login in the template', () => {
    dev.hasResourceProperties('AWS::IAM::User', { UserName: TEST_RUNNER_USER });
    dev.resourceCountIs('AWS::IAM::AccessKey', 0);
    expect(dev.findResources('AWS::IAM::User', { Properties: { LoginProfile: Match.anyValue() } })).toEqual({});
  });

  it('has only the table data actions and user pool admin actions, on those resources', () => {
    const policies = Object.values(dev.findResources('AWS::IAM::Policy')).filter((p) =>
      JSON.stringify(p.Properties.Users ?? []).includes('AutopilotTestsUser'),
    );
    expect(policies).toHaveLength(1);
    const statements = policies[0]!.Properties.PolicyDocument.Statement as Array<{
      Action: string | string[];
      Resource: unknown;
      Effect: string;
    }>;
    const actions = statements.flatMap((s) => [s.Action].flat()).sort();
    expect(actions).toEqual([...TEST_RUNNER_TABLE_ACTIONS, ...TEST_RUNNER_USER_POOL_ACTIONS].sort());
    for (const s of statements) {
      expect(s.Effect).toBe('Allow');
      const resources = JSON.stringify(s.Resource);
      expect(resources).not.toContain('"*"');
      expect(resources).toMatch(/Table|UserPool/);
    }
  });
});
