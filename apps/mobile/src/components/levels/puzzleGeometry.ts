import { CELL_COUNT, type CellIndex } from '@sudoku-fight/engine';

import { PUZZLE_UI } from '../../config/levels';

/**
 * Where the puzzle's nine boxes are on its board (levels-ui.md §4.1, §4.3): pure geometry, always LTR (place 0
 * at the top-left, 2 at the top-right, 8 at the bottom-right, in Hebrew too; CLAUDE.md), so the board finds the
 * box under a finger without asking the engine. Positions are dp in the board's own coordinates.
 *
 * placeAt and slotOrigin are worklets: the drag reads them on the UI thread (PuzzleBoard).
 */

export interface PuzzleGeometry {
  /** The board's side. */
  side: number;
  /** The gap between two boxes (PUZZLE_UI.slotGap). */
  gap: number;
  /** One box's side. */
  slot: number;
  /** From one box's start to the next one's: a box and a gap. */
  pitch: number;
}

/** The nine places, row-major (0 top-left … 8 bottom-right), LTR. */
export const PUZZLE_PLACE_COUNT = 9;

export function puzzleGeometry(side: number, gap: number = PUZZLE_UI.slotGap): PuzzleGeometry {
  const slot = Math.max(0, (side - 2 * gap) / 3);
  return { side, gap, slot, pitch: slot + gap };
}

/** The top-left corner of a place's box: column place % 3 from the left, row ⌊place / 3⌋ from the top. */
export function slotOrigin(g: PuzzleGeometry, place: number): { x: number; y: number } {
  'worklet';
  return { x: (place % 3) * g.pitch, y: Math.floor(place / 3) * g.pitch };
}

/**
 * The place under a point (the board's own coordinates), or null off the board. A point in a gap belongs to the
 * nearer box (each box reaches half a gap out), so the whole board drops somewhere.
 */
export function placeAt(g: PuzzleGeometry, x: number, y: number): number | null {
  'worklet';
  if (!(x >= 0 && y >= 0 && x < g.side && y < g.side) || g.pitch <= 0) return null;
  const along = (v: number) => Math.min(2, Math.max(0, Math.floor((v + g.gap / 2) / g.pitch)));
  return along(y) * 3 + along(x);
}

/** The nine cells (0–80) of the box drawn at a place, row by row, LTR. */
export function boxCellsAt(place: number): CellIndex[] {
  const top = Math.floor(place / 3) * 3;
  const left = (place % 3) * 3;
  const cells: CellIndex[] = [];
  for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) cells.push((top + r) * 9 + left + c);
  return cells;
}

/**
 * The box at a place as a screen reader says it: its three rows of digits, top to bottom, each left to right
 * ("5 3 9", "6 1 2", "8 7 4"). An empty cell (never in a puzzle) is skipped.
 */
export function boxRows(grid: readonly number[], place: number): string[] {
  if (grid.length !== CELL_COUNT) return [];
  const cells = boxCellsAt(place);
  return [0, 1, 2].map((r) =>
    cells
      .slice(r * 3, r * 3 + 3)
      .map((c) => grid[c] ?? 0)
      .filter((d) => d > 0)
      .join(' '),
  );
}

/**
 * Where a drag of the box at `from` that ended at (x, y) asks to go: another place, or null for no move at all
 * (off the board, or back on its own place: no call to the host, levels-ui.md §4.3).
 */
export function dropTarget(g: PuzzleGeometry, from: number, x: number, y: number): number | null {
  const to = placeAt(g, x, y);
  return to === null || to === from ? null : to;
}
