import type { OrderStatus } from '@/lib/generated/graphql';

// DEC-012: único lugar con valores visuales de la app (colores, espaciado, radios, tipografía).
// S-16: marca neutra, primario azul #1D4ED8, fondos claros, tipografía del sistema.
// REQ-007 E1: ninguna pantalla ni componente usa colores literales ni fontSize numérico fuera de aquí.

export const colors = {
  primary: '#1D4ED8',
  primaryPressed: '#1E40AF',
  onPrimary: '#FFFFFF',
  background: '#F8FAFC',
  surface: '#FFFFFF',
  text: '#0F172A',
  textMuted: '#475569',
  border: '#E2E8F0',
  danger: '#B91C1C',
  dangerSurface: '#FEF2F2',
} as const;

// S-16: escala 4/8/12/16/24/32.
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

// S-16: 5 tamaños de texto (12/14/16/20/28).
export const fontSize = { xs: 12, sm: 14, md: 16, lg: 20, xl: 28 } as const;

export const fontWeight = { regular: '400', semibold: '600', bold: '700' } as const;

// REQ-007 E4: área táctil mínima de los controles.
export const touchTarget = 44;

// Opacidad de un control deshabilitado.
export const disabledOpacity = 0.4;

// S-17: nombre legible y colores de cada estado de S-04 (la API sigue usando los códigos).
export const orderStatus: Record<OrderStatus, { label: string; color: string; background: string }> = {
  RECIBIDO: { label: 'Recibido', color: '#1E40AF', background: '#DBEAFE' },
  EN_PREPARACION: { label: 'En preparación', color: '#92400E', background: '#FEF3C7' },
  ENVIADO: { label: 'Enviado', color: '#5B21B6', background: '#EDE9FE' },
  ENTREGADO: { label: 'Entregado', color: '#166534', background: '#DCFCE7' },
  CANCELADO: { label: 'Cancelado', color: '#991B1B', background: '#FEE2E2' },
};

// REQ-007 E2: pares texto/fondo que usa la app; theme.test.tsx exige contraste ≥ 4,5:1 en cada uno.
export const contrastPairs: { name: string; text: string; background: string }[] = [
  { name: 'texto sobre fondo', text: colors.text, background: colors.background },
  { name: 'texto sobre superficie', text: colors.text, background: colors.surface },
  { name: 'texto secundario sobre fondo', text: colors.textMuted, background: colors.background },
  { name: 'texto secundario sobre superficie', text: colors.textMuted, background: colors.surface },
  { name: 'primario sobre superficie', text: colors.primary, background: colors.surface },
  { name: 'primario sobre fondo', text: colors.primary, background: colors.background },
  { name: 'sobre primario', text: colors.onPrimary, background: colors.primary },
  { name: 'sobre primario presionado', text: colors.onPrimary, background: colors.primaryPressed },
  { name: 'error sobre superficie de error', text: colors.danger, background: colors.dangerSurface },
  ...Object.entries(orderStatus).map(([status, s]) => ({
    name: `estado ${status}`,
    text: s.color,
    background: s.background,
  })),
];
