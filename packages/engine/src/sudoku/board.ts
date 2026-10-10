/**
 * Board primitives (spec §2): a 9×9 grid indexed 0..80, row-major.
 * Rows are letters A–I from the top, columns are 1–9 from the left, so index 31 is "D5".
 * Boxes are numbered 1–9 left to right, top to bottom (internally 0–8).
 * The board is always LTR, whatever the UI language.
 */

export type Digit = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
/** 0..80 */
export type CellIndex = number;
/** 81 values, 0 = empty. */
export type Grid = readonly number[];

export const DIGITS: readonly Digit[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export const CELL_COUNT = 81;
export const ROW_LETTERS = 'ABCDEFGHI';

export type UnitKind = 'row' | 'col' | 'box';
export interface Unit {
  kind: UnitKind;
  /** 0..8 */
  index: number;
  cells: readonly CellIndex[];
}

export const rowOf = (i: CellIndex): number => Math.floor(i / 9);
export const colOf = (i: CellIndex): number => i % 9;
export const boxOf = (i: CellIndex): number => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);
export const indexOf = (row: number, col: number): CellIndex => row * 9 + col;

export function isCellIndex(i: unknown): i is CellIndex {
  return typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < CELL_COUNT;
}

export function isDigit(d: unknown): d is Digit {
  return typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 9;
}

/** "D5" for index 31. */
export function cellName(i: CellIndex): string {
  if (!isCellIndex(i)) throw new RangeError(`Not a cell index: ${String(i)}`);
  return `${ROW_LETTERS[rowOf(i)]}${colOf(i) + 1}`;
}

/** 31 for "D5" (case-insensitive). Throws on anything else. */
export function parseCellName(name: string): CellIndex {
  const m = /^([A-Ia-i])([1-9])$/.exec(name.trim());
  if (!m) throw new RangeError(`Not a cell name: ${name}`);
  return indexOf(ROW_LETTERS.indexOf(m[1]!.toUpperCase()), Number(m[2]) - 1);
}

/** Display name of a unit: row letter, column number, or box number 1–9. */
export function unitLabel(unit: Pick<Unit, 'kind' | 'index'>): string {
  return unit.kind === 'row' ? ROW_LETTERS[unit.index]! : String(unit.index + 1);
}

const range9 = [0, 1, 2, 3, 4, 5, 6, 7, 8];

export const ROWS: readonly Unit[] = range9.map((r) => ({
  kind: 'row',
  index: r,
  cells: range9.map((c) => indexOf(r, c)),
}));
export const COLS: readonly Unit[] = range9.map((c) => ({
  kind: 'col',
  index: c,
  cells: range9.map((r) => indexOf(r, c)),
}));
export const BOXES: readonly Unit[] = range9.map((b) => {
  const r0 = Math.floor(b / 3) * 3;
  const c0 = (b % 3) * 3;
  return { kind: 'box', index: b, cells: range9.map((k) => indexOf(r0 + Math.floor(k / 3), c0 + (k % 3))) };
});
/** Rows, then columns, then boxes. */
export const ALL_UNITS: readonly Unit[] = [...ROWS, ...COLS, ...BOXES];

/** The row, column and box of a cell, in that order. */
export function unitsOf(i: CellIndex): readonly [Unit, Unit, Unit] {
  return [ROWS[rowOf(i)]!, COLS[colOf(i)]!, BOXES[boxOf(i)]!];
}

/** The 20 cells that share a row, column or box with `i` (excluding `i`). */
export const PEERS: readonly (readonly CellIndex[])[] = Array.from({ length: CELL_COUNT }, (_, i) => {
  const set = new Set<CellIndex>();
  for (const u of unitsOf(i)) for (const c of u.cells) if (c !== i) set.add(c);
  return [...set].sort((a, b) => a - b);
});

// ---------------------------------------------------------------------------------------------------------
// Grids

/** Parses 81 characters: 1–9 for a digit, 0 or . for empty. Whitespace is ignored. */
export function parseGrid(text: string): number[] {
  const s = text.replace(/\s+/g, '');
  if (s.length !== CELL_COUNT) throw new RangeError(`A grid needs 81 cells, got ${s.length}`);
  return [...s].map((ch, i) => {
    if (ch === '.' || ch === '0') return 0;
    if (ch >= '1' && ch <= '9') return ch.charCodeAt(0) - 48;
    throw new RangeError(`Bad character "${ch}" at ${cellName(i)}`);
  });
}

/** 81 characters, 0 for empty. */
export function gridToString(grid: Grid): string {
  return grid.map((v) => (v >= 1 && v <= 9 ? String(v) : '0')).join('');
}

export const emptyCells = (grid: Grid): CellIndex[] => {
  const out: CellIndex[] = [];
  for (let i = 0; i < CELL_COUNT; i++) if (grid[i] === 0) out.push(i);
  return out;
};

export const filledCount = (grid: Grid): number => grid.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0);

export const isComplete = (grid: Grid): boolean => grid.every((v) => v !== 0);

/** How many times `digit` is on the board. */
export function digitCount(grid: Grid, digit: Digit): number {
  let n = 0;
  for (const v of grid) if (v === digit) n++;
  return n;
}

/** How many cells of `cells` are filled, not counting `except`. */
export function filledIn(grid: Grid, cells: readonly CellIndex[], except?: CellIndex): number {
  let n = 0;
  for (const c of cells) if (c !== except && grid[c] !== 0) n++;
  return n;
}

/** The digits that are missing from a unit, ascending. */
export function missingDigits(grid: Grid, unit: Unit): Digit[] {
  const present = new Set(unit.cells.map((c) => grid[c]));
  return DIGITS.filter((d) => !present.has(d));
}

/** Digits that no peer of `i` holds. Empty for a filled cell. */
export function candidates(grid: Grid, i: CellIndex): Digit[] {
  if (grid[i] !== 0) return [];
  const used = new Set<number>();
  for (const p of PEERS[i]!) used.add(grid[p]!);
  return DIGITS.filter((d) => !used.has(d));
}

/** The peers of `i` that hold `digit`. */
export function peersWith(grid: Grid, i: CellIndex, digit: Digit): CellIndex[] {
  return PEERS[i]!.filter((p) => grid[p] === digit);
}

/** True when no unit holds a digit twice. Empty cells are fine. */
export function isConsistent(grid: Grid): boolean {
  for (const u of ALL_UNITS) {
    const seen = new Set<number>();
    for (const c of u.cells) {
      const v = grid[c]!;
      if (v === 0) continue;
      if (seen.has(v)) return false;
      seen.add(v);
    }
  }
  return true;
}

/** A complete, consistent grid. */
export const isSolvedGrid = (grid: Grid): boolean =>
  grid.length === CELL_COUNT && isComplete(grid) && isConsistent(grid);

/** True when every filled cell of `puzzle` agrees with `solution`. */
export function agreesWith(puzzle: Grid, solution: Grid): boolean {
  for (let i = 0; i < CELL_COUNT; i++) if (puzzle[i] !== 0 && puzzle[i] !== solution[i]) return false;
  return true;
}
