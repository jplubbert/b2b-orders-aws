import { generateClient } from 'aws-amplify/api';
import type {
  AllOrdersQuery,
  AllOrdersQueryVariables,
  CreateOrderMutation,
  CreateOrderMutationVariables,
  ListProductsQuery,
  MyOrdersQuery,
  OrderDetailQuery,
  OrderDetailQueryVariables,
  OrderLineInput,
  OrderStatus,
  SetOrderStatusMutation,
  SetOrderStatusMutationVariables,
} from './generated/graphql';

// Tipos generados desde spec/contracts/schema.graphql (DEC-002): `npm run codegen` tras cambiar el contrato o una consulta.
export type Product = ListProductsQuery['listProducts'][number];
export type CreatedOrder = CreateOrderMutation['createOrder'];
export type OrderSummary = MyOrdersQuery['myOrders'][number];
export type OrderDetail = NonNullable<OrderDetailQuery['order']>;
export type PanelOrder = AllOrdersQuery['allOrders'][number];

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

const MY_ORDERS = /* GraphQL */ `
  query MyOrders {
    myOrders {
      id
      number
      createdAt
      total
      status
    }
  }
`;

const ORDER_DETAIL = /* GraphQL */ `
  query OrderDetail($id: ID!) {
    order(id: $id) {
      id
      number
      createdAt
      total
      status
      lines {
        productId
        name
        presentation
        quantity
        unitPrice
        subtotal
      }
    }
  }
`;

// Panel del distribuidor (REQ-010): con líneas, para que el detalle salga del panel ya cargado (S-19).
const ALL_ORDERS = /* GraphQL */ `
  query AllOrders($status: OrderStatus) {
    allOrders(status: $status) {
      id
      customerId
      number
      createdAt
      total
      status
      lines {
        productId
        name
        presentation
        quantity
        unitPrice
        subtotal
      }
    }
  }
`;

// Cambio de estado del distribuidor (REQ-011): devuelve el pedido con los mismos campos del panel.
const SET_ORDER_STATUS = /* GraphQL */ `
  mutation SetOrderStatus($customerId: ID!, $id: ID!, $status: OrderStatus!) {
    setOrderStatus(customerId: $customerId, id: $id, status: $status) {
      id
      customerId
      number
      createdAt
      total
      status
      lines {
        productId
        name
        presentation
        quantity
        unitPrice
        subtotal
      }
    }
  }
`;

// El cliente se crea en cada llamada: así siempre es posterior a Amplify.configure (en _layout).
export async function listProducts(): Promise<Product[]> {
  const res = (await generateClient().graphql({ query: LIST_PRODUCTS })) as { data: ListProductsQuery };
  return res.data.listProducts;
}

/** Pedidos del cliente del token, del más reciente al más antiguo (REQ-004; el servidor ordena). */
export async function myOrders(): Promise<OrderSummary[]> {
  const res = (await generateClient().graphql({ query: MY_ORDERS })) as { data: MyOrdersQuery };
  return res.data.myOrders;
}

/** Detalle con líneas y precios congelados; `null` si no existe o es de otro cliente (REQ-004 E3). */
export async function getOrder(id: string): Promise<OrderDetail | null> {
  const variables: OrderDetailQueryVariables = { id };
  const res = (await generateClient().graphql({ query: ORDER_DETAIL, variables })) as { data: OrderDetailQuery };
  return res.data.order;
}

/** Pedidos de todos los almacenes, del más reciente al más antiguo (el servidor ordena); solo los de `status` si se indica (REQ-010). */
export async function allOrders(status: OrderStatus | null): Promise<PanelOrder[]> {
  const variables: AllOrdersQueryVariables = { status };
  const res = (await generateClient().graphql({ query: ALL_ORDERS, variables })) as { data: AllOrdersQuery };
  return res.data.allOrders;
}

/** Pasa el pedido `id` del almacén `customerId` a `status`; el servidor solo cambia el estado (REQ-011). */
export async function setOrderStatus(customerId: string, id: string, status: OrderStatus): Promise<PanelOrder> {
  const variables: SetOrderStatusMutationVariables = { customerId, id, status };
  const res = (await generateClient().graphql({ query: SET_ORDER_STATUS, variables })) as { data: SetOrderStatusMutation };
  return res.data.setOrderStatus;
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

const dateTime = new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' });

/** Fecha ISO (AWSDateTime) → fecha y hora locales en formato es-CL (S-08). */
export const formatDate = (iso: string) => dateTime.format(new Date(iso));
