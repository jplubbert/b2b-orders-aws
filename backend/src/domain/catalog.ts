import type { Product as CatalogItem } from '../generated/graphql.js';

export type { CatalogItem };

/** Producto guardado: el `Product` del contrato (DEC-002) más `active`; `unitPrice` en pesos CLP enteros (DEC-006). */
export type Product = CatalogItem & { active: boolean };

const byName = new Intl.Collator('es-CL', { sensitivity: 'base', numeric: true });

/** Productos activos ordenados por nombre (REQ-002). */
export function activeCatalog(products: readonly Product[]): CatalogItem[] {
  return products
    .filter((p) => p.active)
    .sort((a, b) => byName.compare(a.name, b.name))
    .map(({ active: _active, ...item }) => item);
}
