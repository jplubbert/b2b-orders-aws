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

export type Product = {
  name: Scalars['String']['output'];
  presentation: Scalars['String']['output'];
  productId: Scalars['ID']['output'];
  unitPrice: Scalars['Int']['output'];
};

export type Query = {
  /** Productos activos ordenados por nombre (REQ-002). */
  listProducts: Array<Product>;
};
