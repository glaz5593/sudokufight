import { type CellIndex, type Digit, type Grid, PEERS, unitsOf } from './board';
import { type Block, LogicBoard, type Step, type Technique, TECHNIQUES, type UnitRef } from './logic';
import { solve } from './solver';

/**
 * Explanations (spec §13.2): why a cell holds its digit, computed on the board BEFORE the move, whatever
 * the player actually did.
 *
 * The engine solves logically from that board, but checks the asked cell first at every step, so the
 * explanation ends as soon as the cell is decided. It then keeps only the steps the final one depends on.
 * One step is a naked or hidden single; more steps are a chain (technique 'chain'). When our techniques
 * cannot reach the cell at all, the technique is 'beyond' and only the answer is known.
 */

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

export function explain(grid: Grid, cell: CellIndex, solution?: Grid): Explanation {
  if (grid[cell] !== 0) throw new RangeError('Only an empty cell can be explained');
  const solved = solution ?? solve(grid);
  if (!solved) throw new RangeError('The board has no solution');
  const digit = solved[cell] as Digit;

  const board = new LogicBoard(grid);
  const all = new Set(TECHNIQUES);
  let final: Step | null = null;
  while (!board.solved && board.steps.length < 2000) {
    const direct = board.nakedSingleAt(cell) ?? board.hiddenSingleAt(cell);
    if (direct) {
      final = board.apply(direct);
      break;
    }
    const step = board.findStep(all);
    if (!step) break;
    board.apply(step);
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
