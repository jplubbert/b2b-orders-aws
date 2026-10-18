import { randomBytes } from 'node:crypto';

// Base32 de Crockford: el orden lexicográfico del ULID es el orden por tiempo (DEC-006: `SK=ORDER#<ulid>`).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID: 48 bits de milisegundos (10 caracteres) + 80 bits aleatorios (16 caracteres). */
export function ulid(now = Date.now(), random: (n: number) => Uint8Array = randomBytes): string {
  let time = '';
  for (let t = now, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = ALPHABET[t % 32] + time;
  const bytes = random(10);
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  let rand = '';
  for (let i = 0; i < 16; i++, bits >>= 5n) rand = ALPHABET[Number(bits & 31n)] + rand;
  return time + rand;
}

/** Milisegundos codificados en un ULID. */
export function ulidTime(id: string): number {
  let t = 0;
  for (const c of id.slice(0, 10)) t = t * 32 + ALPHABET.indexOf(c);
  return t;
}
