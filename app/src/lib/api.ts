import { generateClient } from 'aws-amplify/api';
import type { ListProductsQuery, Product } from './generated/graphql';

// Tipos generados desde spec/contracts/schema.graphql (DEC-002): `npm run codegen` tras cambiar el contrato o una consulta.
export type { Product };

const LIST_PRODUCTS = /* GraphQL */ `
  query ListProducts {
    listProducts {
      productId
      name
      presentation
      unitPrice
    }
  }
`;

// El cliente se crea en cada llamada: así siempre es posterior a Amplify.configure (en _layout).
export async function listProducts(): Promise<Product[]> {
  const res = (await generateClient().graphql({ query: LIST_PRODUCTS })) as { data: ListProductsQuery };
  return res.data.listProducts;
}

const clp = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });

/** Monto entero en pesos CLP → `$4.500` (S-02, DEC-006). */
export const formatCLP = (amount: number) => clp.format(amount);
