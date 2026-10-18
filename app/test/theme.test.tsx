// REQ-007 con jest-expo: tema único (E1), contraste (E2), etiquetas de estado (E3), área táctil (E4) y
// componente de estado (E5). La comparación visual en el teléfono es manual (E6, DEC-011).
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { StyleSheet } from 'react-native';
import { fetchUserAttributes } from 'aws-amplify/auth';
import CatalogScreen from '@/app/catalog';
import { AccountMenu } from '@/components/AccountMenu';
import { Button } from '@/components/Button';
import { CartBar } from '@/components/CartBar';
import { QuantityStepper } from '@/components/QuantityStepper';
import { SignOutButton } from '@/components/SignOutButton';
import { StateMessage } from '@/components/StateMessage';
import { StatusBadge } from '@/components/StatusBadge';
import { listProducts, type Product } from '@/lib/api';
import { CartProvider } from '@/lib/CartProvider';
import type { OrderStatus } from '@/lib/generated/graphql';
import { colors, contrastPairs, orderStatus, touchTarget } from '@/theme';

jest.mock('aws-amplify/auth', () => ({ signOut: jest.fn(), fetchUserAttributes: jest.fn() }));
jest.mock('aws-amplify/api', () => ({ generateClient: jest.fn() }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual<typeof import('@/lib/api')>('@/lib/api'),
  listProducts: jest.fn(),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() }, Stack: { Screen: () => null } }));

const mockListProducts = jest.mocked(listProducts);
const mockFetchUserAttributes = jest.mocked(fetchUserAttributes);

beforeEach(() => {
  jest.resetAllMocks();
});

const SRC = join(__dirname, '..', 'src');

function sourcesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourcesIn(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

// Pantallas ya migradas al tema. T-12 amplía la lista a todo app/src/app.
const MIGRATED = [
  ...sourcesIn(join(SRC, 'components')),
  join(SRC, 'app', 'catalog.tsx'),
  join(SRC, 'app', '_layout.tsx'),
];

const FORBIDDEN = [
  { name: 'color hexadecimal', re: /['"`]#[0-9a-fA-F]{3,8}['"`]/ },
  { name: 'color rgb()', re: /\brgba?\(/ },
  { name: 'fontSize numérico', re: /fontSize:\s*\d/ },
];

function literalsIn(source: string): string[] {
  return source
    .split('\n')
    .flatMap((line, i) => FORBIDDEN.filter((f) => f.re.test(line)).map((f) => `${i + 1}: ${f.name}: ${line.trim()}`));
}

// WCAG 2.x: luminancia relativa y razón de contraste.
function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const full = n.length === 3 ? [...n].map((c) => c + c).join('') : n;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const STATUSES: OrderStatus[] = ['RECIBIDO', 'EN_PREPARACION', 'ENVIADO', 'ENTREGADO', 'CANCELADO'];

describe('REQ-007 E1: sin colores literales ni fontSize numérico fuera de theme.ts', () => {
  it('la prueba revisa al menos los componentes base y el catálogo', () => {
    const names = MIGRATED.map((f) => relative(SRC, f));
    for (const f of [
      'Screen',
      'Button',
      'Card',
      'StatusBadge',
      'StateMessage',
      'QuantityStepper',
      'SignOutButton',
      'AccountMenu',
      'CartBar',
    ]) {
      expect(names).toContain(join('components', `${f}.tsx`));
    }
    expect(names).toContain(join('app', 'catalog.tsx'));
    expect(names).toContain(join('app', '_layout.tsx'));
  });

  it.each(MIGRATED.map((f) => [relative(SRC, f), f]))('%s', (_name, file) => {
    expect(literalsIn(readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('el detector encuentra literales (no es vacío)', () => {
    expect(literalsIn("a: { color: '#555', fontSize: 16 }\nb: { color: 'rgba(0,0,0,0.5)' }")).toHaveLength(3);
    expect(literalsIn('<Text>N° {item.number}</Text>')).toEqual([]);
  });
});

describe('REQ-007 E2: contraste ≥ 4,5:1 de los pares del tema', () => {
  it.each(contrastPairs.map((p) => [p.name, p.text, p.background]))('%s', (_name, text, background) => {
    expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('un par por debajo de 4,5:1 se detecta', () => {
    expect(contrast('#999999', '#FFFFFF')).toBeLessThan(4.5);
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });

  it('los 5 estados tienen su par declarado', () => {
    for (const s of STATUSES) expect(contrastPairs.map((p) => p.name)).toContain(`estado ${s}`);
  });
});

describe('REQ-007 E3: etiquetas de estado (S-17)', () => {
  const labels: Record<OrderStatus, string> = {
    RECIBIDO: 'Recibido',
    EN_PREPARACION: 'En preparación',
    ENVIADO: 'Enviado',
    ENTREGADO: 'Entregado',
    CANCELADO: 'Cancelado',
  };

  it.each(STATUSES)('%s', async (status) => {
    await render(<StatusBadge status={status} />);
    const text = screen.getByText(labels[status]);
    expect(StyleSheet.flatten(text.props.style).color).toBe(orderStatus[status].color);
    expect(StyleSheet.flatten(screen.getByTestId(`status-${status}`).props.style).backgroundColor).toBe(
      orderStatus[status].background,
    );
    expect(screen.queryByText(status)).toBeNull();
  });

  it('cada estado tiene un color distinto', () => {
    expect(new Set(STATUSES.map((s) => orderStatus[s].background)).size).toBe(5);
    expect(new Set(STATUSES.map((s) => orderStatus[s].color)).size).toBe(5);
  });
});

describe('REQ-007 E4: área táctil ≥ 44 × 44 dp', () => {
  const size = (label: string) => {
    const s = StyleSheet.flatten(screen.getByLabelText(label).props.style);
    return { w: s.width ?? s.minWidth, h: s.height ?? s.minHeight };
  };

  it('− / + del selector de cantidad', async () => {
    await render(<QuantityStepper quantity={1} onChange={() => {}} />);
    for (const label of ['Quitar uno', 'Agregar uno']) {
      expect(size(label).w).toBeGreaterThanOrEqual(touchTarget);
      expect(size(label).h).toBeGreaterThanOrEqual(touchTarget);
    }
    expect(touchTarget).toBeGreaterThanOrEqual(44);
  });

  it.each(['primary', 'secondary', 'link'] as const)('Button %s', async (variant) => {
    await render(<Button title="Acción" variant={variant} onPress={() => {}} accessibilityLabel="acción" />);
    expect(size('acción').w).toBeGreaterThanOrEqual(44);
    expect(size('acción').h).toBeGreaterThanOrEqual(44);
  });

  it('"Cerrar sesión"', async () => {
    await render(
      <CartProvider>
        <SignOutButton />
      </CartProvider>,
    );
    const s = StyleSheet.flatten(screen.getByRole('button', { name: 'Cerrar sesión' }).props.style);
    expect(s.minHeight).toBeGreaterThanOrEqual(44);
    expect(s.minWidth).toBeGreaterThanOrEqual(44);
  });

  it('botón de cuenta y barra del carrito (REQ-006)', async () => {
    mockFetchUserAttributes.mockResolvedValue({ email: 'almacen1@demo.test' });
    await render(
      <CartProvider>
        <AccountMenu />
        <CartBar />
      </CartProvider>,
    );
    expect(size('Cuenta').w).toBeGreaterThanOrEqual(44);
    expect(size('Cuenta').h).toBeGreaterThanOrEqual(44);
    expect(size('Ver carrito').h).toBeGreaterThanOrEqual(44);
    expect(await screen.findByText('A')).toBeOnTheScreen();
  });
});

describe('REQ-007 E5: carga, vacío y error con StateMessage', () => {
  const arroz: Product = { productId: 'arroz-1kg', name: 'Arroz 1 kg', presentation: 'Paquete 1 kg', unitPrice: 1300 };

  function renderCatalog() {
    return render(
      <CartProvider>
        <CatalogScreen />
      </CartProvider>,
    );
  }

  it('StateMessage: error con el color de error del tema', async () => {
    await render(<StateMessage kind="error" message="Network error" />);
    expect(StyleSheet.flatten(screen.getByText('Network error').props.style).color).toBe(colors.danger);
  });

  it('catálogo cargando → state-loading', async () => {
    mockListProducts.mockReturnValue(new Promise(() => {}));
    await renderCatalog();
    expect(screen.getByTestId('state-loading')).toBeOnTheScreen();
  });

  it('REQ-002 E3: catálogo vacío → "No hay productos disponibles" en state-empty', async () => {
    mockListProducts.mockResolvedValue([]);
    await renderCatalog();
    expect(await screen.findByText('No hay productos disponibles')).toBeOnTheScreen();
    expect(screen.getByTestId('state-empty')).toBeOnTheScreen();
  });

  it('error de red → mensaje de error en state-error (no como lista vacía)', async () => {
    mockListProducts.mockRejectedValue(new Error('Network error'));
    await renderCatalog();
    expect(await screen.findByText('Network error')).toBeOnTheScreen();
    expect(screen.getByTestId('state-error')).toBeOnTheScreen();
    expect(screen.queryByText('No hay productos disponibles')).toBeNull();
  });

  it('REQ-002: el catálogo migrado sigue mostrando nombre, presentación, precio y − / +', async () => {
    mockListProducts.mockResolvedValue([arroz]);
    await renderCatalog();
    expect(await screen.findByText('Arroz 1 kg')).toBeOnTheScreen();
    expect(screen.getByText('Paquete 1 kg')).toBeOnTheScreen();
    expect(screen.getByText(/\$\s*1\.300/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Agregar uno')).toBeOnTheScreen();
  });
});
