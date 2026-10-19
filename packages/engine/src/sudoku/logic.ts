import {
  BOXES,
  boxOf,
  CELL_COUNT,
  type CellIndex,
  colOf,
  COLS,
  type Digit,
  DIGITS,
  type Grid,
  missingDigits,
  PEERS,
  rowOf,
  ROWS,
  type Unit,
  type UnitKind,
  unitsOf,
} from './board';

/**
 * The human-style ("logical") solver (spec §13.2, §20).
 *
 * It applies the simplest technique that makes progress, one step at a time, and records every step with
 * the facts it relied on. Grading (./grade) asks which techniques a puzzle needs; explanations (./explain)
 * walk the recorded steps back from a cell to show why it holds its digit.
 */

/** In order of difficulty. */
export const TECHNIQUES = [
  'nakedSingle',
  'hiddenSingle',
  'pointing',
  'claiming',
  'nakedPair',
  'hiddenPair',
] as const;
export type Technique = (typeof TECHNIQUES)[number];

export interface UnitRef {
  kind: UnitKind;
  /** 0..8 */
  index: number;
}

/** Why a digit cannot go in a cell. */
export type Block =
  /** A peer in `unit` already holds the digit (that peer is `cell`). */
  | { kind: 'unit'; unit: UnitRef; cell: CellIndex }
  /** An earlier elimination step removed it. */
  | { kind: 'step'; step: number };

interface StepBase {
  /** Position in the solve, 0-based. */
  id: number;
  /** The earlier steps this one relies on (ids). */
  deps: number[];
}

export interface NakedSingleStep extends StepBase {
  technique: 'nakedSingle';
  cell: CellIndex;
  digit: Digit;
  /** The unit whose missing digits frame the explanation ("Row D is missing 3, 7, 9"). */
  primary: UnitRef;
  /** The digits missing from `primary`, ascending (includes `digit`). */
  missing: Digit[];
  /** The other units that already hold the rest of `missing` ("Column 5 already has 3 and 9"). */
  seen: { unit: UnitRef; digits: Digit[] }[];
  /** Digits of `missing` that an elimination step removed from the cell. */
  eliminated: { digit: Digit; step: number }[];
}

export interface HiddenSingleStep extends StepBase {
  technique: 'hiddenSingle';
  cell: CellIndex;
  digit: Digit;
  unit: UnitRef;
  /** Every other empty cell of `unit`, with why `digit` cannot go there. */
  blocked: { cell: CellIndex; block: Block }[];
}

export interface LockedCandidatesStep extends StepBase {
  /** pointing: inside a box the digit is confined to one line. claiming: inside a line it is confined to one box. */
  technique: 'pointing' | 'claiming';
  digit: Digit;
  /** 0..8 */
  box: number;
  line: UnitRef;
  /** The cells the digit was removed from. */
  removed: CellIndex[];
}

export interface PairStep extends StepBase {
  technique: 'nakedPair' | 'hiddenPair';
  unit: UnitRef;
  cells: [CellIndex, CellIndex];
  digits: [Digit, Digit];
  /** Which candidates were removed from which cells. */
  removed: { cell: CellIndex; digits: Digit[] }[];
}

export type PlacementStep = NakedSingleStep | HiddenSingleStep;
export type EliminationStep = LockedCandidatesStep | PairStep;
export type Step = PlacementStep | EliminationStep;

export const isPlacement = (s: Step): s is PlacementStep =>
  s.technique === 'nakedSingle' || s.technique === 'hiddenSingle';

// ---------------------------------------------------------------------------------------------------------
// Bit helpers: digit d ↔ bit (d − 1)

const bit = (d: number): number => 1 << (d - 1);
const has = (mask: number, d: number): boolean => (mask & bit(d)) !== 0;
const digitsOf = (mask: number): Digit[] => DIGITS.filter((d) => has(mask, d));
function popcount(m: number): number {
  let n = 0;
  while (m) {
    m &= m - 1;
    n++;
  }
  return n;
}

const ref = (u: Unit): UnitRef => ({ kind: u.kind, index: u.index });
const sameUnit = (a: UnitRef, b: UnitRef): boolean => a.kind === b.kind && a.index === b.index;

