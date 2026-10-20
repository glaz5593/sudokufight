import type { MsRange } from '../../bot/levels';
import type { FindScope, TargetTier } from '../spec';
import type { FillCellNeed, FillTimeModel } from './fillRegion';

/**
 * The three player profiles of the simulation (plan §4.4; dev-plan §1.4): casual, good and excellent, as a
 * model per kind, because a 30-second task is not a full board. The plan's full-board think times (9–14 s,
 * 6–9 s, 3.5–5.5 s a move, with 8%, 4% and 2% mistakes) are where they start: they stay as the duel's, and
 * the shorter tasks (a cell of a box, a search, a chain step, a point hunter move) get their own.
 *
 * 1.0.3 (levels-content.md §4.4, §5.3): the fill kinds (fillBox, fillRow, fillCol) and the puzzle are timed by
 * a model of a good player, per cell by what it needs and per moving box (FILL_MODEL, PUZZLE_MODEL), the casual
 * player ×1.6 and the excellent one ×0.65 of it (`modelPace`). The thresholds of levels.config come from the
 * same model, so the report and the thresholds come from one place.
 *
 * NONE OF THESE IS CALIBRATED YET (D74). Every number below is a first guess, and the report says so next to
 * it. Calibrate once against real play before the report is read (Moshe's own times on a few sample levels,
 * only attempts that ended `completed`: a timeUp says "more than the limit"), then set `calibrated` on the
 * numbers that came from it. No staging data was read for the 1.0.3 build.
 */

export const PROFILE_IDS = ['casual', 'good', 'excellent'] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

export interface PlayerProfile {
  id: ProfileId;
  /** find and the race: finding one target, a single in a box with 3 empty cells, from when it shows. */
  findMs: MsRange;
  /** Spot the error: finding one visible error (a clash); a silent one takes `silentFactor` times more. */
  spotErrorMs: MsRange;
  /**
   * The fill kinds and the puzzle: this profile's time against the good player's model (FILL_MODEL,
   * PUZZLE_MODEL): ×1.6 casual, ×1 good, ×0.65 excellent (levels-content.md §4.4).
   */
  modelPace: number;
  /** The chain: one step that is a single; a step that needs an elimination takes `eliminationFactor` more. */
  chainStepMs: MsRange;
  /** The point hunter: one move. */
  pointMoveMs: MsRange;
  /** The point hunter: the share of moves that take the best cell (the others a random known cell). */
  pointBestShare: number;
  /** The duel: one ordinary move on a full board (plan §4.4), stretched by the bot's difficulty model. */
  duelMoveMs: MsRange;
  /** A wrong tap or digit, per target, cell, step or move (plan §4.4). */
  mistakeShare: number;
}

export const PROFILES: Readonly<Record<ProfileId, PlayerProfile>> = {
  casual: {
    id: 'casual',
    findMs: { min: 3000, max: 6000 },
    spotErrorMs: { min: 4000, max: 8000 },
    modelPace: 1.6,
    chainStepMs: { min: 5000, max: 9000 },
    pointMoveMs: { min: 6000, max: 10_000 },
    pointBestShare: 0.35,
    duelMoveMs: { min: 9000, max: 14_000 },
    mistakeShare: 0.08,
  },
  good: {
    id: 'good',
    findMs: { min: 1800, max: 3600 },
    spotErrorMs: { min: 2500, max: 5000 },
    modelPace: 1,
    chainStepMs: { min: 3000, max: 5500 },
    pointMoveMs: { min: 4000, max: 6500 },
    pointBestShare: 0.6,
    duelMoveMs: { min: 6000, max: 9000 },
    mistakeShare: 0.04,
  },
  excellent: {
    id: 'excellent',
    findMs: { min: 1000, max: 2200 },
    spotErrorMs: { min: 1500, max: 3000 },
    modelPace: 0.65,
    chainStepMs: { min: 2000, max: 3500 },
    pointMoveMs: { min: 2500, max: 4000 },
    pointBestShare: 0.85,
    duelMoveMs: { min: 3500, max: 5500 },
    mistakeShare: 0.02,
  },
};

