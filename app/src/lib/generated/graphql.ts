// Generado por `npm run codegen` desde spec/contracts/schema.graphql. No editar.
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
export type CreateOrderInput = {
  lines: Array<OrderLineInput>;
};

/** Sin campo de precio: el servidor usa el del catálogo (S-12). */
export type OrderLineInput = {
  productId: string;
  quantity: number;
};

/** Estados del pedido (S-04); uno nuevo nace en RECIBIDO. */
export type OrderStatus =
  | 'CANCELADO'
  | 'ENTREGADO'
  | 'ENVIADO'
  | 'EN_PREPARACION'
  | 'RECIBIDO';

export type ListProductsQueryVariables = Exact<{ [key: string]: never; }>;


export type ListProductsQuery = { listProducts: Array<{ productId: string, name: string, presentation: string, unitPrice: number }> };

export type CreateOrderMutationVariables = Exact<{
  input: CreateOrderInput;
}>;


export type CreateOrderMutation = { createOrder: { id: string, number: string, total: number, status: OrderStatus } };
