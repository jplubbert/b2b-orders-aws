import type { Product } from '../../backend/src/domain/catalog.ts';

// Datos de demo compartidos por el seed y las pruebas contra `dev`.
export const SEED_PRODUCTS: Product[] = [
  { productId: 'yerba-1kg', name: 'Yerba 1 kg', presentation: 'Paquete 1 kg', unitPrice: 4500, active: true },
  { productId: 'arroz-1kg', name: 'Arroz 1 kg', presentation: 'Paquete 1 kg', unitPrice: 1300, active: true },
];

// Almaceneros: grupo `almaceneros` con su `custom:customerId` (DEC-004).
export const SEED_USERS = [
  { email: 'almacen1@demo.test', customerId: 'C-ALMACEN1' },
  { email: 'almacen2@demo.test', customerId: 'C-ALMACEN2' },
];

// Distribuidor: grupo `distribuidores`, sin `custom:customerId` (S-22, DEC-013).
export const SEED_DISTRIBUTORS = [{ email: 'distribuidor@demo.test' }];
