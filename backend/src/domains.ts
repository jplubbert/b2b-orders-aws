// DEC-019 (S-30): each contract field belongs to one domain Lambda. No imports, so the infra can read it too.
export const DOMAIN_FIELDS = {
  catalog: ['Query.listProducts'],
  orders: ['Query.myOrders', 'Query.order', 'Mutation.createOrder'],
  distributor: ['Query.allOrders', 'Mutation.setOrderStatus'],
} as const;

export type Domain = keyof typeof DOMAIN_FIELDS;

export const DOMAINS = Object.keys(DOMAIN_FIELDS) as Domain[];
