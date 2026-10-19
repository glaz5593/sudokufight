import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { AppLevel } from '@sudoku-fight/engine';

/*
 * The app's copy of the levels (src/levels/data/levels.json, `npm run levels -w @sudoku-fight/mobile`): the
 * engine's frozen file (packages/engine/data/levels.json, `npm run levels:build`) without the builder's checks,
 * byte for byte what scripts/gen-levels.mjs writes, within its size budget.
 */

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const ENGINE_FILE = join(ROOT, 'packages', 'engine', 'data', 'levels.json');
const APP_FILE = join(__dirname, '..', 'data', 'levels.json');

/** Every field of an AppLevel, in the engine file's order (as gen-levels.mjs keeps them). */
const FIELDS = [
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
] as const satisfies readonly (keyof AppLevel)[];
// Every AppLevel field is listed: a new one fails to compile here until the copy keeps it.
type Unlisted = Exclude<keyof AppLevel, (typeof FIELDS)[number]>;
const allListed: [Unlisted] extends [never] ? true : false = true;

/** The engine's levels (LevelSpec, with the build checks), as plain records. */
const engineLevels = (JSON.parse(readFileSync(ENGINE_FILE, 'utf8')) as { levels: Record<string, unknown>[] })
  .levels;
const appText = readFileSync(APP_FILE, 'utf8');
const appLevels = JSON.parse(appText) as AppLevel[];

/** What the app keeps of a level: its AppLevel fields. */
const expected = engineLevels.map((level) =>
  Object.fromEntries(FIELDS.filter((k) => level[k] !== undefined).map((k) => [k, level[k]])),
);

describe('the levels in the app (plan §5.3, dev-plan §2ד)', () => {
  it('lists every AppLevel field', () => {
    expect(allListed).toBe(true);
  });

  it('is the engine file, field for field (run `npm run levels -w @sudoku-fight/mobile` after levels:build)', () => {
    expect(appLevels).toEqual(expected);
    expect(appText).toBe(JSON.stringify(expected) + '\n');
  });

  it('keeps only the fields the app plays by: no build check', () => {
    const keys = new Set(appLevels.flatMap((l) => Object.keys(l)));
    expect([...keys].filter((k) => !(FIELDS as readonly string[]).includes(k))).toEqual([]);
    expect(keys.has('check')).toBe(false);
  });

  // The agreed limit (the lead, 2026-10-19, option A; spec §5.3.7): 180 KB. The plan's "about 100 KB" does not hold
  // for AppLevel as plain JSON: the 300 levels are about 171 KB (36 KB gzipped), the boards 60 KB of it, the race's
  // spots and frozen bot 44 KB. The file is loaded only when the levels open (levelsData requires it on first use;
  // startupGraph.test keeps it off the start), so its size costs no start time. A shorter board format (a givens
  // bitmask: 148 KB; a positional form: about 70 KB) stays an option if it grows; this guards against growth.
  it('stays within the agreed size limit (180 KB)', () => {
    expect(statSync(APP_FILE).size).toBeLessThanOrEqual(180 * 1024);
  });
});
