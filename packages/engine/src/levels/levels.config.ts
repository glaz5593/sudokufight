import type { BotLevelId } from '../bot/levels';
import type { GameType } from '../gameType';
import { type Technique, TECHNIQUES } from '../sudoku/logic';
import { createRng, seedFromString, shuffled } from '../util/random';
import { chapterOf, LEVEL_REV_BASE, LEVEL_RULES, levelIdOf, type LevelRules } from './progress';
import type { FillLevelKind, FindScope, GapStars, LevelKind, SpotStars, TimeStars } from './spec';
import { POINT_SHARES, type PointShares } from './stars';

/**
 * The chapter table of staged practice as data (plan §4.1–§4.4, §2, §3; dev-plan §1.4, §2ד) [D50–D54, D61],
 * as 1.0.3 changes it (docs/handoff/2026-10-19/levels-content.md §3–§7) [D66–D73]: what each of the 300 levels
 * is, before the builder (levels/builder/) turns it into a board. Every number of the plan lives here once,
 * and levels.config.test.ts pins them, so changing one is a reviewed edit and a rebuild (`npm run
 * levels:build`), never a silent change of a built level (levels.json is frozen).
 *
 * The saw-tooth (plan §4.1): slots 1–3 are a step easier than the chapter, 4–6 the chapter itself, 7–9 and the
 * boss a step harder. A step moves the continuous knobs (the givens of a board, the empties of a target's
 * box) by one chapter, back or forward; the fill kinds and the puzzle take the whole row of their ladder of
 * the chapter before or after (levels-content.md §4.3, §5.3). What the chapter brings (its board type, scopes,
 * techniques, the ideas' counts and steps, the thresholds and the bot) is the same in all its slots, except
 * that the easy slots of a chapter whose act adds a technique do not need it yet.
 *
 * D74: the time thresholds of the fill kinds and the puzzle come from a time model (levels-content.md §4.4,
 * §5.3) whose numbers are ASSUMPTIONS, not yet calibrated against real play (builder/profiles.ts): no staging
 * data was read for this build. The next app build retunes them from Moshe's own times.
 */

// ---------------------------------------------------------------------------------------------------------
// Ids, revs and seeds

/** Mixed into every level's seed: no level ever draws from a seed of the puzzle bank (dev-plan §2ד). */
export const LEVELS_SALT = 20261018;

/**
 * Levels rebuilt on purpose after the last whole rebuild, with their new rev (plan §5.6): a level not listed is
 * at LEVEL_REV_BASE (2 since 1.0.3, when all 300 were rebuilt [D73]). A rebuilt level draws a new board from
 * its new seed, keeps its stars, and starts its best measure over (mergeBest).
 */
export const LEVEL_REVS: Readonly<Record<string, number>> = {};

export const levelRev = (id: string): number => LEVEL_REVS[id] ?? LEVEL_REV_BASE;

/** The builder's seed of a level: from `${id}:r${rev}`, salted, never the bank's (each level its own Rng). */
export const levelSeed = (id: string, rev: number): number => seedFromString(`${id}:r${rev}`, LEVELS_SALT);

// ---------------------------------------------------------------------------------------------------------
// Acts, tiers and kinds

/** Five chapters an act (plan §4.3): 1 basics, 2 rows, 3 the whole board, 4 eliminations, 5 pairs, 6 champions. */
export const actOf = (chapter: number): number => Math.ceil(chapter / 5);

export type LevelTier = 'easy' | 'base' | 'hard';

/** Slots 1–3 easy, 4–6 the chapter's own, 7–9 and the boss (10) hard (plan §4.1, §3.3). */
export const tierOfSlot = (slot: number): LevelTier => (slot <= 3 ? 'easy' : slot <= 6 ? 'base' : 'hard');

/** How far a tier moves the continuous knobs, in chapters. */
const TIER_SHIFT: Readonly<Record<LevelTier, number>> = { easy: -1, base: 0, hard: 1 };

const F = 'find';
const R = 'findDuel';
const B = 'fillBox';
const D = 'duel';
const E = 'spotError';
const P = 'pointHunter';
const C = 'chain';
const W = 'fillRow';
const K = 'fillCol';
const Z = 'puzzle';
/** A pattern's "line" slot: fillRow in an odd chapter, fillCol in an even one (levels-content.md §3.1). */
const L = 'line';

/** A slot of CHAPTER_PATTERNS: a kind, or the line (one family: fillRow or fillCol by the chapter). */
export type PatternKind = LevelKind | typeof L;

/**
 * Slots 1–9 of chapters 1–5 (levels-content.md §3.2) [D66]: chapter 1 has four kinds (find, the box, the
 * puzzle, the row) and its boss is the first bot; every one of the ten has come by chapter 5. A kind that comes
 * in gets two levels in its first chapter, its "איך משחקים" before the first: the column and the race in 2,
 * the duel and spot the error in 3, the chain in 4, the point hunter in 5. Never two of one kind in a row.
 */
