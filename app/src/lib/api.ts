import { generateClient } from 'aws-amplify/api';
import type {
  CreateOrderMutation,
  CreateOrderMutationVariables,
  ListProductsQuery,
  OrderLineInput,
} from './generated/graphql';

// Tipos generados desde spec/contracts/schema.graphql (DEC-002): `npm run codegen` tras cambiar el contrato o una consulta.
export type Product = ListProductsQuery['listProducts'][number];
export type CreatedOrder = CreateOrderMutation['createOrder'];

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

const CREATE_ORDER = /* GraphQL */ `
  mutation CreateOrder($input: CreateOrderInput!) {
    createOrder(input: $input) {
      id
      number
      total
      status
    }
  }
`;

// El cliente se crea en cada llamada: así siempre es posterior a Amplify.configure (en _layout).
export async function listProducts(): Promise<Product[]> {
  const res = (await generateClient().graphql({ query: LIST_PRODUCTS })) as { data: ListProductsQuery };
  return res.data.listProducts;
}

/** Error de GraphQL con su `errorType` (motivos de rechazo de REQ-003, DEC-005). */
export class ApiError extends Error {
  constructor(
    readonly errorType: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Confirma el pedido; el servidor pone los precios (REQ-003). Rechazos → ApiError con el motivo. */
export async function createOrder(lines: OrderLineInput[]): Promise<CreatedOrder> {
  const variables: CreateOrderMutationVariables = { input: { lines } };
  try {
    const res = (await generateClient().graphql({ query: CREATE_ORDER, variables })) as { data: CreateOrderMutation };
    return res.data.createOrder;
  } catch (e) {
    // Amplify rechaza con el resultado `{ data, errors }` cuando la API devuelve errores.
    const first = (e as { errors?: Array<{ errorType?: string; message?: string }> }).errors?.[0];
    if (first) throw new ApiError(first.errorType, first.message ?? '');
    throw e;
  }
}

const clp = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });

/** Monto entero en pesos CLP → `$4.500` (S-02, DEC-006). */
export const formatCLP = (amount: number) => clp.format(amount);
