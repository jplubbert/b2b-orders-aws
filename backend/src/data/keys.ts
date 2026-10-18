// Single-table keys (DEC-006).
export const CATALOG_PK = 'CATALOG';
export const productSk = (productId: string) => `PRODUCT#${productId}`;
export const PRODUCT_SK_PREFIX = 'PRODUCT#';
export const CUSTOMER_PK_PREFIX = 'CUSTOMER#';
export const customerPk = (customerId: string) => `${CUSTOMER_PK_PREFIX}${customerId}`;
export const orderSk = (orderId: string) => `ORDER#${orderId}`;
export const ORDER_SK_PREFIX = 'ORDER#';
// DEC-020: history outside the customer's partition and outside the panel's `ORDER#` Scan.
export const HISTORY_PK_PREFIX = 'HISTORY#';
export const historyPk = (orderId: string) => `${HISTORY_PK_PREFIX}${orderId}`;
export const eventSk = (at: string, eventId: string) => `EVENT#${at}#${eventId}`;
export const EVENT_SK_PREFIX = 'EVENT#';
