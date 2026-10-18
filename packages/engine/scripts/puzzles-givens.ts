/**
 * Givens at the start per game type (spec §5.2, §20) [D43]:
 *
 *   npm run puzzles:givens [-- --dry-run] [--salt 20261015]
 *
 * Brings every puzzle of packages/engine/data/puzzles.json into its type's givens range (DEFAULT_GIVENS:
 * fast 45–50, normal 35–40; hard has no range and is never touched). A puzzle with too few givens gets more
 * from its own solution: seeded by its id, the digit with the fewest givens first, without making it easier
 * than its type (fitBankGivens). A puzzle already in range is left as it is. One that can't fit is left out, and the shortfalls are printed
 * with the command that makes up for them. Deterministic: the same bank gives the same file, and a second run
 * changes nothing. --dry-run prints the report and writes nothing.
 */
import {
  checkPuzzle,
  DEFAULT_FIT,
  DEFAULT_GIVENS,
  fitBankGivens,
  type FitBankKey,
  GAME_TYPES,
  PUZZLE_POOLS,
  type PuzzlePool,
} from '../src';
import { parseArgs, printSummary, readBank, writeBank } from './bankFile';

/** The smallest pool per game type (spec §20; the server test asks for 2,000 ranked per type). */
const MIN_POOL: Record<PuzzlePool, number> = { offline: 200, ranked: 2000 };

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const { flags } = parseArgs(argv.filter((a) => a !== '--dry-run'));
const salt = Number(flags.get('salt') ?? DEFAULT_FIT.salt);
if (!Number.isInteger(salt)) throw new Error('--salt must be an integer');

const bank = readBank();
console.log(
  `Fitting ${bank.length} puzzles to the givens ranges ` +
    GAME_TYPES.map((t) => {
      const range = DEFAULT_GIVENS[t];
      return range ? `${t} ${range.min}–${range.max}` : `${t} as it is`;
    }).join(', ') +
    ` (salt ${salt})${dryRun ? ', dry run' : ''}…`,
);
const started = Date.now();
const { puzzles, report } = fitBankGivens(bank, { salt });

// Safety net: every changed puzzle is still valid, with exactly one solution.
const before = new Set(bank);
for (const p of puzzles) {
  if (before.has(p)) continue;
  const check = checkPuzzle(p.givens, p.solution);
  if (!check.ok)
    throw new Error(`Puzzle ${p.id} (from ${p.baseId}) is not valid after the fit: ${check.reason}`);
}

console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s.\n`);
console.log(
  `  ${'pool/type'.padEnd(16)}${'before'.padStart(8)}${'after'.padStart(8)}${'noRange'.padStart(9)}${'inRange'.padStart(9)}` +
    `${'filled'.padStart(8)}${'tooMany'.padStart(9)}${'gradeLost'.padStart(11)}${'dup'.padStart(5)}` +
    `   givens min–max avg   max digit spread`,
);
for (const key of Object.keys(report.byKey) as FitBankKey[]) {
  const s = report.byKey[key];
  if (s.before === 0) continue;
  console.log(
    `  ${key.padEnd(16)}${String(s.before).padStart(8)}${String(s.after).padStart(8)}${String(s.noRange).padStart(9)}` +
      `${String(s.inRange).padStart(9)}` +
      `${String(s.filled).padStart(8)}${String(s.tooMany).padStart(9)}${String(s.gradeLost).padStart(11)}` +
      `${String(s.duplicates).padStart(5)}   ${`${s.givens.min}–${s.givens.max} ${s.givens.avg}`.padEnd(18)}` +
      `${String(s.maxSpread).padStart(4)}`,
  );
}
for (const d of report.dropped) console.log(`  dropped ${d.id} (${d.pool}/${d.gameType}): ${d.reason}`);

// Shortfalls: fewer than the pool needs, or fewer than before the fit (then the generator makes up for them).
const shortfalls: string[] = [];
for (const pool of PUZZLE_POOLS)
  for (const type of GAME_TYPES) {
    const s = report.byKey[`${pool}/${type}`];
    if (s.before === 0) continue;
    const need = Math.max(MIN_POOL[pool], s.before) - s.after;
    if (need > 0)
      shortfalls.push(
        `  ${pool}/${type}: ${need} short → npm run puzzles:generate -- --type ${type} --count ${need} --pool ${pool} --seed <n>`,
      );
  }
if (shortfalls.length) console.log(`\nShortfalls (run after this script):\n${shortfalls.join('\n')}`);

if (dryRun) {
  console.log('\nDry run: nothing written.');
} else {
  writeBank(puzzles);
  console.log('\nWritten. Next: npm run pool -w @sudoku-fight/mobile');
  printSummary(puzzles);
}
