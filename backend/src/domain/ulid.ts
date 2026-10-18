import { randomBytes } from 'node:crypto';

// Crockford's Base32: the ULID's lexicographic order is its time order (DEC-006: `SK=ORDER#<ulid>`).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID: 48 bits of milliseconds (10 characters) + 80 random bits (16 characters). */
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

/** Milliseconds encoded in a ULID. */
export function ulidTime(id: string): number {
  let t = 0;
  for (const c of id.slice(0, 10)) t = t * 32 + ALPHABET.indexOf(c);
  return t;
}