/** How a target's search stretches (all profiles): by its scope, its tier, and its box's empty cells. */
export const SEARCH_FACTORS = {
  scope: { box: 1, row: 1.2, col: 1.2, board: 1.5 } satisfies Record<FindScope['kind'], number>,
  tier: {
    single: 1,
    pointing: 1.8,
    claiming: 1.8,
    nakedPair: 2.2,
    hiddenPair: 2.2,
    chain2: 2.4,
  } satisfies Record<TargetTier, number>,
  /** + this share for every empty cell of the target's box beyond 3. */
  perEmpty: 0.08,
  /** A silent error takes this many times a visible one. */
  silentFactor: 2,
  /** A chain step that needs an elimination. */
  eliminationFactor: 1.6,
} as const;

// ---------------------------------------------------------------------------------------------------------
// The time model of the fill kinds and the puzzle (levels-content.md §4.4, §5.3) [D67, D70, D74]

/**
 * A good player on a fill region (§4.4), in ms: finding one's way 2 s; per cell 1 s to choose the cell and the
 * digit, and thinking: 2 s on a full board, 3 s with holes around, 4.5 s for a hidden single, 9 s for a cell
 * that needs pointing or claiming, 12 s for a pair; the region's last cell 0.5 s (one digit is left).
 * ASSUMPTIONS, not calibrated (D74).
 */
export const FILL_MODEL: FillTimeModel = {
  orientMs: 2000,
  typeMs: 1000,
  thinkMs: { fullBoard: 2000, single: 3000, hiddenSingle: 4500, locked: 9000, pair: 12000, last: 500 },
};

/**
 * The model's mix of a ladder row's cells (§4.4), for the plan's "זמן משוער" column (the simulation reads the
 * built level's own cells instead, fillRegionSolve): one hidden single with 5–6 missing, two with 7–8, three
 * with 9; from chapter 16 one cell needs an elimination: pointing or claiming in place of a hidden single
 * (16–20), a pair in place of one (21–25), a pair besides the three (26–30, "any elimination"). The rest are
 * singles, and the last cell is free. An assumption, like the model's numbers.
 */
export function fillMixOf(missing: number, chapter: number): FillCellNeed[] {
  let hidden = missing <= 4 ? 0 : missing <= 6 ? 1 : missing <= 8 ? 2 : 3;
  let locked = 0;
  let pair = 0;
  if (chapter >= 16 && chapter <= 20) {
    hidden--;
    locked = 1;
  } else if (chapter >= 21 && chapter <= 25) {
    hidden--;
    pair = 1;
  } else if (chapter >= 26) pair = 1;
  const singles = missing - 1 - hidden - locked - pair;
  return [
    ...Array<FillCellNeed>(singles).fill('single'),
    ...Array<FillCellNeed>(hidden).fill('hiddenSingle'),
    ...Array<FillCellNeed>(locked).fill('locked'),
    ...Array<FillCellNeed>(pair).fill('pair'),
    'last',
  ];
}

/** A good player's time on a mix of cells (§4.4): orientation, then typing and thinking for every cell. */
export function fillMixMs(needs: readonly FillCellNeed[], fullBoard: boolean, model = FILL_MODEL): number {
  let ms = model.orientMs;
  for (const need of needs)
    ms += model.typeMs + model.thinkMs[need === 'single' && fullBoard ? 'fullBoard' : need];
  return ms;
}

/**
 * A good player on a puzzle (§5.3), in ms: finding one's way 3 s; 4.5 s thinking for each moving box (no lock:
 * D71), and 0.5 s more for each box above 3 (more boxes, more to compare); 1.5 s a swap, the fewest (moving − 1).
 * ASSUMPTIONS, not calibrated (D74).
 */
export interface PuzzleTimeModel {
  orientMs: number;
  boxMs: number;
  /** More per moving box, for each moving box above `extraFrom`. */
  extraPerBoxMs: number;
  extraFrom: number;
  swapMs: number;
}

export const PUZZLE_MODEL: PuzzleTimeModel = {
  orientMs: 3000,
  boxMs: 4500,
  extraPerBoxMs: 500,
  extraFrom: 3,
  swapMs: 1500,
};

/** Thinking per moving box (with the extra for many boxes). */
export const puzzleBoxMs = (moving: number, model = PUZZLE_MODEL): number =>
  model.boxMs + model.extraPerBoxMs * Math.max(0, moving - model.extraFrom);

