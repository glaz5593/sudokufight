import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  checkPuzzle,
  DEFAULT_GIVENS,
  digitCounts,
  filledCount,
  GAME_TYPES,
  givensSpread,
  parseGrid,
  type PuzzleRecord,
  puzzleId,
} from '@sudoku-fight/engine';

import { allOfflinePuzzles, offlinePool, poolIds, poolOf, puzzleById } from '../offlinePool';

const BANK = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'engine', 'data', 'puzzles.json');
const bank = (JSON.parse(readFileSync(BANK, 'utf8')) as { puzzles: PuzzleRecord[] }).puzzles;

describe('the offline pool (spec §16.1, §20)', () => {
  const all = allOfflinePuzzles();

  it.each(GAME_TYPES)('has at least 200 %s puzzles', (type) => {
    expect(poolIds(type).length).toBeGreaterThanOrEqual(200);
    expect(poolIds(type).every((id) => puzzleById(id)?.gameType === type)).toBe(true);
  });

  it('holds no ranked puzzle: neither its id nor its givens', () => {
    const ranked = bank.filter((p) => p.pool === 'ranked');
    const ids = new Set(all.map((p) => p.id));
    const givens = new Set(all.map((p) => p.givens));
    expect(ranked.filter((p) => ids.has(p.id) || givens.has(p.givens))).toEqual([]);
  });

  it('is the whole offline pool of the bank, field for field (run `npm run pool` after a bank change)', () => {
    const expected = bank
      .filter((p) => p.pool === 'offline')
      .map(({ id, givens, solution, gameType }) => ({ id, givens, solution, gameType }));
    expect(all).toEqual(expected);
  });

  it('keeps only what practice needs', () => {
    expect(new Set(all.flatMap((p) => Object.keys(p)))).toEqual(
      new Set(['id', 'givens', 'solution', 'gameType']),
    );
  });

  it('ids are the stable hash of the givens, and unique', () => {
    expect(all.filter((p) => p.id !== puzzleId(p.givens))).toEqual([]);
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
  });

  it('fast boards start with 45–50 givens, normal ones with 35–40; hard ones as before (§5.2) [D43]', () => {
    const outOfRange = all.filter((p) => {
      const range = DEFAULT_GIVENS[p.gameType];
      if (range === null) return false;
      const n = filledCount(parseGrid(p.givens));
      return n < range.min || n > range.max;
    });
    expect(outOfRange.map((p) => p.id)).toEqual([]);
  });

  it('fast and normal boards show every digit, and no digit stands out', () => {
    const uneven = all.filter((p) => {
      if (p.gameType === 'hard') return false;
      const grid = parseGrid(p.givens);
      return digitCounts(grid).some((n) => n === 0) || givensSpread(grid) > 3;
    });
    expect(uneven.map((p) => p.id)).toEqual([]);
  });

  it('a sample of each type are valid puzzles with one solution that matches', () => {
    for (const type of GAME_TYPES) {
      const ids = poolIds(type);
      for (let k = 0; k < 8; k++) {
        const p = puzzleById(ids[Math.floor((k * ids.length) / 8)]!)!;
        expect(checkPuzzle(p.givens, p.solution)).toEqual({
          ok: true,
          givens: p.givens,
          solution: p.solution,
        });
      }
    }
  });

  it('looks puzzles up by id, and a small pool works the same way', () => {
    const first = all[0]!;
    expect(offlinePool.byId(first.id)).toBe(first);
    expect(puzzleById('nope')).toBeUndefined();
    const small = poolOf(all.slice(0, 3));
    expect(small.ids(first.gameType)).toEqual(all.slice(0, 3).map((p) => p.id));
    expect(small.ids('hard')).toEqual([]);
    expect(small.byId(first.id)).toBe(first);
  });
});
