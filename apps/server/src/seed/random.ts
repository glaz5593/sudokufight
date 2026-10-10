import { pick, randomInt, type Rng } from '@sudoku-fight/engine';

/** Small helpers over the engine's seeded Rng, so the sample data is the same for the same seed. */

export { pick, randomInt };

export const chance = (rng: Rng, p: number): boolean => rng.next() < p;

export const between = (rng: Rng, min: number, max: number): number => min + rng.next() * (max - min);

/** An integer in [min, max], both included. */
export const intBetween = (rng: Rng, min: number, max: number): number => min + randomInt(rng, max - min + 1);

export function weighted<T>(rng: Rng, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((sum, [, w]) => sum + w, 0);
  let r = rng.next() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r < 0) return item;
  }
  return items[items.length - 1]![0];
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A version-4-shaped UUID from the Rng (deterministic, unlike crypto.randomUUID). */
export function uuid(rng: Rng): string {
  const b = Array.from({ length: 16 }, () => randomInt(rng, 256));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
