import type { GameType } from '../../gameType';
import {
  BOXES,
  type CellIndex,
  CELL_COUNT,
  COLS,
  type Digit,
  DIGITS,
  type Grid,
  gridToString,
  ROWS,
} from '../../sudoku/board';
import { generateSolvedGrid } from '../../sudoku/generate';
import { type LogicBoard, type Technique, TECHNIQUES } from '../../sudoku/logic';
import {
  closedBoard,
  decidedDigit,
  eliminationBoard,
  eliminationsOf,
  knowablePlacements,
} from '../../sudoku/reading';
import { createRng, randomInt, type Rng, shuffled } from '../../util/random';
import type { LevelLogic } from '../levels.config';
import type { FillLevelKind, FillRegion, LevelSpecOf, TimeStars } from '../spec';
import { BuildError, checkOf, withoutNeeded } from './common';
import type { Built } from './find';

/**
 * "Fill a region" (levels-content.md §4) [D67, D69]: fillBox, fillRow and fillCol, one generator. A region (a
 * box, a row or a column, drawn from the level's seed so it goes round all nine) has the chapter's missing
 * cells (2 → 9 up the ladder, §4.3), the only cells that can be chosen, in a board of the chapter's givens
 * around it. The builder, from a full solution (§4.2):
 *  1. empties the region's missing cells;
 *  2. from chapter 5 (`minDigitGaps`), for every digit in a seeded order, empties one of its cells outside the
 *     region, a seeded one of its eight, keeping it only while the region still fills by itself with the
 *     chapter's techniques (else the digit goes back and the next of its cells is tried): then every digit is
 *     the answer of an empty cell outside, so no digit's place in the region can be read off its eight copies;
 *  3. empties more cells around in a seeded order, with the same check, until the chapter's number is left;
 *  4. where the chapter needs a technique (mustNeed), refuses a board whose region fills without it.
 * "Fills by itself" is closedBoard playing the region alone: every step of that logic is forced, so the region
 * has one answer, however open the rest of the board is. Pure and deterministic: the Rng is the level's.
 *
 * The time model (§4.4) reads a built region through fillRegionSolve(): the order a player fills it in, the
 * easiest cell first, and what each cell needed. Its numbers belong with the profiles (profiles.ts), not here.
 */

// ---------------------------------------------------------------------------------------------------------
// Regions

export type FillUnit = FillRegion['unit'];

const UNIT_OF: Readonly<Record<FillLevelKind, FillUnit>> = { fillBox: 'box', fillRow: 'row', fillCol: 'col' };

/** The unit a fill kind plays: fillBox a box, fillRow a row, fillCol a column [D69]. */
export const fillUnitOf = (kind: FillLevelKind): FillUnit => UNIT_OF[kind];

/** The nine cells of a box (row-major), a row (A–I) or a column (1–9), ascending. */
export function regionCellsOf(unit: FillUnit, index: number): readonly CellIndex[] {
  if (!(Number.isInteger(index) && index >= 0 && index <= 8)) throw new RangeError(`No ${unit} ${index}`);
  return (unit === 'box' ? BOXES : unit === 'row' ? ROWS : COLS)[index]!.cells;
}

/** Whether the techniques fill every one of `cells` on `grid`, playing those cells only. */
export function regionCloses(
  grid: Grid,
  cells: readonly CellIndex[],
  techniques: readonly Technique[],
): boolean {
  const out = closedBoard(grid, techniques, new Set(cells));
  return cells.every((c) => out[c] !== 0);
}

/** The givens outside a region (of its 72 cells around). */
export function givensAround(grid: Grid, region: readonly CellIndex[]): number {
  const inside = new Set(region);
  let n = 0;
  for (let c = 0; c < CELL_COUNT; c++) if (grid[c] !== 0 && !inside.has(c)) n++;
  return n;
}

/**
 * The rule "every digit missing at least once" (§4.2) as counts: out[d − 1] is how many empty cells outside the
 * region have the digit d as their answer. The rule holds with `minDigitGaps` = k when every count is k or more.
 */
