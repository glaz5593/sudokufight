import {
  agreesWith,
  ALL_UNITS,
  boxOf,
  BOXES,
  candidates,
  cellName,
  colOf,
  digitCount,
  emptyCells,
  filledCount,
  filledIn,
  gridToString,
  indexOf,
  isCellIndex,
  isComplete,
  isConsistent,
  isDigit,
  isSolvedGrid,
  missingDigits,
  parseCellName,
  parseGrid,
  PEERS,
  peersWith,
  rowOf,
  ROWS,
  unitLabel,
  unitsOf,
} from './board';
import { gridFrom } from '../testing/fixtures';

const SOLVED = parseGrid('864371259325849761971265843436192587198657432257483916689734125713528694542916378');

describe('cell names (D5)', () => {
  it('names cells by row letter and column number', () => {
    expect(cellName(0)).toBe('A1');
    expect(cellName(8)).toBe('A9');
    expect(cellName(31)).toBe('D5');
    expect(cellName(80)).toBe('I9');
  });

  it('parses every name back to its index', () => {
    for (let i = 0; i < 81; i++) expect(parseCellName(cellName(i))).toBe(i);
    expect(parseCellName('d5')).toBe(31);
  });

  it('rejects anything that is not a cell', () => {
    expect(() => cellName(81)).toThrow(RangeError);
    expect(() => cellName(-1)).toThrow(RangeError);
    expect(() => cellName(1.5)).toThrow(RangeError);
    for (const bad of ['J1', 'A0', 'A10', '', '5D']) expect(() => parseCellName(bad)).toThrow(RangeError);
  });

  it('guards indices and digits', () => {
    expect(isCellIndex(0)).toBe(true);
    expect(isCellIndex(80)).toBe(true);
    expect(isCellIndex(81)).toBe(false);
    expect(isCellIndex('3')).toBe(false);
    expect(isDigit(1)).toBe(true);
    expect(isDigit(9)).toBe(true);
    expect(isDigit(0)).toBe(false);
    expect(isDigit(10)).toBe(false);
    expect(isDigit(2.5)).toBe(false);
  });
});

describe('units and peers', () => {
  it('maps rows, columns and boxes; boxes are numbered left to right, top to bottom', () => {
    expect([rowOf(31), colOf(31), boxOf(31)]).toEqual([3, 4, 4]); // D5 is in box 5
    expect(boxOf(parseCellName('A1'))).toBe(0);
    expect(boxOf(parseCellName('C9'))).toBe(2);
    expect(boxOf(parseCellName('G1'))).toBe(6);
    expect(boxOf(parseCellName('I9'))).toBe(8);
    expect(indexOf(3, 4)).toBe(31);
  });

  it('has 27 units of 9 cells, and every cell is in exactly one row, column and box', () => {
    expect(ALL_UNITS).toHaveLength(27);
    for (const u of ALL_UNITS) expect(new Set(u.cells).size).toBe(9);
    for (let i = 0; i < 81; i++) {
      const units = ALL_UNITS.filter((u) => u.cells.includes(i));
      expect(units.map((u) => u.kind)).toEqual(['row', 'col', 'box']);
      expect(unitsOf(i)).toEqual(units);
    }
    expect(BOXES[4]!.cells.map(cellName)).toEqual(['D4', 'D5', 'D6', 'E4', 'E5', 'E6', 'F4', 'F5', 'F6']);
  });

  it('gives every cell 20 distinct peers, symmetrically', () => {
    for (let i = 0; i < 81; i++) {
      expect(PEERS[i]).toHaveLength(20);
      expect(PEERS[i]).not.toContain(i);
      for (const p of PEERS[i]!) expect(PEERS[p]).toContain(i);
    }
  });

  it('labels units the way the explanations name them', () => {
    expect(unitLabel(ROWS[3]!)).toBe('D');
    expect(unitLabel({ kind: 'col', index: 4 })).toBe('5');
    expect(unitLabel({ kind: 'box', index: 4 })).toBe('5');
  });
});

describe('grids', () => {
  it('parses 0 and . as empty, ignores whitespace, and prints back with 0', () => {
    const text = '1.3' + '0'.repeat(78);
    const g = parseGrid(text.slice(0, 40) + '\n  ' + text.slice(40));
    expect(g[0]).toBe(1);
    expect(g[1]).toBe(0);
    expect(g[2]).toBe(3);
    expect(gridToString(g)).toBe('103' + '0'.repeat(78));
  });

  it('rejects a wrong length or a bad character', () => {
    expect(() => parseGrid('123')).toThrow(/81 cells/);
    expect(() => parseGrid('x' + '0'.repeat(80))).toThrow(/Bad character "x" at A1/);
  });

  it('counts, finds and checks', () => {
    const g = gridFrom({ A1: 5, A2: 3, B1: 6, E5: 5 });
    expect(filledCount(g)).toBe(4);
    expect(emptyCells(g)).toHaveLength(77);
    expect(digitCount(g, 5)).toBe(2);
    expect(filledIn(g, ROWS[0]!.cells)).toBe(2);
    expect(filledIn(g, ROWS[0]!.cells, 0)).toBe(1);
    expect(missingDigits(g, ROWS[0]!)).toEqual([1, 2, 4, 6, 7, 8, 9]);
    expect(candidates(g, parseCellName('A3'))).toEqual([1, 2, 4, 7, 8, 9]);
    expect(candidates(g, 0)).toEqual([]);
    expect(peersWith(g, parseCellName('A5'), 5)).toEqual([parseCellName('A1'), parseCellName('E5')]);
    expect(isConsistent(g)).toBe(true);
    expect(isComplete(g)).toBe(false);
  });

  it('detects clashes in rows, columns and boxes', () => {
    expect(isConsistent(gridFrom({ A1: 5, A9: 5 }))).toBe(false);
    expect(isConsistent(gridFrom({ A1: 5, I1: 5 }))).toBe(false);
    expect(isConsistent(gridFrom({ A1: 5, C3: 5 }))).toBe(false);
  });

  it('recognises a solved grid and a puzzle that agrees with it', () => {
    expect(isSolvedGrid(SOLVED)).toBe(true);
    const broken = SOLVED.slice();
    [broken[0], broken[1]] = [broken[1]!, broken[0]!];
    expect(isSolvedGrid(broken)).toBe(false);
    const puzzle = parseGrid(
      '004300209005009001070060043006002087190007400050083000600000105003508690042910300',
    );
    expect(agreesWith(puzzle, SOLVED)).toBe(true);
    expect(agreesWith(gridFrom({ A1: 1 }), SOLVED)).toBe(false);
  });
});
