import type { EndReason, GameResult } from '../game/types';
import { DEFAULT_PROGRESS_RULES, type ProgressRules } from '../progress/progress';
import type {
  AppLevel,
  FindEndReason,
  FindLevelOver,
  LevelKind,
  PuzzleLevelOver,
  StarRule,
  Stars,
} from './spec';
import { starsFor } from './stars';

/**
 * Progress through the levels (plan §4.5, §5.1; dev-plan §1.1, §1.4) [D50, D51, D55]: which level is open, the
 * gates between chapters, the best a level ever got, the XP it is worth, and how any end of a level reads
 * (levelOutcome). Every number is a setting of LEVEL_RULES (the XP ones of DEFAULT_PROGRESS_RULES), read here.
 *
 * Progress is given as records by level id: the best stars ever and the plays that count. The phone keeps them
 * in levels.db, the server in user_levels; both decide with these functions.
 *
 * Words: "the gate of chapter k" stands at the end of chapter k and opens chapter k + 1: it needs the boss
 * L(10k) played and at least gateStars stars in chapter k. A gate that opened once stays open, even if
 * gateStars rises or the chapter gets a new level later (dev-plan §1.4): the chapters it opened are passed in
 * (`openedChapters`), and a level that was played was open.
 */

export interface LevelRules {
  /** Levels per chapter; the last one is the boss. */
  chapterSize: number;
  chapterCount: number;
  /** The stars of chapter k that open chapter k + 1 (with its boss played) [D51]. */
  gateStars: number;
  /** No level is longer [D49], but the kinds kindMaxMs names (maxMsOf). */
  levelMaxMs: number;
  /**
   * [D68] Moshe asked for more time in the fill kinds (2026-10-19, "צריך יותר זמן"): it updates D49 for these
   * kinds only, up to this much; every other kind stays at levelMaxMs. Still one task a level.
   */
  kindMaxMs: Readonly<Partial<Record<LevelKind, number>>>;
  /** [D70c] A puzzle swap that puts neither box at its home costs this much time (a wrong digit's 5 s). */
  puzzleSwapPenaltyMs: number;
  /**
   * [D78b] Whether a puzzle's view marks the digits that repeat in a row or column: never (the default: finding
   * them is the puzzle), only in the first `puzzleConflictsFirstStages` puzzles of the levels, or always.
   */
  puzzleConflicts: 'none' | 'firstStages' | 'always';
  puzzleConflictsFirstStages: number;
  /** A quit (the X, confirmed) counts as played: the next level opens [D51]. */
  quitCountsAsPlayed: boolean;
  /** From the second attempt on, "שוב" plays an equivalent board (transformLevel) [D63]. */
  replayTransform: boolean;
  /**
   * A chain: a right digit in a cell that cannot be known yet is taken with its points ('accept', the original
   * §14, the default), or costs time and is not placed ('penalty', the proposal). D64 is waiting for Moshe, who
   * tries both first (2026-10-18): a staging build's settings turn 'penalty' on (apps/mobile config/testing.ts).
   */
  chainNotYet: 'accept' | 'penalty';
  /** A tap on a filled cell in the tap kinds: nothing happens, or it counts as a wrong tap [D52]. */
  tapOnFilled: 'ignore' | 'penalty';
}

export const LEVEL_RULES: LevelRules = {
  chapterSize: 10,
  chapterCount: 30,
  gateStars: 20,
  levelMaxMs: 30000,
  kindMaxMs: { fillBox: 60000, fillRow: 60000, fillCol: 60000, puzzle: 60000 },
  quitCountsAsPlayed: true,
  replayTransform: true,
  chainNotYet: 'accept',
  tapOnFilled: 'ignore',
  puzzleSwapPenaltyMs: 5000,
  puzzleConflicts: 'none',
  puzzleConflictsFirstStages: 3,
};

/** How many levels there are (300): the server and the phone both take the number from here. */
export const maxLevel = (rules: LevelRules = LEVEL_RULES): number => rules.chapterCount * rules.chapterSize;

/**
 * The longest a level of this kind may be [D49, D68]: 60 s for fillBox, fillRow, fillCol and the puzzle, 30 s
 * for every other kind. The builder, the validator and the simulation read it; a level's own limit
 * (timeLimitMs) is at most this.
 */
export const maxMsOf = (kind: LevelKind, rules: LevelRules = LEVEL_RULES): number =>
  rules.kindMaxMs[kind] ?? rules.levelMaxMs;

