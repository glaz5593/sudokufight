import type { MsRange } from '../../bot/levels';
import type { FindScope, TargetTier } from '../spec';

/**
 * The three player profiles of the simulation (plan §4.4; dev-plan §1.4): casual, good and excellent, as a
 * model per kind, because a 30-second task is not a full board. The plan's full-board think times (9–14 s,
 * 6–9 s, 3.5–5.5 s a move, with 8%, 4% and 2% mistakes) are where they start: they stay as the duel's, and
 * the shorter tasks (a cell of a box, a search, a chain step, a point hunter move) get their own.
 *
 * NONE OF THESE IS CALIBRATED YET. Every number below is a first guess, and the report says so next to it.
 * Calibrate once against real play before the report is read (Moshe's own times on a few sample levels, or
 * the think-time data of practice games), then set `calibrated` on the numbers that came from it.
 */

export const PROFILE_IDS = ['casual', 'good', 'excellent'] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

export interface PlayerProfile {
  id: ProfileId;
  /** find and the race: finding one target, a single in a box with 3 empty cells, from when it shows. */
  findMs: MsRange;
  /** Spot the error: finding one visible error (a clash); a silent one takes `silentFactor` times more. */
  spotErrorMs: MsRange;
  /** fillBox: one naked single of the box; the bot's difficulty model stretches harder cells (BOT_CONFIG). */
  fillBoxCellMs: MsRange;
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
    fillBoxCellMs: { min: 2500, max: 4500 },
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
    fillBoxCellMs: { min: 1600, max: 2800 },
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
    fillBoxCellMs: { min: 1000, max: 1800 },
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
      { name: `${id}.fillBoxCellMs`, value: ms(p.fillBoxCellMs), calibrated: false },
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
  );
  return out;
}
