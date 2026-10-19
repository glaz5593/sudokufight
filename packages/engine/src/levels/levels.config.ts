import type { BotLevelId } from '../bot/levels';
import type { GameType } from '../gameType';
import { type Technique, TECHNIQUES } from '../sudoku/logic';
import { seedFromString } from '../util/random';
import { chapterOf, LEVEL_RULES, levelIdOf, type LevelRules } from './progress';
import type { FindScope, GapStars, LevelKind, SpotStars, TimeStars } from './spec';
import { POINT_SHARES, type PointShares } from './stars';

/**
 * The chapter table of staged practice as data (plan §4.1–§4.4, §2, §3; dev-plan §1.4, §2ד) [D50–D54, D61]:
 * what each of the 300 levels is, before the builder (levels/builder/) turns it into a board. Every number
 * of the plan lives here once, and levels.config.test.ts pins them, so changing one is a reviewed edit and a
 * rebuild (`npm run levels:build`), never a silent change of a built level (levels.json is frozen).
 *
 * The saw-tooth (plan §4.1): slots 1–3 are a step easier than the chapter, 4–6 the chapter itself, 7–9 and the
 * boss a step harder. A step moves the continuous knobs (the givens of a board, the empties of a target's
 * box, the givens around a fillBox box) by one chapter, back or forward. What the chapter brings (its board
 * type, scopes, techniques, the ideas' counts and steps, the thresholds and the bot) is the same in all its
 * slots, except that the easy slots of a chapter whose act adds a technique do not need it yet (a fillBox's
 * box needs its band's technique in every slot: plan §2.3 gives it per band).
 */

// ---------------------------------------------------------------------------------------------------------
// Ids, revs and seeds

/** Mixed into every level's seed: no level ever draws from a seed of the puzzle bank (dev-plan §2ד). */
export const LEVELS_SALT = 20261018;

/**
 * Levels rebuilt on purpose, with their new rev (plan §5.6): a level not listed is rev 1. A rebuilt level
 * draws a new board from its new seed, and keeps its stars (mergeBest).
 */
export const LEVEL_REVS: Readonly<Record<string, number>> = {};

export const levelRev = (id: string): number => LEVEL_REVS[id] ?? 1;

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

/**
 * Slots 1–9 of chapters 1–9 (plan §4.1): chapters 1–4 by the plan's table (chapter 4 has one Idea-1), then two
 * of each kind and one idea. A kind that comes in gets two levels instead of one of an older kind: Idea-2 in
 * chapter 7 takes a findDuel slot, Idea-3 in chapter 9 a duel slot. Where the design drew a level, it is that
 * kind: L066 a point hunter, L077 a spot-the-error, L135 a chain.
 */
const FIRST_CHAPTERS: Readonly<Record<number, readonly LevelKind[]>> = {
  1: [F, B, F, B, F, B, F, B, F],
  2: [F, R, B, F, R, B, F, R, B],
  3: [D, F, R, B, D, F, R, B, D],
  4: [F, R, B, E, D, B, F, R, D],
  5: [F, R, B, D, E, F, B, R, D],
  6: [F, R, B, D, E, F, B, R, D],
  7: [F, R, B, D, F, P, B, P, D],
  8: [F, R, B, D, F, B, E, R, D],
  9: [F, R, B, D, C, F, B, R, C],
};

/**
 * From chapter 10 (plan §4.1): one find, two each of findDuel, fillBox and duel, and two ideas, in turn so
 * that each comes back about every chapter and a half. The pairs go round every three chapters, and put each
 * idea where the plan's table brings something new for it (13 silent errors, 14 a 4-step chain, 12 and 21
 * the point hunter's shorter limits, 22 a 5-step chain, 27 the 98%, 29 the 12 s chain).
 */
const IDEA_PAIRS: readonly (readonly [LevelKind, LevelKind])[] = [
  [C, E], // chapters 10, 13, 16 …
  [C, P], // 11, 14, 17 …
  [E, P], // 12, 15, 18 …
];

