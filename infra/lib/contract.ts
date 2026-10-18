import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Kind, parse, type FieldDefinitionNode } from 'graphql';

/** Contrato único de la API (DEC-005): la infra lo lee de spec/contracts/. */
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

/** Campos raíz del contrato como pares [tipo, campo]; cada uno recibe un resolver `api`. */
export function rootFields(path = SCHEMA_PATH): Array<[typeName: string, fieldName: string]> {
  return [...rootFieldDefs(path)].map(([typeName, f]) => [typeName, f.name.value]);
}

/** Grupos de `@aws_auth(cognito_groups)` de cada campo raíz, `Tipo.campo` → grupos (`null` si no declara, DEC-013). */
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
