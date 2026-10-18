/* The real bank file (packages/engine/data/puzzles.json): what `npm run puzzles:givens` promises about it. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GAME_TYPES, type GameType } from '../gameType';
import { bankRows, REPO_ROOT } from '../testing/fixtures';
import {
  type BankFile,
  buildBank,
  checkPuzzle,
  fitBankGivens,
  PUZZLE_POOLS,
  type PuzzlePool,
  puzzleId,
} from './bank';
import { filledCount, parseGrid } from './board';
import { DEFAULT_GIVENS, digitCounts, givensSpread } from './givens';
import { gradePuzzle } from './grade';

const BANK_JSON = join(REPO_ROOT, 'packages', 'engine', 'data', 'puzzles.json');
const bank = (JSON.parse(readFileSync(BANK_JSON, 'utf8')) as BankFile).puzzles;

/** The most common digit of a fast or normal board may have this many more givens than the rarest one. */
const MAX_SPREAD = { fast: 2, normal: 3 } as const;

describe('the bank file: givens at the start per game type (§5.2, §20) [D43]', () => {
  it('every fast and normal puzzle within its type range; ids from the givens, the grade of the type', () => {
    const bad = bank.filter((p) => {
      const range = DEFAULT_GIVENS[p.gameType];
      return (
        p.givensCount !== filledCount(parseGrid(p.givens)) ||
        (range !== null && (p.givensCount < range.min || p.givensCount > range.max)) ||
        p.id !== puzzleId(p.givens) ||
        p.difficulty !== p.gameType
      );
    });
    expect(bad.map((p) => p.id)).toEqual([]);
    expect(new Set(bank.map((p) => p.id)).size).toBe(bank.length);
  });

  it('hard puzzles are kept as they were: none got givens, 22–29 as before (Moshe, 2026-10-15)', () => {
    const hard = bank.filter((p) => p.gameType === 'hard');
    expect(DEFAULT_GIVENS.hard).toBeNull();
    expect(hard.filter((p) => p.baseId !== undefined)).toEqual([]);
    const counts = hard.map((p) => p.givensCount);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(22);
    expect(Math.max(...counts)).toBeLessThanOrEqual(29);
  });

  it('fast and normal boards show every digit, and no digit stands out', () => {
    const bad = bank.filter((p) => {
      const grid = parseGrid(p.givens);
      const allDigits = digitCounts(grid).every((n) => n > 0);
      if (p.gameType === 'hard') return false;
      return !allDigits || givensSpread(grid) > MAX_SPREAD[p.gameType];
    });
    expect(bad.map((p) => p.id)).toEqual([]);
  });

  it('pools big enough (offline 200+, ranked 2,000+ per type), and already fitted: a fit changes nothing', () => {
    const count = (pool: PuzzlePool, type: GameType) =>
      bank.filter((p) => p.pool === pool && p.gameType === type).length;
    for (const type of GAME_TYPES) {
      expect(count('offline', type)).toBeGreaterThanOrEqual(200);
      expect(count('ranked', type)).toBeGreaterThanOrEqual(2000);
    }
    const { puzzles, report } = fitBankGivens(bank);
    expect(report.dropped).toEqual([]);
    expect(puzzles).toHaveLength(bank.length);
    expect(puzzles.every((p, k) => p === bank[k])).toBe(true);
  });

  it('a sample of every pool and type: valid, one solution, and the grade of its type', () => {
    for (const pool of PUZZLE_POOLS)
      for (const type of GAME_TYPES) {
        const of = bank.filter((p) => p.pool === pool && p.gameType === type);
        for (let k = 0; k < 20; k++) {
          const p = of[Math.floor((k * of.length) / 20)]!;
          expect(checkPuzzle(p.givens, p.solution)).toEqual({
            ok: true,
            givens: p.givens,
            solution: p.solution,
          });
          expect(gradePuzzle(parseGrid(p.givens)).difficulty).toBe(type);
        }
      }
  });

  it('importing the CSV again gives the very puzzles of the bank, so `npm run puzzles:import` adds none', () => {
    const imported = fitBankGivens(buildBank(bankRows(), 'sudoku-bank-690').puzzles).puzzles;
    const offlineFast = bank.filter((p) => p.pool === 'offline' && p.source === 'sudoku-bank-690');
    expect(imported.map((p) => p.id)).toEqual(offlineFast.map((p) => p.id));
    expect(imported).toEqual(offlineFast);
  }, 60_000);
});
