import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { checkPuzzle } from '@sudoku-fight/engine';

import { NEARLY_DONE, PUZZLE } from '../testing/game';
import { bankPuzzleSource, fixedPuzzleSource } from './puzzles';

describe('the puzzles of server games', () => {
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'puzzles-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const bank = (puzzles: object[]) => {
    const file = path.join(dir, `bank-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, JSON.stringify({ version: 1, puzzles }));
    return file;
  };
  const record = (id: string, gameType: string, pool: string) => ({
    id,
    givens: PUZZLE.givens,
    solution: PUZZLE.solution,
    gameType,
    pool,
    difficulty: gameType,
    techniques: [],
    givensCount: 30,
    source: 'test',
  });

  it('come from the real bank: a valid puzzle of the game type', () => {
    const source = bankPuzzleSource({ nodeEnv: 'development' });
    for (const gameType of ['fast', 'normal', 'hard'] as const) {
      const p = source.pick(gameType);
      expect(checkPuzzle(p.givens, p.solution)).toMatchObject({ ok: true });
    }
  });

  it("take the 'ranked' pool when it has puzzles of the type (it never ships in the app)", () => {
    const file = bank([record('off-1', 'fast', 'offline'), record('rk-1', 'fast', 'ranked')]);
    const source = bankPuzzleSource({ nodeEnv: 'production', file, random: () => 0 });
    expect(source.pick('fast').id).toBe('rk-1');
  });

  it("fall back to the 'offline' pool outside production only", () => {
    const file = bank([record('off-1', 'fast', 'offline'), record('off-2', 'fast', 'offline')]);
    expect(bankPuzzleSource({ nodeEnv: 'test', file, random: (n) => n - 1 }).pick('fast').id).toBe('off-2');
    expect(() => bankPuzzleSource({ nodeEnv: 'production', file }).pick('fast')).toThrow('No fast puzzles');
    expect(() => bankPuzzleSource({ nodeEnv: 'test', file }).pick('hard')).toThrow('No hard puzzles');
  });

  it('read the bank only when a game needs one', () => {
    const source = bankPuzzleSource({ nodeEnv: 'test', file: path.join(dir, 'missing.json') });
    expect(() => source.pick('fast')).toThrow();
  });

  it('can be one fixed puzzle (tests)', () => {
    expect(fixedPuzzleSource(NEARLY_DONE).pick('hard')).toBe(NEARLY_DONE);
  });
});