export const FIRST_CHAPTERS: Readonly<Record<number, readonly LevelKind[]>> = {
  1: [F, B, Z, W, F, B, Z, W, F],
  2: [F, K, R, B, Z, W, R, K, F],
  3: [D, B, E, Z, R, F, D, E, K],
  4: [C, B, R, Z, D, C, W, E, F],
  5: [P, K, R, B, E, P, D, Z, C],
};

/** The first chapter of the patterns (levels-content.md §3.3). */
export const PATTERNS_FROM = 6;

/**
 * Slots 1–9 from chapter 6 (levels-content.md §3.3) [D66]: three patterns in turn, א (6, 9, 12 … 30), ב (7,
 * 10, 13 … 28), ג (8, 11, 14 … 29). Every family once a chapter (the row and the column are one family, the
 * line), and over three chapters each family comes once in the easy slots, once in the chapter's own and once
 * in the hard ones. No two levels of one kind in a row, across chapters too: no pattern starts or ends with the
 * race or the duel, so neither ever stands next to a boss of its kind.
 */
export const CHAPTER_PATTERNS: readonly (readonly PatternKind[])[] = [
  [F, E, B, Z, R, C, L, D, P],
  [Z, D, P, L, E, F, B, R, C],
  [L, R, C, B, P, D, F, Z, E],
];

/** The line of a chapter from PATTERNS_FROM: the row in odd chapters, the column in even ones. */
export const lineKindOf = (chapter: number): FillLevelKind => (chapter % 2 === 1 ? 'fillRow' : 'fillCol');

/**
 * [D72] Chapter 1's boss. 'findDuel' (the default): a race against Pip, 10% slower (pace ×1.1) because it is
 * the first bot you meet, on a fast board with box targets (levels-content.md §6). 'fillBox' is D72 ב: the boss
 * stays a box, with the next chapter's missing cells and no bot. A setting: switching it is one edit and a
 * rebuild.
 */
export interface FirstBoss {
  kind: 'findDuel' | 'fillBox';
  bot: ChapterBot;
}

export const FIRST_BOSS: FirstBoss = { kind: 'findDuel', bot: { level: 1, pace: 1.1 } };

/**
 * The boss (levels-content.md §6) [D72]: one fight against a named bot. Chapter 1 the race against Pip (or
 * FIRST_BOSS's kind); then, as before, the race in even chapters and the duel in odd ones.
 */
export const bossKindOf = (chapter: number, first: FirstBoss['kind'] = FIRST_BOSS.kind): LevelKind =>
  chapter === 1 ? first : chapter % 2 === 0 ? 'findDuel' : 'duel';

/** The kinds of a chapter's ten slots, in order; slot 10 is the boss. */
export function chapterKinds(chapter: number, rules: LevelRules = LEVEL_RULES): LevelKind[] {
  if (!(Number.isInteger(chapter) && chapter >= 1 && chapter <= rules.chapterCount))
    throw new RangeError(`Not a chapter: ${chapter}`);
  const first = FIRST_CHAPTERS[chapter];
  const slots =
    first ??
    CHAPTER_PATTERNS[(chapter - PATTERNS_FROM) % CHAPTER_PATTERNS.length]!.map((k) =>
      k === L ? lineKindOf(chapter) : k,
    );
  return [...slots, bossKindOf(chapter)];
}

// ---------------------------------------------------------------------------------------------------------
// Boards

/** The givens of a board by its type [D43]: fast and normal as the bank's ranges, hard as its boards. */
export const LEVEL_GIVENS: Readonly<Record<GameType, { min: number; max: number }>> = {
  fast: { min: 45, max: 50 },
  normal: { min: 35, max: 40 },
  hard: { min: 22, max: 29 },
};

/** The board type of each act (plan §4.3). */
const ACT_BOARD: readonly GameType[] = ['fast', 'normal', 'normal', 'hard', 'hard', 'hard'];

/**
 * The givens of each act's boards, from its first chapter to its last (plan §4.3), within the D43 range of its
 * type (dev-plan §1.4): act 3 "normal 38→33" is 38→35, act 4 "hard 30→27" is 29→27.
 */
export const ACT_GIVENS: readonly (readonly [first: number, last: number])[] = [
  [50, 45],
  [40, 35],
  [38, 35],
  [29, 27],
  [28, 24],
  [24, 22],
];

/**
 * The board type of a kind in a chapter: the act's, but the duel is fast up to chapter 7 and normal from 8
 * ("דו־קרב על לוח רגיל", plan §4.2) to 15; the point hunter fast in 7–11, normal in 12–20, hard from 21.
 */
export function boardTypeOf(kind: LevelKind, chapter: number): GameType {
  if (kind === 'duel') return chapter <= 7 ? 'fast' : chapter <= 15 ? 'normal' : 'hard';
  if (kind === 'pointHunter') return chapter <= 11 ? 'fast' : chapter <= 20 ? 'normal' : 'hard';
  return ACT_BOARD[actOf(chapter) - 1]!;
}

/** A line from `first` (at chapter `from`) to `last` (at `to`), read at `at`, which may lie outside. */
const along = (first: number, last: number, from: number, to: number, at: number): number =>
  to === from ? first : first + ((last - first) * (at - from)) / (to - from);

