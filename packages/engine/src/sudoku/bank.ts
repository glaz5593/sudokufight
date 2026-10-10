import type { GameType } from '../gameType';
import { agreesWith, filledCount, gridToString, isSolvedGrid, parseGrid } from './board';
import { DEFAULT_GRADING, type Difficulty, gradePuzzle, type GradingRules } from './grade';
import type { Technique } from './logic';
import { countSolutions } from './solver';

/**
 * The puzzle bank (spec §19 `puzzles`, §20): validation, grading and de-duplication of imported puzzles.
 * Pure: the scripts (scripts/puzzles-import.ts, scripts/puzzles-generate.ts) read and write the files.
 */

/**
 * Two separate banks (spec §20): 'offline' ships inside the app for practice; 'ranked' lives only on the
 * server, because a ranked puzzle's solution must never reach the phone (spec §21).
 */
export const PUZZLE_POOLS = ['offline', 'ranked'] as const;
export type PuzzlePool = (typeof PUZZLE_POOLS)[number];

export interface PuzzleRecord {
  /** Stable: derived from the givens. */
  id: string;
  /** 81 characters, 0 = empty. */
  givens: string;
  /** 81 characters. */
  solution: string;
  gameType: GameType;
  difficulty: Difficulty;
  techniques: Technique[];
  givensCount: number;
  source: string;
  pool: PuzzlePool;
}

export type PuzzleCheck =
  | { ok: true; givens: string; solution: string }
  | { ok: false; reason: 'format' | 'badSolution' | 'mismatch' | 'notUnique' };

/** 81 cells each, a valid solution that agrees with the givens, and exactly one solution. */
export function checkPuzzle(givensText: string, solutionText: string): PuzzleCheck {
  let givens: number[];
  let solution: number[];
  try {
    givens = parseGrid(givensText);
    solution = parseGrid(solutionText);
  } catch {
    return { ok: false, reason: 'format' };
  }
  if (!isSolvedGrid(solution)) return { ok: false, reason: 'badSolution' };
  if (!agreesWith(givens, solution)) return { ok: false, reason: 'mismatch' };
  // The givens agree with a valid solution, so there is at least one; is it the only one?
  if (countSolutions(givens, 2) > 1) return { ok: false, reason: 'notUnique' };
  return { ok: true, givens: gridToString(givens), solution: gridToString(solution) };
}

/** A stable id from the givens: two 32-bit FNV-1a hashes, 16 hex characters. */
export function puzzleId(givens: string): string {
  const fnv = (s: string, basis: number): string => {
    let h = basis >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  return fnv(givens, 0x811c9dc5) + fnv([...givens].reverse().join(''), 0x2166136b);
}

/** Rows of a `puzzle,solution` CSV. A header row and blank lines are skipped. */
export interface CsvRow {
  /** 1-based line number in the file. */
  line: number;
  puzzle: string;
  solution: string;
}

export function parsePuzzleCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  text.split(/\r?\n/).forEach((raw, k) => {
    const line = raw.trim();
    if (!line) return;
    const [puzzle = '', solution = ''] = line.split(/[,;\t]/).map((s) => s.trim().replace(/^"|"$/g, ''));
    if (k === 0 && !/^[0-9.]{81}$/.test(puzzle)) return; // header
    rows.push({ line: k + 1, puzzle, solution });
  });
  return rows;
}

export interface BankReport {
  source: string;
  pool: PuzzlePool;
  rows: number;
  accepted: number;
  duplicates: number;
  rejected: { line: number; reason: string }[];
  /** Accepted puzzles per game type. */
  byGameType: Record<GameType, number>;
  /** Accepted puzzles per graded difficulty ('beyond' = needs more than our techniques). */
  byDifficulty: Record<Difficulty, number>;
  /** Valid puzzles the grading rules leave out (beyond every level, with beyondAs = null). */
  excluded: number;
  givens: { min: number; max: number; avg: number };
}

export function buildBank(
  rows: readonly { line: number; puzzle: string; solution: string }[],
  source: string,
  { pool = 'offline', grading = DEFAULT_GRADING }: { pool?: PuzzlePool; grading?: GradingRules } = {},
): { puzzles: PuzzleRecord[]; report: BankReport } {
  const puzzles: PuzzleRecord[] = [];
  const seen = new Set<string>();
  const report: BankReport = {
    source,
    pool,
    rows: rows.length,
    accepted: 0,
    duplicates: 0,
    rejected: [],
    byGameType: { fast: 0, normal: 0, hard: 0 },
    byDifficulty: { fast: 0, normal: 0, hard: 0, beyond: 0 },
    excluded: 0,
    givens: { min: 0, max: 0, avg: 0 },
  };
  for (const row of rows) {
    const check = checkPuzzle(row.puzzle, row.solution);
    if (!check.ok) {
      report.rejected.push({ line: row.line, reason: check.reason });
      continue;
    }
    if (seen.has(check.givens)) {
      report.duplicates++;
      continue;
    }
    seen.add(check.givens);
    const grade = gradePuzzle(parseGrid(check.givens), grading);
    if (!grade.gameType) {
      report.excluded++;
      continue;
    }
    puzzles.push({
      id: puzzleId(check.givens),
      givens: check.givens,
      solution: check.solution,
      gameType: grade.gameType,
      difficulty: grade.difficulty,
      techniques: grade.techniques,
      givensCount: filledCount(parseGrid(check.givens)),
      source,
      pool,
    });
    report.byGameType[grade.gameType]++;
    report.byDifficulty[grade.difficulty]++;
  }
  report.accepted = puzzles.length;
  if (puzzles.length) {
    const counts = puzzles.map((p) => p.givensCount);
    report.givens = {
      min: Math.min(...counts),
      max: Math.max(...counts),
      avg: Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 10) / 10,
    };
  }
  return { puzzles, report };
}

/** The bank file (packages/engine/data/puzzles.json). */
export interface BankFile {
  version: 1;
  puzzles: PuzzleRecord[];
}

/** Adds puzzles that are not in the bank yet (same id = same givens); returns the merged bank and how many were new. */
export function mergeIntoBank(
  bank: readonly PuzzleRecord[],
  add: readonly PuzzleRecord[],
): { puzzles: PuzzleRecord[]; added: number } {
  const ids = new Set(bank.map((p) => p.id));
  const fresh = add.filter((p) => !ids.has(p.id) && ids.add(p.id));
  return { puzzles: [...bank, ...fresh], added: fresh.length };
}

/** How many puzzles each pool holds per game type. */
export function bankSummary(puzzles: readonly PuzzleRecord[]): Record<PuzzlePool, Record<GameType, number>> {
  const out = {
    offline: { fast: 0, normal: 0, hard: 0 },
    ranked: { fast: 0, normal: 0, hard: 0 },
  };
  for (const p of puzzles) out[p.pool][p.gameType]++;
  return out;
}
