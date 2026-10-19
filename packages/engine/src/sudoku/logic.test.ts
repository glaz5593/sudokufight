import { cellName, parseCellName, parseGrid } from './board';
import { LogicBoard, logicalSolve, type Step, TECHNIQUES } from './logic';
import { bankRows, gridFrom } from '../testing/fixtures';

const names = (cells: readonly number[]): string[] => cells.map(cellName);

describe('techniques, one at a time', () => {
  it('naked single: frames the explanation with the unit that has the fewest missing digits', () => {
    // Spec §13.2: row D is missing 3, 7, 9; column 5 already has 3 and 9.
    const board = new LogicBoard(gridFrom({ D1: 1, D2: 2, D3: 4, D4: 5, D6: 6, D7: 8, A5: 3, H5: 9 }));
    const s = board.nakedSingleAt(parseCellName('D5'))!;
    expect(s).toMatchObject({
      technique: 'nakedSingle',
      digit: 7,
      primary: { kind: 'row', index: 3 },
      missing: [3, 7, 9],
      seen: [{ unit: { kind: 'col', index: 4 }, digits: [3, 9] }],
      eliminated: [],
      deps: [],
    });
    expect(board.nakedSingleAt(parseCellName('D8'))).toBeNull();
    expect(board.nakedSingleAt(parseCellName('D1'))).toBeNull(); // filled
  });

  it('hidden single: lists every other empty cell of the unit with what blocks it', () => {
    // Spec §13.2: 7 must be in box 5; D4 is blocked by 7 in column 4, E6 by 7 in row E.
    const board = new LogicBoard(gridFrom({ D6: 1, E4: 2, E5: 3, F4: 4, F5: 5, F6: 6, A4: 7, E1: 7 }));
    const d5 = parseCellName('D5');
    expect(board.nakedSingleAt(d5)).toBeNull();
    const s = board.hiddenSingleAt(d5)!;
    expect(s).toMatchObject({ technique: 'hiddenSingle', digit: 7, unit: { kind: 'box', index: 4 } });
    expect(s.blocked).toEqual([
      {
        cell: parseCellName('D4'),
        block: { kind: 'unit', unit: { kind: 'col', index: 3 }, cell: parseCellName('A4') },
      },
      {
        cell: parseCellName('E6'),
        block: { kind: 'unit', unit: { kind: 'row', index: 4 }, cell: parseCellName('E1') },
      },
    ]);
    expect(board.findHiddenSingle()).not.toBeNull();
  });

  it('placesOf and hiddenSingleInUnit look at one unit only (a find target is scoped)', () => {
    const d5 = parseCellName('D5');
    const box5 = { kind: 'box', index: 4 } as const;
    const hidden = new LogicBoard(gridFrom({ D6: 1, E4: 2, E5: 3, F4: 4, F5: 5, F6: 6, A4: 7, E1: 7 }));
    expect(names(hidden.placesOf(box5, 7))).toEqual(['D5']);
    expect(hidden.hiddenSingleInUnit(box5, d5, 7)).toEqual(hidden.hiddenSingleAt(d5, 7));
    // Row D leaves the 7 only D5, while box 5 still has D5 and E6 for it.
    const rowOnly = new LogicBoard(
      gridFrom({ D1: 1, D2: 2, D3: 3, D6: 4, D7: 5, D8: 6, D9: 8, A4: 7, E5: 1, F5: 2, F6: 3 }),
    );
    expect(names(rowOnly.placesOf(box5, 7))).toEqual(['D5', 'E6']);
    expect(rowOnly.hiddenSingleAt(d5, 7)).toMatchObject({ unit: { kind: 'row', index: 3 } });
    expect(rowOnly.hiddenSingleInUnit(box5, d5, 7)).toBeNull();
    expect(rowOnly.hiddenSingleInUnit({ kind: 'row', index: 3 }, d5, 7)).toMatchObject({
      technique: 'hiddenSingle',
      cell: d5,
      digit: 7,
    });
    expect(rowOnly.hiddenSingleInUnit({ kind: 'row', index: 0 }, d5, 7)).toBeNull(); // D5 is not in row A
    expect(rowOnly.placesOf({ kind: 'row', index: 3 }, 1)).toEqual([]); // already in the row
    expect(() => rowOnly.placesOf({ kind: 'col', index: 9 }, 1)).toThrow(RangeError);
  });

  it('pointing: a digit confined to one row of a box leaves the rest of that row', () => {
    const board = new LogicBoard(gridFrom({ B1: 2, B2: 3, B3: 4, C1: 5, C2: 6, C3: 7 }));
    const s = board.findPointing()!;
    expect(s).toMatchObject({ technique: 'pointing', digit: 1, box: 0, line: { kind: 'row', index: 0 } });
    expect(names(s.removed)).toEqual(['A4', 'A5', 'A6', 'A7', 'A8', 'A9']);
    const applied = board.apply(s);
    expect(applied.id).toBe(0);
    expect(board.candidatesOf(parseCellName('A4'))).not.toContain(1);
    expect(board.findBlock(parseCellName('A4'), 1)).toEqual({ kind: 'step', step: 0 });
  });

  it('claiming: a digit confined to one box within a row leaves the rest of that box', () => {
    const board = new LogicBoard(gridFrom({ A4: 2, A5: 3, A6: 4, A7: 5, A8: 6, A9: 7 }));
    const s = board.findClaiming()!;
    expect(s).toMatchObject({ technique: 'claiming', digit: 1, box: 0, line: { kind: 'row', index: 0 } });
    expect(names(s.removed)).toEqual(['B1', 'B2', 'B3', 'C1', 'C2', 'C3']);
  });

  it('naked pair: two cells that can only hold the same two digits clear them from the unit', () => {
    const board = new LogicBoard(gridFrom({ A3: 3, A4: 4, A5: 5, A6: 6, A7: 7, A8: 8, A9: 9 }));
    const s = board.findNakedPair()!;
    expect(s).toMatchObject({ technique: 'nakedPair', unit: { kind: 'box', index: 0 }, digits: [1, 2] });
    expect(names(s.cells)).toEqual(['A1', 'A2']);
    expect(names(s.removed.map((r) => r.cell))).toEqual(['B1', 'B2', 'B3', 'C1', 'C2', 'C3']);
    expect(s.removed[0]!.digits).toEqual([1, 2]);
  });

  it('hidden pair: two digits with only the same two places clear the other candidates there', () => {
    const board = new LogicBoard(gridFrom({ D3: 1, E3: 2, B4: 1, C5: 2, C7: 1, B8: 2 }));
    const s = board.findHiddenPair()!;
    expect(s).toMatchObject({ technique: 'hiddenPair', unit: { kind: 'row', index: 0 }, digits: [1, 2] });
    expect(names(s.cells)).toEqual(['A1', 'A2']);
    expect(s.removed).toEqual([
      { cell: 0, digits: [3, 4, 5, 6, 7, 8, 9] },
      { cell: 1, digits: [3, 4, 5, 6, 7, 8, 9] },
    ]);
    board.apply(s);
    expect(board.candidatesOf(0)).toEqual([1, 2]);
  });

  it('finds nothing to do on an empty board, and reports a broken one', () => {
    const empty = new LogicBoard(new Array<number>(81).fill(0));
    expect(empty.findStep(new Set(TECHNIQUES))).toBeNull();
    const broken = new LogicBoard(
      gridFrom({ A1: 1, A2: 2, A3: 3, A4: 4, A5: 5, A6: 6, A7: 7, A8: 8, E9: 9 }),
    );
    expect(broken.broken).toBe(true);
    expect(logicalSolve(broken.grid).solved).toBe(false);
  });
});