const clamp = (x: number, min: number, max: number): number => Math.min(max, Math.max(min, x));

/**
 * The race keeps at least 24 givens (act 6's first chapter): five targets in a row, each needing an
 * elimination, are not there on a board of 22–23 (the builder found no race in 400 such boards, 2026-10-18).
 */
export const RACE_MIN_GIVENS = 24;

/**
 * The givens of a full board (find, findDuel, duel, pointHunter, chain): the act's line at the chapter, moved
 * by the tier, within the D43 range of the board's type (a duel or point hunter board of another type than its
 * act's sits at its own range's edge); the race no fewer than RACE_MIN_GIVENS.
 */
export function boardGivens(kind: LevelKind, chapter: number, tier: LevelTier): number {
  const act = actOf(chapter);
  const [first, last] = ACT_GIVENS[act - 1]!;
  const from = (act - 1) * 5 + 1;
  const n = Math.round(along(first, last, from, from + 4, chapter + TIER_SHIFT[tier]));
  const range = LEVEL_GIVENS[boardTypeOf(kind, chapter)];
  return clamp(kind === 'findDuel' ? Math.max(n, RACE_MIN_GIVENS) : n, range.min, range.max);
}

/** The techniques of the acts (plan §4.3): singles; pointing and claiming from act 4; pairs from act 5. */
export const SINGLES: readonly Technique[] = ['nakedSingle', 'hiddenSingle'];
export const LOCKED: readonly Technique[] = ['pointing', 'claiming'];
export const PAIRS: readonly Technique[] = ['nakedPair', 'hiddenPair'];
export const ELIMINATIONS: readonly Technique[] = [...LOCKED, ...PAIRS];

const ACT_TECHNIQUES: readonly (readonly Technique[])[] = [
  SINGLES,
  SINGLES,
  SINGLES,
  [...SINGLES, ...LOCKED],
  TECHNIQUES,
  TECHNIQUES,
];

/** What a level is checked against (its LevelCheck): the techniques it may use, and what it must need. */
export interface LevelLogic {
  techniques: readonly Technique[];
  mustNeed: readonly Technique[];
}

/**
 * What the act's targets must need (dev-plan §1.4: only where the act adds a technique): nothing in acts
 * 1–3 (rows and columns, then the whole board, are scopes, not techniques); pointing or claiming from chapter
 * 17 ("יעדים שמופיעים רק אחרי צמצום", plan §4.2; chapter 16 brings the hard boards first); a pair in act 5;
 * in act 6, the hardest, any elimination ("יעד שדורש צמצום", plan §4.4).
 */
function actMustNeed(chapter: number): readonly Technique[] {
  if (chapter <= 16) return [];
  if (chapter <= 20) return LOCKED;
  if (chapter <= 25) return PAIRS;
  return ELIMINATIONS;
}

/** The logic of the targets of find, a silent error and a chain: the easy slots need nothing new. */
export function targetLogic(chapter: number, tier: LevelTier): LevelLogic {
  return {
    techniques: ACT_TECHNIQUES[actOf(chapter) - 1]!,
    mustNeed: tier === 'easy' ? [] : actMustNeed(chapter),
  };
}

/**
 * The race's logic: where the act's targets need something new (from chapter 17), each of its five spots needs
 * an elimination, any the act has. Five in a row that each need a pair (act 5) are not there on a board: the
 * builder found none in 400 boards (2026-10-18).
 */
export function raceLogic(chapter: number, tier: LevelTier): LevelLogic {
  const logic = targetLogic(chapter, tier);
  if (!logic.mustNeed.length) return logic;
  return { techniques: logic.techniques, mustNeed: ELIMINATIONS.filter((t) => logic.techniques.includes(t)) };
}

// ---------------------------------------------------------------------------------------------------------
// Bots (plan §4.2) [D61]

export interface ChapterBot {
  level: BotLevelId;
  pace: number;
}

/** The chapter's bot and its pace (plan §4.2); chapter 1 has none. */
const CHAPTER_BOTS: readonly (ChapterBot | null)[] = [
  null,
  { level: 1, pace: 1 },
  { level: 1, pace: 1 },
  { level: 1, pace: 0.9 },
  { level: 2, pace: 1 },
  { level: 2, pace: 1 },
  { level: 2, pace: 1 },
  { level: 2, pace: 0.9 },
  { level: 2, pace: 0.9 },
  { level: 3, pace: 1 },
  { level: 3, pace: 1 },
  { level: 3, pace: 1 },
  { level: 3, pace: 0.9 },
  { level: 3, pace: 0.9 },
  { level: 3, pace: 0.9 },
  { level: 3, pace: 0.85 },
  { level: 3, pace: 0.8 },
  { level: 4, pace: 1.1 },
  { level: 4, pace: 1.1 },
  { level: 4, pace: 1.05 },
  { level: 4, pace: 1 },
  { level: 4, pace: 1 },
  { level: 4, pace: 1 },
  { level: 4, pace: 0.95 },
  { level: 4, pace: 0.9 },
  { level: 4, pace: 0.9 },
  { level: 4, pace: 0.85 },
  { level: 4, pace: 0.85 },
  { level: 4, pace: 0.85 },
  { level: 4, pace: 0.8 },
];

