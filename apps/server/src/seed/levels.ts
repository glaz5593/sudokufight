import {
  type BotLevelId,
  chapterOf,
  isBossLevel,
  LEVEL_KINDS,
  LEVEL_METRIC,
  LEVEL_RULES,
  type LevelEndReason,
  type LevelKind,
  type Rng,
  type Stars,
} from '@sudoku-fight/engine';

import { between, chance, intBetween, weighted } from './random';

/**
 * Staged practice (1.0.2) in the sample data: which kind each level is, and how an attempt at it goes for a
 * player of some skill. A rough model of plan §4 (the real levels come from levels.json, which the server does
 * not read): good enough for the admin's "שלבים" page to show what it is for.
 *
 * - Kinds come in as in plan §4.1: chapter 1 has find and fillBox, chapter 2 adds the race, 3 the duel, 4 the
 *   first idea (spotError), 7 and 9 the other two. The boss: fillBox in chapter 1, then a race in the even
 *   chapters and a duel in the odd ones.
 * - Stars: a player's level (casual, good, excellent) less a drop per chapter and the chapter's "saw tooth"
 *   (levels 1–3 easier, 7–9 harder, the boss hardest), plus what a replay has taught, plus noise.
 *   SAMPLE_HARD_LEVELS and SAMPLE_HARD_CHAPTERS are made too hard on purpose, so the page has something to
 *   point at.
 */

export const LEVEL_SKILLS = ['casual', 'good', 'excellent'] as const;
export type LevelSkill = (typeof LEVEL_SKILLS)[number];

const SKILL: Record<LevelSkill, { base: number; drop: number }> = {
  casual: { base: 2.3, drop: 0.09 },
  good: { base: 2.7, drop: 0.05 },
  excellent: { base: 3.1, drop: 0.025 },
};

/** Stars taken off a level's expected stars: these are too hard (more than 60% get 0 on the first try). */
export const SAMPLE_HARD_LEVELS: Readonly<Record<number, number>> = { 14: 2.4, 27: 2.2 };
/** Stars taken off every level of these chapters: their gates hold casual players back (the page says soften). */
export const SAMPLE_HARD_CHAPTERS: Readonly<Record<number, number>> = { 3: 0.7 };

/** A quit with the X: the share of attempts. */
const QUIT_SHARE = 0.04;

export function sampleLevelKind(n: number): LevelKind {
  const chapter = chapterOf(n);
  if (isBossLevel(n)) return chapter === 1 ? 'fillBox' : chapter % 2 === 0 ? 'findDuel' : 'duel';
  const kinds: readonly LevelKind[] =
    chapter === 1
      ? ['find', 'fillBox']
      : chapter === 2
        ? ['find', 'findDuel', 'fillBox']
        : chapter === 3
          ? ['find', 'findDuel', 'fillBox', 'duel']
          : chapter < 7
            ? ['find', 'findDuel', 'fillBox', 'duel', 'spotError']
            : chapter < 9
              ? ['find', 'findDuel', 'fillBox', 'duel', 'spotError', 'pointHunter']
              : LEVEL_KINDS;
  return kinds[(n - 1) % kinds.length]!;
}

/** The bot of a level with one (plan §4.2): Pip, Biscuit, Mr. Hoot, Maestro; Overlord as the last bosses. */
export function sampleBotLevel(n: number, kind: LevelKind): BotLevelId | null {
  if (kind !== 'findDuel' && kind !== 'duel') return null;
  const chapter = chapterOf(n);
  if (isBossLevel(n) && chapter >= 28) return 5;
  return chapter <= 4 ? 1 : chapter <= 9 ? 2 : chapter <= 17 ? 3 : 4;
}

export interface SampleAttempt {
  stars: Stars;
  reason: LevelEndReason;
  durationMs: number;
  mistakes: number;
  metric: number | null;
}

