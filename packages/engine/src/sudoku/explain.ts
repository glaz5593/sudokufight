import { CELL_COUNT, type CellIndex, type Digit, type Grid, PEERS, unitsOf } from './board';
import {
  type Block,
  type Draft,
  isPlacement,
  LogicBoard,
  type PlacementStep,
  type Step,
  type Technique,
  TECHNIQUES,
  type UnitRef,
} from './logic';
import { solve } from './solver';

/**
 * Explanations (spec §13.2): why a cell holds its digit, computed on the board BEFORE the move, whatever
 * the player actually did.
 *
 * The engine solves logically from that board, but checks the asked cell first at every step, so the
 * explanation ends as soon as the cell is decided. It then keeps only the steps the final one depends on.
 * One step is a naked or hidden single; more steps are a chain (technique 'chain'). When our techniques
 * cannot reach the cell at all, the technique is 'beyond' and only the answer is known.
 *
 * Staged practice (dev-plan §2ב) adds options: a level explains in its own frame ("7 must appear in box 5",
 * even when the cell is also a naked single) and with its chapter's techniques only.
 */

export interface ExplainOptions {
  /**
   * Frame the answer as the hidden single of the digit in this unit (a find target's scope). When the cell
   * is decided another way before the unit frame applies, that step ends the explanation.
   */
  unit?: UnitRef;
  /**
   * The digit the cell must hold, when no solution is given (a chain board need not have just one: its
   * digits are forced in every solution). With a solution it must agree with it.
   */
  digit?: Digit;
  /** Only these techniques (the level's chapter); all by default. The unit frame is always allowed. */
  techniques?: readonly Technique[];
}

export interface Explanation {
  cell: CellIndex;
  /** The digit the cell must hold. */
  digit: Digit;
  /** False when our techniques cannot reach the cell from this board (an advanced technique is needed). */
  resolved: boolean;
  /**
   * The chain, in solve order; the last step places `cell`. Ids and every step reference (deps, blocks,
   * eliminations) are positions in this array. Empty when not resolved.
   */
  steps: Step[];
  /** The single technique that decides the cell; 'chain' when it takes several steps; 'beyond' when unresolved. */
  technique: Technique | 'chain' | 'beyond';
}

export function explain(
  grid: Grid,
  cell: CellIndex,
  solution?: Grid,
  { unit, digit: asked, techniques = TECHNIQUES }: ExplainOptions = {},
): Explanation {
  if (grid[cell] !== 0) throw new RangeError('Only an empty cell can be explained');
  let digit: Digit;
  if (asked !== undefined && solution === undefined) digit = asked;
  else {
    const solved = solution ?? solve(grid);
    if (!solved) throw new RangeError('The board has no solution');
    digit = solved[cell] as Digit;
    if (asked !== undefined && asked !== digit)
      throw new RangeError(`The solution has ${digit} in this cell, not ${asked}`);
  }

  const board = new LogicBoard(grid);
  const allowed = new Set(techniques);
  const direct = (): Draft<PlacementStep> | null => {
    if (unit) return board.hiddenSingleInUnit(unit, cell, digit);
    return (
      (allowed.has('nakedSingle') ? board.nakedSingleAt(cell) : null) ??
      (allowed.has('hiddenSingle') ? board.hiddenSingleAt(cell) : null)
    );
  };
  let final: Step | null = null;
  while (!board.solved && board.steps.length < 2000) {
    const found = direct();
    if (found) {
      final = board.apply(found);
      break;
    }
    const step = board.findStep(allowed);
    if (!step) break;
    final = board.apply(step);
    // Decided outside the asked frame (only possible with options: otherwise the direct check came first).
    if (isPlacement(final) && final.cell === cell) break;
    final = null;
  }
  if (!final) return { cell, digit, resolved: false, steps: [], technique: 'beyond' };
  if (final.technique !== 'nakedSingle' && final.technique !== 'hiddenSingle')
    throw new Error('unreachable: the final step places the cell');
  if (final.digit !== digit) throw new Error(`Logic placed ${final.digit} but the solution has ${digit}`);

  // Keep only what the final step depends on, transitively.
  const needed = new Set<number>();
  const stack = [final.id];
  while (stack.length) {
    const id = stack.pop()!;
    if (needed.has(id)) continue;
    needed.add(id);
    stack.push(...board.steps[id]!.deps);
  }
  const ids = [...needed].sort((a, b) => a - b);
  const at = new Map(ids.map((id, k) => [id, k]));
  const steps = ids.map((id) => renumber(board.steps[id]!, at));
  return { cell, digit, resolved: true, steps, technique: steps.length > 1 ? 'chain' : final.technique };
}

