import type { CodegenConfig } from '@graphql-codegen/cli';

// Tipos de GraphQL generados desde el contrato (DEC-002): `npm run codegen`.
// La salida se versiona; scripts/test/codegen.test.ts falla si quedó desactualizada.
const schema = ['spec/contracts/schema.graphql', 'scripts/codegen/appsync.graphql'];

const scalars = {
  ID: 'string',
  AWSDate: 'string',
  AWSTime: 'string',
  AWSDateTime: 'string',
  AWSTimestamp: 'number',
  AWSEmail: 'string',
  AWSJSON: 'string',
  AWSURL: 'string',
  AWSPhone: 'string',
  AWSIPAddress: 'string',
};

const header = { add: { content: '// Generado por `npm run codegen` desde spec/contracts/schema.graphql. No editar.' } };

const config: CodegenConfig = {
  schema,
  overwrite: true,
  generates: {
    // Backend: tipos del esquema (lo que los resolvers devuelven).
    'backend/src/generated/graphql.ts': {
      plugins: [header, 'typescript'],
      config: { scalars, enumsAsTypes: true, avoidOptionals: true, skipTypename: true },
    },
    // App: tipos de cada operación escrita con /* GraphQL */ en app/src. `typescript-operations` (v6) ya
    // emite los inputs y enums que usan; sumarle `typescript` los duplica.
    'app/src/lib/generated/graphql.ts': {
      documents: ['app/src/**/*.{ts,tsx}', '!app/src/lib/generated/**'],
      plugins: [header, 'typescript-operations'],
      config: { scalars, enumsAsTypes: true, avoidOptionals: true, skipTypename: true },
    },
  },
};

export default config;
