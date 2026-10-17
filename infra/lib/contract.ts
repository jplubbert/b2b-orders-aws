import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Kind, parse } from 'graphql';

/** Contrato único de la API (DEC-005): la infra lo lee de spec/contracts/. */
export const SCHEMA_PATH = fileURLToPath(new URL('../../spec/contracts/schema.graphql', import.meta.url));

const ROOT_TYPES = new Set(['Query', 'Mutation']);

/** Campos raíz del contrato como pares [tipo, campo]; cada uno recibe un resolver `api`. */
export function rootFields(path = SCHEMA_PATH): Array<[typeName: string, fieldName: string]> {
  const doc = parse(readFileSync(path, 'utf8'));
  const fields: Array<[string, string]> = [];
  for (const def of doc.definitions) {
    if (
      (def.kind === Kind.OBJECT_TYPE_DEFINITION || def.kind === Kind.OBJECT_TYPE_EXTENSION) &&
      ROOT_TYPES.has(def.name.value)
    ) {
      for (const f of def.fields ?? []) fields.push([def.name.value, f.name.value]);
    }
  }
  return fields;
}
