import { type CellIndex, CELL_COUNT, type Grid } from '../../sudoku/board';
import { generateSolvedGrid } from '../../sudoku/generate';
import { TECHNIQUES } from '../../sudoku/logic';
import { knowableCells } from '../../sudoku/reading';
import { createRng, randomInt, type Rng, shuffled } from '../../util/random';
import type { LevelLogic, LevelPlanOf } from '../levels.config';
import type { LevelSpecOf } from '../spec';
import { BuildError, checkOf, specHead, withoutNeeded } from './common';
import type { Built } from './find';

/**
 * Idea-3, the chain (plan §3.1; dev-plan §1.4): at every step exactly one empty cell of the board can be known,
 * with every technique the solver has (a player who knows a stronger one than the chapter's must not find
 * another cell and be told "not yet"), it is the chain's next cell, and the chapter's techniques know it; when
 * the act adds a technique, at least one step needs it. Such a board does not happen by itself, so it is
 * searched for: simulated annealing over which cells of a solution are givens (their number fixed: the D43
 * range of the board's type), the cost being how far each step is from exactly one knowable cell. The board
 * need not have one solution: the chain's digits are forced by logic, so they are the same in every one.
 */

export interface ChainWalk {
  /** 0 for a chain that holds. */
  cost: number;
  /** The cells the walk filled, in order. */
  cells: CellIndex[];
}

/** No cell known at a step: as bad as a step with this many extra. */
const STUCK = 6;

/** The chain a board makes: step by step, the known cells (all techniques), and what each step costs. */
export function walkChain(grid: Grid, solution: Grid, steps: number, logic: LevelLogic): ChainWalk {
  const board = grid.slice();
  const full = logic.techniques.length === TECHNIQUES.length;
  const lean = withoutNeeded(logic);
  let cost = 0;
  let needed = logic.mustNeed.length === 0;
  const cells: CellIndex[] = [];
  for (let i = 0; i < steps; i++) {
    const known = knowableCells(board, TECHNIQUES);
    if (!known.length) {
      cost += STUCK * (steps - i);
      break;
    }
    cost += known.length - 1;
    const chapter = full ? known : knowableCells(board, logic.techniques);
    const next = known.find((c) => chapter.includes(c));
    if (next === undefined) cost += 2;
    const cell = next ?? known[0]!;
    if (!needed && !knowableCells(board, lean).includes(cell)) needed = true;
    cells.push(cell);
    board[cell] = solution[cell]!;
  }
  if (!needed) cost += 1;
  return { cost, cells };
}

/** The annealing's schedule: a restart's moves, its first and lowest temperature, the cooling. */
export const CHAIN_SEARCH = { restarts: 40, moves: 6000, t0: 2, tMin: 0.05, cooling: 0.999 } as const;

export function buildChain(
  plan: LevelPlanOf<'chain'>,
  rng: Rng = createRng(plan.seed),
): Built<LevelSpecOf<'chain'>> {
  const all = Array.from({ length: CELL_COUNT }, (_, i) => i);
  for (let attempt = 1; attempt <= CHAIN_SEARCH.restarts; attempt++) {
    const solution = generateSolvedGrid(rng);
    const given = new Array<boolean>(CELL_COUNT).fill(false);
    for (const c of shuffled(rng, all).slice(0, plan.givens)) given[c] = true;
    const gridOf = () => solution.map((v, i) => (given[i] ? v : 0));
    let walk = walkChain(gridOf(), solution, plan.steps, plan.logic);
    let t: number = CHAIN_SEARCH.t0;
    for (let move = 0; move < CHAIN_SEARCH.moves && walk.cost > 0; move++) {
      const on: CellIndex[] = [];
      const off: CellIndex[] = [];
      for (let i = 0; i < CELL_COUNT; i++) (given[i] ? on : off).push(i);
      const a = on[randomInt(rng, on.length)]!;
      const b = off[randomInt(rng, off.length)]!;
      given[a] = false;
      given[b] = true;
      const next = walkChain(gridOf(), solution, plan.steps, plan.logic);
      const worse = next.cost - walk.cost;
      if (worse <= 0 || rng.next() < Math.exp(-worse / t)) walk = next;
      else {
        given[a] = true;
        given[b] = false;
      }
      t = Math.max(CHAIN_SEARCH.tMin, t * CHAIN_SEARCH.cooling);
    }
    if (walk.cost > 0) continue;
    return {
      spec: {
        ...specHead(plan, { givens: gridOf(), solution }),
        targets: { cells: walk.cells },
        stars: plan.stars,
        check: checkOf(plan.logic),
      },
      attempts: attempt,
    };
  }
  throw new BuildError(plan.id, `no ${plan.steps}-step chain in ${CHAIN_SEARCH.restarts} searches`);
}
