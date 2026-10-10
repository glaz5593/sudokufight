import { createRng, pick, randomInt } from './random';
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

describe('ManualClock', () => {
  it('moves only when told to', () => {
    const clock = new ManualClock(1000);
    expect(clock.now()).toBe(1000);
    expect(clock.advance(250)).toBe(1250);
    clock.set(5);
    expect(clock.now()).toBe(5);
  });
});
