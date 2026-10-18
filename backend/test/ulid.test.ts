import { describe, expect, it } from 'vitest';
import { ulid, ulidTime } from '../src/domain/ulid.js';

describe('ulid (DEC-006)', () => {
  it('26 caracteres de Crockford y codifica el tiempo', () => {
    const now = Date.UTC(2026, 9, 17, 23, 0, 0);
    const id = ulid(now);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(ulidTime(id)).toBe(now);
  });

  it('valores conocidos: tiempo 0 y aleatorio en cero o en máximo', () => {
    expect(ulid(0, (n) => new Uint8Array(n))).toBe('0'.repeat(26));
    expect(ulid(0, (n) => new Uint8Array(n).fill(255))).toBe('0'.repeat(10) + 'Z'.repeat(16));
  });

  it('el orden lexicográfico sigue al tiempo', () => {
    const ids = [3, 1, 2].map((t) => ulid(1_700_000_000_000 + t));
    expect([...ids].sort().map(ulidTime)).toEqual([1, 2, 3].map((t) => 1_700_000_000_000 + t));
  });

  it('dos ids del mismo milisegundo son distintos', () => {
    expect(ulid(1)).not.toBe(ulid(1));
  });
});