export const chapterBot = (chapter: number): ChapterBot | null => CHAPTER_BOTS[chapter - 1] ?? null;

/** The boss is the chapter's bot 10% faster (plan §3.3), and Overlord in chapters 28–30 (L280, L290, L300). */
export const BOSS = { pace: 0.9, overlordFrom: 28 } as const;

/**
 * A level's bot: its pace is final, a boss's ×0.9 already in it (rounded to a thousandth). Chapter 1 has no bot
 * of its own; its boss meets FIRST_BOSS.bot (Pip at ×1.1) [D72].
 */
export function levelBotOf(chapter: number, boss: boolean): ChapterBot | null {
  const bot = chapterBot(chapter);
  if (!bot) return boss && chapter === 1 ? { ...FIRST_BOSS.bot } : null;
  if (!boss) return bot;
  return {
    level: chapter >= BOSS.overlordFrom ? 5 : bot.level,
    pace: Math.round(bot.pace * BOSS.pace * 1000) / 1000,
  };
}

// ---------------------------------------------------------------------------------------------------------
// The kinds

/** find (plan §2.1) [D52]: 20 s; ★★ 10 s, ★ 20 s; ★★★ 5 s, from chapter 11 4 s, from chapter 26 3 s. */
export const FIND = { limitMs: 20000, two: 10000, one: 20000 } as const;

export function findStars(chapter: number): TimeStars {
  const three = chapter <= 10 ? 5000 : chapter <= 25 ? 4000 : 3000;
  return { by: 'timeMs', three, two: FIND.two, one: FIND.one };
}

/**
 * The scopes of a find target (plan §4.3): a box in act 1, a row or a column in act 2, the whole board from
 * act 3. The race keeps to boxes, rows and columns (a spot taken on the whole board would leave the next spots
 * hanging on which cell it was), all three from act 3.
 */
export function findScopes(kind: 'find' | 'findDuel', chapter: number): FindScope['kind'][] {
  const act = actOf(chapter);
  if (act === 1) return ['box'];
  if (act === 2) return ['row', 'col'];
  return kind === 'find' ? ['board'] : ['box', 'row', 'col'];
}

/**
 * The empty cells of the target's box (plan §2.1): 3 in chapter 1, up to 7–8 in chapter 30, on a straight line
 * (the two whole numbers around it), moved by the tier.
 */
export function targetBoxEmpties(chapter: number, tier: LevelTier): { min: number; max: number } {
  const at = clamp(chapter + TIER_SHIFT[tier], 1, LEVEL_RULES.chapterCount);
  const x = along(3, 7.5, 1, LEVEL_RULES.chapterCount, at);
  return { min: Math.floor(x + 1e-9), max: Math.ceil(x - 1e-9) };
}

/** The race (plan §2.2) [D53]: 5 spots in 30 s; ★★★ 4–5, ★★ 3, ★ 2. */
export const RACE = { spots: 5, limitMs: 30000, stars: { by: 'spots', three: 4, two: 3, one: 2 } } as const;

export const raceStars = (): SpotStars => ({ ...RACE.stars });

/** The duel (plan §2.4) [D52]: first to 30 in 30 s; a lead of 15 / 8 / any. */
export const DUEL = { endAtScore: 30, limitMs: 30000, stars: { by: 'gap', three: 15, two: 8 } } as const;

export const duelStars = (): GapStars => ({ ...DUEL.stars });

/**
 * One row of the fill ladder (levels-content.md §4.3) [D67]: fillBox, fillRow and fillCol alike [D69]. A row
 * spans chapters `from`–`to`; `around` (the givens of the other 72 cells) runs on a line from its first to its
 * last chapter. The times are the time model's (§4.4; builder/profiles.ts), each an ASSUMPTION until calibrated
 * (D74): ★★★ is the good player's model time ×1.5 in the first chapters, down to ×0.9 in the last; ★ is the end
 * of the level, at most maxMsOf(kind) = 60 s [D68].
 */
export interface FillRow {
  from: number;
  to: number;
  /** The region's empty cells: the only ones that can be chosen. */
  missing: number;
  around: readonly [first: number, last: number];
  /** "Every digit missing at least once" outside the region (§4.2): 1 from chapter 5, else 0. */
  minDigitGaps: number;
  logic: LevelLogic;
  /** ★★★, ★★, ★ in ms; ★ is the end of the level. */
  stars: readonly [three: number, two: number, one: number];
}

const NAKED: LevelLogic = { techniques: ['nakedSingle'], mustNeed: [] };
const HIDDEN_MUST: LevelLogic = { techniques: SINGLES, mustNeed: ['hiddenSingle'] };