/** The level clock at a done end of the kinds whose stars go by time, by the stars it got. */
const TIME_BY_STARS: Record<1 | 2 | 3, readonly [number, number]> = {
  1: [14_000, 26_000],
  2: [8_000, 16_000],
  3: [3_000, 9_000],
};

const clampStars = (x: number): Stars => Math.min(3, Math.max(0, Math.round(x))) as Stars;

/** One attempt (number `attempt`, 1 for the first) at level `n` by a player of `skill`. */
export function sampleAttempt(rng: Rng, skill: LevelSkill, n: number, attempt: number): SampleAttempt {
  const kind = sampleLevelKind(n);
  const limit = LEVEL_RULES.levelMaxMs;
  if (chance(rng, QUIT_SHARE)) {
    return {
      stars: 0,
      reason: 'quit',
      durationMs: intBetween(rng, 2_000, 15_000),
      mistakes: 0,
      metric: null,
    };
  }
  const pos = (n - 1) % LEVEL_RULES.chapterSize;
  const saw = isBossLevel(n) ? -0.45 : pos < 3 ? 0.25 : pos < 6 ? 0 : -0.25;
  const learned = Math.min(1.2, 0.35 * (attempt - 1));
  const { base, drop } = SKILL[skill];
  const chapter = chapterOf(n);
  const hard = (SAMPLE_HARD_LEVELS[n] ?? 0) + (SAMPLE_HARD_CHAPTERS[chapter] ?? 0);
  const expected = base - drop * (chapter - 1) + saw + learned - hard;
  const stars = clampStars(expected + between(rng, -1, 1));
  const mistakes = weighted(rng, [
    [0, 2 + stars * 2],
    [1, 3],
    [2, 3 - stars / 2],
    [3, 1],
  ] as const);
  const timed = (from: number, to: number) => Math.round(between(rng, from, to));

  switch (LEVEL_METRIC[kind]) {
    case 'timeMs': {
      if (stars === 0) {
        // A second wrong tap in find; the clock otherwise.
        if (kind === 'find' && chance(rng, 0.5)) {
          return { stars, reason: 'failed', durationMs: timed(3_000, 20_000), mistakes: 2, metric: null };
        }
        return { stars, reason: 'timeUp', durationMs: limit, mistakes, metric: null };
      }
      const [from, to] = TIME_BY_STARS[stars];
      const durationMs = timed(from, to);
      return { stars, reason: 'completed', durationMs, mistakes, metric: durationMs };
    }
    case 'spots':
      // Five spots, whoever took them: the race always ends done.
      return {
        stars,
        reason: 'completed',
        durationMs: timed(10_000, limit),
        mistakes,
        metric: [intBetween(rng, 0, 1), 2, 3, intBetween(rng, 4, 5)][stars]!,
      };
    case 'gap':
      if (stars === 0) {
        return chance(rng, 0.6)
          ? {
              stars,
              reason: 'botWon',
              durationMs: timed(12_000, 28_000),
              mistakes,
              metric: -intBetween(rng, 1, 15),
            }
          : { stars, reason: 'timeUp', durationMs: limit, mistakes, metric: intBetween(rng, -5, 0) };
      }
      return {
        stars,
        reason: 'completed',
        durationMs: timed(15_000, limit),
        mistakes,
        metric: 4 + 6 * stars + intBetween(rng, 0, 5),
      };
    case 'found':
      return stars === 0
        ? { stars, reason: 'timeUp', durationMs: limit, mistakes, metric: intBetween(rng, 0, 1) }
        : { stars, reason: 'completed', durationMs: timed(8_000, 28_000), mistakes, metric: 2 };
    case 'points':
      return {
        stars,
        reason: 'completed',
        durationMs: timed(18_000, limit),
        mistakes,
        metric: [
          intBetween(rng, 5, 14),
          intBetween(rng, 15, 22),
          intBetween(rng, 23, 27),
          intBetween(rng, 28, 30),
        ][stars]!,
      };
  }
}
