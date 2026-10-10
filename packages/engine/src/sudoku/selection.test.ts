import { currentCycle, selectPuzzle } from './selection';
import { createRng } from '../util/random';

const pool = Array.from({ length: 10 }, (_, k) => `p${k}`);
const plays = (ids: string[], from = 0) => ids.map((puzzleId, k) => ({ puzzleId, playedAt: from + k }));

describe('selectPuzzle (§20)', () => {
  it('picks a puzzle that no participant has played', () => {
    const a = plays(['p0', 'p1', 'p2']);
    const b = plays(['p3', 'p4']);
    for (let seed = 0; seed < 50; seed++) {
      const id = selectPuzzle(pool, [a, b], { rng: createRng(seed) });
      expect(['p5', 'p6', 'p7', 'p8', 'p9']).toContain(id);
    }
  });

  it('is repeatable for the same seed', () => {
    const pick = (seed: number) => selectPuzzle(pool, [], { rng: createRng(seed) });
    expect(pick(7)).toBe(pick(7));
  });

  it('when everything was played, picks the one forgotten the longest', () => {
    // Four players together cover the pool (each below the 80% reset); p6 was last played earliest.
    const h = [
      [...plays(['p0', 'p1', 'p2'], 100)],
      [...plays(['p3', 'p4', 'p5'], 200)],
      [{ puzzleId: 'p6', playedAt: 5 }, ...plays(['p7'], 300)],
      [...plays(['p8', 'p9'], 400)],
    ];
    expect(selectPuzzle(pool, h, { rng: createRng(1) })).toBe('p6');
  });

  it('ignores plays outside the pool, and refuses an empty pool', () => {
    expect(selectPuzzle(['x'], [plays(['p0'])], { rng: createRng(1) })).toBe('x');
    expect(() => selectPuzzle([], [], { rng: createRng(1) })).toThrow(RangeError);
  });
});

describe('currentCycle: history starts over past 80% of the pool (§20, original §32)', () => {
  it('keeps everything up to 80%', () => {
    const h = plays(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']); // 8 of 10 = 80%: not more
    expect(currentCycle(h, pool)).toHaveLength(8);
  });

  it('starts over once a player has played more than 80%', () => {
    const h = plays(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']); // 9 of 10
    expect(currentCycle(h, pool)).toEqual([]);
    const later = [...h, ...plays(['p2', 'p9'], 100)];
    expect(currentCycle(later, pool).map((p) => p.puzzleId)).toEqual(['p2', 'p9']);
    // So the next game can be any puzzle but those two.
    const id = selectPuzzle(pool, [later], { rng: createRng(3) });
    expect(['p2', 'p9']).not.toContain(id);
  });

  it('counts repeated plays of one puzzle once, and sorts by time', () => {
    const h = [
      { puzzleId: 'p1', playedAt: 30 },
      { puzzleId: 'p0', playedAt: 10 },
      { puzzleId: 'p0', playedAt: 20 },
    ];
    expect(currentCycle(h, pool).map((p) => p.playedAt)).toEqual([10, 20, 30]);
    expect(currentCycle(h, pool, 0.1).map((p) => p.playedAt)).toEqual([]); // 2 distinct > 1
  });
});
