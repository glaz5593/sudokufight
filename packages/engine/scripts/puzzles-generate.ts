/**
 * Puzzle generator (spec §20, work plan stage 1).
 *
 *   npm run puzzles:generate -- --type hard --count 300 [--pool offline|ranked] [--seed 42]
 *
 * Makes puzzles with exactly one solution, grades each one, and keeps it only if it is of the asked type.
 * New puzzles are added to packages/engine/data/puzzles.json. The seed is printed, so a run can be repeated.
 */
import {
  createRng,
  GAME_TYPES,
  type GameType,
  generatePuzzle,
  gradePuzzle,
  gridToString,
  mergeIntoBank,
  PUZZLE_POOLS,
  type PuzzlePool,
  type PuzzleRecord,
  puzzleId,
} from '../src';
import { parseArgs, printSummary, readBank, writeBank } from './bankFile';

const { flags } = parseArgs(process.argv.slice(2));
const type = flags.get('type') as GameType;
const count = Number(flags.get('count') ?? 10);
const pool = (flags.get('pool') ?? 'offline') as PuzzlePool;
const seed = Number(flags.get('seed') ?? Date.now() % 2 ** 31);
if (!GAME_TYPES.includes(type)) throw new Error(`--type must be one of ${GAME_TYPES.join(', ')}`);
if (!PUZZLE_POOLS.includes(pool)) throw new Error(`--pool must be one of ${PUZZLE_POOLS.join(', ')}`);
if (!Number.isInteger(count) || count < 1) throw new Error('--count must be a positive integer');

console.log(`Generating ${count} × ${type} into pool ${pool} (seed ${seed})`);
const rng = createRng(seed);
const made: PuzzleRecord[] = [];
const ids = new Set(readBank().map((p) => p.id));
const started = Date.now();
let misses = 0;
while (made.length < count) {
  const p = generatePuzzle(rng, type);
  if (!p) {
    if (++misses > 50) throw new Error(`No ${type} puzzle after 50 rounds; stopping`);
    continue;
  }
  const givens = gridToString(p.givens);
  const id = puzzleId(givens);
  if (ids.has(id)) continue;
  ids.add(id);
  const grade = gradePuzzle(p.givens);
  made.push({
    id,
    givens,
    solution: gridToString(p.solution),
    gameType: type,
    difficulty: grade.difficulty,
    techniques: grade.techniques,
    givensCount: p.givens.filter((v) => v !== 0).length,
    source: `generator:${seed}`,
    pool,
  });
  if (made.length % 25 === 0 || made.length === count)
    console.log(`  ${made.length}/${count} · ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

const merged = mergeIntoBank(readBank(), made);
writeBank(merged.puzzles);
console.log(`Added ${merged.added} puzzles.`);
printSummary(merged.puzzles);