/** The row, column or box a reference names. */
function unitAt(u: UnitRef): Unit {
  const unit = (u.kind === 'row' ? ROWS : u.kind === 'col' ? COLS : BOXES)[u.index];
  if (!unit) throw new RangeError(`Not a unit: ${u.kind} ${String(u.index)}`);
  return unit;
}

/** Order in which hidden-single units are preferred when several apply (shorter explanations first). */
const HIDDEN_UNIT_ORDER: Record<UnitKind, number> = { box: 0, row: 1, col: 2 };

/** A step before it gets its id (distributes over the union). */
export type Draft<S extends Step = Step> = S extends unknown ? Omit<S, 'id'> : never;

// ---------------------------------------------------------------------------------------------------------

/** A board with pencil marks and the provenance of every fact, for one logical solve. */
export class LogicBoard {
  readonly grid: number[];
  /** Candidate bitmask per cell; 0 for a filled cell. */
  readonly cand: number[];
  /** Step id that filled each cell; −1 for the cells filled at the start. */
  readonly filledBy: number[];
  /** (cell * 9 + digit − 1) → id of the elimination step that removed that candidate. */
  private readonly elimBy = new Map<number, number>();
  readonly steps: Step[] = [];

  constructor(grid: Grid) {
    if (grid.length !== CELL_COUNT) throw new RangeError('A grid needs 81 cells');
    this.grid = grid.map((v) => (v >= 1 && v <= 9 ? v : 0));
    this.filledBy = new Array<number>(CELL_COUNT).fill(-1);
    this.cand = new Array<number>(CELL_COUNT).fill(0);
    for (let i = 0; i < CELL_COUNT; i++) {
      if (this.grid[i]) continue;
      let used = 0;
      for (const p of PEERS[i]!) if (this.grid[p]) used |= bit(this.grid[p]);
      this.cand[i] = 0x1ff & ~used;
    }
  }

  get solved(): boolean {
    return this.grid.every((v) => v !== 0);
  }

  candidatesOf(cell: CellIndex): Digit[] {
    return digitsOf(this.cand[cell]!);
  }

  /** A cell with no candidates left means the board contradicts itself. */
  get broken(): boolean {
    for (let i = 0; i < CELL_COUNT; i++) if (!this.grid[i] && !this.cand[i]) return true;
    return false;
  }

  // -- facts and provenance ------------------------------------------------------------------------------

  /** Why `digit` cannot go in the empty cell `cell` (never through `exclude`). Null if it still can. */
  findBlock(cell: CellIndex, digit: Digit, exclude?: UnitRef): Block | null {
    let best: Block | null = null;
    let bestBy = Infinity;
    for (const u of unitsOf(cell)) {
      if (exclude && sameUnit(ref(u), exclude)) continue;
      const holder = u.cells.find((c) => this.grid[c] === digit);
      if (holder === undefined) continue;
      // Prefer a holder that was there from the start: it keeps the explanation chain short.
      const by = this.filledBy[holder]!;
      const rank = by < 0 ? -1 : by;
      if (rank < bestBy) {
        best = { kind: 'unit', unit: ref(u), cell: holder };
        bestBy = rank;
      }
    }
    if (best) return best;
    const step = this.elimBy.get(cell * 9 + digit - 1);
    return step === undefined ? null : { kind: 'step', step };
  }

  private depOfBlock(block: Block | null, deps: Set<number>): void {
    if (!block) return;
    if (block.kind === 'step') deps.add(block.step);
    else if (this.filledBy[block.cell]! >= 0) deps.add(this.filledBy[block.cell]!);
  }

  private depOfFilled(cell: CellIndex, deps: Set<number>): void {
    if (this.filledBy[cell]! >= 0) deps.add(this.filledBy[cell]!);
  }

  /** Adds why `digit` cannot be in any cell of `cells` (filled cells count as taken). */
  private depsOfAbsence(
    cells: readonly CellIndex[],
    digit: Digit,
    exclude: UnitRef,
    deps: Set<number>,
  ): void {
    for (const c of cells) {
      if (this.grid[c]) this.depOfFilled(c, deps);
      else this.depOfBlock(this.findBlock(c, digit, exclude), deps);
    }
  }

  // -- placements ----------------------------------------------------------------------------------------

