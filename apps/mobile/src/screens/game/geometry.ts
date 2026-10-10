import { type CellIndex, colOf, rowOf } from '@sudoku-fight/engine';

import { boardGeometry } from '../../components/board';
import { tokens } from '../../theme';

/**
 * Where things are on the game screen, for the flights of the score chips (motion.md §6 "Flights") and the
 * reactions' floats (§4.5): rects come from onLayout (each relative to its parent) and are chained up to the
 * screen's root, the overlays' space. Layout x is always from the physical left, in Hebrew too, and the
 * overlays are LTR, so no mirroring is needed.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `child` (laid out inside `parent`) in the coordinates `parent` is laid out in. */
export const within = (parent: Rect, child: Rect): Rect => ({
  x: parent.x + child.x,
  y: parent.y + child.y,
  width: child.width,
  height: child.height,
});

export const centerOf = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

const { boxGap, grid } = tokens.border;

/**
 * The centre of a cell of a board drawn in `board` (components.md §11.1): always LTR, column 1 on the left and
 * row A on top; 1 dp lines inside a box, 3 dp gaps between boxes.
 */
export function cellCenter(board: Rect, cell: CellIndex): Point {
  const g = boardGeometry(board.width);
  const along = (k: number) =>
    Math.floor(k / 3) * (3 * g.cell + 2 * grid + boxGap) + (k % 3) * (g.cell + grid) + g.cell / 2;
  return { x: board.x + along(colOf(cell)), y: board.y + along(rowOf(cell)) };
}

/**
 * The board's side (components.md §11.1): the screen width less the two 16 dp gutters, and no taller than the
 * room left between the strip and the keypad. Before that room is measured: the design's 358 dp, if it fits.
 */
export function boardSide(windowWidth: number, roomHeight: number | null): number {
  const byWidth = windowWidth - 2 * tokens.layout.gutterGame;
  const side = roomHeight === null ? Math.min(byWidth, tokens.size.board) : Math.min(byWidth, roomHeight);
  return Math.max(0, Math.floor(side));
}

const card = tokens.layout.game.playerCard;

/**
 * Where a score chip lands on a 2-player card laid out in `cardRect` (components.md §3.2, motion.md
 * `points.flight`): the middle of its score row, where "+3.5" sits beside the score. The card's own layout is
 * not measured piece by piece; its rows have fixed heights, so the score row is found from them.
 */
export function scoreSlotOf(cardRect: Rect): Point {
  return {
    x: cardRect.x + cardRect.width / 2,
    y: cardRect.y + card.headerHeight + card.scoreRowTop + card.scoreRowHeight / 2,
  };
}

/**
 * The centre of a 2-player card's avatar (components.md §3.1): at the card's outer edge, in either language
 * (mine at the start of the row, the opponent's mirrored at its end), so the edge nearer the screen's side.
 * Reactions rise from here (motion.md `reaction.float`).
 */
export function avatarCenterOf(cardRect: Rect, screenWidth: number): Point {
  const half = tokens.size.avatar.card.frame / 2;
  const onLeft = cardRect.x + cardRect.width / 2 < screenWidth / 2;
  return {
    x: onLeft ? cardRect.x + half : cardRect.x + cardRect.width - half,
    y: cardRect.y + card.headerHeight / 2,
  };
}
