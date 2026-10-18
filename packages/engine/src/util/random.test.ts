import { createRng, pick, randomInt, seedFromString, shuffled } from './random';
import { ManualClock } from './clock';

describe('seeded randomness', () => {
  it('repeats the same sequence for the same seed, and differs for another', () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const sa = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(sa);
    for (const v of sa) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('spreads integers over the whole range', () => {
    const rng = createRng(1);
    const seen = new Set(Array.from({ length: 500 }, () => randomInt(rng, 6)));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(() => randomInt(rng, 0)).toThrow(RangeError);
  });

  it('picks from a list and refuses an empty one', () => {
    expect(['a', 'b']).toContain(pick(createRng(2), ['a', 'b']));
    expect(() => pick(createRng(2), [])).toThrow(RangeError);
  });
});

describe('shuffled', () => {
  it('returns a permutation, the same for the same seed, and leaves the input alone', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const a = shuffled(createRng(9), items);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(a).not.toEqual(items);
    expect(shuffled(createRng(9), items)).toEqual(a);
    expect(shuffled(createRng(10), items)).not.toEqual(a);
    expect(items).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(shuffled(createRng(1), [])).toEqual([]);
  });
});

describe('seedFromString (one seed per puzzle id)', () => {
  it('is stable, a 32-bit unsigned integer, and differs between texts and between salts', () => {
    const s = seedFromString('0123456789abcdef', 20261015);
    expect(seedFromString('0123456789abcdef', 20261015)).toBe(s);
    expect(Number.isInteger(s) && s >= 0 && s < 2 ** 32).toBe(true);
    expect(seedFromString('0123456789abcdee', 20261015)).not.toBe(s);
    expect(seedFromString('0123456789abcdef', 20261016)).not.toBe(s);
    expect(seedFromString('0123456789abcdef')).not.toBe(s);
    // FNV-1a of the empty text is its basis.
    expect(seedFromString('')).toBe(0x811c9dc5);
    for (const text of ['a', 'zz', 'פאזל', 'x'.repeat(200)]) {
      const v = seedFromString(text, 7);
      expect(Number.isInteger(v) && v >= 0 && v < 2 ** 32).toBe(true);
    }
  });
});

describe('ManualClock', () => {
  it('moves only when told to', () => {
    const clock = new ManualClock(1000);
    expect(clock.now()).toBe(1000);
    expect(clock.advance(250)).toBe(1250);
    clock.set(5);
    expect(clock.now()).toBe(5);
  });
});
