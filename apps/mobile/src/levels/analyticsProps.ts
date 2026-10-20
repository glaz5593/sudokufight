import {
  type AppLevel,
  chapterOf,
  LEVEL_RULES,
  type LevelOutcome,
  levelNumber,
  type LevelRules,
  maxLevel,
  type Stars,
} from '@sudoku-fight/engine';
import type { LevelEventProps, LevelTutorialKind, TelemetryProps } from '@sudoku-fight/protocol';

/**
 * The props of staged practice's six events (1.0.2; plan §5.5; protocol telemetry.ts LevelEventProps), as the
 * level screens send them. Pure: no React Native or Expo imports, so the server's contract test sends the very
 * same props and checks that every batch is taken.
 *
 * The server checks each prop (its ranges and kinds) and refuses the whole batch for one wrong value, so these
 * builders only make values it takes: `level` is the level's number, never its id (the app's GA4 filter drops
 * every key ending in "id"); times and counts are whole and within the server's bounds; a value that is
 * missing is null, never undefined (which the queue would leave out). Flat, and far below MAX_PROPS_BYTES.
 *
 * 1.0.3: level_start, level_end and level_quit carry the level's `rev` [D73], so the admin site can tell a
 * rebuilt level's plays from the old ones'. It is the one prop that is left out rather than null when unknown: the server takes
 * it optional (an app before 1.0.3 sends none), never null. A level from levels.json always has one.
 */

/** The props of `name`, as track() takes them. */
export type LevelProps<N extends keyof LevelEventProps> = LevelEventProps[N] & TelemetryProps;

/** The level an event is about: its id and what its props say of it (its rev, when known). */
export type EventLevel = Pick<AppLevel, 'id' | 'kind' | 'bot'> & { rev?: number };

/** The server's bound on a time in a level (a day: a level lasts 30 s, the bound only keeps junk out). */
const MAX_MS = 24 * 3600 * 1000;
/** The server's bound on a count (an attempt, mistakes) and on a measure. */
const MAX_COUNT = 1_000_000;

const finite = (n: number): number => (Number.isFinite(n) ? n : 0);
const whole = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(finite(n))));
const ms = (n: number): number => whole(n, 0, MAX_MS);
const stars = (n: number): Stars => whole(n, 0, 3) as Stars;

/** `{ rev }` for a level with a whole rev of 1 or more; nothing otherwise (the server takes it optional). */
const revOf = (level: { rev?: number }): { rev?: number } =>
  typeof level.rev === 'number' && Number.isFinite(level.rev) && level.rev >= 1
    ? { rev: whole(level.rev, 1, MAX_COUNT) }
    : {};

/** A level's number for the props: "L037" → 37. Throws for an id that is not a level's. */
export function levelPropOf(id: string): number {
  const n = levelNumber(id);
  if (n === null) throw new RangeError(`Not a level: ${id}`);
  return n;
}

/** level_map_open: the map's current level, and all my best stars. */
export function levelMapOpenProps(
  current: number,
  allStars: number,
  rules: LevelRules = LEVEL_RULES,
): LevelProps<'level_map_open'> {
  const last = maxLevel(rules);
  return { level: whole(current, 1, last), stars: whole(allStars, 0, 3 * last) };
}

/** level_start: when a level's clock starts (after "מוכן?" or "איך משחקים"). */
export function levelStartProps(
  level: EventLevel,
  start: { attempt: number; bestStars: number; quick: boolean },
  rules: LevelRules = LEVEL_RULES,
): LevelProps<'level_start'> {
  return {
    level: levelPropOf(level.id),
    ...revOf(level),
    chapter: chapterOf(level.id, rules),
    kind: level.kind,
    attempt: whole(start.attempt, 1, MAX_COUNT),
    bestStars: stars(start.bestStars),
    quick: start.quick,
  };
}

/**
 * level_end: an attempt's end as the engine's levelOutcome read it (a quit with the X, and `failed`, too).
 * `mistakes` is levelsRepo's mistakesOf: a puzzle's are its wrong swaps [D70c].
 */
export function levelEndProps(
  level: EventLevel,
  outcome: LevelOutcome,
  end: { prevBest: number; mistakes: number; attempt: number },
): LevelProps<'level_end'> {
  const { metric } = outcome;
  return {
    level: levelPropOf(level.id),
    ...revOf(level),
    kind: level.kind,
    stars: stars(outcome.stars),
    prevBest: stars(end.prevBest),
    durationMs: ms(outcome.elapsedMs),
    reason: outcome.reason,
    mistakes: whole(end.mistakes, 0, MAX_COUNT),
    metric:
      metric === null || !Number.isFinite(metric) ? null : Math.min(MAX_COUNT, Math.max(-MAX_COUNT, metric)),
    botLevel: level.bot?.level ?? null,
    attempt: whole(end.attempt, 1, MAX_COUNT),
  };
}

/** level_quit: an attempt left without an end (the app went away mid-level), at the level clock `atMs`. */
export function levelQuitProps(
  level: Pick<AppLevel, 'id'> & { rev?: number },
  atMs: number,
): LevelProps<'level_quit'> {
  return { level: levelPropOf(level.id), ...revOf(level), atMs: ms(atMs) };
}

/** chapter_gate: an attempt at the gate in front of `chapter` (2 and up), with the chapter before's stars. */
export function chapterGateProps(
  chapter: number,
  chapterStars: number,
  open: boolean,
  rules: LevelRules = LEVEL_RULES,
): LevelProps<'chapter_gate'> {
  return {
    chapter: whole(chapter, 2, rules.chapterCount),
    stars: whole(chapterStars, 0, 3 * rules.chapterSize),
    open,
  };
}

/** level_tutorial: "איך משחקים" of a kind (or the boss's) was shown, and gone through or skipped. */
export function levelTutorialProps(kind: LevelTutorialKind, skipped: boolean): LevelProps<'level_tutorial'> {
  return { kind, skipped };
}
