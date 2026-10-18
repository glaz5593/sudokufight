import { parseCellName, parseGrid } from './board';
import * as scoring from './scoring';
import { formatScoreLine, interferenceCost, missedPoints, moveScore } from './scoring';
import { designScenarios, gridFrom } from '../testing/fixtures';

describe('moveScore (§6.4)', () => {
  it('reproduces the spec example: X = 7, Y = 6 → +3.5', () => {
    // D5: 7 filled in row D, 6 in column 5, 2 in box 5, and the digit 9 nowhere yet.
    const grid = gridFrom({
      D1: 1,
      D2: 2,
      D3: 3,
      D4: 4,
      D6: 5,
      D7: 6,
      D8: 7, // row D: 7
      A5: 8,
      B5: 1,
      C5: 2,
      G5: 3,
      H5: 4,
      I5: 6, // column 5: 6
    });
    const s = moveScore(grid, parseCellName('D5'), 9);
    expect(s).toEqual({ row: 7, col: 6, box: 2, num: 0, X: 7, Y: 6, points: 3.5 });
    expect(formatScoreLine(s)).toBe('points = 9 − 7 + (9 − 6) / 2 = 3.5');
  });

  it('ranges from 13.5 on an empty board to 1.5 on a nearly full one', () => {
    expect(moveScore(new Array<number>(81).fill(0), 0, 1).points).toBe(13.5);
    const solved = parseGrid(
      '864371259325849761971265843436192587198657432257483916689734125713528694542916378',
    );
    const last = solved.slice();
    last[0] = 0;
    expect(moveScore(last, 0, 8)).toEqual({ row: 8, col: 8, box: 8, num: 8, X: 8, Y: 8, points: 1.5 });
  });

  it('takes the two highest counts, counts the digit across the board, and lets Y equal X', () => {
    const grid = gridFrom({ A2: 5, A3: 6, B1: 7, C1: 8, E9: 1, I5: 1 });
    // A1: row 2, column 2, box 4 (A2, A3, B1, C1), num(1) = 2 → X = 4, Y = 2 → 5 + 3.5.
    expect(moveScore(grid, 0, 1)).toEqual({ row: 2, col: 2, box: 4, num: 2, X: 4, Y: 2, points: 8.5 });
    expect(moveScore(grid, 0, 2)).toMatchObject({ num: 0, X: 4, Y: 2 });
    // Two more in row A: row 4 and box 4 → X = Y = 4 → 5 + 2.5.
    const more = gridFrom({ A2: 5, A3: 6, B1: 7, C1: 8, A4: 1, A5: 2 });
    expect(moveScore(more, 0, 3)).toEqual({ row: 4, col: 2, box: 4, num: 0, X: 4, Y: 4, points: 7.5 });
  });

  it('[D13] can take Y as the second distinct value instead', () => {
    // A1 with row 4, col 2, box 4, num 0: sorted gives Y = X = 4; distinct gives Y = 2.
    const more = gridFrom({ A2: 5, A3: 6, B1: 7, C1: 8, A4: 1, A5: 2 });
    expect(moveScore(more, 0, 3, 'distinct')).toEqual({
      row: 4,
      col: 2,
      box: 4,
      num: 0,
      X: 4,
      Y: 2,
      points: 8.5,
    });
    // All four equal: Y stays X.
    expect(moveScore(new Array<number>(81).fill(0), 0, 1, 'distinct')).toMatchObject({
      X: 0,
      Y: 0,
      points: 13.5,
    });
  });

  it('refuses a filled cell or a non-digit', () => {
    const grid = gridFrom({ A1: 5 });
    expect(() => moveScore(grid, 0, 5)).toThrow(RangeError);
    expect(() => moveScore(grid, 1, 0 as never)).toThrow(RangeError);
  });

  it('matches every move of the design fixtures, and their running scores', () => {
    for (const [name, scenario] of Object.entries(designScenarios())) {
      const grid = parseGrid(scenario.puzzle);
      const score = new Map<number, number>();
      for (const e of scenario.log) {
        const cell = parseCellName(e.cell);
        if (e.type === 'correct') {
          const s = moveScore(grid, cell, e.digit as 1);
          expect({ name, cell: e.cell, ...s }).toEqual({
            name,
            cell: e.cell,
            row: e.rowFilled,
            col: e.colFilled,
            box: e.boxFilled,
            num: e.digitCount,
            X: e.X,
            Y: e.Y,
            points: e.points,
          });
          score.set(e.seat, (score.get(e.seat) ?? 0) + s.points);
          grid[cell] = e.digit;
        } else {
          // §6.5: what the right digit would have scored there, on the board as it was.
          const penalty = missedPoints(grid, cell, Number(scenario.solution[cell]) as 1).points;
          expect({ name, cell: e.cell, penalty }).toEqual({ name, cell: e.cell, penalty: e.penalty });
          score.set(e.seat, (score.get(e.seat) ?? 0) - penalty);
        }
        expect(score.get(e.seat)).toBe(e.score);
      }
      expect(grid.join('')).toBe(scenario.grid);
      for (const p of scenario.players) expect(score.get(p.seat) ?? 0).toBe(p.score);
    }
  });
});

