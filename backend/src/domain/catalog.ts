/** Producto del catálogo; `unitPrice` en pesos CLP enteros (DEC-006). */
export interface Product {
  productId: string;
  name: string;
  presentation: string;
  unitPrice: number;
  active: boolean;
}

export type CatalogItem = Omit<Product, 'active'>;

const byName = new Intl.Collator('es-CL', { sensitivity: 'base', numeric: true });

/** Productos activos ordenados por nombre (REQ-002). */
export function activeCatalog(products: readonly Product[]): CatalogItem[] {
  return products
    .filter((p) => p.active)
    .sort((a, b) => byName.compare(a.name, b.name))
    .map(({ active: _active, ...item }) => item);
}
