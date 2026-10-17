import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { rootFields } from '../lib/contract.js';
import { PedidosStack } from '../lib/pedidos-stack.js';

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
});
