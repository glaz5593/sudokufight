import { CELL_COUNT, type CellIndex, type Digit, DIGITS, type Grid, unitsOf } from './board';
import { LogicBoard, type Technique, TECHNIQUES } from './logic';

/**
 * What a player can know on a board as it is (staged practice, dev-plan §2ב): the cells that the techniques
 * decide WITHOUT filling any other cell first.
 *
 * The eliminations among the techniques (pointing, claiming, naked and hidden pairs) run one at a time,
 * simplest first, until none is left, exactly as the bot reads a board (bot/brain computeReading, which keeps
 * its own copy so the bot never changes). A cell is then knowable when it is a naked single ('nakedSingle')
 * or the only place of a digit in its row, column or box ('hiddenSingle'). Nothing is placed: a cell known
 * only after another one is filled is not knowable yet (the chain levels, plan Idea-3).
 *
 * The chain rule checks knowableCells(grid, TECHNIQUES), the whole solver; the point hunter and the find
 * targets (./targets) use the techniques of the level's chapter. closedBoard() fills what the techniques
 * reach, round after round.
 */

/**
 * Digits ruled out of a cell from outside the grid: the wrong tries everyone sees (spec §6.5) [D12], which
 * the bot leaves out of a cell's options too.
 */
export type ExcludedDigits = ReadonlyMap<CellIndex, readonly Digit[]>;

/** A cell the techniques decide, and its digit. */
export interface KnowablePlacement {
  cell: CellIndex;
  digit: Digit;
}

const bit = (d: number): number => 1 << (d - 1);
const SINGLES: ReadonlySet<Technique> = new Set<Technique>(['nakedSingle', 'hiddenSingle']);
/** A guard: every elimination removes a candidate, so a board runs out of them long before this. */
const MAX_ELIMINATIONS = 729;

/** The eliminations among `techniques` (no single: they place a digit). */
export const eliminationsOf = (techniques: readonly Technique[]): Technique[] =>
  TECHNIQUES.filter((t) => !SINGLES.has(t) && techniques.includes(t));

/**
 * The board's candidates after the eliminations of `techniques`, one at a time, simplest first, until none
 * is left or `enough(board)` holds. On a board with a solution an elimination never removes a cell's answer,
 * so a single found on the way stays one: stopping early changes no answer.
 */
export function eliminationBoard(
  grid: Grid,
  techniques: readonly Technique[] = TECHNIQUES,
  excluded?: ExcludedDigits,
  enough?: (board: LogicBoard) => boolean,
): LogicBoard {
  const board = new LogicBoard(grid);
  excluded?.forEach((digits, cell) => {
    for (const d of digits) board.cand[cell]! &= ~bit(d);
  });
  const allowed = new Set(eliminationsOf(techniques));
  if (!allowed.size) return board;
  for (let k = 0; k < MAX_ELIMINATIONS && !enough?.(board); k++) {
    const step = board.findStep(allowed);
    if (!step) break;
    board.apply(step);
  }
  return board;
}

/**
 * The digit the board decides for the empty `cell`, or null: a naked single, then a hidden single (row,
 * column, box), as far as `techniques` allow.
 */
export function decidedDigit(
  board: LogicBoard,
  cell: CellIndex,
  techniques: readonly Technique[] = TECHNIQUES,
): Digit | null {
  if (board.grid[cell] !== 0) return null;
  const mask = board.cand[cell]!;
  if (!mask) return null;
  if (techniques.includes('nakedSingle') && (mask & (mask - 1)) === 0)
    return DIGITS.find((d) => mask === bit(d))!;
  if (!techniques.includes('hiddenSingle')) return null;
  for (const unit of unitsOf(cell)) {
    let elsewhere = 0;
    for (const c of unit.cells) if (c !== cell && board.grid[c] === 0) elsewhere |= board.cand[c]!;
    // A digit that fits nowhere else in a row, column or box goes here.
    const only = mask & ~elsewhere;
    if (only) return DIGITS.find((d) => (only & bit(d)) !== 0)!;
  }
  return null;
}

/** Every empty cell the techniques decide on the board as it is, with its digit, by cell. */
export function knowablePlacements(
  grid: Grid,
  techniques: readonly Technique[] = TECHNIQUES,
  excluded?: ExcludedDigits,
): KnowablePlacement[] {
  if (!techniques.some((t) => SINGLES.has(t))) return [];
  // The cells not decided yet; the eliminations stop once there are none left (as the bot does).
  let pending: CellIndex[] = [];
  for (let cell = 0; cell < CELL_COUNT; cell++) if (grid[cell] === 0) pending.push(cell);
  const board = eliminationBoard(grid, techniques, excluded, (b) => {
    pending = pending.filter((c) => decidedDigit(b, c, techniques) === null);
    return pending.length === 0;
  });
  const out: KnowablePlacement[] = [];
  for (let cell = 0; cell < CELL_COUNT; cell++) {
    const digit = decidedDigit(board, cell, techniques);
    if (digit !== null) out.push({ cell, digit });
  }
  return out;
}

/**
 * The empty cells the techniques decide on the board as it is, ascending. knowableCells(grid, TECHNIQUES) is
 * the set the chain rule checks: at every step of a chain it is exactly the next cell.
 */
export const knowableCells = (
  grid: Grid,
  techniques: readonly Technique[] = TECHNIQUES,
  excluded?: ExcludedDigits,
): CellIndex[] => knowablePlacements(grid, techniques, excluded).map((p) => p.cell);

/**
 * The board once every cell the techniques reach is filled: the knowable cells, round after round, until
 * none is left. `fillable` limits which cells may be filled (fillBox: only its box can be played).
 */
export function closedBoard(
  grid: Grid,
  techniques: readonly Technique[] = TECHNIQUES,
  fillable?: ReadonlySet<CellIndex>,
): number[] {
  const out = grid.map((v) => (v >= 1 && v <= 9 ? v : 0));
  for (;;) {
    const moves = knowablePlacements(out, techniques).filter((p) => !fillable || fillable.has(p.cell));
    if (!moves.length) return out;
    for (const m of moves) out[m.cell] = m.digit;
  }
}