  /** The naked single at `cell`, with the shortest framing, or null. */
  nakedSingleAt(cell: CellIndex): Draft<NakedSingleStep> | null {
    if (this.grid[cell] || popcount(this.cand[cell]!) !== 1) return null;
    const digit = digitsOf(this.cand[cell]!)[0]!;
    const units = unitsOf(cell);
    let best: { draft: Draft<NakedSingleStep>; score: number } | null = null;
    for (const primary of units) {
      const missing = missingDigits(this.grid, primary);
      const others = units.filter((u) => u !== primary);
      const seen = new Map<Unit, Digit[]>();
      const eliminated: { digit: Digit; step: number }[] = [];
      const deps = new Set<number>();
      for (const c of primary.cells) if (this.grid[c]) this.depOfFilled(c, deps);
      let ok = true;
      for (const e of missing) {
        if (e === digit) continue;
        const v = others.find((u) => u.cells.some((c) => this.grid[c] === e));
        if (v) {
          seen.set(v, [...(seen.get(v) ?? []), e]);
          this.depOfFilled(
            v.cells.find((c) => this.grid[c] === e)!,
            deps,
          );
          continue;
        }
        const step = this.elimBy.get(cell * 9 + e - 1);
        if (step === undefined) {
          ok = false; // cannot happen on a consistent board
          break;
        }
        eliminated.push({ digit: e, step });
        deps.add(step);
      }
      if (!ok) continue;
      const score = missing.length + seen.size + eliminated.length;
      if (!best || score < best.score) {
        best = {
          score,
          draft: {
            technique: 'nakedSingle',
            cell,
            digit,
            primary: ref(primary),
            missing,
            seen: [...seen].map(([u, digits]) => ({ unit: ref(u), digits })),
            eliminated,
            deps: [...deps].sort((a, b) => a - b),
          },
        };
      }
    }
    return best?.draft ?? null;
  }

  /** The empty cells of `unit` that still list `digit` as a candidate, in the unit's order. */
  placesOf(unit: UnitRef, digit: Digit): CellIndex[] {
    return unitAt(unit).cells.filter((c) => !this.grid[c] && has(this.cand[c]!, digit));
  }

  /**
   * The hidden single for `digit` in this very `unit` at `cell`, or null if `digit` has another place in
   * `unit` (or `cell` is not in it). Unlike hiddenSingleAt, no other unit of the cell counts: a find
   * target is scoped (sudoku/targets).
   */
  hiddenSingleInUnit(unit: UnitRef, cell: CellIndex, digit: Digit): Draft<HiddenSingleStep> | null {
    const u = unitAt(unit);
    return u.cells.includes(cell) ? this.hiddenSingleIn(u, cell, digit) : null;
  }

  /** A hidden single for `digit` in `unit` at `cell`, or null if `digit` has another place in `unit`. */
  private hiddenSingleIn(unit: Unit, cell: CellIndex, digit: Digit): Draft<HiddenSingleStep> | null {
    if (this.grid[cell] || !has(this.cand[cell]!, digit)) return null;
    if (unit.cells.some((c) => this.grid[c] === digit)) return null;
    const deps = new Set<number>();
    const blocked: { cell: CellIndex; block: Block }[] = [];
    for (const c of unit.cells) {
      if (c === cell) continue;
      if (this.grid[c]) {
        this.depOfFilled(c, deps);
        continue;
      }
      if (has(this.cand[c]!, digit)) return null;
      const block = this.findBlock(c, digit, ref(unit));
      if (!block) return null; // cannot happen: the candidate is gone, so something removed it
      blocked.push({ cell: c, block });
      this.depOfBlock(block, deps);
    }
    return {
      technique: 'hiddenSingle',
      cell,
      digit,
      unit: ref(unit),
      blocked,
      deps: [...deps].sort((a, b) => a - b),
    };
  }

  /** The hidden single at `cell` with the fewest blocked cells to list, or null. */
  hiddenSingleAt(cell: CellIndex, onlyDigit?: Digit): Draft<HiddenSingleStep> | null {
    if (this.grid[cell]) return null;
    let best: Draft<HiddenSingleStep> | null = null;
    for (const digit of onlyDigit ? [onlyDigit] : digitsOf(this.cand[cell]!)) {
      for (const unit of unitsOf(cell)) {
        const s = this.hiddenSingleIn(unit, cell, digit);
        if (!s) continue;
        if (
          !best ||
          s.blocked.length < best.blocked.length ||
          (s.blocked.length === best.blocked.length &&
            HIDDEN_UNIT_ORDER[s.unit.kind] < HIDDEN_UNIT_ORDER[best.unit.kind])
        )
          best = s;
      }
    }
    return best;
  }

