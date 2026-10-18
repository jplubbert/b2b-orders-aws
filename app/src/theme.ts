import type { OrderStatus } from '@/lib/generated/graphql';

// DEC-012: the only place with the app's visual values (colors, spacing, radii, typography).
// S-16: neutral brand, primary blue #1D4ED8, light backgrounds, system typography.
// REQ-007 E1: no screen or component uses literal colors or a numeric fontSize outside this file.

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
  // Veil behind the account menu (REQ-006); no text on top of it.
  backdrop: 'rgba(15, 23, 42, 0.4)',
} as const;

// S-16: 4/8/12/16/24/32 scale.
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

// S-16: 5 text sizes (12/14/16/20/28).
export const fontSize = { xs: 12, sm: 14, md: 16, lg: 20, xl: 28 } as const;

export const fontWeight = { regular: '400', semibold: '600', bold: '700' } as const;

// REQ-007 E4: minimum touch area of the controls.
export const touchTarget = 44;

// Opacity of a disabled control.
export const disabledOpacity = 0.4;

// S-17: readable name and colors of each S-04 status (the API keeps using the codes).
export const orderStatus: Record<OrderStatus, { label: string; color: string; background: string }> = {
  RECIBIDO: { label: 'Recibido', color: '#1E40AF', background: '#DBEAFE' },
  EN_PREPARACION: { label: 'En preparación', color: '#92400E', background: '#FEF3C7' },
  ENVIADO: { label: 'Enviado', color: '#5B21B6', background: '#EDE9FE' },
  ENTREGADO: { label: 'Entregado', color: '#166534', background: '#DCFCE7' },
  CANCELADO: { label: 'Cancelado', color: '#991B1B', background: '#FEE2E2' },
};

// REQ-007 E2: text/background pairs the app uses; theme.test.tsx requires contrast ≥ 4.5:1 for each.
export const contrastPairs: { name: string; text: string; background: string }[] = [
  { name: 'text on background', text: colors.text, background: colors.background },
  { name: 'text on surface', text: colors.text, background: colors.surface },
  { name: 'muted text on background', text: colors.textMuted, background: colors.background },
  { name: 'muted text on surface', text: colors.textMuted, background: colors.surface },
  { name: 'primary on surface', text: colors.primary, background: colors.surface },
  { name: 'primary on background', text: colors.primary, background: colors.background },
  { name: 'on primary', text: colors.onPrimary, background: colors.primary },
  { name: 'on pressed primary', text: colors.onPrimary, background: colors.primaryPressed },
  { name: 'error on error surface', text: colors.danger, background: colors.dangerSurface },
  ...Object.entries(orderStatus).map(([status, s]) => ({
    name: `status ${status}`,
    text: s.color,
    background: s.background,
  })),
];