function renumber(step: Step, at: Map<number, number>): Step {
  const n = (id: number): number => {
    const k = at.get(id);
    if (k === undefined) throw new Error(`Step ${id} is not in the chain`);
    return k;
  };
  const block = (b: Block): Block => (b.kind === 'step' ? { kind: 'step', step: n(b.step) } : b);
  const base = { id: n(step.id), deps: step.deps.map(n) };
  switch (step.technique) {
    case 'nakedSingle':
      return { ...step, ...base, eliminated: step.eliminated.map((e) => ({ ...e, step: n(e.step) })) };
    case 'hiddenSingle':
      return { ...step, ...base, blocked: step.blocked.map((b) => ({ ...b, block: block(b.block) })) };
    default:
      return { ...step, ...base };
  }
}

// ---------------------------------------------------------------------------------------------------------

/** Why a played digit is wrong: a visible clash, or it simply isn't the solution. */
export type WrongReason =
  | { kind: 'conflict'; digit: Digit; unit: UnitRef; cell: CellIndex }
  | { kind: 'notSolution'; digit: Digit; answer: Digit };

export function whyWrong(grid: Grid, cell: CellIndex, played: Digit, solution?: Grid): WrongReason {
  for (const u of unitsOf(cell)) {
    const holder = u.cells.find((c) => c !== cell && grid[c] === played);
    if (holder !== undefined && PEERS[cell]!.includes(holder))
      return { kind: 'conflict', digit: played, unit: { kind: u.kind, index: u.index }, cell: holder };
  }
  const solved = solution ?? solve(grid);
  if (!solved) throw new RangeError('The board has no solution');
  return { kind: 'notSolution', digit: played, answer: solved[cell] as Digit };
}

// ---------------------------------------------------------------------------------------------------------

/** "Spot the error" (staged practice, plan Idea-1): why a planted digit is wrong, why the right one holds. */
export interface SpotErrorExplanation {
  /** A visible error clashes with a given ('conflict', its holder a given); a silent one is 'notSolution'. */
  reason: WrongReason;
  /** Why the cell holds the solution's digit, on the board without the planted errors. */
  explanation: Explanation;
}

/**
 * Explains a planted error at `cell` (showing `wrong`) on the board the player saw, cleaned: the givens and
 * the "mine" digits that agree with the solution (the other planted errors are dropped, so they never get
 * in the way), with `cell` emptied. A clash with a given comes first; then one with a correct "mine" digit;
 * otherwise the digit only contradicts the logic. `techniques` limits the explanation (the level's chapter).
 */
export function explainSpotError(
  givens: Grid,
  mine: Grid,
  cell: CellIndex,
  wrong: Digit,
  solution: Grid,
  techniques: readonly Technique[] = TECHNIQUES,
): SpotErrorExplanation {
  if (givens.length !== CELL_COUNT || mine.length !== CELL_COUNT || solution.length !== CELL_COUNT)
    throw new RangeError('explainSpotError needs 81-cell grids');
  if (givens[cell] !== 0) throw new RangeError('A planted error is never on a given');
  if (solution[cell] === wrong) throw new RangeError('This digit is the solution, not an error');
  const board = givens.map((g, i) => (g !== 0 ? g : mine[i] === solution[i] ? mine[i]! : 0));
  board[cell] = 0;
  let reason: WrongReason | null = null;
  for (const source of [givens, board]) {
    for (const u of unitsOf(cell)) {
      const holder = u.cells.find((c) => c !== cell && source[c] === wrong);
      if (holder === undefined) continue;
      reason = { kind: 'conflict', digit: wrong, unit: { kind: u.kind, index: u.index }, cell: holder };
      break;
    }
    if (reason) break;
  }
  reason ??= { kind: 'notSolution', digit: wrong, answer: solution[cell] as Digit };
  return { reason, explanation: explain(board, cell, solution, { techniques }) };
}
