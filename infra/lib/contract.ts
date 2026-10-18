import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Kind, parse, type FieldDefinitionNode } from 'graphql';

/** The API's single contract (DEC-005): the infra reads it from spec/contracts/. */
export const SCHEMA_PATH = fileURLToPath(new URL('../../spec/contracts/schema.graphql', import.meta.url));

const ROOT_TYPES = new Set(['Query', 'Mutation']);

function* rootFieldDefs(path: string): Generator<[typeName: string, field: FieldDefinitionNode]> {
  const doc = parse(readFileSync(path, 'utf8'));
  for (const def of doc.definitions) {
    if (
      (def.kind === Kind.OBJECT_TYPE_DEFINITION || def.kind === Kind.OBJECT_TYPE_EXTENSION) &&
      ROOT_TYPES.has(def.name.value)
    ) {
      for (const f of def.fields ?? []) yield [def.name.value, f];
    }
  }
}

/** The contract's root fields as [type, field] pairs; each one gets a resolver on its domain Lambda (DEC-019). */
export function rootFields(path = SCHEMA_PATH): Array<[typeName: string, fieldName: string]> {
  return [...rootFieldDefs(path)].map(([typeName, f]) => [typeName, f.name.value]);
}

/** `@aws_auth(cognito_groups)` groups of each root field, `Type.field` → groups (`null` if none declared, DEC-013). */
export function rootFieldGroups(path = SCHEMA_PATH): Record<string, string[] | null> {
  const out: Record<string, string[] | null> = {};
  for (const [typeName, f] of rootFieldDefs(path)) {
    const auth = f.directives?.find((d) => d.name.value === 'aws_auth');
    const groups = auth?.arguments?.find((a) => a.name.value === 'cognito_groups')?.value;
    out[`${typeName}.${f.name.value}`] =
      groups?.kind === Kind.LIST ? groups.values.flatMap((v) => (v.kind === Kind.STRING ? [v.value] : [])) : null;
  }
  return out;
}