/**
 * The ladder (levels-content.md §4.3): 2 missing on a full board in chapter 1, 9 from chapter 14, fewer givens
 * around as it climbs, every digit missing outside from chapter 5, then the technique: a naked single, a hidden
 * single (a must in 6–10), pointing or claiming (16–20), a pair (21–25), any elimination (26–30). Chapters 21–30
 * have slightly lower thresholds on purpose: ★★★ there is for excellent players only (plan §4.4). A built region
 * a good player would need longer than its ★★ for, by the same model, is drawn again (fillModelProblem in
 * builder/validate.ts): the thresholds assume a typical mix of cells, and a draw can need far more.
 */
export const FILL_ROWS: readonly FillRow[] = [
  {
    from: 1,
    to: 1,
    missing: 2,
    around: [72, 72],
    minDigitGaps: 0,
    logic: NAKED,
    stars: [10000, 15000, 20000],
  },
  {
    from: 2,
    to: 2,
    missing: 3,
    around: [72, 72],
    minDigitGaps: 0,
    logic: NAKED,
    stars: [14000, 20000, 30000],
  },
  {
    from: 3,
    to: 3,
    missing: 3,
    around: [68, 68],
    minDigitGaps: 0,
    logic: NAKED,
    stars: [16000, 24000, 30000],
  },
  {
    from: 4,
    to: 4,
    missing: 4,
    around: [66, 66],
    minDigitGaps: 0,
    logic: NAKED,
    stars: [22000, 30000, 40000],
  },
  {
    from: 5,
    to: 5,
    missing: 4,
    around: [63, 63],
    minDigitGaps: 1,
    logic: NAKED,
    stars: [22000, 30000, 40000],
  },
  {
    from: 6,
    to: 7,
    missing: 5,
    around: [58, 54],
    minDigitGaps: 1,
    logic: HIDDEN_MUST,
    stars: [28000, 38000, 50000],
  },
  {
    from: 8,
    to: 9,
    missing: 6,
    around: [50, 46],
    minDigitGaps: 1,
    logic: HIDDEN_MUST,
    stars: [32000, 44000, 60000],
  },
  {
    from: 10,
    to: 10,
    missing: 7,
    around: [43, 43],
    minDigitGaps: 1,
    logic: HIDDEN_MUST,
    stars: [36000, 48000, 60000],
  },
  {
    from: 11,
    to: 11,
    missing: 7,
    around: [40, 40],
    minDigitGaps: 1,
    logic: { techniques: SINGLES, mustNeed: [] },
    stars: [36000, 48000, 60000],
  },
  {
    from: 12,
    to: 13,
    missing: 8,
    around: [38, 36],
    minDigitGaps: 1,
    logic: { techniques: SINGLES, mustNeed: [] },
    stars: [38000, 50000, 60000],
  },
  {
    from: 14,
    to: 15,
    missing: 9,
    around: [35, 34],
    minDigitGaps: 1,
    logic: { techniques: SINGLES, mustNeed: [] },
    stars: [42000, 54000, 60000],
  },
  {
    from: 16,
    to: 20,
    missing: 9,
    around: [33, 30],
    minDigitGaps: 1,
    logic: { techniques: [...SINGLES, ...LOCKED], mustNeed: LOCKED },
    stars: [45000, 55000, 60000],
  },
  {
    from: 21,
    to: 25,
    missing: 9,
    around: [30, 27],
    minDigitGaps: 1,
    logic: { techniques: TECHNIQUES, mustNeed: PAIRS },
    stars: [45000, 55000, 60000],
  },
  {
    from: 26,
    to: 30,
    missing: 9,
    around: [27, 24],
    minDigitGaps: 1,
    logic: { techniques: TECHNIQUES, mustNeed: ELIMINATIONS },
    stars: [44000, 54000, 60000],
  },
];

export const fillRowOf = (chapter: number): FillRow => {
  const row = FILL_ROWS.find((r) => chapter >= r.from && chapter <= r.to);
  if (!row) throw new RangeError(`Not a chapter: ${chapter}`);
  return row;
};

/** The chapter whose row of a ladder a slot takes: the one before (easy), its own (base), the next (hard). */
const ladderChapter = (chapter: number, tier: LevelTier): number =>
  clamp(chapter + TIER_SHIFT[tier], 1, LEVEL_RULES.chapterCount);

/** What a fill level is made of, by its chapter and slot (the builder's FillRegionPlan, less the head). */
export interface FillPlan {
  missing: number;
  /** The givens of the other 72 cells. */
  around: number;
  minDigitGaps: number;
  stars: TimeStars;
  limitMs: number;
  logic: LevelLogic;
}

/** A fill level (fillBox, fillRow or fillCol: one ladder for the three units) [D67, D69]: the row of its saw-tooth chapter. */
export function fillPlan(chapter: number, tier: LevelTier): FillPlan {
  const at = ladderChapter(chapter, tier);
  const row = fillRowOf(at);
  const [first, last] = row.around;
  const [three, two, one] = row.stars;
  return {
    missing: row.missing,
    around: Math.round(along(first, last, row.from, row.to, at)),
    minDigitGaps: row.minDigitGaps,
    stars: { by: 'timeMs', three, two, one },
    limitMs: one,
    logic: row.logic,
  };
}

