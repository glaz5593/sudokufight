// Builds src/game/data/offline-puzzles.json from the engine's bank (packages/engine/data/puzzles.json).
// Only the 'offline' pool ships inside the app: a ranked puzzle's solution must never reach the phone
// (spec §20, §21). Each puzzle keeps what practice needs: id, givens, solution, gameType.
//   npm run pool -w @sudoku-fight/mobile
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const source = join(here, '..', '..', '..', 'packages', 'engine', 'data', 'puzzles.json');
export const target = join(here, '..', 'src', 'game', 'data', 'offline-puzzles.json');

/** The offline puzzles of a bank file's contents, in bank order. */
export function offlinePuzzles(bank) {
  return bank.puzzles
    .filter((p) => p.pool === 'offline')
    .map(({ id, givens, solution, gameType }) => ({ id, givens, solution, gameType }));
}

/** The file's text: compact JSON, one array. */
export function generate(bankText = readFileSync(source, 'utf8')) {
  return JSON.stringify(offlinePuzzles(JSON.parse(bankText))) + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = generate();
  writeFileSync(target, text);
  const puzzles = JSON.parse(text);
  const byType = {};
  for (const p of puzzles) byType[p.gameType] = (byType[p.gameType] ?? 0) + 1;
  console.log(`Wrote ${puzzles.length} offline puzzles to ${target}`, byType);
}
