import {
  type AppLevel,
  LEVEL_END_REASONS,
  type LevelOutcome,
  levelOutcome,
  type PuzzleLevelOver,
} from '@sudoku-fight/engine';
import { MAX_PROPS_BYTES, type TelemetryProps } from '@sudoku-fight/protocol';

import { sanitizeProps } from '../../services/telemetry/batching';
import { mistakesOf } from '../levelsRepo';
import {
  chapterGateProps,
  type EventLevel,
  levelEndProps,
  levelMapOpenProps,
  levelPropOf,
  levelQuitProps,
  levelStartProps,
  levelTutorialProps,
} from '../analyticsProps';

/**
 * The props of staged practice's six events (plan §5.5; protocol LevelEventProps): flat, never an id, every
 * value one the server takes (it refuses a whole batch for one wrong prop), attempt on start and end.
 */

const FIND: EventLevel = { id: 'L037', kind: 'find' };
const DUEL: EventLevel = { id: 'L021', kind: 'duel', bot: { level: 1, pace: 1 } };
/** 1.0.3: a level as levels.json has it, with its rev [D73]. */
const PUZZLE: EventLevel = { id: 'L003', rev: 2, kind: 'puzzle' };

const outcome = (over: Partial<LevelOutcome> = {}): LevelOutcome => ({
  reason: 'completed',
  stars: 2,
  metric: 7400,
  elapsedMs: 7400,
  ...over,
});

/** One of each event, as a level screen would send it. */
const ALL: [string, TelemetryProps][] = [
  ['level_map_open', levelMapOpenProps(37, 88)],
  ['level_start', levelStartProps(FIND, { attempt: 1, bestStars: 0, quick: false })],
  ...LEVEL_END_REASONS.map((reason): [string, TelemetryProps] => [
    'level_end',
    levelEndProps(DUEL, outcome({ reason, metric: reason === 'quit' ? null : -4.5 }), {
      prevBest: 1,
      mistakes: 2,
      attempt: 3,
    }),
  ]),
  ['level_start', levelStartProps(PUZZLE, { attempt: 1, bestStars: 2, quick: false })],
  [
    'level_end',
    levelEndProps(PUZZLE, outcome({ metric: 30_000, elapsedMs: 30_000 }), {
      prevBest: 2,
      mistakes: 2,
      attempt: 1,
    }),
  ],
  ['level_quit', levelQuitProps(FIND, 12_345.6)],
  ['level_quit', levelQuitProps(PUZZLE, 12_345.6)],
  ['chapter_gate', chapterGateProps(5, 17, false)],
  ['level_tutorial', levelTutorialProps('boss', true)],
  ['level_tutorial', levelTutorialProps('puzzle', false)],
];

