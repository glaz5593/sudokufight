import { type CellIndex, CELL_COUNT, type Digit, DIGITS, type Grid, PEERS } from '../../sudoku/board';
import { knowablePlacements } from '../../sudoku/reading';
import { createRng, type Rng, shuffled } from '../../util/random';
import type { LevelLogic, LevelPlanOf } from '../levels.config';
import type { LevelSpecOf, PlantedError } from '../spec';
import { makeBoard } from './boards';
import { BuildError, checkOf, specHead, withoutNeeded } from './common';
import type { Built } from './find';

/**
 * Idea-1, spot the error (plan §3.1): "my" digits around the givens, some of them wrong; the givens are always
 * right and alone have one solution. A visible error clashes with a given in its row, column or box; a silent
 * one clashes with nothing on the board, and only the logic says it is wrong: on the board cleaned of the
 * errors, the chapter's techniques know the cell's right digit (when the act adds a technique, a silent
 * error's right digit needs it). A cell the logic knows as a naked single cannot hold a silent error (every
 * other digit is around it), so a silent error sits where a hidden single decides the cell.
 */

/** The digits of `cells` that hold `digit` on `board`. */
const holds = (board: Grid, cells: readonly CellIndex[], digit: Digit): boolean =>
  cells.some((c) => board[c] === digit);

/** The givens and "my" right digits: the board as the logic reads it (sudoku/explain's explainSpotError). */
export function cleanedBoard(givens: Grid, mine: Grid, solution: Grid): number[] {
  return givens.map((v, i) => (v !== 0 ? v : mine[i] !== 0 && mine[i] === solution[i] ? mine[i]! : 0));
}

/** The cells the logic decides on `board`, with the right digit, as a set. */
function decided(board: Grid, solution: Grid, logic: LevelLogic['techniques']): Set<CellIndex> {
  return new Set(
    knowablePlacements(board, logic)
      .filter((p) => solution[p.cell] === p.digit)
      .map((p) => p.cell),
  );
}

export const SPOT_ERROR_ATTEMPTS = 400;

export function buildSpotError(
  plan: LevelPlanOf<'spotError'>,
  rng: Rng = createRng(plan.seed),
): Built<LevelSpecOf<'spotError'>> {
  const count = plan.visible + plan.silent;
  const lean = withoutNeeded(plan.logic);
  for (let attempt = 1; attempt <= SPOT_ERROR_ATTEMPTS; attempt++) {
    const board = makeBoard(rng, { type: plan.gameType, total: plan.givens });
    if (!board) continue;
    const { givens, solution } = board;
    const empties = shuffled(
      rng,
      Array.from({ length: CELL_COUNT }, (_, i) => i).filter((i) => givens[i] === 0),
    );
    const right = empties.slice(0, plan.mine - count);
    const cleaned = givens.slice();
    for (const c of right) cleaned[c] = solution[c]!;
    const known = decided(cleaned, solution, plan.logic.techniques);
    const knownLean = plan.logic.mustNeed.length ? decided(cleaned, solution, lean) : known;
    const free = empties.slice(plan.mine - count).filter((c) => known.has(c));

    const shown = cleaned.slice();
    const errors: PlantedError[] = [];
    const silentAt: { cell: CellIndex; digit: Digit }[] = [];
    // Silent errors first: they need the most of the board.
    for (const cell of free) {
      if (silentAt.length === plan.silent) break;
      if (plan.logic.mustNeed.length && knownLean.has(cell)) continue;
      const digit = shuffled(rng, DIGITS).find((d) => d !== solution[cell] && !holds(shown, PEERS[cell]!, d));
      if (digit === undefined) continue;
      shown[cell] = digit;
      silentAt.push({ cell, digit });
      errors.push({ cell, digit, visible: false });
    }
    if (silentAt.length < plan.silent) continue;
    let visible = 0;
    for (const cell of free) {
      if (visible === plan.visible) break;
      if (shown[cell] !== 0) continue;
      const digit = shuffled(rng, DIGITS).find(
        (d) =>
          d !== solution[cell] &&
          holds(givens, PEERS[cell]!, d) &&
          // It must not give a silent error a clash.
          !silentAt.some((s) => s.digit === d && PEERS[cell]!.includes(s.cell)),
      );
      if (digit === undefined) continue;
      shown[cell] = digit;
      errors.push({ cell, digit, visible: true });
      visible++;
    }
    if (visible < plan.visible) continue;
    const mine = shown.map((v, i) => (givens[i] === 0 ? v : 0));
    errors.sort((a, b) => a.cell - b.cell);
    return {
      spec: {
        ...specHead(plan, { givens, solution, mine }),
        targets: { errors },
        stars: plan.stars,
        check: checkOf(plan.logic),
      },
      attempts: attempt,
    };
  }
  throw new BuildError(plan.id, `no board for ${count} errors in ${SPOT_ERROR_ATTEMPTS} tries`);
}
