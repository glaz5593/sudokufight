/**
 * Puzzle generator (spec §20, work plan stage 1).
 *
 *   npm run puzzles:generate -- --type hard --count 300 [--pool offline|ranked] [--seed 42]
 *
 * Makes puzzles with exactly one solution, grades each one, and keeps it only if it is of the asked type.
 * Fast and normal ones then land in their type's givens range (fitBankGivens, DEFAULT_GIVENS [D43]): givens
 * from their own solution, without making them easier; one that can't fit counts as a miss. Hard ones stay as
 * generated (hard has no givens range). New puzzles are added to
 * packages/engine/data/puzzles.json. The seed is printed, so a run can be repeated.
 */
import {
  createRng,
  fitBankGivens,
  GAME_TYPES,
  type GameType,
  type GeneratedPuzzle,
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

function toRecord(p: GeneratedPuzzle): PuzzleRecord {
  const givens = gridToString(p.givens);
  const grade = gradePuzzle(p.givens);
  return {
    id: puzzleId(givens),
    givens,
    solution: gridToString(p.solution),
    gameType: type,
    difficulty: grade.difficulty,
    techniques: grade.techniques,
    givensCount: p.givens.filter((v) => v !== 0).length,
    source: `generator:${seed}`,
    pool,
  };
}

console.log(`Generating ${count} × ${type} into pool ${pool} (seed ${seed})`);
const rng = createRng(seed);
const made: PuzzleRecord[] = [];
const ids = new Set(readBank().map((p) => p.id));
const started = Date.now();
let misses = 0;
while (made.length < count) {
  // Fast and normal get givens back in the fit below; hard has no givens range and stays as generated.
  const p = generatePuzzle(rng, type);
  const fitted = p ? fitBankGivens([toRecord(p)], { salt: seed }).puzzles[0] : undefined;
  if (!fitted) {
    if (++misses > 50) throw new Error(`No ${type} puzzle after 50 rounds; stopping`);
    continue;
  }
  if (ids.has(fitted.id)) continue; // the id of the puzzle as it lands in the bank
  ids.add(fitted.id);
  made.push(fitted);
  if (made.length % 25 === 0 || made.length === count)
    console.log(`  ${made.length}/${count} · ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

const merged = mergeIntoBank(readBank(), made);
writeBank(merged.puzzles);
console.log(`Added ${merged.added} puzzles.`);
printSummary(merged.puzzles);