describe('the level events’ props', () => {
  it('level_start and level_end: the level by number, the chapter, the attempt', () => {
    expect(levelStartProps(FIND, { attempt: 2, bestStars: 1, quick: true })).toEqual({
      level: 37,
      chapter: 4,
      kind: 'find',
      attempt: 2,
      bestStars: 1,
      quick: true,
    });
    expect(levelEndProps(FIND, outcome(), { prevBest: 1, mistakes: 0, attempt: 2 })).toEqual({
      level: 37,
      kind: 'find',
      stars: 2,
      prevBest: 1,
      durationMs: 7400,
      reason: 'completed',
      mistakes: 0,
      metric: 7400,
      botLevel: null,
      attempt: 2,
    });
  });

  it('[D73] level_start, level_end and level_quit carry the level’s rev; none (never null) without one', () => {
    expect(levelStartProps(PUZZLE, { attempt: 1, bestStars: 2, quick: false })).toEqual({
      level: 3,
      rev: 2,
      chapter: 1,
      kind: 'puzzle',
      attempt: 1,
      bestStars: 2,
      quick: false,
    });
    expect(levelEndProps(PUZZLE, outcome(), { prevBest: 2, mistakes: 0, attempt: 1 })).toMatchObject({
      level: 3,
      rev: 2,
      kind: 'puzzle',
    });
    expect(levelQuitProps(PUZZLE, 4000)).toEqual({ level: 3, rev: 2, atMs: 4000 });
    // An app's level always has its rev; without one (a 1.0.2 shape) the key is left out, as before.
    expect(levelQuitProps(FIND, 4000)).toEqual({ level: 37, atMs: 4000 });
    expect('rev' in levelStartProps(FIND, { attempt: 1, bestStars: 0, quick: false })).toBe(false);
    expect('rev' in levelEndProps(FIND, outcome(), { prevBest: 0, mistakes: 0, attempt: 1 })).toBe(false);
    // A rev the server would refuse (0, a fraction, not a number) is left out or made whole, never sent bad.
    expect('rev' in levelStartProps({ ...FIND, rev: 0 }, { attempt: 1, bestStars: 0, quick: false })).toBe(
      false,
    );
    expect(
      'rev' in levelStartProps({ ...FIND, rev: Number.NaN }, { attempt: 1, bestStars: 0, quick: false }),
    ).toBe(false);
    expect(levelStartProps({ ...FIND, rev: 2.4 }, { attempt: 1, bestStars: 0, quick: false }).rev).toBe(2);
  });

  it('[D70c] a puzzle’s level_end: its mistakes are the wrong swaps (levelsRepo.mistakesOf), its measure the time', () => {
    const level = {
      ...PUZZLE,
      chapter: 1,
      stars: { by: 'timeMs', three: 26_000, two: 36_000, one: 45_000 },
    } as const;
    const end = {
      reason: 'targetReached',
      elapsedMs: 30_000,
      penaltyMs: 10_000,
      swaps: 6,
      mistakes: 2,
      stars: 0,
    } satisfies PuzzleLevelOver;
    expect(
      levelEndProps(level, levelOutcome(level, end), {
        prevBest: 0,
        mistakes: mistakesOf({ end }),
        attempt: 1,
      }),
    ).toEqual({
      level: 3,
      rev: 2,
      kind: 'puzzle',
      stars: 2,
      prevBest: 0,
      durationMs: 30_000,
      reason: 'completed',
      mistakes: 2,
      metric: 30_000,
      botLevel: null,
      attempt: 1,
    });
  });

  it('level_end: every reason of the engine (failed too), the bot’s level, a duel’s lead below 0', () => {
    const reasons = ALL.filter(([name]) => name === 'level_end')
      .slice(0, LEVEL_END_REASONS.length)
      .map(([, p]) => p.reason);
    expect(reasons).toEqual([...LEVEL_END_REASONS]);
    expect(reasons).toContain('failed');
    expect(
      levelEndProps(DUEL, outcome({ reason: 'botWon', metric: -6 }), {
        prevBest: 0,
        mistakes: 1,
        attempt: 1,
      }),
    ).toMatchObject({ reason: 'botWon', metric: -6, botLevel: 1 });
  });

  it('only values the server takes: whole times and counts within its bounds, null for no measure', () => {
    const odd = levelEndProps(
      FIND,
      outcome({ elapsedMs: Number.NaN, metric: Number.POSITIVE_INFINITY, stars: 3 }),
      { prevBest: 9, mistakes: -2, attempt: 0 },
    );
    expect(odd).toMatchObject({ durationMs: 0, metric: null, prevBest: 3, mistakes: 0, attempt: 1 });
    expect(
      levelEndProps(FIND, outcome({ elapsedMs: 9e9, metric: 5e7 }), { prevBest: 0, mistakes: 0, attempt: 1 }),
    ).toMatchObject({ durationMs: 86_400_000, metric: 1_000_000 });
    expect(levelQuitProps(FIND, 12_345.6)).toEqual({ level: 37, atMs: 12_346 });
    expect(levelMapOpenProps(0, 5000)).toEqual({ level: 1, stars: 900 });
    expect(chapterGateProps(1, 40, true)).toEqual({ chapter: 2, stars: 30, open: true });
    expect(levelTutorialProps('fillBox', false)).toEqual({ kind: 'fillBox', skipped: false });
  });

  it('a level’s number, never its id; an id that is not a level’s throws', () => {
    expect(levelPropOf('L001')).toBe(1);
    expect(levelPropOf('L300')).toBe(300);
    expect(() => levelPropOf('level-1')).toThrow(RangeError);
    expect(() =>
      levelStartProps({ id: 'L1', kind: 'find' } as AppLevel, { attempt: 1, bestStars: 0, quick: false }),
    ).toThrow(RangeError);
  });

  it.each(ALL)(
    '%s: flat, no id or uid key, unchanged by the queue’s check, within MAX_PROPS_BYTES',
    (_name, props) => {
      for (const [key, value] of Object.entries(props)) {
        expect(key).not.toMatch(/id$|ids$|uid|name|user|device|install/i);
        expect(value === null || ['string', 'number', 'boolean'].includes(typeof value)).toBe(true);
        expect(value).not.toBeUndefined();
      }
      expect(sanitizeProps(props)).toEqual(props);
      expect(new TextEncoder().encode(JSON.stringify(props)).length).toBeLessThanOrEqual(MAX_PROPS_BYTES);
    },
  );
});