export function digitGapsOutside(grid: Grid, solution: Grid, region: readonly CellIndex[]): number[] {
  const inside = new Set(region);
  const out = new Array<number>(9).fill(0);
  for (let c = 0; c < CELL_COUNT; c++) if (grid[c] === 0 && !inside.has(c)) out[solution[c]! - 1]!++;
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// The builder

/**
 * What the builder needs of a fill level's plan (levels.config's plan of fillBox, fillRow or fillCol fits it):
 * the head every built level starts with, and the row of the ladder (levels-content.md §4.3) [D67].
 */
export interface FillRegionPlan<K extends FillLevelKind = FillLevelKind> {
  id: string;
  rev: number;
  chapter: number;
  slot: number;
  kind: K;
  boss: boolean;
  seed: number;
  gameType: GameType;
  timeLimitMs: number;
  /**
   * The region (0–8: the box, the row A–I or the column 1–9), when the plan sets it: the config can make the
   * regions go round all nine over a kind's few levels. Absent: drawn from the level's seed.
   */
  index?: number;
  /** The region's empty cells, the only ones that can be chosen: 2 → 9 up the ladder. */
  missing: number;
  /** The givens of the other 72 cells. */
  around: number;
  /**
   * Every digit 1–9 is the answer of at least this many empty cells outside the region (§4.2: 1 from chapter
   * 5, `minDigitGaps`); 0 or absent: no such rule. Needs `around` ≤ 72 − 9 × minDigitGaps.
   */
  minDigitGaps?: number;
  stars: TimeStars;
  logic: LevelLogic;
}

/**
 * How many solutions the builder tries for a level before it gives up. Plenty: the hardest row (5 missing, 56
 * around, a hidden single a must) comes out of about 1 board in 6 (§4.2).
 */
export const FILL_REGION_ATTEMPTS = 400;

const AROUND = CELL_COUNT - 9;

function planProblem(plan: FillRegionPlan): string | null {
  const gaps = plan.minDigitGaps ?? 0;
  if (!(Number.isInteger(plan.missing) && plan.missing >= 1 && plan.missing <= 9))
    return `${plan.missing} missing is not 1–9`;
  if (!(Number.isInteger(plan.around) && plan.around >= 0 && plan.around <= AROUND))
    return `${plan.around} around is not 0–${AROUND}`;
  if (!(Number.isInteger(gaps) && gaps >= 0)) return `minDigitGaps ${gaps} is not a whole number`;
  if (plan.index !== undefined && !(Number.isInteger(plan.index) && plan.index >= 0 && plan.index <= 8))
    return `region ${plan.index} is not 0–8`;
  if (plan.around > AROUND - 9 * gaps)
    return `${plan.around} around leaves no room for ${gaps} empty cell(s) of every digit`;
  return null;
}

function targetsOf(unit: FillUnit, index: number, cells: CellIndex[]) {
  switch (unit) {
    case 'box':
      return { box: index, cells };
    case 'row':
      return { row: index, cells };
    case 'col':
      return { col: index, cells };
  }
}

export function buildFillRegion<K extends FillLevelKind>(
  plan: FillRegionPlan<K>,
  rng: Rng = createRng(plan.seed),
): Built<LevelSpecOf<K>> {
  const problem = planProblem(plan);
  if (problem) throw new BuildError(plan.id, problem);
  const gaps = plan.minDigitGaps ?? 0;
  const unit = fillUnitOf(plan.kind);
  const index = plan.index ?? randomInt(rng, 9);
  const region = regionCellsOf(unit, index);
  const inside = new Set(region);
  const outside: CellIndex[] = [];
  for (let c = 0; c < CELL_COUNT; c++) if (!inside.has(c)) outside.push(c);
  const { techniques } = plan.logic;
  const lean = withoutNeeded(plan.logic);
  for (let attempt = 1; attempt <= FILL_REGION_ATTEMPTS; attempt++) {
    const solution = generateSolvedGrid(rng);
    // 1. The region's missing cells.
    const missing = shuffled(rng, region)
      .slice(0, plan.missing)
      .sort((a, b) => a - b);
    const grid = solution.slice();
    for (const c of missing) grid[c] = 0;
    /** Empties `c` if the region still fills by itself; puts it back otherwise. */
    const tryEmpty = (c: CellIndex): boolean => {
      grid[c] = 0;
      if (regionCloses(grid, missing, techniques)) return true;
      grid[c] = solution[c]!;
      return false;
    };
    let around = AROUND;
    // 2. Every digit missing at least `gaps` times outside the region, digit by digit in a seeded order.
    let gapped = true;
    for (let round = 0; gapped && round < gaps; round++)
      for (const d of shuffled(rng, DIGITS)) {
        const cells = shuffled(
          rng,
          outside.filter((c) => grid[c] === d),
        );
        const emptied = cells.some(tryEmpty);
        if (!emptied) {
          gapped = false;
          break;
        }
        around--;
      }
    if (!gapped) continue;
    // 3. More cells around, until the chapter's number of givens is left.
    for (const c of shuffled(rng, outside)) {
      if (around <= plan.around) break;
      if (grid[c] !== 0 && tryEmpty(c)) around--;
    }
    if (around !== plan.around) continue;
    // 4. The region fills by itself (checked at every emptying above; here for a full board, where nothing
    // was emptied), and what the chapter must need.
    if (!regionCloses(grid, missing, techniques)) continue;
    if (plan.logic.mustNeed.length && regionCloses(grid, missing, lean)) continue;
    const spec = {
      id: plan.id,
      rev: plan.rev,
      chapter: plan.chapter,
      slot: plan.slot,
      kind: plan.kind,
      boss: plan.boss,
      seed: plan.seed,
      gameType: plan.gameType,
      board: { grid: gridToString(grid), solution: gridToString(solution) },
      timeLimitMs: plan.timeLimitMs,
      targets: targetsOf(unit, index, missing),
      stars: plan.stars,
      check: checkOf(plan.logic),
    };
    return { spec: spec as unknown as LevelSpecOf<K>, attempts: attempt };
  }
  throw new BuildError(
    plan.id,
    `no ${unit} of ${plan.missing} with ${plan.around} around${gaps ? ` and every digit missing ${gaps}×` : ''} in ${FILL_REGION_ATTEMPTS} tries`,
  );
}

// ---------------------------------------------------------------------------------------------------------
// The time model's inputs (levels-content.md §4.4)

/**
 * What a cell needs before a player sees it, as the time model prices it (§4.4): a naked single ('single'),
 * a hidden single, an elimination by pointing or claiming ('locked'), a pair, or nothing at all because it is
 * the region's last cell ('last': one digit is left).
 */
export type FillCellNeed = 'single' | 'hiddenSingle' | 'locked' | 'pair' | 'last';

export const FILL_CELL_NEEDS: readonly FillCellNeed[] = ['single', 'hiddenSingle', 'locked', 'pair', 'last'];

export interface FillCellStep {
  cell: CellIndex;
  digit: Digit;
  need: FillCellNeed;
}

export interface FillRegionSolve {
  /** Every cell outside the region is given (chapters 1–2): a single there is quicker to see (§4.4). */
  fullBoard: boolean;
  /** The cells in the order a player fills them: always the easiest cell next (the lowest of equals). */
  steps: readonly FillCellStep[];
}

type NeedTier = { need: Exclude<FillCellNeed, 'last'>; techniques: readonly Technique[] };

/** The techniques of each need, easiest first; a cell needs the first tier that decides it. */
const NEED_TIERS: readonly NeedTier[] = [
  { need: 'single', techniques: ['nakedSingle'] },
  { need: 'hiddenSingle', techniques: ['nakedSingle', 'hiddenSingle'] },
  { need: 'locked', techniques: ['nakedSingle', 'hiddenSingle', 'pointing', 'claiming'] },
  { need: 'pair', techniques: TECHNIQUES },
];

/** What a player has worked out so far: the digits their eliminations took out of each empty cell. */
type Known = Map<CellIndex, Digit[]>;

/**
 * The lowest of `cells` a tier decides on `board`, with what the player already knows, and the candidates it
 * took: its eliminations run one at a time, simplest first, only until one of `cells` is decided (one insight,
 * not every pattern on the board). Null when the tier decides none of them.
 */
function decideAt(
  board: Grid,
  cells: readonly CellIndex[],
  tier: NeedTier,
  known: Known,
): { cell: CellIndex; seen: LogicBoard } | null {
  const decides = (b: LogicBoard, c: CellIndex) => decidedDigit(b, c, tier.techniques) !== null;
  const seen = eliminationBoard(board, tier.techniques, known, (b) => cells.some((c) => decides(b, c)));
  const cell = cells.find((c) => decides(seen, c));
  return cell === undefined ? null : { cell, seen };
}

/**
 * How a player fills the region `cells` of `grid` with `techniques` (the level's check), and what each cell
 * needed (§4.4). It goes round by round exactly as regionCloses() (closedBoard): a round is the region's cells
 * the techniques decide on the board as it is, so it is null exactly when regionCloses() is false. Within a
 * round, the easiest cell goes first, on the board as it is now and with what the player has worked out: an
 * elimination is found once, and a cell it settles later is a single then, not another pair. A cell of the
 * round no tier decides any more (the reading does not carry a single outside the region into its
 * eliminations, so a filled cell can break a pattern a player still sees) keeps the need it had when the round
 * began.
 */
export function fillRegionSolve(
  grid: Grid,
  cells: readonly CellIndex[],
  techniques: readonly Technique[],
): FillRegionSolve | null {
  const board = grid.map((v) => (v >= 1 && v <= 9 ? v : 0));
  const pending = new Set(cells.filter((c) => board[c] === 0));
  const fullBoard = board.every((v, c) => v !== 0 || pending.has(c));
  const tiers: NeedTier[] = [];
  for (const tier of NEED_TIERS) {
    const allowed = tier.techniques.filter((t) => techniques.includes(t));
    const prev = tiers[tiers.length - 1];
    if (allowed.length && allowed.length !== prev?.techniques.length)
      tiers.push({ need: tier.need, techniques: allowed });
  }
  const known: Known = new Map();
  /** The first tier that decides one of `of`, and remembers what its eliminations took out. */
  const easiest = (on: Grid, of: readonly CellIndex[]) => {
    for (const tier of tiers) {
      const found = decideAt(on, of, tier, known);
      if (!found) continue;
      if (eliminationsOf(tier.techniques).length)
        for (let c = 0; c < CELL_COUNT; c++)
          if (board[c] === 0)
            known.set(
              c,
              DIGITS.filter((d) => (found.seen.cand[c]! & (1 << (d - 1))) === 0),
            );
      return { cell: found.cell, need: tier.need };
    }
    return null;
  };
  const steps: FillCellStep[] = [];
  while (pending.size) {
    const round = new Map(
      knowablePlacements(board, techniques)
        .filter((p) => pending.has(p.cell))
        .map((p) => [p.cell, p.digit] as const),
    );
    if (!round.size) return null;
    const start = board.slice();
    while (round.size) {
      const left = [...round.keys()];
      const next = easiest(board, left) ?? {
        cell: left[0]!,
        need: easiest(start, [left[0]!])?.need ?? tiers[tiers.length - 1]!.need,
      };
      const digit = round.get(next.cell)!;
      board[next.cell] = digit;
      pending.delete(next.cell);
      round.delete(next.cell);
      steps.push({ cell: next.cell, digit, need: pending.size === 0 ? 'last' : next.need });
    }
  }
  return { fullBoard, steps };
}

/**
 * The time model's numbers for one profile (§4.4), in ms. The numbers belong with the profiles (profiles.ts),
 * each marked as an assumption until calibrated against real play (D74).
 */
export interface FillTimeModel {
  /** Finding one's way at the start of the level. */
  orientMs: number;
  /** Choosing the cell and the digit, every cell. */
  typeMs: number;
  /** Thinking, per cell, by its need; `fullBoard` takes the place of `single` when nothing around is empty. */
  thinkMs: Readonly<Record<FillCellNeed | 'fullBoard', number>>;
}

/** A profile's time on a region by the model (§4.4): orientation, then typing and thinking for every cell. */
export function fillRegionModelMs(solve: FillRegionSolve, model: FillTimeModel): number {
  let ms = model.orientMs;
  for (const s of solve.steps)
    ms += model.typeMs + model.thinkMs[s.need === 'single' && solve.fullBoard ? 'fullBoard' : s.need];
  return ms;
}
