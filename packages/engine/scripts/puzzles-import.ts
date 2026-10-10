/**
 * Puzzle import (spec §20, work plan stage 1).
 *
 *   npm run puzzles:import -- [file.csv ...] [--pool offline|ranked]
 *
 * Reads `puzzle,solution` CSV files (81 characters each, 0 or . for empty), checks every puzzle (81 cells,
 * a valid solution that matches, exactly one solution), grades it, drops duplicates, and adds it to
 * packages/engine/data/puzzles.json with its game type and pool. Invalid puzzles are reported, not saved.
 * Default input: assets/puzzles/sudoku-bank-690.csv into the offline pool.
 */
import { readFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

import { buildBank, mergeIntoBank, parsePuzzleCsv, PUZZLE_POOLS, type PuzzlePool } from '../src';
import { parseArgs, printSummary, readBank, REPO_ROOT, writeBank } from './bankFile';

const { flags, rest } = parseArgs(process.argv.slice(2));
const pool = (flags.get('pool') ?? 'offline') as PuzzlePool;
if (!PUZZLE_POOLS.includes(pool)) throw new Error(`--pool must be one of ${PUZZLE_POOLS.join(', ')}`);
const files = rest.length ? rest : [join(REPO_ROOT, 'assets', 'puzzles', 'sudoku-bank-690.csv')];

let bank = readBank();
for (const file of files) {
  const source = basename(file, extname(file));
  const { puzzles, report } = buildBank(parsePuzzleCsv(readFileSync(file, 'utf8')), source, { pool });
  const merged = mergeIntoBank(bank, puzzles);
  bank = merged.puzzles;

  console.log(`\n${relative(REPO_ROOT, file)} → pool ${pool}`);
  console.log(
    `  rows ${report.rows} · valid ${report.accepted} · duplicates ${report.duplicates} · invalid ${report.rejected.length}` +
      ` · beyond our techniques ${report.excluded} · new in the bank ${merged.added}`,
  );
  console.log(`  givens: min ${report.givens.min} · max ${report.givens.max} · avg ${report.givens.avg}`);
  console.log(
    `  by game type: fast ${report.byGameType.fast} · normal ${report.byGameType.normal} · hard ${report.byGameType.hard}`,
  );
  for (const r of report.rejected.slice(0, 20)) console.log(`  invalid, line ${r.line}: ${r.reason}`);
  if (report.rejected.length > 20) console.log(`  … and ${report.rejected.length - 20} more`);
}

writeBank(bank);
printSummary(bank);