/**
 * [D78b] Whether the puzzle that is the `ordinal`-th of the levels (1 for the first puzzle level, by level
 * number) marks its repeated digits, by LEVEL_RULES.puzzleConflicts. The phone counts the ordinal from its
 * levels (as the point hunter's worth hint), and passes the answer to the puzzle (PuzzleRules.conflicts).
 */
export function puzzleConflictsOn(ordinal: number, rules: LevelRules = LEVEL_RULES): boolean {
  switch (rules.puzzleConflicts) {
    case 'none':
      return false;
    case 'always':
      return true;
    case 'firstStages':
      return Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= rules.puzzleConflictsFirstStages;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Ids

/**
 * [D73] The rev every level is built at (1.0.3: all 300 rebuilt, rev 2; seed `L001:r2`). levels.config.ts's
 * LEVEL_REVS moves a single level further later, and levelRev() (catalog.ts) reads both. Here, beside the ids,
 * so that levels.config.ts and catalog.ts both import it with no cycle between them.
 */
export const LEVEL_REV_BASE = 2;

const LEVEL_ID = /^L(\d{3,})$/;

/** 1 → "L001", 300 → "L300". */
export function levelIdOf(n: number): string {
  if (!(Number.isInteger(n) && n >= 1)) throw new RangeError(`A level number is 1 or more, got ${n}`);
  return `L${String(n).padStart(3, '0')}`;
}

/** "L001" → 1; null for anything that is not a level id in its one spelling ("l001", "L1", "L0001", "L000"). */
export function levelNumber(id: string): number | null {
  const m = LEVEL_ID.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && levelIdOf(n) === id ? n : null;
}

export const isLevelId = (v: unknown): v is string => typeof v === 'string' && levelNumber(v) !== null;

function numberOf(level: number | string): number {
  const n = typeof level === 'number' ? level : levelNumber(level);
  if (n === null || !(Number.isInteger(n) && n >= 1)) throw new RangeError(`Not a level: ${String(level)}`);
  return n;
}

/** The chapter of a level (by number or id): L001–L010 → 1, L300 → 30. */
export const chapterOf = (level: number | string, rules: LevelRules = LEVEL_RULES): number =>
  Math.ceil(numberOf(level) / rules.chapterSize);

/** The last level of every chapter is its boss (plan §3.3). */
export const isBossLevel = (level: number | string, rules: LevelRules = LEVEL_RULES): boolean =>
  numberOf(level) % rules.chapterSize === 0;

/** The ids of a chapter's levels, in order. */
export function chapterLevelIds(chapter: number, rules: LevelRules = LEVEL_RULES): string[] {
  if (!(Number.isInteger(chapter) && chapter >= 1)) throw new RangeError(`Not a chapter: ${chapter}`);
  const first = (chapter - 1) * rules.chapterSize + 1;
  return Array.from({ length: rules.chapterSize }, (_, k) => levelIdOf(first + k));
}

// ---------------------------------------------------------------------------------------------------------
// Records, gates and what is open

/** What is known of one level: its best stars ever (never lower, mergeBest) and the plays that count. */
export interface LevelRecord {
  stars: Stars;
  plays: number;
  /** When it was last played, in any clock (only compared): replayCandidates' tie-break. */
  lastPlayedAt?: number;
}

/** By level id; a level never played may be missing. */
export type LevelRecords = Readonly<Record<string, LevelRecord | undefined>>;

const playedId = (records: LevelRecords, id: string): boolean => (records[id]?.plays ?? 0) > 0;
const played = (records: LevelRecords, n: number): boolean => playedId(records, levelIdOf(n));

/** Whether an end counts as "played": every end does, a quit only while quitCountsAsPlayed [D51]. */
export const countsAsPlayed = (reason: LevelEndReason, rules: LevelRules = LEVEL_RULES): boolean =>
  reason !== 'quit' || rules.quitCountsAsPlayed;

/** The best stars of a chapter's levels, summed (0–30). */
export function chapterStars(
  chapter: number,
  records: LevelRecords,
  rules: LevelRules = LEVEL_RULES,
): number {
  return chapterLevelIds(chapter, rules).reduce((sum, id) => sum + (records[id]?.stars ?? 0), 0);
}

/** The gate of `chapter`, as the records stand now: its boss played and gateStars stars in it (plan §4.5). */
export function gateOpen(chapter: number, records: LevelRecords, rules: LevelRules = LEVEL_RULES): boolean {
  return (
    played(records, chapter * rules.chapterSize) && chapterStars(chapter, records, rules) >= rules.gateStars
  );
}

/**
 * Whether `chapter` is open: the first one always; another once the gate before it opens, and for good: a
 * chapter a gate opened once (`openedChapters`), or whose first level was played, stays open.
 */
export function chapterOpen(
  chapter: number,
  records: LevelRecords,
  openedChapters: readonly number[] = [],
  rules: LevelRules = LEVEL_RULES,
): boolean {
  if (!(Number.isInteger(chapter) && chapter >= 1 && chapter <= rules.chapterCount)) return false;
  if (chapter === 1 || openedChapters.includes(chapter)) return true;
  return played(records, (chapter - 1) * rules.chapterSize + 1) || gateOpen(chapter - 1, records, rules);
}

export interface GateState {
  /** The chapter whose stars count; the gate opens chapter + 1. */
  chapter: number;
  open: boolean;
  /** Its best stars so far, and the stars it needs. */
  stars: number;
  need: number;
  /** Its boss was played: without it the gate stays shut, whatever the stars (plan §4.5). */
  bossPlayed: boolean;
}

/** The gate at the end of `chapter` (the map's plate under chapter + 1, the locked gate's sheet). */
export function gateState(
  chapter: number,
  records: LevelRecords,
  openedChapters: readonly number[] = [],
  rules: LevelRules = LEVEL_RULES,
): GateState {
  return {
    chapter,
    open: chapter < rules.chapterCount && chapterOpen(chapter + 1, records, openedChapters, rules),
    stars: chapterStars(chapter, records, rules),
    need: rules.gateStars,
    bossPlayed: played(records, chapter * rules.chapterSize),
  };
}

/**
 * Whether a level can be played (plan §4.5) [D51]: L001 always; level n once n − 1 was played; the first level
 * of a chapter only once its chapter is open. A level that was played stays open.
 */
export function isLevelOpen(
  level: number | string,
  records: LevelRecords,
  openedChapters: readonly number[] = [],
  rules: LevelRules = LEVEL_RULES,
): boolean {
  const n = numberOf(level);
  if (n > maxLevel(rules)) return false;
  if (n === 1 || played(records, n)) return true;
  // The first level of a chapter: its gate (which needs the boss before it played), or the chapter opened once.
  const firstOfChapter = (n - 1) % rules.chapterSize === 0;
  if (firstOfChapter) return chapterOpen(chapterOf(n, rules), records, openedChapters, rules);
  return played(records, n - 1);
}

/** "לשלב הבא": the level after `level`, when it is open; null at a closed gate and after the last level. */
export function nextLevelId(
  level: number | string,
  records: LevelRecords,
  openedChapters: readonly number[] = [],
  rules: LevelRules = LEVEL_RULES,
): string | null {
  const next = numberOf(level) + 1;
  if (next > maxLevel(rules)) return null;
  return isLevelOpen(next, records, openedChapters, rules) ? levelIdOf(next) : null;
}

/**
 * The levels worth playing again in front of the gate of `chapter`, at most `max` (plan §4.5): first the
 * chapter's next unplayed level (the boss, when only it is missing: without it the gate never opens), then the
 * played ones by fewest stars, a tie to the most recently played. A level at ★★★ has nothing more to give.
 */
export function replayCandidates(
  chapter: number,
  records: LevelRecords,
  rules: LevelRules = LEVEL_RULES,
  max = 3,
): string[] {
  const ids = chapterLevelIds(chapter, rules);
  const unplayed = ids.find((id) => !playedId(records, id));
  const lastAt = (id: string) => records[id]?.lastPlayedAt ?? Number.NEGATIVE_INFINITY;
  const order = new Map(ids.map((id, k) => [id, k]));
  const again = ids
    .filter((id) => playedId(records, id) && (records[id]?.stars ?? 0) < 3)
    .sort(
      (a, b) =>
        (records[a]?.stars ?? 0) - (records[b]?.stars ?? 0) ||
        lastAt(b) - lastAt(a) ||
        order.get(a)! - order.get(b)!,
    );
  return [...(unplayed ? [unplayed] : []), ...again].slice(0, max);
}

/** The chapters (2 and up) open now: what gates have opened. */
export function openedChaptersOf(
  records: LevelRecords,
  openedChapters: readonly number[] = [],
  rules: LevelRules = LEVEL_RULES,
): number[] {
  const out: number[] = [];
  for (let c = 2; c <= rules.chapterCount; c++)
    if (chapterOpen(c, records, openedChapters, rules)) out.push(c);
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Bests and XP

/** What a level's measure is (the record "השיא שלי", level_end's metric). */
export type LevelMetric = 'timeMs' | 'spots' | 'gap' | 'points' | 'found';

/**
 * Each kind's measure: the level clock where the stars go by time (find, fillBox, fillRow, fillCol, chain,
 * puzzle), the spots I took (findDuel), my lead (duel), my points (pointHunter), and the errors found
 * (spotError, whose stars go by time once all are found).
 */
export const LEVEL_METRIC: Readonly<Record<LevelKind, LevelMetric>> = {
  find: 'timeMs',
  findDuel: 'spots',
  fillBox: 'timeMs',
  duel: 'gap',
  spotError: 'found',
  pointHunter: 'points',
  chain: 'timeMs',
  fillRow: 'timeMs',
  fillCol: 'timeMs',
  puzzle: 'timeMs',
};

/** Whether measure `a` beats `b` in this kind: a time lower, every other measure higher. Equal does not. */
export const isBetterMetric = (kind: LevelKind, a: number, b: number): boolean =>
  LEVEL_METRIC[kind] === 'timeMs' ? a < b : a > b;

export interface LevelBest {
  stars: Stars;
  /** The best measure of an attempt that had one (levelOutcome); null before any. */
  metric: number | null;
  /** The rev of the level the measure was made on; absent when the caller does not track it. */
  rev?: number;
}

/**
 * The best of two, never lower: the stars, and the better measure. [D73] Across a new rev of the level (it was
 * rebuilt: a new board, maybe a new kind) the stars still never drop, but the old measure says nothing about
 * the new level: the best measure starts over from the new rev's ("השיא שלי" resets). An attempt at an older rev
 * than the record's (one that synced late) adds its stars only. Without revs on both sides: as one rev.
 */
export function mergeBest(kind: LevelKind, prev: LevelBest | null | undefined, next: LevelBest): LevelBest {
  if (!prev) return next;
  const stars = Math.max(prev.stars, next.stars) as Stars;
  if (prev.rev !== undefined && next.rev !== undefined && prev.rev !== next.rev)
    return next.rev > prev.rev
      ? { stars, metric: next.metric, rev: next.rev }
      : { stars, metric: prev.metric, rev: prev.rev };
  const metric =
    prev.metric === null
      ? next.metric
      : next.metric !== null && isBetterMetric(kind, next.metric, prev.metric)
        ? next.metric
        : prev.metric;
  const rev = prev.rev ?? next.rev;
  return rev === undefined ? { stars, metric } : { stars, metric, rev };
}

/**
 * The XP of one attempt as the phone shows it (plan §5.1) [D55]: 10 for each new star (a replay from ★ to ★★★
 * gives 20, one with no new star nothing), and 50 when it opened a gate. The server pays its own count.
 */
export function levelXpFor(
  prevBest: Stars,
  best: Stars,
  gateOpened: boolean,
  rules: ProgressRules = DEFAULT_PROGRESS_RULES,
): number {
  return Math.max(0, best - prevBest) * rules.xp.levelStar + (gateOpened ? rules.xp.levelGate : 0);
}

/**
 * All the XP the levels are worth by now (the server: PUT /v1/me/levels, less what it paid): 10 per best star
 * of every level there is, 50 per open gate. 300 levels at ★★★ and 29 gates: 10,450.
 */
export function levelsXpEarned(
  records: LevelRecords,
  openedChapters: readonly number[] = [],
  levelRules: LevelRules = LEVEL_RULES,
  progressRules: ProgressRules = DEFAULT_PROGRESS_RULES,
): number {
  let stars = 0;
  for (let n = 1; n <= maxLevel(levelRules); n++) stars += records[levelIdOf(n)]?.stars ?? 0;
  const gates = openedChaptersOf(records, openedChapters, levelRules).length;
  return stars * progressRules.xp.levelStar + gates * progressRules.xp.levelGate;
}

// ---------------------------------------------------------------------------------------------------------
// How a level ended

/**
 * Why a level ended, for the phone, the server and the admin site alike (dev-plan §1.4): done (the target
 * reached, also findDuel's five spots whoever took them), the time ran out (in a duel too, whoever leads), the
 * bot first to the duel's target, a second wrong tap in find, or the X.
 */
export const LEVEL_END_REASONS = ['completed', 'timeUp', 'botWon', 'failed', 'quit'] as const;
export type LevelEndReason = (typeof LEVEL_END_REASONS)[number];

/** A level's end in LEVEL_END_REASONS: from the game engine's reason or the tap engine's. */
export function levelEndReason(
  kind: LevelKind,
  reason: EndReason | FindEndReason,
  metric: number,
): LevelEndReason {
  switch (reason) {
    case 'targetReached':
    case 'boardComplete':
      // A duel ends at the first to the target: the bot when I am behind.
      return kind === 'duel' && metric <= 0 ? 'botWon' : 'completed';
    case 'timeUp':
      return 'timeUp';
    case 'tooManyMisses':
      return 'failed';
    case 'quit':
    case 'practiceEnded':
    case 'lastPlayerStanding':
      return 'quit';
  }
}

/**
 * The stars of an end: none for a quit, a failure or the bot's win; by the level clock only when the task was
 * done (a time rule); otherwise by the measure, at the target or when time ran out.
 */
export function levelStars(rule: StarRule, reason: LevelEndReason, metric: number, elapsedMs: number): Stars {
  if (reason === 'quit' || reason === 'failed' || reason === 'botWon') return 0;
  if (rule.by === 'timeMs') return reason === 'completed' ? starsFor(rule, elapsedMs) : 0;
  return starsFor(rule, metric);
}

export interface LevelOutcome {
  reason: LevelEndReason;
  stars: Stars;
  /**
   * The level's measure (LEVEL_METRIC), or null when this end has none to compare: a quit, a failure, a time
   * kind not finished. What mergeBest keeps and level_end reports.
   */
  metric: number | null;
  /** The level clock at the end. */
  elapsedMs: number;
  /**
   * [D72] A boss: whether I beat it ("ניצחת את הבוס!"), the engine's verdict and never the screen's. Against the
   * bot only a win over the bot counts: a race can give a star (2 of 5 spots) and still be the bot's (3). A boss
   * with no bot (only under D72 ב) is beaten by finishing it with a star. Null when the level is not a boss.
   * levelOutcome() always sets it; optional only so that an outcome stored or written before 1.0.3 still reads.
   */
  bossBeaten?: boolean | null;
}

/** Any end a level host gives: the game engine's result, the tap engine's levelOver, the puzzle's levelOver. */
export type LevelEndOf = GameResult | FindLevelOver | PuzzleLevelOver;

const isGameResult = (end: LevelEndOf): end is GameResult => 'ranking' in end;
const isPuzzleOver = (end: LevelEndOf): end is PuzzleLevelOver => 'swaps' in end;

/** A race's spots when the level does not say (RACE.spots of levels.config.ts). */
const RACE_SPOTS = 5;

/**
 * Whether the boss was beaten [D72]: the duel by my lead at the end (a win to the target or a lead when the
 * time ran out), the race by more spots than the bot's, any other boss by a star. A quit never beats it.
 */
function bossBeatenOf(
  spec: Pick<AppLevel, 'kind'> & { boss?: boolean; targets?: AppLevel['targets'] },
  end: LevelEndOf,
  reason: LevelEndReason,
  value: number,
  stars: Stars,
): boolean | null {
  if (!spec.boss) return null;
  if (reason === 'quit' || reason === 'failed' || reason === 'botWon') return false;
  if (spec.kind === 'duel') return value > 0;
  if (spec.kind === 'findDuel') {
    if (isGameResult(end) || isPuzzleOver(end)) return false;
    if (end.opponentSpots !== undefined) return end.spots > end.opponentSpots;
    const all = spec.targets && 'spots' in spec.targets ? spec.targets.spots.length : RACE_SPOTS;
    return end.spots * 2 > all;
  }
  return reason === 'completed' && stars >= 1;
}

/**
 * One reading of every end, from any host (dev-plan §2א): the game engine's result of a digit level, the tap
 * engine's levelOver, or the puzzle's (its measure the level clock, its mistakes the wrong swaps). The stars are
 * worked out again from the level's rule; a boss also gets the engine's verdict (bossBeaten).
 */
export function levelOutcome(
  spec: Pick<AppLevel, 'kind' | 'stars'> & { boss?: boolean; targets?: AppLevel['targets'] },
  end: LevelEndOf,
): LevelOutcome {
  const measure = LEVEL_METRIC[spec.kind];
  let value: number;
  let elapsedMs: number;
  if (isGameResult(end)) {
    value = end.level?.metric ?? 0;
    elapsedMs = end.level?.elapsedMs ?? end.durationMs;
  } else if (isPuzzleOver(end)) {
    elapsedMs = end.elapsedMs;
    value = end.elapsedMs;
  } else {
    elapsedMs = end.elapsedMs;
    value = measure === 'spots' ? end.spots : measure === 'found' ? end.found : end.elapsedMs;
  }
  const reason = levelEndReason(spec.kind, end.reason, value);
  const stars = levelStars(spec.stars, reason, value, elapsedMs);
  const comparable =
    reason !== 'quit' && reason !== 'failed' && (measure !== 'timeMs' || reason === 'completed');
  const bossBeaten = bossBeatenOf(spec, end, reason, value, stars);
  return { reason, stars, metric: comparable ? value : null, elapsedMs, bossBeaten };
}
