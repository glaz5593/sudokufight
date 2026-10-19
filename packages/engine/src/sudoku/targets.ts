import type { FindScope, FindTarget, TargetTier } from '../levels/spec';
import {
  BOXES,
  type CellIndex,
  COLS,
  type Digit,
  type Grid,
  missingDigits,
  ROWS,
  type Unit,
  type UnitKind,
} from './board';
import { type LogicBoard, type Technique, TECHNIQUES } from './logic';
import { eliminationBoard, eliminationsOf, knowablePlacements } from './reading';

/**
 * Find targets (staged practice, plan §2.1–§2.2, dev-plan §2ב): "where must the 7 go in box 5?". A target
 * is a digit and a scope where the digit has exactly one place, on the board as it is, with the techniques
 * of the level's chapter (the eliminations run first, ./reading; nothing is placed).
 *
 * The check is the scope's own: the digit's places in that row, column or box. A 7 forced in D5 by row D is
 * not a target of box 5 while box 5 still has two places for it, although LogicBoard.hiddenSingleAt(D5)
 * finds the row's single (it looks at every unit of the cell). With the scope 'board', any cell where the
 * digit is known counts, and a tap on any empty cell of the digit is right (plan §2.1).
 *
 * The tier says what it takes: a single, a single only after an elimination (the first of the ladder that
 * brings it), or 'chain2', a single only after one other knowable cell is filled (act 6, plan §4.3).
 */

export type UnitScope = Exclude<FindScope, { kind: 'board' }>;

export interface FindTargetsOptions {
  /** The chapter's techniques; every technique by default. */
  techniques?: readonly Technique[];
  /** Which units: boxes, rows, columns (the order of the result). The whole board: boardScopeTarget. */
  scopes?: readonly UnitKind[];
  /** Also the targets known only after one other knowable cell is filled ('chain2'). */
  chain2?: boolean;
}

const unitOfScope = (s: UnitScope): Unit =>
  (s.kind === 'row' ? ROWS : s.kind === 'col' ? COLS : BOXES)[s.index]!;

/** One rung of a tier ladder: what the techniques up to it can do. */
interface Rung {
  tier: TargetTier;
  techniques: Technique[];
}

/**
 * The ladder of `techniques`: the singles, then each elimination added in order of difficulty. The first
 * rung that knows a target is its tier.
 */
function rungsOf(techniques: readonly Technique[]): Rung[] {
  const singles = TECHNIQUES.filter(
    (t) => (t === 'nakedSingle' || t === 'hiddenSingle') && techniques.includes(t),
  );
  const rungs: Rung[] = [{ tier: 'single', techniques: singles }];
  let upTo = singles;
  for (const e of eliminationsOf(techniques)) {
    upTo = [...upTo, e];
    rungs.push({ tier: e as TargetTier, techniques: upTo });
  }
  return rungs;
}

/** The one place of `digit` in the unit on this board, or null (none, or more than one). */
function placeIn(board: LogicBoard, unit: UnitScope, digit: Digit): CellIndex | null {
  const places = board.placesOf(unit, digit);
  return places.length === 1 ? places[0]! : null;
}

/** Whether the target is known on `grid` with `techniques`, nothing placed. */
function isKnown(grid: Grid, target: FindTarget, techniques: readonly Technique[]): boolean {
  const { scope, digit } = target;
  if (scope.kind === 'board') {
    const accept = new Set(target.accept);
    return knowablePlacements(grid, techniques).some((p) => accept.has(p.cell) && p.digit === digit);
  }
  // The scope's own hidden single: never another unit of the cell.
  if (!techniques.includes('hiddenSingle')) return false;
  const board = eliminationBoard(grid, techniques, undefined, (b) => b.placesOf(scope, digit).length <= 1);
  return target.cell !== null && placeIn(board, scope, digit) === target.cell;
}

/** The cells whose filling would answer the target itself. */
const answers = (target: FindTarget): ReadonlySet<CellIndex> =>
  new Set(target.cell === null ? target.accept : [target.cell, ...target.accept]);

/**
 * The fewest knowable cells to fill before the target is known: 0 when it is known now, 1 when it takes one
 * other cell first (a "two-step" target, act 6), up to `maxDepth`; null beyond. Each filled cell gets the
 * solution's digit, and is one the techniques know on the board of that moment.
 */
export function placementsBefore(
  grid: Grid,
  solution: Grid,
  target: FindTarget,
  techniques: readonly Technique[] = TECHNIQUES,
  maxDepth = 2,
): number | null {
  if (isKnown(grid, target, techniques)) return 0;
  const skip = answers(target);
  const seen = new Set<string>();
  let frontier: { grid: number[]; placed: CellIndex[] }[] = [{ grid: grid.slice(), placed: [] }];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const next: typeof frontier = [];
    for (const state of frontier) {
      for (const { cell } of knowablePlacements(state.grid, techniques)) {
        if (skip.has(cell)) continue;
        const placed = [...state.placed, cell].sort((a, b) => a - b);
        const key = placed.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        const g = state.grid.slice();
        g[cell] = solution[cell]!;
        if (isKnown(g, target, techniques)) return depth;
        next.push({ grid: g, placed });
      }
    }
    frontier = next;
  }
  return null;
}

