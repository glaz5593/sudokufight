/* The bank file on disk: packages/engine/data/puzzles.json (spec §20, work plan stage 1). */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type BankFile, bankSummary, GAME_TYPES, PUZZLE_POOLS, type PuzzleRecord } from '../src';

export const ENGINE_ROOT = join(__dirname, '..');
export const REPO_ROOT = join(ENGINE_ROOT, '..', '..');
export const BANK_PATH = join(ENGINE_ROOT, 'data', 'puzzles.json');

export function readBank(path = BANK_PATH): PuzzleRecord[] {
  if (!existsSync(path)) return [];
  return (JSON.parse(readFileSync(path, 'utf8')) as BankFile).puzzles;
}

/** One puzzle per line: small diffs, easy to read. */
export function writeBank(puzzles: readonly PuzzleRecord[], path = BANK_PATH): void {
  const lines = puzzles.map((p) => '    ' + JSON.stringify(p));
  writeFileSync(path, `{\n  "version": 1,\n  "puzzles": [\n${lines.join(',\n')}\n  ]\n}\n`);
}

export function printSummary(puzzles: readonly PuzzleRecord[]): void {
  const s = bankSummary(puzzles);
  console.log('\nBank (packages/engine/data/puzzles.json):');
  console.log(`  ${'pool'.padEnd(8)}${GAME_TYPES.map((t) => t.padStart(8)).join('')}`);
  for (const pool of PUZZLE_POOLS)
    console.log(`  ${pool.padEnd(8)}${GAME_TYPES.map((t) => String(s[pool][t]).padStart(8)).join('')}`);
  console.log(`  total   ${String(puzzles.length).padStart(8)}`);
}

/** --name value pairs and bare arguments. */
export function parseArgs(argv: string[]): { flags: Map<string, string>; rest: string[] } {
  const flags = new Map<string, string>();
  const rest: string[] = [];
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k]!;
    if (a.startsWith('--')) flags.set(a.slice(2), argv[++k] ?? '');
    else rest.push(a);
  }
  return { flags, rest };
}
