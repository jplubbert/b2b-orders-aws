// Generado por `npm run codegen` desde spec/contracts/schema.graphql. No editar.
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  AWSDate: { input: string; output: string; }
  AWSDateTime: { input: string; output: string; }
  AWSEmail: { input: string; output: string; }
  AWSIPAddress: { input: string; output: string; }
  AWSJSON: { input: string; output: string; }
  AWSPhone: { input: string; output: string; }
  AWSTime: { input: string; output: string; }
  AWSTimestamp: { input: number; output: number; }
  AWSURL: { input: string; output: string; }
};

export type CreateOrderInput = {
  lines: Array<OrderLineInput>;
};

export type Mutation = {
  /** Confirma un pedido en RECIBIDO con precios del catálogo (REQ-003). Errores: INVALID_QUANTITY, PRODUCT_UNAVAILABLE, EMPTY_ORDER, TOO_MANY_LINES. */
  createOrder: Order;
  /** Cambia solo el estado del pedido `id` del almacén `customerId` (REQ-011). Error: ORDER_NOT_FOUND. */
  setOrderStatus: Order;
};


export type MutationCreateOrderArgs = {
  input: CreateOrderInput;
};


export type MutationSetOrderStatusArgs = {
  customerId: Scalars['ID']['input'];
  id: Scalars['ID']['input'];
  status: OrderStatus;
};

export type Order = {
  createdAt: Scalars['AWSDateTime']['output'];
  /** Almacén dueño del pedido (DEC-004); el panel lo muestra como almacén (S-23). */
  customerId: Scalars['ID']['output'];
  /** ULID (DEC-006). */
  id: Scalars['ID']['output'];
  lines: Array<OrderLine>;
  /** Últimos 8 caracteres del ULID en mayúsculas (S-11). */
  number: Scalars['String']['output'];
  status: OrderStatus;
  total: Scalars['Int']['output'];
};

/** Línea con nombre, presentación y precio congelados al confirmar. */
export type OrderLine = {
  name: Scalars['String']['output'];
  presentation: Scalars['String']['output'];
  productId: Scalars['ID']['output'];
  quantity: Scalars['Int']['output'];
  subtotal: Scalars['Int']['output'];
  unitPrice: Scalars['Int']['output'];
};

/** Sin campo de precio: el servidor usa el del catálogo (S-12). */
export type OrderLineInput = {
  productId: Scalars['ID']['input'];
  quantity: Scalars['Int']['input'];
};

/** Estados del pedido (S-04); uno nuevo nace en RECIBIDO. */
export type OrderStatus =
  | 'CANCELADO'
  | 'ENTREGADO'
  | 'ENVIADO'
  | 'EN_PREPARACION'
  | 'RECIBIDO';

export type Product = {
  name: Scalars['String']['output'];
  presentation: Scalars['String']['output'];
  productId: Scalars['ID']['output'];
  unitPrice: Scalars['Int']['output'];
};

export type Query = {
  /** Pedidos de todos los almacenes, del más reciente al más antiguo; solo los de `status` si se indica (REQ-010). */
  allOrders: Array<Order>;
  /** Productos activos ordenados por nombre (REQ-002). */
  listProducts: Array<Product>;
  /** Pedidos del cliente del token, del más reciente al más antiguo (REQ-004). */
  myOrders: Array<Order>;
  /** Pedido del cliente del token; null si no existe o es de otro cliente (REQ-004 E3). */
  order: Maybe<Order>;
};


export type QueryAllOrdersArgs = {
  status: InputMaybe<OrderStatus>;
};


export type QueryOrderArgs = {
  id: Scalars['ID']['input'];
};
