import { describe, expect, it } from 'vitest';
import { activeCatalog, type Product } from '../src/domain/catalog.js';

const p = (name: string, unitPrice: number, active = true): Product => ({
  productId: name.toLowerCase().replace(/\W+/g, '-'),
  name,
  presentation: 'Unidad',
  unitPrice,
  active,
});

describe('activeCatalog (REQ-002)', () => {
  it('E1: sorts active products by name', () => {
    const out = activeCatalog([p('Yerba 1 kg', 4500), p('Arroz 1 kg', 1300)]);
    expect(out.map((x) => [x.name, x.unitPrice])).toEqual([
      ['Arroz 1 kg', 1300],
      ['Yerba 1 kg', 4500],
    ]);
  });

  it('E2: excludes inactive products', () => {
    const out = activeCatalog([p('Aceite 900 ml', 2100, false), p('Arroz 1 kg', 1300)]);
    expect(out.map((x) => x.name)).toEqual(['Arroz 1 kg']);
  });

  it('E3: with no active products returns an empty list', () => {
    expect(activeCatalog([p('Aceite 900 ml', 2100, false)])).toEqual([]);
  });

  it('does not expose the active field', () => {
    expect(activeCatalog([p('Arroz 1 kg', 1300)])[0]).not.toHaveProperty('active');
  });
});
