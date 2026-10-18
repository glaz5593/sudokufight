/**
 * Seeded randomness. The engine never calls Math.random: whoever needs chance (puzzle choice, bots) gets an
 * Rng, so a game can be replayed and a test can be repeated exactly.
 */
export interface Rng {
  /** A number in [0, 1). */
  next(): number;
}

/** mulberry32: small, fast and good enough for games. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** An integer in [0, n). */
export function randomInt(rng: Rng, n: number): number {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError(`randomInt needs a positive integer, got ${n}`);
  return Math.floor(rng.next() * n);
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (!items.length) throw new RangeError('pick from an empty list');
  return items[randomInt(rng, items.length)]!;
}

/** A shuffled copy (Fisher–Yates, with randomInt). */
export function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * A stable 32-bit seed from a text (32-bit FNV-1a; `salt` changes the basis): the same puzzle id gives the
 * same seed on any machine, whatever else is in the bank.
 */
export function seedFromString(text: string, salt = 0): number {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
