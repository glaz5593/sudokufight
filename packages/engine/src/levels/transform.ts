import { CELL_COUNT, type CellIndex, type Digit, DIGITS } from '../sudoku/board';
import { createRng, type Rng, seedFromString, shuffled } from '../util/random';
import { LEVEL_RULES, type LevelRules } from './progress';
import type { AppLevel, FindScope, FindTarget } from './spec';

/**
 * "שוב" on an equivalent board [D63] (dev-plan §1.3 ה): from the second attempt on, a level is played on a
 * sudoku isomorphism of its stored board, so it is never solved from memory, while its logic, targets, scores
 * and thresholds stay exactly the same. The isomorphism relabels the digits, swaps rows inside their band and
 * columns inside their stack, swaps the bands and the stacks, and sometimes transposes. Each of those keeps
 * every row, column and box a row, column or box with the same cells filled, and every digit's count: the
 * technique of a target, what can be known, and §6.4's score of every move (row, column, box and digit
 * counts, of which X and Y are the two highest) are all invariant.
 *
 * Deterministic: drawn from seedFromString(`${id}:r${rev}:a${attempt}`), so the same attempt is always the same
 * board, and the next attempt another one.
 *
 * Two kinds draw less (1.0.3; levels-content.md §4.6, §5.6) [D63, D69]:
 * - fillRow and fillCol never transpose: a row stays a row and a column a column (the screens name it "row D"
 *   or "column 5", from the attempt's level).
 * - The puzzle moves whole bands and stacks only, never a row inside its band or a column inside its stack, and
 *   may transpose: every box moves as one piece, the same pairs of boxes fit side by side, so its one valid
 *   arrangement, its step-by-step solution and its fixed boxes all carry over. The start moves with it.
 */

interface Isomorphism {
  /** The new digit of digit d is digits[d − 1]. */
  digits: readonly Digit[];
  /** The new row of row r, and the new column of column c (before the transpose). */
  rows: readonly number[];
  cols: readonly number[];
  transpose: boolean;
}

/**
 * A permutation of 0–8 that keeps the three groups of three (bands or stacks) and moves them as wholes; with
 * `within` false, the order inside each group stays.
 */
function groupedPermutation(rng: Rng, within = true): number[] {
  const groups = shuffled(rng, [0, 1, 2]);
  const inside = [0, 1, 2].map(() => (within ? shuffled(rng, [0, 1, 2]) : [0, 1, 2]));
  const map = new Array<number>(9);
  for (let g = 0; g < 3; g++) for (let i = 0; i < 3; i++) map[3 * g + i] = 3 * groups[g]! + inside[g]![i]!;
  return map;
}

function drawIsomorphism(rng: Rng, kind: AppLevel['kind']): Isomorphism {
  const whole = kind === 'puzzle';
  const iso = {
    digits: shuffled(rng, DIGITS),
    rows: groupedPermutation(rng, !whole),
    cols: groupedPermutation(rng, !whole),
    transpose: rng.next() < 0.5,
  };
  return kind === 'fillRow' || kind === 'fillCol' ? { ...iso, transpose: false } : iso;
}

const mapCell = (iso: Isomorphism, cell: CellIndex): CellIndex => {
  const r = iso.rows[Math.floor(cell / 9)]!;
  const c = iso.cols[cell % 9]!;
  return iso.transpose ? c * 9 + r : r * 9 + c;
};

const mapDigit = (iso: Isomorphism, d: Digit): Digit => iso.digits[d - 1]!;

/** An 81-character grid (0 = empty) moved and relabelled. */
function mapGrid(iso: Isomorphism, grid: string): string {
  if (grid.length !== CELL_COUNT) throw new RangeError('A grid needs 81 cells');
  const out = new Array<string>(CELL_COUNT).fill('0');
  for (let i = 0; i < CELL_COUNT; i++) {
    const v = Number(grid[i]);
    out[mapCell(iso, i)] = v >= 1 && v <= 9 ? String(mapDigit(iso, v as Digit)) : '0';
  }
  return out.join('');
}

function mapScope(iso: Isomorphism, scope: FindScope): FindScope {
  switch (scope.kind) {
    case 'board':
      return scope;
    case 'row': {
      const index = iso.rows[scope.index]!;
      return iso.transpose ? { kind: 'col', index } : { kind: 'row', index };
    }
    case 'col': {
      const index = iso.cols[scope.index]!;
      return iso.transpose ? { kind: 'row', index } : { kind: 'col', index };
    }
    case 'box': {
      const band = Math.floor(iso.rows[3 * Math.floor(scope.index / 3)]! / 3);
      const stack = Math.floor(iso.cols[3 * (scope.index % 3)]! / 3);
      return { kind: 'box', index: iso.transpose ? stack * 3 + band : band * 3 + stack };
    }
  }
}

