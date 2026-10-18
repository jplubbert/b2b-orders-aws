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

// Types generated from spec/contracts/schema.graphql (DEC-002): `npm run codegen` after changing the contract or a query.
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

// Distributor panel (REQ-010): with lines, so the detail comes from the already loaded panel (S-19).
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

// Distributor status change (REQ-011): returns the order with the same fields as the panel.
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

// The client is created on every call: that way it always comes after Amplify.configure (in _layout).
export async function listProducts(): Promise<Product[]> {
  const res = (await generateClient().graphql({ query: LIST_PRODUCTS })) as { data: ListProductsQuery };
  return res.data.listProducts;
}

/** Orders of the token's customer, newest first (REQ-004; the server sorts). */
export async function myOrders(): Promise<OrderSummary[]> {
  const res = (await generateClient().graphql({ query: MY_ORDERS })) as { data: MyOrdersQuery };
  return res.data.myOrders;
}

/** Detail with lines and frozen prices; `null` if it doesn't exist or belongs to another customer (REQ-004 E3). */
export async function getOrder(id: string): Promise<OrderDetail | null> {
  const variables: OrderDetailQueryVariables = { id };
  const res = (await generateClient().graphql({ query: ORDER_DETAIL, variables })) as { data: OrderDetailQuery };
  return res.data.order;
}

/** Orders of every store, newest first (the server sorts); only those in `status` if given (REQ-010). */
export async function allOrders(status: OrderStatus | null): Promise<PanelOrder[]> {
  const variables: AllOrdersQueryVariables = { status };
  const res = (await generateClient().graphql({ query: ALL_ORDERS, variables })) as { data: AllOrdersQuery };
  return res.data.allOrders;
}

/** Moves order `id` of store `customerId` to `status`; the server changes only the status (REQ-011). */
export async function setOrderStatus(customerId: string, id: string, status: OrderStatus): Promise<PanelOrder> {
  const variables: SetOrderStatusMutationVariables = { customerId, id, status };
  const res = (await generateClient().graphql({ query: SET_ORDER_STATUS, variables })) as { data: SetOrderStatusMutation };
  return res.data.setOrderStatus;
}

/** GraphQL error with its `errorType` (REQ-003 rejection reasons, DEC-005). */
export class ApiError extends Error {
  constructor(
    readonly errorType: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Confirms the order; the server sets the prices (REQ-003). Rejections → ApiError with the reason. */
export async function createOrder(lines: OrderLineInput[]): Promise<CreatedOrder> {
  const variables: CreateOrderMutationVariables = { input: { lines } };
  try {
    const res = (await generateClient().graphql({ query: CREATE_ORDER, variables })) as { data: CreateOrderMutation };
    return res.data.createOrder;
  } catch (e) {
    // Amplify rejects with the `{ data, errors }` result when the API returns errors.
    const first = (e as { errors?: Array<{ errorType?: string; message?: string }> }).errors?.[0];
    if (first) throw new ApiError(first.errorType, first.message ?? '');
    throw e;
  }
}

const clp = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });

/** Whole amount in CLP pesos → `$4.500` (S-02, DEC-006). */
export const formatCLP = (amount: number) => clp.format(amount);

const dateTime = new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' });

/** ISO date (AWSDateTime) → local date and time in es-CL format (S-08). */
export const formatDate = (iso: string) => dateTime.format(new Date(iso));