/** The first rung of the ladder that knows the target, with nothing placed; null when none does. */
function knownTier(grid: Grid, target: FindTarget, ladder: readonly Technique[]): TargetTier | null {
  for (const rung of rungsOf(ladder)) if (isKnown(grid, target, rung.techniques)) return rung.tier;
  return null;
}

/**
 * How hard the target is with the techniques of `ladder` (sudoku/logic order): 'single', the first
 * elimination that makes it a single, or 'chain2' when only one other knowable cell filled first (its digit
 * is the one the logic gives it) brings it; null beyond that.
 */
export function targetTier(
  grid: Grid,
  target: FindTarget,
  ladder: readonly Technique[] = TECHNIQUES,
): TargetTier | null {
  const tier = knownTier(grid, target, ladder);
  if (tier) return tier;
  const skip = answers(target);
  for (const p of knowablePlacements(grid, ladder)) {
    if (skip.has(p.cell)) continue;
    const g = grid.slice();
    g[p.cell] = p.digit;
    if (isKnown(g, target, ladder)) return 'chain2';
  }
  return null;
}

/**
 * Known with `techniques` and, when `mustNeed` is not empty, not without them: the level needs the new
 * technique of its act (dev-plan §1.4). With an empty `mustNeed` only the first part is checked.
 */
export function requiresTechniques(
  grid: Grid,
  target: FindTarget,
  techniques: readonly Technique[],
  mustNeed: readonly Technique[],
): boolean {
  if (!isKnown(grid, target, techniques)) return false;
  if (!mustNeed.length) return true;
  return !isKnown(
    grid,
    target,
    techniques.filter((t) => !mustNeed.includes(t)),
  );
}

/**
 * Every target of the board in the units of `scopes` (by scope kind, unit and digit): a digit with exactly
 * one place in the unit, known with the techniques, nothing placed; with `chain2`, also the ones known after
 * one other knowable cell is filled.
 */
export function findTargets(
  grid: Grid,
  { techniques = TECHNIQUES, scopes = ['box', 'row', 'col'], chain2 = false }: FindTargetsOptions = {},
): FindTarget[] {
  const rungs = rungsOf(techniques);
  const boards = new Map<number, LogicBoard>();
  const boardAt = (k: number): LogicBoard => {
    let b = boards.get(k);
    if (!b) {
      b = eliminationBoard(grid, rungs[k]!.techniques);
      boards.set(k, b);
    }
    return b;
  };
  const known = techniques.includes('hiddenSingle');
  const top = rungs.length - 1;
  const pairs: { scope: UnitScope; digit: Digit }[] = [];
  for (const kind of scopes)
    for (let index = 0; index < 9; index++) {
      const scope: UnitScope = { kind, index };
      for (const digit of missingDigits(grid, unitOfScope(scope))) pairs.push({ scope, digit });
    }
  // After one other knowable cell is filled: one board per placement (only when asked).
  let after: { cell: CellIndex; digit: Digit; board: LogicBoard }[] | null = null;
  const out: FindTarget[] = [];
  for (const { scope, digit } of pairs) {
    if (!known) break;
    const cell = placeIn(boardAt(top), scope, digit);
    if (cell !== null) {
      let k = 0;
      while (k < top && placeIn(boardAt(k), scope, digit) !== cell) k++;
      out.push({ digit, scope, cell, accept: [cell], tier: rungs[k]!.tier });
      continue;
    }
    if (!chain2) continue;
    after ??= knowablePlacements(grid, techniques).map((p) => {
      const g = grid.slice();
      g[p.cell] = p.digit;
      return { ...p, board: eliminationBoard(g, techniques) };
    });
    for (const p of after) {
      // Filling the digit itself in the unit is the answer, not a step before it.
      if (p.digit === digit && unitOfScope(scope).cells.includes(p.cell)) continue;
      const c = placeIn(p.board, scope, digit);
      if (c === null) continue;
      out.push({ digit, scope, cell: c, accept: [c], tier: 'chain2' });
      break;
    }
  }
  return out;
}

/**
 * The scope 'board' for `digit` (plan §2.1): a tap on any empty cell whose answer is the digit is right,
 * and at least one of them must be known with the techniques now. Null otherwise. The tier is the easiest
 * of those cells'.
 */
export function boardScopeTarget(
  grid: Grid,
  solution: Grid,
  digit: Digit,
  techniques: readonly Technique[] = TECHNIQUES,
): FindTarget | null {
  const accept: CellIndex[] = [];
  for (let c = 0; c < grid.length; c++) if (grid[c] === 0 && solution[c] === digit) accept.push(c);
  if (!accept.length) return null;
  const target: FindTarget = { digit, scope: { kind: 'board' }, cell: null, accept, tier: 'single' };
  const tier = knownTier(grid, target, techniques);
  return tier ? { ...target, tier } : null;
}