describe('logical solve over the whole bank', () => {
  const rows = bankRows();

  it('is sound: every placement matches the solution, no elimination removes it, deps point backwards', () => {
    for (const { puzzle, solution } of rows) {
      const sol = parseGrid(solution);
      const result = logicalSolve(parseGrid(puzzle));
      result.steps.forEach((step: Step, k) => {
        expect(step.id).toBe(k);
        for (const d of step.deps) expect(d).toBeLessThan(k);
        switch (step.technique) {
          case 'nakedSingle':
          case 'hiddenSingle':
            expect(step.digit).toBe(sol[step.cell]);
            break;
          case 'pointing':
          case 'claiming':
            for (const c of step.removed) expect(sol[c]).not.toBe(step.digit);
            break;
          default:
            for (const r of step.removed) expect(r.digits).not.toContain(sol[r.cell]);
        }
      });
      if (result.solved) expect(result.grid).toEqual(sol);
    }
  });

  it('solves most of the bank with the full technique set', () => {
    const solved = rows.filter((r) => logicalSolve(parseGrid(r.puzzle)).solved).length;
    expect(solved / rows.length).toBeGreaterThan(0.9);
  });

  it('lists the techniques it used in order of difficulty', () => {
    const r = logicalSolve(parseGrid(rows[0]!.puzzle));
    expect(r.techniques[0]).toBe('nakedSingle');
    const order = r.techniques.map((t) => TECHNIQUES.indexOf(t));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('stops where the allowed techniques stop', () => {
    const r = logicalSolve(parseGrid(rows[0]!.puzzle), []);
    expect(r.steps).toHaveLength(0);
    expect(r.solved).toBe(false);
  });
});