/** The boss (plan §3.3): chapter 1 a fillBox with 5 missing; then the race in even chapters, the duel in odd. */
export const bossKindOf = (chapter: number): LevelKind =>
  chapter === 1 ? 'fillBox' : chapter % 2 === 0 ? 'findDuel' : 'duel';

/** The kinds of a chapter's ten slots, in order; slot 10 is the boss. */
export function chapterKinds(chapter: number, rules: LevelRules = LEVEL_RULES): LevelKind[] {
  if (!(Number.isInteger(chapter) && chapter >= 1 && chapter <= rules.chapterCount))
    throw new RangeError(`Not a chapter: ${chapter}`);
  const first = FIRST_CHAPTERS[chapter];
  if (first) return [...first, bossKindOf(chapter)];
  const [a, b] = IDEA_PAIRS[(chapter - 10) % IDEA_PAIRS.length]!;
  return [B, R, D, F, a, b, B, R, D, bossKindOf(chapter)];
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

/** A level's bot: its pace is final, a boss's ×0.9 already in it (rounded to a thousandth). */
export function levelBotOf(chapter: number, boss: boolean): ChapterBot | null {
  const bot = chapterBot(chapter);
  if (!bot) return null;
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

/** fillBox (plan §2.3): its bands. `around`: the givens of the other 72 cells, from the band's first chapter to its last. */
export interface FillBoxBand {
  from: number;
  to: number;
  missing: number;
  around: readonly [first: number, last: number];
  /** ★★★, ★★, ★ in ms; ★ is the end of the level. */
  stars: readonly [three: number, two: number, one: number];
  logic: LevelLogic;
}

/**
 * The plan's table (§2.3): what the box needs is a band's own, in all its slots. Chapters 1–5 a naked single
 * ("בודד גלוי"), 6–10 a hidden single, 11–15 hidden singles through other cells (nothing new to need,
 * dev-plan §1.4), 16–20 pointing or claiming, 21–25 a pair, 26–30 "pairs and chains": any elimination.
 */
export const FILL_BOX_BANDS: readonly FillBoxBand[] = [
  {
    from: 1,
    to: 2,
    missing: 4,
    around: [72, 66],
    stars: [10000, 15000, 20000],
    logic: { techniques: ['nakedSingle'], mustNeed: [] },
  },
  {
    from: 3,
    to: 5,
    missing: 5,
    around: [60, 50],
    stars: [12000, 18000, 25000],
    logic: { techniques: ['nakedSingle'], mustNeed: [] },
  },
  {
    from: 6,
    to: 10,
    missing: 6,
    around: [42, 36],
    stars: [14000, 21000, 30000],
    logic: { techniques: SINGLES, mustNeed: ['hiddenSingle'] },
  },
  {
    from: 11,
    to: 15,
    missing: 7,
    around: [34, 30],
    stars: [16000, 23000, 30000],
    logic: { techniques: SINGLES, mustNeed: [] },
  },
  {
    from: 16,
    to: 20,
    missing: 9,
    around: [30, 27],
    stars: [18000, 25000, 30000],
    logic: { techniques: [...SINGLES, ...LOCKED], mustNeed: LOCKED },
  },
  {
    from: 21,
    to: 25,
    missing: 9,
    around: [27, 25],
    stars: [18000, 25000, 30000],
    logic: { techniques: TECHNIQUES, mustNeed: PAIRS },
  },
  {
    from: 26,
    to: 30,
    missing: 9,
    around: [25, 22],
    stars: [15000, 22000, 30000],
    logic: { techniques: TECHNIQUES, mustNeed: ELIMINATIONS },
  },
];

/** Chapter 1's boss: a box with 5 missing, ★★★ 10 s, ★★ 15, ★ 20 (plan §3.3). */
export const FIRST_BOSS_BOX = { missing: 5, stars: [10000, 15000, 20000] as const };

export const fillBoxBandOf = (chapter: number): FillBoxBand => {
  const band = FILL_BOX_BANDS.find((b) => chapter >= b.from && chapter <= b.to);
  if (!band) throw new RangeError(`Not a chapter: ${chapter}`);
  return band;
};

export interface FillBoxPlan {
  missing: number;
  /** The givens of the other 72 cells. */
  around: number;
  stars: TimeStars;
  limitMs: number;
  logic: LevelLogic;
}

/** A fillBox level: the band's, the givens around moved by the tier within the band; chapter 1's boss its own. */
export function fillBoxPlan(chapter: number, tier: LevelTier, boss: boolean): FillBoxPlan {
  const band = fillBoxBandOf(chapter);
  const [first, last] = band.around;
  const around = Math.round(
    clamp(
      along(first, last, band.from, band.to, chapter + TIER_SHIFT[tier]),
      Math.min(first, last),
      Math.max(first, last),
    ),
  );
  const [three, two, one] = boss && chapter === 1 ? FIRST_BOSS_BOX.stars : band.stars;
  return {
    missing: boss && chapter === 1 ? FIRST_BOSS_BOX.missing : band.missing,
    around,
    stars: { by: 'timeMs', three, two, one },
    limitMs: one,
    logic: band.logic,
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
 * One visible error in 20 s (chapters 4–7), two visible in 30 s (8–12), two silent (13–18), three from 19:
 * one visible and two silent ("מלכודות"; the plan gives the count only).
 */
export const SPOT_ERROR_BANDS: readonly SpotErrorBand[] = [
  { from: 4, to: 7, visible: 1, silent: 0, limitMs: 20000, stars: [6000, 12000, 20000] },
  { from: 8, to: 12, visible: 2, silent: 0, limitMs: 30000, stars: [12000, 20000, 30000] },
  { from: 13, to: 18, visible: 0, silent: 2, limitMs: 30000, stars: [12000, 20000, 30000] },
  { from: 19, to: 30, visible: 1, silent: 2, limitMs: 30000, stars: [15000, 22000, 30000] },
];

/**
 * The board of spot the error: the givens, from 60 in chapter 4 down to 30 in chapter 30 (the design's level
 * 77 has 58), moved by the tier, and 14 of "my" digits, the errors among them.
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

/** Idea-2, the point hunter (plan §3.1, §4.3): 3 moves; 30 s in 7–11, 25 s in 12–20, 20 s from 21. */
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
 * Idea-3, the chain (plan §3.1, §4.3): 3 steps in 24 s (chapters 9–13), 4 in 30 s (14–21), 5 in 30 s (from
 * 22); from chapter 29 ★★★ only up to 12 s (dev-plan §1.4).
 */
export interface ChainBand {
  from: number;
  to: number;
  steps: number;
  limitMs: number;
  stars: readonly [three: number, two: number, one: number];
}

export const CHAIN_BANDS: readonly ChainBand[] = [
  { from: 9, to: 13, steps: 3, limitMs: 24000, stars: [10000, 16000, 24000] },
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
  | (PlanBase & { kind: 'fillBox' } & FillBoxPlan)
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

/** The first `POINT_HUNTER.worthHintLevels` point hunters say what a locked cell is worth (plan §3.2). */
function pointHunterIndex(n: number, rules: LevelRules): number {
  let k = 0;
  for (let m = 1; m < n; m++) if (kindOfLevel(m, rules) === 'pointHunter') k++;
  return k;
}

/** The kind of level n. */
export const kindOfLevel = (n: number, rules: LevelRules = LEVEL_RULES): LevelKind =>
  chapterKinds(chapterOf(n, rules), rules)[(n - 1) % rules.chapterSize]!;

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
    case 'fillBox': {
      const p = fillBoxPlan(chapter, tier, boss);
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
        worthHint: pointHunterIndex(n, rules) < POINT_HUNTER.worthHintLevels,
      };
    }
    case 'chain': {
      const p = chainPlan(chapter, tier);
      return { ...base, kind, ...p, timeLimitMs: p.limitMs, givens: boardGivens(kind, chapter, tier) };
    }
  }
}
