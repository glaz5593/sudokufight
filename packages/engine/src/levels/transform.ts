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
 */

interface Isomorphism {
  /** The new digit of digit d is digits[d − 1]. */
  digits: readonly Digit[];
  /** The new row of row r, and the new column of column c (before the transpose). */
  rows: readonly number[];
  cols: readonly number[];
  transpose: boolean;
}

/** A permutation of 0–8 that keeps the three groups of three (bands or stacks) and moves them as wholes. */
function groupedPermutation(rng: Rng): number[] {
  const groups = shuffled(rng, [0, 1, 2]);
  const within = [0, 1, 2].map(() => shuffled(rng, [0, 1, 2]));
  const map = new Array<number>(9);
  for (let g = 0; g < 3; g++) for (let i = 0; i < 3; i++) map[3 * g + i] = 3 * groups[g]! + within[g]![i]!;
  return map;
}

function drawIsomorphism(rng: Rng): Isomorphism {
  return {
    digits: shuffled(rng, DIGITS),
    rows: groupedPermutation(rng),
    cols: groupedPermutation(rng),
    transpose: rng.next() < 0.5,
  };
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
    const out = apply(spec, drawIsomorphism(rng));
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