  findNakedSingle(): Draft<NakedSingleStep> | null {
    for (let i = 0; i < CELL_COUNT; i++) {
      const s = this.nakedSingleAt(i);
      if (s) return s;
    }
    return null;
  }

  findHiddenSingle(): Draft<HiddenSingleStep> | null {
    for (const unit of [...BOXES, ...ROWS, ...COLS]) {
      for (const digit of missingDigits(this.grid, unit)) {
        const spots = unit.cells.filter((c) => !this.grid[c] && has(this.cand[c]!, digit));
        if (spots.length === 1) return this.hiddenSingleAt(spots[0]!, digit);
      }
    }
    return null;
  }

  // -- eliminations --------------------------------------------------------------------------------------

  findPointing(): Draft<LockedCandidatesStep> | null {
    for (const box of BOXES) {
      for (const digit of missingDigits(this.grid, box)) {
        const spots = box.cells.filter((c) => !this.grid[c] && has(this.cand[c]!, digit));
        if (spots.length < 2) continue;
        for (const line of [ROWS[rowOf(spots[0]!)]!, COLS[colOf(spots[0]!)]!]) {
          if (!spots.every((c) => line.cells.includes(c))) continue;
          const removed = line.cells.filter(
            (c) => boxOf(c) !== box.index && !this.grid[c] && has(this.cand[c]!, digit),
          );
          if (!removed.length) continue;
          const deps = new Set<number>();
          this.depsOfAbsence(
            box.cells.filter((c) => !line.cells.includes(c)),
            digit,
            ref(box),
            deps,
          );
          return {
            technique: 'pointing',
            digit,
            box: box.index,
            line: ref(line),
            removed,
            deps: [...deps].sort((a, b) => a - b),
          };
        }
      }
    }
    return null;
  }

  findClaiming(): Draft<LockedCandidatesStep> | null {
    for (const line of [...ROWS, ...COLS]) {
      for (const digit of missingDigits(this.grid, line)) {
        const spots = line.cells.filter((c) => !this.grid[c] && has(this.cand[c]!, digit));
        if (spots.length < 2) continue;
        const b = boxOf(spots[0]!);
        if (!spots.every((c) => boxOf(c) === b)) continue;
        const box = BOXES[b]!;
        const removed = box.cells.filter(
          (c) => !line.cells.includes(c) && !this.grid[c] && has(this.cand[c]!, digit),
        );
        if (!removed.length) continue;
        const deps = new Set<number>();
        this.depsOfAbsence(
          line.cells.filter((c) => boxOf(c) !== b),
          digit,
          ref(line),
          deps,
        );
        return {
          technique: 'claiming',
          digit,
          box: b,
          line: ref(line),
          removed,
          deps: [...deps].sort((a, b2) => a - b2),
        };
      }
    }
    return null;
  }

  findNakedPair(): Draft<PairStep> | null {
    for (const unit of [...ROWS, ...COLS, ...BOXES]) {
      const pairs = unit.cells.filter((c) => !this.grid[c] && popcount(this.cand[c]!) === 2);
      for (let x = 0; x < pairs.length; x++) {
        for (let y = x + 1; y < pairs.length; y++) {
          const a = pairs[x]!;
          const b = pairs[y]!;
          const mask = this.cand[a]!;
          if (this.cand[b] !== mask) continue;
          const removed = unit.cells
            .filter((c) => c !== a && c !== b && !this.grid[c] && (this.cand[c]! & mask) !== 0)
            .map((c) => ({ cell: c, digits: digitsOf(this.cand[c]! & mask) }));
          if (!removed.length) continue;
          const deps = new Set<number>();
          for (const c of [a, b])
            for (const e of DIGITS) if (!has(mask, e)) this.depOfBlock(this.findBlock(c, e), deps);
          const [d1, d2] = digitsOf(mask) as [Digit, Digit];
          return {
            technique: 'nakedPair',
            unit: ref(unit),
            cells: [a, b],
            digits: [d1, d2],
            removed,
            deps: [...deps].sort((p, q) => p - q),
          };
        }
      }
    }
    return null;
  }

