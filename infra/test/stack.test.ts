import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { rootFieldGroups, rootFields } from '../lib/contract.js';
import {
  PedidosStack,
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

describe('PedidosStack', () => {
  it('DEC-005: cada campo raíz del contrato usa la fuente de datos `api`', () => {
    const fields = rootFields();
    expect(fields).toContainEqual(['Query', 'listProducts']);
    expect(fields).toContainEqual(['Mutation', 'createOrder']);
    const resolvers = template.findResources('AWS::AppSync::Resolver');
    expect(Object.keys(resolvers)).toHaveLength(fields.length);
    for (const [typeName, fieldName] of fields) {
      template.hasResourceProperties('AWS::AppSync::Resolver', {
        TypeName: typeName,
        FieldName: fieldName,
        DataSourceName: 'api',
      });
    }
    template.hasResourceProperties('AWS::AppSync::DataSource', { Name: 'api', Type: 'AWS_LAMBDA' });
  });

  it('DEC-004: user pool sin auto-registro, grupo almaceneros y AppSync con user pool', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      Schema: Match.arrayWith([Match.objectLike({ Name: 'customerId', Mutable: false })]),
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: 'almaceneros' });
    template.hasResourceProperties('AWS::AppSync::GraphQLApi', { AuthenticationType: 'AMAZON_COGNITO_USER_POOLS' });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', { WriteAttributes: [] });
  });

  it('DEC-013: grupo distribuidores y cada campo raíz autorizado solo para su grupo', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolGroup', { GroupName: 'distribuidores' });
    expect(rootFieldGroups()).toEqual({
      'Query.listProducts': ['almaceneros'],
      'Query.myOrders': ['almaceneros'],
      'Query.order': ['almaceneros'],
      'Query.allOrders': ['distribuidores'],
      'Mutation.createOrder': ['almaceneros'],
      'Mutation.setOrderStatus': ['distribuidores'],
    });
  });

  it('DEC-013: la Lambda api puede hacer Scan y UpdateItem sobre la tabla', () => {
    const fnRole = Object.keys(template.findResources('AWS::IAM::Role')).find((id) => id.startsWith('ApiFunction'));
    const policies = Object.values(template.findResources('AWS::IAM::Policy')).filter((p) =>
      JSON.stringify(p.Properties.Roles ?? []).includes(fnRole!),
    );
    const actions = policies.flatMap((p) =>
      (p.Properties.PolicyDocument.Statement as Array<{ Action: string | string[] }>).flatMap((s) => [s.Action].flat()),
    );
    expect(actions).toEqual(expect.arrayContaining(['dynamodb:Scan', 'dynamodb:UpdateItem']));
  });

  it('DEC-006: tabla única PK/SK on-demand', () => {
    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
    });
  });

  it('DEC-005: Lambda api en Node.js 24 con TABLE_NAME', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs24.x',
      Environment: { Variables: { TABLE_NAME: Match.anyValue() } },
    });
  });

  it('expone las salidas que usa scripts/write-env.ts', () => {
    const outputs = Object.keys(template.toJSON().Outputs ?? {});
    expect(outputs).toEqual(expect.arrayContaining(['Region', 'UserPoolId', 'UserPoolClientId', 'GraphqlUrl', 'TableName']));
  });

  it('DEC-010: sin usuario de pruebas fuera de dev', () => {
    template.resourceCountIs('AWS::IAM::User', 0);
  });
});

describe('PedidosStack dev: usuario autopilot-tests (DEC-010, DEC-015)', () => {
  let dev: Template;
  beforeAll(() => {
    dev = Template.fromStack(new PedidosStack(new App(), 'PedidosB2B-dev', { stage: 'dev', env: { region: 'us-east-1' } }));
  });

  it('existe, sin llaves de acceso ni login de consola en la plantilla', () => {
    dev.hasResourceProperties('AWS::IAM::User', { UserName: TEST_RUNNER_USER });
    dev.resourceCountIs('AWS::IAM::AccessKey', 0);
    expect(dev.findResources('AWS::IAM::User', { Properties: { LoginProfile: Match.anyValue() } })).toEqual({});
  });

  it('solo tiene las acciones de datos de la tabla y de admin del user pool, sobre esos recursos', () => {
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
