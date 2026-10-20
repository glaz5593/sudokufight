import { boxOf, colOf, rowOf } from '@sudoku-fight/engine';

import { PUZZLE_UI } from '../../../config/levels';
import { boxCellsAt, boxRows, dropTarget, placeAt, puzzleGeometry, slotOrigin } from '../puzzleGeometry';

/**
 * The puzzle board's geometry (levels-ui.md §4.1, §4.3): always LTR (place 0 at the top-left, in Hebrew too),
 * PUZZLE_UI.slotGap between the boxes, the place under a finger from the geometry alone (a gap belongs to the
 * nearer box, off the board is no place), and a drop that asks the host only for another place.
 */

const G = puzzleGeometry(300);

describe('puzzleGeometry', () => {
  it('three boxes and two gaps of PUZZLE_UI.slotGap (6 dp) across the side', () => {
    expect(PUZZLE_UI.slotGap).toBe(6);
    expect(G.gap).toBe(6);
    expect(3 * G.slot + 2 * G.gap).toBeCloseTo(300);
    expect(G.pitch).toBeCloseTo(G.slot + G.gap);
    expect(puzzleGeometry(300, 10).slot).toBeCloseTo((300 - 20) / 3);
  });

  it('places run row by row, left to right: 0 top-left, 2 top-right, 6 bottom-left, 8 bottom-right', () => {
    expect(slotOrigin(G, 0)).toEqual({ x: 0, y: 0 });
    expect(slotOrigin(G, 2)).toEqual({ x: 2 * G.pitch, y: 0 });
    expect(slotOrigin(G, 6)).toEqual({ x: 0, y: 2 * G.pitch });
    expect(slotOrigin(G, 8)).toEqual({ x: 2 * G.pitch, y: 2 * G.pitch });
  });

  it('the place under a point: its box, the nearer box in a gap, none off the board', () => {
    for (let place = 0; place < 9; place++) {
      const o = slotOrigin(G, place);
      expect(placeAt(G, o.x + 1, o.y + 1)).toBe(place);
      expect(placeAt(G, o.x + G.slot - 1, o.y + G.slot - 1)).toBe(place);
    }
    // In the gap between places 0 and 1: the first half is 0's, the second 1's.
    expect(placeAt(G, G.slot + 1, 10)).toBe(0);
    expect(placeAt(G, G.slot + G.gap - 1, 10)).toBe(1);
    expect(placeAt(G, -1, 10)).toBeNull();
    expect(placeAt(G, 10, 300)).toBeNull();
    expect(placeAt(G, Number.NaN, 10)).toBeNull();
    expect(placeAt(puzzleGeometry(0), 0, 0)).toBeNull();
  });

  it('a drop asks for another place only: not off the board, not its own place', () => {
    const o4 = slotOrigin(G, 4);
    const o7 = slotOrigin(G, 7);
    expect(dropTarget(G, 4, o7.x + 5, o7.y + 5)).toBe(7);
    expect(dropTarget(G, 4, o4.x + 5, o4.y + 5)).toBeNull();
    expect(dropTarget(G, 4, 400, 5)).toBeNull();
  });

  it('the nine cells of the box at a place, row by row, LTR', () => {
    for (let place = 0; place < 9; place++) {
      const cells = boxCellsAt(place);
      expect(cells).toHaveLength(9);
      expect(cells.every((c) => boxOf(c) === place)).toBe(true);
      expect(cells.map(rowOf)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2].map((r) => r + 3 * Math.floor(place / 3)));
      expect(cells.map(colOf)).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2].map((c) => c + 3 * (place % 3)));
    }
  });

  it('a box read aloud: three rows of digits, top to bottom, each left to right', () => {
    const grid = [...'534678912672195348198342567859761423426853791713924856961537284287419635345286179'].map(
      Number,
    );
    expect(boxRows(grid, 0)).toEqual(['5 3 4', '6 7 2', '1 9 8']);
    expect(boxRows(grid, 8)).toEqual(['2 8 4', '6 3 5', '1 7 9']);
    expect(boxRows([1, 2, 3], 0)).toEqual([]);
  });
});