/**
 * Which box, row or column (0–8) the k-th level of a fill kind plays (k from 0, by level number): every nine in
 * a seeded order, so a kind's few levels go round all nine regions (levels:validate wants each used).
 */
export function regionIndexOf(kind: FillLevelKind, k: number): number {
  const order = shuffled(
    createRng(seedFromString(`${kind}:regions:${Math.floor(k / 9)}`, LEVELS_SALT)),
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
  );
  return order[k % 9]!;
}

/**
 * One row of the puzzle's table (levels-content.md §5.3) [D70, D71]: how many boxes move (the rest fixed at
 * home), the thresholds from the time model (orientation 3 s, 4.5 s a moving box and 0.5 s more each above 3,
 * 1.5 s a swap: ASSUMPTIONS until calibrated, D74), and the lock (never, D71: it gives the answer away).
 */
export interface PuzzleRow {
  from: number;
  to: number;
  moving: number;
  lockOnCorrect: boolean;
  /** ★★★, ★★, ★ in ms; ★ is the end of the level, at most maxMsOf('puzzle') = 60 s [D68]. */
  stars: readonly [three: number, two: number, one: number];
}

/**
 * 3 moving in chapters 1–3 (the introduction: a blind swapper cannot be kept from ★★★ there, §5.3), 4 in 4–6,
 * 5 in 7–15, 6 from 16 [D70a]. 7 would take a good player about 57 s: it does not fit in 60.
 */
export const PUZZLE_ROWS: readonly PuzzleRow[] = [
  { from: 1, to: 3, moving: 3, lockOnCorrect: false, stars: [26000, 36000, 45000] },
  { from: 4, to: 6, moving: 4, lockOnCorrect: false, stars: [36000, 48000, 60000] },
  { from: 7, to: 10, moving: 5, lockOnCorrect: false, stars: [44000, 54000, 60000] },
  { from: 11, to: 15, moving: 5, lockOnCorrect: false, stars: [40000, 52000, 60000] },
  { from: 16, to: 20, moving: 6, lockOnCorrect: false, stars: [45000, 55000, 60000] },
  { from: 21, to: 30, moving: 6, lockOnCorrect: false, stars: [42000, 52000, 60000] },
];

export const puzzleRowOf = (chapter: number): PuzzleRow => {
  const row = PUZZLE_ROWS.find((r) => chapter >= r.from && chapter <= r.to);
  if (!row) throw new RangeError(`Not a chapter: ${chapter}`);
  return row;
};

export interface PuzzlePlan {
  moving: number;
  lockOnCorrect: boolean;
  stars: TimeStars;
  limitMs: number;
}

/** A puzzle level: the row of its saw-tooth chapter, as the fill ladder. */
export function puzzlePlan(chapter: number, tier: LevelTier): PuzzlePlan {
  const row = puzzleRowOf(ladderChapter(chapter, tier));
  const [three, two, one] = row.stars;
  return {
    moving: row.moving,
    lockOnCorrect: row.lockOnCorrect,
    stars: { by: 'timeMs', three, two, one },
    limitMs: one,
  };
}

/** Idea-1, spot the error (plan §3.1, §4.3): its bands. */
export interface SpotErrorBand {
  from: number;
  to: number;
  visible: number;
  silent: number;
  limitMs: number;
  stars: readonly [three: number, two: number, one: number];
}

/**
 * One visible error in 20 s (chapters 3–7: one visible error needs no technique, so it comes in chapter 3 since
 * 1.0.3, levels-content.md §3.1), two visible in 30 s (8–12), two silent (13–18), three from 19: one visible and
 * two silent ("מלכודות"; the plan gives the count only).
 */
export const SPOT_ERROR_BANDS: readonly SpotErrorBand[] = [
  { from: 3, to: 7, visible: 1, silent: 0, limitMs: 20000, stars: [6000, 12000, 20000] },
  { from: 8, to: 12, visible: 2, silent: 0, limitMs: 30000, stars: [12000, 20000, 30000] },
  { from: 13, to: 18, visible: 0, silent: 2, limitMs: 30000, stars: [12000, 20000, 30000] },
  { from: 19, to: 30, visible: 1, silent: 2, limitMs: 30000, stars: [15000, 22000, 30000] },
];

/**
 * The board of spot the error: the givens, from 60 in chapter 4 down to 30 in chapter 30 (the design's level
 * 77 has 58), moved by the tier (chapter 3 keeps chapter 4's 60), and 14 of "my" digits, the errors among them.
 */
export const SPOT_ERROR_BOARD = { givens: [60, 30] as const, mine: 14 } as const;

export interface SpotErrorPlan {
  visible: number;
  silent: number;
  givens: number;
  mine: number;
  stars: TimeStars;
  limitMs: number;
  /** A silent error's right digit must need `mustNeed`; a visible one is found by its clash. */
  logic: LevelLogic;
}

