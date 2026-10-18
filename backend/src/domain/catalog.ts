import type { Product as CatalogItem } from '../generated/graphql.js';

export type { CatalogItem };

/** Stored product: the contract's `Product` (DEC-002) plus `active`; `unitPrice` in whole CLP pesos (DEC-006). */
export type Product = CatalogItem & { active: boolean };

const byName = new Intl.Collator('es-CL', { sensitivity: 'base', numeric: true });

/** Active products sorted by name (REQ-002). */
export function activeCatalog(products: readonly Product[]): CatalogItem[] {
  return products
    .filter((p) => p.active)
    .sort((a, b) => byName.compare(a.name, b.name))
    .map(({ active: _active, ...item }) => item);
}
