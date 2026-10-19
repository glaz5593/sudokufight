import { boxOf, type CellIndex, DIGITS, type Grid } from '../../sudoku/board';
import { knowablePlacements } from '../../sudoku/reading';
import { boardScopeTarget, findTargets, requiresTechniques } from '../../sudoku/targets';
import { createRng, pick, type Rng } from '../../util/random';
import type { LevelLogic, LevelPlanOf } from '../levels.config';
import type { FindScope, FindTarget, LevelSpecOf } from '../spec';
import { makeBoard } from './boards';
import { boxEmpties, BuildError, checkOf, specHead } from './common';

/**
 * find, "where must the 7 go?" (plan §2.1): one target on a board of the chapter's givens. A target is a digit
 * and a scope where it has exactly one place with the chapter's techniques, nothing placed (sudoku/targets);
 * when the act adds a technique (LevelLogic.mustNeed), not without it. With the whole board as the scope, at
 * least one empty cell of the digit is known, and a tap on any of them is right. The box of the target (for
 * the whole board: of one known cell) has the chapter's number of empty cells.
 */

export interface TargetRules {
  scopes: readonly FindScope['kind'][];
  logic: LevelLogic;
  boxEmpties: { min: number; max: number };
}

/** The cells a target is known in now: its cell, or the known cells of `accept` (the whole board). */
export function knownCellsOf(grid: Grid, target: FindTarget, logic: LevelLogic): CellIndex[] {
  if (target.cell !== null) return [target.cell];
  const accept = new Set(target.accept);
  return knowablePlacements(grid, logic.techniques)
    .filter((p) => accept.has(p.cell) && p.digit === target.digit)
    .map((p) => p.cell);
}

/**
 * A target's box has the chapter's empties (for the whole board: the box of one of its known cells), counted
 * on `board` (a race counts them on the level's board, before any spot is taken).
 */
export function boxEmptiesFit(
  grid: Grid,
  target: FindTarget,
  logic: LevelLogic,
  range: TargetRules['boxEmpties'],
  board: Grid = grid,
): boolean {
  return knownCellsOf(grid, target, logic).some((c) => {
    const n = boxEmpties(board, boxOf(c));
    return n >= range.min && n <= range.max;
  });
}

/** Known with the techniques and, when the logic must need something, not without it. */
export const meetsLogic = (grid: Grid, target: FindTarget, logic: LevelLogic): boolean =>
  requiresTechniques(grid, target, logic.techniques, logic.mustNeed);

/**
 * Every target of `grid` that a level of these rules may ask for, in the solver's order; the box empties are
 * counted on `board`.
 */
export function targetCandidates(
  grid: Grid,
  solution: Grid,
  rules: TargetRules,
  board: Grid = grid,
): FindTarget[] {
  const out: FindTarget[] = [];
  const units = rules.scopes.filter((s): s is 'box' | 'row' | 'col' => s !== 'board');
  if (units.length) out.push(...findTargets(grid, { techniques: rules.logic.techniques, scopes: units }));
  if (rules.scopes.includes('board'))
    for (const d of DIGITS) {
      const t = boardScopeTarget(grid, solution, d, rules.logic.techniques);
      if (t) out.push(t);
    }
  return out.filter(
    (t) => meetsLogic(grid, t, rules.logic) && boxEmptiesFit(grid, t, rules.logic, rules.boxEmpties, board),
  );
}

/** How many boards the builder tries for a level before it gives up. */
export const FIND_ATTEMPTS = 400;

export interface Built<S> {
  spec: S;
  /** The boards tried, this one included. */
  attempts: number;
}

export function buildFind(
  plan: LevelPlanOf<'find'>,
  rng: Rng = createRng(plan.seed),
): Built<LevelSpecOf<'find'>> {
  const rules: TargetRules = { scopes: plan.scopes, logic: plan.logic, boxEmpties: plan.boxEmpties };
  for (let attempt = 1; attempt <= FIND_ATTEMPTS; attempt++) {
    const board = makeBoard(rng, { type: plan.gameType, total: plan.givens });
    if (!board) continue;
    const candidates = targetCandidates(board.givens, board.solution, rules);
    if (!candidates.length) continue;
    const target = pick(rng, candidates);
    return {
      spec: {
        ...specHead(plan, board),
        targets: { target },
        stars: plan.stars,
        check: checkOf(plan.logic),
      },
      attempts: attempt,
    };
  }
  throw new BuildError(plan.id, `no find target in ${FIND_ATTEMPTS} boards`);
}