/** A good player's time on a puzzle of `moving` boxes by the model: 19.5 s with 3, 46.5 s with 6. */
export const puzzleModelMs = (moving: number, model = PUZZLE_MODEL): number =>
  model.orientMs + moving * puzzleBoxMs(moving, model) + (moving - 1) * model.swapMs;

/**
 * How much one run's times spread around the model in the simulation: each part ×(1 ± this), uniformly. An
 * assumption (D74).
 */
export const MODEL_SPREAD = 0.25;

/** The stars of a chapter (of 30) each profile should get on its first attempts (plan §4.4): a target, not a measure. */
export const TARGET_STARS: readonly Readonly<Record<ProfileId, number>>[] = [
  { casual: 26, good: 29, excellent: 30 },
  { casual: 22, good: 27, excellent: 30 },
  { casual: 18, good: 25, excellent: 29 },
  { casual: 14, good: 23, excellent: 28 },
  { casual: 10, good: 21, excellent: 27 },
  { casual: 7, good: 19.5, excellent: 26 },
];

/** A chapter this many stars off its target is flagged (the report warns; nothing fails). */
export const TARGET_TOLERANCE = 3;

/** One number of the model, for the report: what it is, its value, and whether real play has set it. */
export interface ModelNumber {
  name: string;
  value: string;
  calibrated: boolean;
}

const ms = (r: MsRange) => `${r.min / 1000}–${r.max / 1000} s`;

/** Every number of the model, each marked as an assumption until calibrated (none is yet). */
export function modelNumbers(profiles: Readonly<Record<ProfileId, PlayerProfile>> = PROFILES): ModelNumber[] {
  const out: ModelNumber[] = [];
  for (const id of PROFILE_IDS) {
    const p = profiles[id];
    out.push(
      { name: `${id}.findMs`, value: ms(p.findMs), calibrated: false },
      { name: `${id}.spotErrorMs`, value: ms(p.spotErrorMs), calibrated: false },
      { name: `${id}.modelPace`, value: `×${p.modelPace}`, calibrated: false },
      { name: `${id}.chainStepMs`, value: ms(p.chainStepMs), calibrated: false },
      { name: `${id}.pointMoveMs`, value: ms(p.pointMoveMs), calibrated: false },
      { name: `${id}.pointBestShare`, value: String(p.pointBestShare), calibrated: false },
      { name: `${id}.duelMoveMs`, value: ms(p.duelMoveMs), calibrated: false },
      { name: `${id}.mistakeShare`, value: String(p.mistakeShare), calibrated: false },
    );
  }
  const f = SEARCH_FACTORS;
  out.push(
    { name: 'search.scope', value: JSON.stringify(f.scope), calibrated: false },
    { name: 'search.tier', value: JSON.stringify(f.tier), calibrated: false },
    { name: 'search.perEmpty', value: String(f.perEmpty), calibrated: false },
    { name: 'spotError.silentFactor', value: String(f.silentFactor), calibrated: false },
    { name: 'chain.eliminationFactor', value: String(f.eliminationFactor), calibrated: false },
    { name: 'fill.orientMs', value: `${FILL_MODEL.orientMs / 1000} s`, calibrated: false },
    { name: 'fill.typeMs', value: `${FILL_MODEL.typeMs / 1000} s`, calibrated: false },
    { name: 'fill.thinkMs', value: JSON.stringify(FILL_MODEL.thinkMs), calibrated: false },
    { name: 'puzzle.orientMs', value: `${PUZZLE_MODEL.orientMs / 1000} s`, calibrated: false },
    { name: 'puzzle.boxMs', value: `${PUZZLE_MODEL.boxMs / 1000} s`, calibrated: false },
    {
      name: 'puzzle.extraPerBoxMs',
      value: `${PUZZLE_MODEL.extraPerBoxMs / 1000} s above ${PUZZLE_MODEL.extraFrom}`,
      calibrated: false,
    },
    { name: 'puzzle.swapMs', value: `${PUZZLE_MODEL.swapMs / 1000} s`, calibrated: false },
    { name: 'model.spread', value: `±${MODEL_SPREAD * 100}%`, calibrated: false },
  );
  return out;
}