describe('missedPoints (§6.5)', () => {
  it('is what the right digit would score in that cell now (the spec example D5 → 3.5)', () => {
    const grid = gridFrom({ D1: 1, D2: 2, D3: 3, D4: 4, D6: 5, D7: 6, D8: 7, A5: 8, B5: 1, C5: 2, G5: 3 });
    const right = missedPoints(grid, parseCellName('D5'), 9);
    expect(right).toEqual(moveScore(grid, parseCellName('D5'), 9));
    expect(right).toMatchObject({ X: 7, Y: 4, points: 4.5 });
    // The same cell costs less as the board fills (here column 5).
    grid[parseCellName('H5')] = 4;
    grid[parseCellName('I5')] = 6;
    expect(missedPoints(grid, parseCellName('D5'), 9)).toMatchObject({ X: 7, Y: 6, points: 3.5 });
  });

  it('ranges from 13.5 on an empty board to 1.5 for the last cell', () => {
    expect(missedPoints(new Array<number>(81).fill(0), 0, 1).points).toBe(13.5);
    const last = parseGrid(
      '864371259325849761971265843436192587198657432257483916689734125713528694542916378',
    );
    last[0] = 0;
    expect(missedPoints(last, 0, 8).points).toBe(1.5);
  });

  it('[D13] follows the Y rule of the game', () => {
    const more = gridFrom({ A2: 5, A3: 6, B1: 7, C1: 8, A4: 1, A5: 2 });
    expect(missedPoints(more, 0, 3).points).toBe(7.5);
    expect(missedPoints(more, 0, 3, 'distinct').points).toBe(8.5);
  });
});

describe('the retired §13 ladder (Moshe, 2026-10-15: no option to keep it)', () => {
  it('is gone: the scoring module has no ladder function', () => {
    for (const name of ['doublingPenalty', 'mistakePenalty']) expect(scoring).not.toHaveProperty(name);
  });

  it('a penalty is never below 1.5, so a cost of 1 (the ladder’s first step) exists only in old logs', () => {
    const solution = parseGrid(
      '864371259325849761971265843436192587198657432257483916689734125713528694542916378',
    );
    let lowest = Infinity;
    // Every cell, on boards from almost full down to empty (all of them subsets of the solution).
    for (let filled = 80; filled >= 0; filled -= 8) {
      for (let cell = 0; cell < 81; cell++) {
        const grid = solution.map((d, k) => (k !== cell && (k + cell) % 81 < filled ? d : 0));
        lowest = Math.min(lowest, missedPoints(grid, cell, solution[cell] as 1).points);
      }
    }
    expect(lowest).toBe(1.5);
  });
});

describe('interferenceCost (§7.2)', () => {
  it('is 2, 4, 8 … for the 1st, 2nd, 3rd interference', () => {
    expect([1, 2, 3, 4].map(interferenceCost)).toEqual([2, 4, 8, 16]);
    expect(() => interferenceCost(0)).toThrow(RangeError);
  });
});
