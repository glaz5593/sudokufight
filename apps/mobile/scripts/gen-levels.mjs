// Builds src/levels/data/levels.json from the engine's levels (packages/engine/data/levels.json, made by
// `npm run levels:build`). The app ships the levels without the builder's checks: each keeps only the fields
// of AppLevel (packages/engine/src/levels/spec.ts), loaded lazily when staged practice opens (plan §5.3).
//   npm run levels -w @sudoku-fight/mobile
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const source = join(here, '..', '..', '..', 'packages', 'engine', 'data', 'levels.json');
export const target = join(here, '..', 'src', 'levels', 'data', 'levels.json');

/** The fields of an AppLevel, in the order the engine's file keeps them (LevelSpec without `check`). */
export const APP_LEVEL_FIELDS = [
  'id',
  'rev',
  'chapter',
  'slot',
  'kind',
  'boss',
  'seed',
  'gameType',
  'board',
  'timeLimitMs',
  'targets',
  'stars',
  'bot',
  'worthHint',
];

/** The app's levels of a levels file's contents: AppLevel fields only, in level order. */
export function appLevels(file) {
  return file.levels.map((level) =>
    Object.fromEntries(APP_LEVEL_FIELDS.filter((k) => level[k] !== undefined).map((k) => [k, level[k]])),
  );
}

/** The file's text: compact JSON, one array. */
export function generate(levelsText = readFileSync(source, 'utf8')) {
  return JSON.stringify(appLevels(JSON.parse(levelsText))) + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = generate();
  writeFileSync(target, text);
  const levels = JSON.parse(text);
  const byKind = {};
  for (const l of levels) byKind[l.kind] = (byKind[l.kind] ?? 0) + 1;
  console.log(
    `Wrote ${levels.length} levels to ${target} (${(Buffer.byteLength(text) / 1024).toFixed(1)} KB)`,
    byKind,
  );
}