const mapCells = (iso: Isomorphism, cells: readonly CellIndex[]): CellIndex[] =>
  cells.map((c) => mapCell(iso, c));

/** Where box (place) p goes: its band and stack moved, swapped by the transpose. */
function mapBox(iso: Isomorphism, p: number): number {
  const box = mapScope(iso, { kind: 'box', index: p });
  return box.kind === 'box' ? box.index : p;
}

/** A row or a column moved; never transposed (fillRow, fillCol draw no transpose). */
function mapLine(iso: Isomorphism, kind: 'row' | 'col', index: number): number {
  const line = mapScope(iso, { kind, index });
  if (line.kind !== kind || !('index' in line)) throw new Error(`A ${kind} turned into a ${line.kind}`);
  return line.index;
}

function mapTarget(iso: Isomorphism, t: FindTarget): FindTarget {
  return {
    ...t,
    digit: mapDigit(iso, t.digit),
    scope: mapScope(iso, t.scope),
    cell: t.cell === null ? null : mapCell(iso, t.cell),
    accept: mapCells(iso, t.accept),
  };
}

function apply<S extends AppLevel>(spec: S, iso: Isomorphism): S {
  const board = {
    ...spec.board,
    grid: mapGrid(iso, spec.board.grid),
    solution: mapGrid(iso, spec.board.solution),
    ...(spec.board.mine === undefined ? null : { mine: mapGrid(iso, spec.board.mine) }),
  };
  const level: AppLevel = spec;
  let targets: AppLevel['targets'];
  switch (level.kind) {
    case 'find':
      targets = { target: mapTarget(iso, level.targets.target) };
      break;
    case 'findDuel':
      targets = { spots: level.targets.spots.map((t) => mapTarget(iso, t)) };
      break;
    case 'fillBox': {
      const box = mapScope(iso, { kind: 'box', index: level.targets.box });
      targets = {
        box: box.kind === 'box' ? box.index : level.targets.box,
        cells: mapCells(iso, level.targets.cells),
      };
      break;
    }
    case 'duel':
      targets = level.targets;
      break;
    case 'spotError':
      targets = {
        errors: level.targets.errors.map((e) => ({
          ...e,
          cell: mapCell(iso, e.cell),
          digit: mapDigit(iso, e.digit),
        })),
      };
      break;
    case 'pointHunter':
      targets = {
        maxMoves: level.targets.maxMoves,
        best: level.targets.best.map((m) => ({
          ...m,
          cell: mapCell(iso, m.cell),
          digit: mapDigit(iso, m.digit),
        })),
      };
      break;
    case 'chain':
      targets = { cells: mapCells(iso, level.targets.cells) };
      break;
    case 'fillRow':
      targets = { row: mapLine(iso, 'row', level.targets.row), cells: mapCells(iso, level.targets.cells) };
      break;
    case 'fillCol':
      targets = { col: mapLine(iso, 'col', level.targets.col), cells: mapCells(iso, level.targets.cells) };
      break;
    case 'puzzle': {
      // The box at place p (home h) stands at place P(p) with home P(h): the boxes moved as wholes.
      const { start, fixed } = level.targets;
      const moved = new Array<number>(start.length);
      start.forEach((home, place) => {
        moved[mapBox(iso, place)] = mapBox(iso, home);
      });
      targets = {
        ...level.targets,
        start: moved,
        fixed: fixed.map((p) => mapBox(iso, p)).sort((a, b) => a - b),
      };
      break;
    }
  }
  return { ...spec, board, targets };
}

/**
 * The level as attempt `attempt` plays it: attempt 1 is the stored level itself; from 2 on, an equivalent
 * board (above). The star rule, the limits and the bot (level, pace, frozen search times) are untouched.
 */
export function transformLevel<S extends AppLevel>(spec: S, attempt: number): S {
  if (!(Number.isInteger(attempt) && attempt >= 1))
    throw new RangeError(`An attempt is 1 or more, got ${attempt}`);
  if (attempt === 1) return spec;
  const rng = createRng(seedFromString(`${spec.id}:r${spec.rev}:a${attempt}`));
  // An isomorphism can map a grid onto itself (an automorphism): draw again, so a replay is always new.
  for (let k = 0; k < 8; k++) {
    const out = apply(spec, drawIsomorphism(rng, spec.kind));
    if (out.board.solution !== spec.board.solution) return out;
  }
  throw new Error(`No new board for ${spec.id} attempt ${attempt}`);
}

/** The level an attempt plays: transformLevel while LEVEL_RULES.replayTransform is on, else the stored one. */
export const attemptLevel = <S extends AppLevel>(
  spec: S,
  attempt: number,
  rules: LevelRules = LEVEL_RULES,
): S => (rules.replayTransform ? transformLevel(spec, attempt) : spec);
