// Claves de la tabla única (DEC-006).
export const CATALOG_PK = 'CATALOG';
export const productSk = (productId: string) => `PRODUCT#${productId}`;
export const PRODUCT_SK_PREFIX = 'PRODUCT#';
export const customerPk = (customerId: string) => `CUSTOMER#${customerId}`;
export const orderSk = (orderId: string) => `ORDER#${orderId}`;
export const ORDER_SK_PREFIX = 'ORDER#';
