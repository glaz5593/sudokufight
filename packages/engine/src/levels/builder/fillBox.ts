import { BOXES, type CellIndex, CELL_COUNT, type Grid } from '../../sudoku/board';
import { generateSolvedGrid } from '../../sudoku/generate';
import type { Technique } from '../../sudoku/logic';
import { closedBoard } from '../../sudoku/reading';
import { createRng, randomInt, type Rng, shuffled } from '../../util/random';
import type { LevelPlanOf } from '../levels.config';
import type { LevelSpecOf } from '../spec';
import { BuildError, checkOf, specHead, withoutNeeded } from './common';
import type { Built } from './find';

/**
 * fillBox, "מלא את הריבוע" (plan §2.3): a box with the chapter's missing cells, the only cells that can be
 * chosen, in a board of the chapter's givens around it. The box goes round all nine (drawn from the level's
 * seed). From a full solution, the box's missing cells are emptied, then the givens around it are taken away
 * in a seeded order, each only while the chapter's techniques still fill the whole box by themselves, playing
 * the box alone (closedBoard with only the box fillable), until the chapter's number is left. When the band
 * needs a technique (mustNeed), the box must not fill without it. Every step of that logic is forced, so the
 * box has one answer, however open the rest of the board is.
 */

/** Whether the techniques fill every one of `cells` on `grid`, playing those cells only. */
export function boxCloses(
  grid: Grid,
  cells: readonly CellIndex[],
  techniques: readonly Technique[],
): boolean {
  const out = closedBoard(grid, techniques, new Set(cells));
  return cells.every((c) => out[c] !== 0);
}

export const FILL_BOX_ATTEMPTS = 400;

export function buildFillBox(
  plan: LevelPlanOf<'fillBox'>,
  rng: Rng = createRng(plan.seed),
): Built<LevelSpecOf<'fillBox'>> {
  const box = randomInt(rng, 9);
  const boxCells = BOXES[box]!.cells;
  const outside: CellIndex[] = [];
  for (let c = 0; c < CELL_COUNT; c++) if (!boxCells.includes(c)) outside.push(c);
  const lean = withoutNeeded(plan.logic);
  for (let attempt = 1; attempt <= FILL_BOX_ATTEMPTS; attempt++) {
    const solution = generateSolvedGrid(rng);
    const missing = shuffled(rng, boxCells)
      .slice(0, plan.missing)
      .sort((a, b) => a - b);
    const grid = solution.slice();
    for (const c of missing) grid[c] = 0;
    let around = outside.length;
    for (const c of shuffled(rng, outside)) {
      if (around <= plan.around) break;
      grid[c] = 0;
      if (boxCloses(grid, missing, plan.logic.techniques)) around--;
      else grid[c] = solution[c]!;
    }
    if (around !== plan.around) continue;
    if (plan.logic.mustNeed.length && boxCloses(grid, missing, lean)) continue;
    return {
      spec: {
        ...specHead(plan, { givens: grid, solution }),
        targets: { box, cells: missing },
        stars: plan.stars,
        check: checkOf(plan.logic),
      },
      attempts: attempt,
    };
  }
  throw new BuildError(
    plan.id,
    `no box of ${plan.missing} with ${plan.around} around in ${FILL_BOX_ATTEMPTS} tries`,
  );
}