  findHiddenPair(): Draft<PairStep> | null {
    for (const unit of [...ROWS, ...COLS, ...BOXES]) {
      const missing = missingDigits(this.grid, unit);
      const spotsOf = new Map<Digit, CellIndex[]>(
        missing.map((d) => [d, unit.cells.filter((c) => !this.grid[c] && has(this.cand[c]!, d))]),
      );
      for (let x = 0; x < missing.length; x++) {
        for (let y = x + 1; y < missing.length; y++) {
          const d1 = missing[x]!;
          const d2 = missing[y]!;
          const s1 = spotsOf.get(d1)!;
          const s2 = spotsOf.get(d2)!;
          if (s1.length !== 2 || s2.length !== 2 || s1[0] !== s2[0] || s1[1] !== s2[1]) continue;
          const keep = bit(d1) | bit(d2);
          const removed = s1
            .filter((c) => (this.cand[c]! & ~keep) !== 0)
            .map((c) => ({ cell: c, digits: digitsOf(this.cand[c]! & ~keep) }));
          if (!removed.length) continue;
          const deps = new Set<number>();
          const others = unit.cells.filter((c) => c !== s1[0] && c !== s1[1]);
          this.depsOfAbsence(others, d1, ref(unit), deps);
          this.depsOfAbsence(others, d2, ref(unit), deps);
          return {
            technique: 'hiddenPair',
            unit: ref(unit),
            cells: [s1[0]!, s1[1]!],
            digits: [d1, d2],
            removed,
            deps: [...deps].sort((p, q) => p - q),
          };
        }
      }
    }
    return null;
  }

  /** The simplest step allowed by `allowed`, or null when stuck. */
  findStep(allowed: ReadonlySet<Technique>): Draft<Step> | null {
    for (const t of TECHNIQUES) {
      if (!allowed.has(t)) continue;
      const s =
        t === 'nakedSingle'
          ? this.findNakedSingle()
          : t === 'hiddenSingle'
            ? this.findHiddenSingle()
            : t === 'pointing'
              ? this.findPointing()
              : t === 'claiming'
                ? this.findClaiming()
                : t === 'nakedPair'
                  ? this.findNakedPair()
                  : this.findHiddenPair();
      if (s) return s;
    }
    return null;
  }

  /** Records and applies a step; returns it with its id. */
  apply(draft: Draft): Step {
    const step: Step = { ...draft, id: this.steps.length };
    this.steps.push(step);
    switch (step.technique) {
      case 'nakedSingle':
      case 'hiddenSingle':
        this.grid[step.cell] = step.digit;
        this.cand[step.cell] = 0;
        this.filledBy[step.cell] = step.id;
        for (const p of PEERS[step.cell]!) this.cand[p]! &= ~bit(step.digit);
        break;
      case 'pointing':
      case 'claiming':
        for (const c of step.removed) this.eliminate(c, step.digit, step.id);
        break;
      case 'nakedPair':
      case 'hiddenPair':
        for (const r of step.removed) for (const d of r.digits) this.eliminate(r.cell, d, step.id);
        break;
    }
    return step;
  }

  private eliminate(cell: CellIndex, digit: Digit, stepId: number): void {
    if (!has(this.cand[cell]!, digit)) return;
    this.cand[cell]! &= ~bit(digit);
    this.elimBy.set(cell * 9 + digit - 1, stepId);
  }
}

// ---------------------------------------------------------------------------------------------------------

export interface LogicalSolveResult {
  solved: boolean;
  /** The grid when the solve stopped. */
  grid: number[];
  steps: Step[];
  /** The techniques the solve used, in order of difficulty. */
  techniques: Technique[];
}

/** Solves as far as `techniques` allow, simplest step first. */
export function logicalSolve(
  grid: Grid,
  techniques: readonly Technique[] = TECHNIQUES,
  maxSteps = 2000,
): LogicalSolveResult {
  const board = new LogicBoard(grid);
  const allowed = new Set(techniques);
  while (!board.solved && board.steps.length < maxSteps && !board.broken) {
    const step = board.findStep(allowed);
    if (!step) break;
    board.apply(step);
  }
  const used = new Set(board.steps.map((s) => s.technique));
  return {
    solved: board.solved,
    grid: board.grid.slice(),
    steps: board.steps,
    techniques: TECHNIQUES.filter((t) => used.has(t)),
  };
}
