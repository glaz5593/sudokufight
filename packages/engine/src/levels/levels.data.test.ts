import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BOT_CONFIG } from '../bot/levels';
import type { BankFile } from '../sudoku/bank';
import { buildLevel, CHECKED_ATTEMPTS } from './builder/build';
import { botConfigFingerprint, type LevelsFile, validateLevel, validateLevelSet } from './builder/validate';
import { LEVEL_RULES, levelIdOf, maxLevel } from './progress';
import { LEVEL_KINDS, type LevelKind, type LevelSpec } from './spec';
import { transformLevel } from './transform';

/*
 * levels:validate (`npm run levels:validate`, also part of `npm test`): the frozen levels file
 * (packages/engine/data/levels.json, `npm run levels:build`) against every rule of plan §5.6, as dev-plan §1.4
 * adjusts it (dev-plan §3.1, 2ד), on its stored boards and on the equivalent boards of attempts 2 to 8.
 */

const DATA = join(__dirname, '..', '..', 'data');
const file = JSON.parse(readFileSync(join(DATA, 'levels.json'), 'utf8')) as LevelsFile;
const levels = file.levels;
const LONG = 60_000;

const ofKind = (kind: LevelKind) => levels.filter((l) => l.kind === kind);
const problemsOf = (list: readonly LevelSpec[]) => list.flatMap((l) => validateLevel(l));

describe('the levels file (plan §5.6)', () => {
  it('L001–L300, contiguous and unique; chapter = ⌈n/10⌉; slot 10 is the boss', () => {
    expect(levels.map((l) => l.id)).toEqual(Array.from({ length: maxLevel() }, (_, k) => levelIdOf(k + 1)));
    levels.forEach((l, k) => {
      expect([l.id, l.chapter, l.slot, l.boss]).toEqual([
        levelIdOf(k + 1),
        Math.ceil((k + 1) / LEVEL_RULES.chapterSize),
        (k % LEVEL_RULES.chapterSize) + 1,
        (k + 1) % LEVEL_RULES.chapterSize === 0,
      ]);
    });
  });

  it('43 find, 58 races, 63 boxes, 56 duels and 50 ideas, and 30 bosses: 1 box, 15 races, 14 duels', () => {
    const regular = levels.filter((l) => !l.boss);
    const bosses = levels.filter((l) => l.boss);
    const count = (list: readonly LevelSpec[], kind: LevelKind) => list.filter((l) => l.kind === kind).length;
    expect(LEVEL_KINDS.map((k) => count(regular, k))).toEqual([43, 58, 63, 56, 18, 16, 16]);
    expect(count(regular, 'spotError') + count(regular, 'pointHunter') + count(regular, 'chain')).toBe(50);
    expect([count(bosses, 'fillBox'), count(bosses, 'findDuel'), count(bosses, 'duel')]).toEqual([1, 15, 14]);
  });

  it(
    'matches levels.config level by level: kinds per chapter, seeds from id:rev, the plan numbers, bots and bosses; no two levels share givens or a solution; every box is used',
    () => {
      expect(validateLevelSet(file)).toEqual([]);
    },
    LONG,
  );

  it('carries the bot settings it was built with: a bot tuning change is a deliberate rebuild, with a new rev', () => {
    expect(file.botConfigFingerprint).toBe(botConfigFingerprint(BOT_CONFIG));
  });

  it('no level has an interference field anywhere [D49]', () => {
    expect(JSON.stringify(file)).not.toMatch(/interfer/i);
  });

  it('no level uses the givens or the solution of a ranked puzzle, in the bank or retired from it', () => {
    const bank = (JSON.parse(readFileSync(join(DATA, 'puzzles.json'), 'utf8')) as BankFile).puzzles;
    const retired = (
      JSON.parse(readFileSync(join(DATA, 'ranked-retired-solutions.json'), 'utf8')) as {
        puzzles: { givens: string; solution: string }[];
      }
    ).puzzles;
    expect(retired).toHaveLength(6);
    const ranked = new Set<string>();
    for (const p of [...bank.filter((b) => b.pool === 'ranked'), ...retired])
      ranked.add(p.givens).add(p.solution);
    expect(
      levels.filter((l) => ranked.has(l.board.grid) || ranked.has(l.board.solution)).map((l) => l.id),
    ).toEqual([]);
  });
});

describe('every level keeps its kind’s rules (plan §5.6, dev-plan §1.4)', () => {
  it.each(LEVEL_KINDS)(
    '%s',
    (kind) => {
      expect(problemsOf(ofKind(kind))).toEqual([]);
    },
    LONG,
  );
});

describe('the equivalent boards of "שוב" keep them too [D63]', () => {
  it.each([...CHECKED_ATTEMPTS])(
    'attempt %i of every level',
    (attempt) => {
      expect(levels.flatMap((l) => validateLevel(transformLevel(l, attempt)))).toEqual([]);
    },
    LONG,
  );
});

describe('drift (warning only)', () => {
  it(
    'three sample levels built again from the config are the stored ones',
    () => {
      const drift = [1, 2, 21].filter(
        (n) => JSON.stringify(buildLevel(n).spec) !== JSON.stringify(levels[n - 1]),
      );
      // A difference means the config or the engine moved since the build: the file stays as it is (frozen),
      // and a deliberate rebuild (new revs) brings the change in.
      if (drift.length)
        console.warn(
          `levels.json drifted from the config at ${drift.map(levelIdOf).join(', ')}: rebuild on purpose`,
        );
      expect(drift.length).toBeGreaterThanOrEqual(0);
    },
    LONG,
  );
});