export function spotErrorPlan(chapter: number, tier: LevelTier): SpotErrorPlan {
  const band = SPOT_ERROR_BANDS.find((b) => chapter >= b.from && chapter <= b.to);
  if (!band) throw new RangeError(`No spot-the-error level in chapter ${chapter}`);
  const [first, last] = SPOT_ERROR_BOARD.givens;
  const at = clamp(chapter + TIER_SHIFT[tier], 4, LEVEL_RULES.chapterCount);
  const [three, two, one] = band.stars;
  return {
    visible: band.visible,
    silent: band.silent,
    givens: Math.round(along(first, last, 4, LEVEL_RULES.chapterCount, at)),
    mine: SPOT_ERROR_BOARD.mine,
    stars: { by: 'timeMs', three, two, one },
    limitMs: band.limitMs,
    logic: targetLogic(chapter, tier),
  };
}

/**
 * Idea-2, the point hunter (plan §3.1, §4.3): 3 moves; 30 s up to chapter 11 (it comes in chapter 5 since 1.0.3,
 * on a fast board), 25 s in 12–20, 20 s from 21.
 */
export const POINT_HUNTER = {
  maxMoves: 3,
  worthHintLevels: 2,
  sharesFrom27: { ...POINT_SHARES, three: 0.98 },
};

export interface PointHunterPlan {
  maxMoves: number;
  limitMs: number;
  shares: PointShares;
  /** The cells a move may take: those the chapter's techniques know at that moment. */
  techniques: readonly Technique[];
}

export function pointHunterPlan(chapter: number): PointHunterPlan {
  return {
    maxMoves: POINT_HUNTER.maxMoves,
    limitMs: chapter <= 11 ? 30000 : chapter <= 20 ? 25000 : 20000,
    shares: chapter >= 27 ? POINT_HUNTER.sharesFrom27 : POINT_SHARES,
    techniques: ACT_TECHNIQUES[actOf(chapter) - 1]!,
  };
}

/**
 * Idea-3, the chain (plan §3.1, §4.3): 3 steps in 24 s (chapters 4–13: since 1.0.3 it comes in chapter 4, three
 * steps of singles on a fast board, levels-content.md §3.1), 4 in 30 s (14–21), 5 in 30 s (from 22); from
 * chapter 29 ★★★ only up to 12 s (dev-plan §1.4).
 */
export interface ChainBand {
  from: number;
  to: number;
  steps: number;
  limitMs: number;
  stars: readonly [three: number, two: number, one: number];
}

export const CHAIN_BANDS: readonly ChainBand[] = [
  { from: 4, to: 13, steps: 3, limitMs: 24000, stars: [10000, 16000, 24000] },
  { from: 14, to: 21, steps: 4, limitMs: 30000, stars: [13000, 20000, 30000] },
  { from: 22, to: 30, steps: 5, limitMs: 30000, stars: [16000, 23000, 30000] },
];

export const CHAIN_FAST_THREE = { from: 29, three: 12000 } as const;

export interface ChainPlan {
  steps: number;
  stars: TimeStars;
  limitMs: number;
  /** Each step is known with the techniques; with mustNeed, at least one step needs it. */
  logic: LevelLogic;
}

export function chainPlan(chapter: number, tier: LevelTier): ChainPlan {
  const band = CHAIN_BANDS.find((b) => chapter >= b.from && chapter <= b.to);
  if (!band) throw new RangeError(`No chain level in chapter ${chapter}`);
  const [three, two, one] = band.stars;
  return {
    steps: band.steps,
    stars: {
      by: 'timeMs',
      three: chapter >= CHAIN_FAST_THREE.from ? CHAIN_FAST_THREE.three : three,
      two,
      one,
    },
    limitMs: band.limitMs,
    logic: targetLogic(chapter, tier),
  };
}

// ---------------------------------------------------------------------------------------------------------
// A level's plan

interface PlanBase {
  id: string;
  rev: number;
  seed: number;
  /** 1–300. */
  n: number;
  chapter: number;
  slot: number;
  boss: boolean;
  tier: LevelTier;
  gameType: GameType;
  timeLimitMs: number;
}

export type LevelPlan =
  | (PlanBase & {
      kind: 'find';
      givens: number;
      scopes: FindScope['kind'][];
      boxEmpties: { min: number; max: number };
      stars: TimeStars;
      logic: LevelLogic;
    })
  | (PlanBase & {
      kind: 'findDuel';
      givens: number;
      scopes: FindScope['kind'][];
      boxEmpties: { min: number; max: number };
      spots: number;
      stars: SpotStars;
      logic: LevelLogic;
      bot: ChapterBot;
    })
  | (PlanBase & { kind: 'fillBox'; index: number } & FillPlan)
  | (PlanBase & { kind: 'fillRow'; index: number } & FillPlan)
  | (PlanBase & { kind: 'fillCol'; index: number } & FillPlan)
  | (PlanBase & { kind: 'puzzle' } & PuzzlePlan)
  | (PlanBase & {
      kind: 'duel';
      givens: number;
      endAtScore: number;
      stars: GapStars;
      bot: ChapterBot;
    })
  | (PlanBase & { kind: 'spotError' } & SpotErrorPlan)
  | (PlanBase & { kind: 'pointHunter'; givens: number; worthHint: boolean } & PointHunterPlan)
  | (PlanBase & { kind: 'chain'; givens: number } & ChainPlan);

