/* Test-only helpers: they read the repository's asset files, which the engine itself never does. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parsePuzzleCsv } from '../sudoku/bank';

export const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
export const BANK_CSV = join(REPO_ROOT, 'assets', 'puzzles', 'sudoku-bank-690.csv');
export const DESIGN_FIXTURES = join(REPO_ROOT, 'assets', 'puzzles', 'design-fixtures.json');

let bankCache: { puzzle: string; solution: string; line: number }[] | undefined;

/** The 690 puzzles of the original bank, as CSV rows. */
export function bankRows(): { puzzle: string; solution: string; line: number }[] {
  bankCache ??= parsePuzzleCsv(readFileSync(BANK_CSV, 'utf8'));
  return bankCache;
}

export interface FixtureLogEntry {
  t: number;
  type: 'correct' | 'wrong';
  seat: number;
  cell: string;
  digit: number;
  rowFilled?: number;
  colFilled?: number;
  boxFilled?: number;
  digitCount?: number;
  X?: number;
  Y?: number;
  points?: number;
  penalty?: number;
  score: number;
  expl: { technique: string; cell: string; digit: number };
}

export interface FixtureScenario {
  puzzleIndex: number;
  puzzle: string;
  solution: string;
  grid: string;
  players: { seat: number; score: number; mistakes: number; correct: number }[];
  log: FixtureLogEntry[];
}

export function designScenarios(): Record<string, FixtureScenario> {
  return (JSON.parse(readFileSync(DESIGN_FIXTURES, 'utf8')) as { scenarios: Record<string, FixtureScenario> })
    .scenarios;
}

/** Builds an 81-cell grid from a map like { D1: 1, A5: 3 }. */
export function gridFrom(cells: Record<string, number>): number[] {
  const rows = 'ABCDEFGHI';
  const grid = new Array<number>(81).fill(0);
  for (const [name, v] of Object.entries(cells)) {
    const r = rows.indexOf(name[0]!);
    const c = Number(name[1]) - 1;
    grid[r * 9 + c] = v;
  }
  return grid;
}
