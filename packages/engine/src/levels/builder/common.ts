import { BOXES, type CellIndex, type Grid, gridToString } from '../../sudoku/board';
import type { LevelLogic, LevelPlan } from '../levels.config';
import type { LevelCheck, LevelSpecOf } from '../spec';

/** What every built level starts with, in the order levels.json keeps its fields. */
export function specHead<K extends LevelPlan['kind']>(
  plan: Extract<LevelPlan, { kind: K }>,
  board: { givens: Grid; solution: Grid; mine?: Grid },
): Pick<
  LevelSpecOf<K>,
  'id' | 'rev' | 'chapter' | 'slot' | 'kind' | 'boss' | 'seed' | 'gameType' | 'board' | 'timeLimitMs'
> {
  return {
    id: plan.id,
    rev: plan.rev,
    chapter: plan.chapter,
    slot: plan.slot,
    kind: plan.kind,
    boss: plan.boss,
    seed: plan.seed,
    gameType: plan.gameType,
    board: {
      grid: gridToString(board.givens),
      solution: gridToString(board.solution),
      ...(board.mine ? { mine: gridToString(board.mine) } : null),
    },
    timeLimitMs: plan.timeLimitMs,
  } as Pick<
    LevelSpecOf<K>,
    'id' | 'rev' | 'chapter' | 'slot' | 'kind' | 'boss' | 'seed' | 'gameType' | 'board' | 'timeLimitMs'
  >;
}

export const checkOf = (logic: LevelLogic): LevelCheck => ({
  techniques: [...logic.techniques],
  mustNeed: [...logic.mustNeed],
});

/** The empty cells of a box (0–8). */
export const boxEmpties = (grid: Grid, box: number): number =>
  BOXES[box]!.cells.reduce((n, c) => n + (grid[c] === 0 ? 1 : 0), 0);

/** The techniques of `logic` without what it must need: a level that needs something fails with these. */
export const withoutNeeded = (logic: LevelLogic): LevelLogic['techniques'] =>
  logic.techniques.filter((t) => !logic.mustNeed.includes(t));

/** A grid with `cells` filled from the solution. */
export function filled(grid: Grid, solution: Grid, cells: Iterable<CellIndex>): number[] {
  const out = grid.slice();
  for (const c of cells) out[c] = solution[c]!;
  return out;
}

/** The builder gave up on a level: the chapter's numbers leave no board that passes. */
export class BuildError extends Error {
  constructor(id: string, what: string) {
    super(`${id}: ${what}`);
    this.name = 'BuildError';
  }
}