export type LevelPlanOf<K extends LevelKind> = Extract<LevelPlan, { kind: K }>;

/**
 * How many levels of `kind` come before level n: the point hunter's worth hint (the first
 * `POINT_HUNTER.worthHintLevels` say what a locked cell is worth, plan §3.2), a fill kind's region.
 */
function kindIndex(kind: LevelKind, n: number, rules: LevelRules): number {
  let k = 0;
  for (let m = 1; m < n; m++) if (kindOfLevel(m, rules) === kind) k++;
  return k;
}

/** The kind of level n. */
export const kindOfLevel = (n: number, rules: LevelRules = LEVEL_RULES): LevelKind =>
  chapterKinds(chapterOf(n, rules), rules)[(n - 1) % rules.chapterSize]!;

/**
 * The numbers of the levels of a kind, in order; with `chapter`, of that chapter only; with `boss`, only bosses
 * (true) or no boss (false). Tests and tools pick a level by its kind this way, never by a fixed id: a rebuild
 * may give an id another kind.
 */
export function levelsOfKind(
  kind: LevelKind,
  o: { chapter?: number; boss?: boolean } = {},
  rules: LevelRules = LEVEL_RULES,
): number[] {
  const out: number[] = [];
  for (let n = 1; n <= rules.chapterCount * rules.chapterSize; n++) {
    if (o.chapter !== undefined && chapterOf(n, rules) !== o.chapter) continue;
    if (o.boss !== undefined && (n % rules.chapterSize === 0) !== o.boss) continue;
    if (kindOfLevel(n, rules) === kind) out.push(n);
  }
  return out;
}

/** Everything the builder needs to make level n, from the tables above. */
export function levelPlan(n: number, rules: LevelRules = LEVEL_RULES): LevelPlan {
  const id = levelIdOf(n);
  const chapter = chapterOf(n, rules);
  const slot = ((n - 1) % rules.chapterSize) + 1;
  const boss = slot === rules.chapterSize;
  const tier = tierOfSlot(slot);
  const kind = kindOfLevel(n, rules);
  const rev = levelRev(id);
  const base = {
    id,
    rev,
    seed: levelSeed(id, rev),
    n,
    chapter,
    slot,
    boss,
    tier,
    gameType: boardTypeOf(kind, chapter),
  };
  const botOf = (): ChapterBot => {
    const bot = levelBotOf(chapter, boss);
    if (!bot) throw new RangeError(`${id}: a ${kind} needs a bot, and chapter ${chapter} has none`);
    return bot;
  };
  switch (kind) {
    case 'find':
      return {
        ...base,
        kind,
        timeLimitMs: FIND.limitMs,
        givens: boardGivens(kind, chapter, tier),
        scopes: findScopes(kind, chapter),
        boxEmpties: targetBoxEmpties(chapter, tier),
        stars: findStars(chapter),
        logic: targetLogic(chapter, tier),
      };
    case 'findDuel':
      return {
        ...base,
        kind,
        timeLimitMs: RACE.limitMs,
        givens: boardGivens(kind, chapter, tier),
        scopes: findScopes(kind, chapter),
        boxEmpties: targetBoxEmpties(chapter, tier),
        spots: RACE.spots,
        stars: raceStars(),
        logic: raceLogic(chapter, tier),
        bot: botOf(),
      };
    case 'fillBox':
    case 'fillRow':
    case 'fillCol': {
      const p = fillPlan(chapter, tier);
      return {
        ...base,
        kind,
        ...p,
        timeLimitMs: p.limitMs,
        index: regionIndexOf(kind, kindIndex(kind, n, rules)),
      };
    }
    case 'puzzle': {
      const p = puzzlePlan(chapter, tier);
      return { ...base, kind, ...p, timeLimitMs: p.limitMs };
    }
    case 'duel':
      return {
        ...base,
        kind,
        timeLimitMs: DUEL.limitMs,
        givens: boardGivens(kind, chapter, tier),
        endAtScore: DUEL.endAtScore,
        stars: duelStars(),
        bot: botOf(),
      };
    case 'spotError': {
      const p = spotErrorPlan(chapter, tier);
      return { ...base, kind, ...p, timeLimitMs: p.limitMs };
    }
    case 'pointHunter': {
      const p = pointHunterPlan(chapter);
      return {
        ...base,
        kind,
        ...p,
        timeLimitMs: p.limitMs,
        givens: boardGivens(kind, chapter, tier),
        worthHint: kindIndex('pointHunter', n, rules) < POINT_HUNTER.worthHintLevels,
      };
    }
    case 'chain': {
      const p = chainPlan(chapter, tier);
      return { ...base, kind, ...p, timeLimitMs: p.limitMs, givens: boardGivens(kind, chapter, tier) };
    }
  }
}
