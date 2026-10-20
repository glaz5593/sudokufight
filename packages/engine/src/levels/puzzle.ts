import { defaultRules } from '../game/rules';
import type { PlayerId, PlayerInfo, RejectReason } from '../game/types';
import type { GameView, PlayerView } from '../game/view';
import { CELL_COUNT, type CellIndex, isSolvedGrid, parseGrid } from '../sudoku/board';
import type { Clock } from '../util/clock';
import { LEVEL_RULES, type LevelRules, levelOutcome } from './progress';
import {
  type AppLevelOf,
  type LevelPuzzleView,
  levelModeFor,
  levelRulesFor,
  levelRunOf,
  type LevelView,
  type NewPuzzleEvent,
  type PuzzleConfig,
  type PuzzleEndReason,
  type PuzzleEvent,
  type PuzzleLevelOver,
  type PuzzleRules,
  type PuzzleSlotView,
  type Stars,
} from './spec';
import { starsFor } from './stars';

/**
 * The puzzle engine (levels-content.md §5) [D70, D71]: nine full boxes, some fixed at home, the rest shuffled;
 * the one move swaps two boxes, until every row and column is right. A small machine of its own, the shape of
 * the tap engine (find.ts): pure and deterministic, the clock injected, no RNG at all (the level froze the
 * start).
 *
 *   createPuzzle(setup, { clock, attempt })  → the first state and the puzzleCreated event
 *   applyPuzzle(state, action, now)          → { state, events } (a new state), or with `rejected`
 *   tickPuzzle(state, now)                   → the time limit, when it is due
 *   nextPuzzleDeadline(state)                → when tickPuzzle next has something to do (one host timer)
 *   evolvePuzzle(state, event)               → the reducer; replayPuzzle(events) folds a whole log
 *   puzzleView(state, viewer, now)           → the GameView of the screens, with level.puzzle
 *   puzzleExplainSteps(level)                → "למה?": the solution step by step, each with its reason
 *
 * The rules:
 * - swap(from, to): two different places, neither box fixed (nor locked) → boxesSwapped. Refused: 'boxFixed'
 *   (a fixed or locked box), 'badCell' (the same place, or no such place), 'paused', 'gameOver' (after the end).
 *   A swap at the very ms the time runs out is too late, as in every kind (D52).
 * - [D70c] A swap after which neither of the two boxes stands at its home costs PuzzleRules.swapPenaltyMs (5 s):
 *   boxesSwapped.penaltyMs, the limit comes closer, and it counts as a mistake. There is always a swap that puts
 *   at least one box home, so thinking never pays. A swap that finishes the puzzle is never wrong.
 * - [D71] No lock by default: a box at home stays movable and the view never says it is home ('placed' only
 *   with lockOnCorrect, and then boxPlaced).
 * - The end: every row and column right ('targetReached', stars by the level clock), the limit ('timeUp', 0
 *   stars), or the X ('quit'). Any valid arrangement is right [D70b]; the builder makes sure there is just one.
 * - The phone's own freeze [D65] (`pause` / `resume`): nothing runs out meanwhile, swaps are refused 'paused'.
 *
 * Words: a "place" is one of the nine 3×3 positions (0–8, row-major, LTR); a box is named by its "home", the
 * place it has in the solution. `at[place]` is the home of the box standing there.
 */

// ---------------------------------------------------------------------------------------------------------
// The geometry of the nine boxes (shared with the builder, levels/builder/puzzle.ts)

/** The nine places, row-major (0 top-left … 8 bottom-right). */
export const PUZZLE_PLACES: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];

/** The band (row of boxes, 0–2) and the stack (column of boxes, 0–2) of a place. */
export const bandOf = (place: number): number => Math.floor(place / 3);
export const stackOf = (place: number): number => place % 3;

const isPlace = (p: unknown): p is number => typeof p === 'number' && Number.isInteger(p) && p >= 0 && p <= 8;

/** The cell of row i, column j (0–2) of place p. */
const cellIn = (p: number, i: number, j: number): CellIndex => (3 * bandOf(p) + i) * 9 + 3 * stackOf(p) + j;

/** The board shown when place p holds the box of at[p]: the solution's boxes, moved as wholes. */
export function assemblePuzzle(solution: string, at: readonly number[]): number[] {
  if (solution.length !== CELL_COUNT) throw new RangeError('A puzzle needs an 81-cell solution');
  const out = new Array<number>(CELL_COUNT).fill(0);
  at.forEach((home, p) => {
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) out[cellIn(p, i, j)] = Number(solution[cellIn(home, i, j)]);
  });
  return out;
}

/**
 * Which boxes of a solution may stand side by side: rows[a][b] when boxes a and b share no digit in any of
 * their three rows (they may be in one band), cols[a][b] the same for their columns (one stack). A box keeps its
 * own rows and columns wherever it stands, so this is all an arrangement's rows and columns depend on.
 */
export interface PuzzleFit {
  rows: readonly (readonly boolean[])[];
  cols: readonly (readonly boolean[])[];
}

export function puzzleFitOf(solution: string): PuzzleFit {
  const digits = (home: number, line: 'row' | 'col', k: number): Set<string> => {
    const s = new Set<string>();
    for (let m = 0; m < 3; m++) s.add(solution[line === 'row' ? cellIn(home, k, m) : cellIn(home, m, k)]!);
    return s;
  };
  const apart = (a: number, b: number, line: 'row' | 'col'): boolean =>
    [0, 1, 2].every((k) => {
      const mine = digits(a, line, k);
      return ![...digits(b, line, k)].some((d) => mine.has(d));
    });
  const table = (line: 'row' | 'col') =>
    PUZZLE_PLACES.map((a) => PUZZLE_PLACES.map((b) => a !== b && apart(a, b, line)));
  return { rows: table('row'), cols: table('col') };
}

/** Box `home` fits place p beside the boxes placed (place → home): no digit twice in a row or a column. */
export function boxFits(
  fit: PuzzleFit,
  home: number,
  p: number,
  placed: ReadonlyMap<number, number>,
): boolean {
  for (const [q, other] of placed) {
    if (q === p) return false;
    if (bandOf(q) === bandOf(p) && !fit.rows[home]![other]) return false;
    if (stackOf(q) === stackOf(p) && !fit.cols[home]![other]) return false;
  }
  return true;
}

/** Whether an arrangement is a valid sudoku: every row and column right (the boxes always are) [D70b]. */
export function isValidArrangement(solution: string, at: readonly number[]): boolean {
  return isSolvedGrid(assemblePuzzle(solution, at));
}

/**
 * The cells whose digit repeats in their row or column on the board as it stands (the boxes never repeat one),
 * ascending: what the view marks while PuzzleRules.conflicts is on [D78b].
 */
export function puzzleConflicts(grid: readonly number[]): CellIndex[] {
  const marked = new Set<CellIndex>();
  for (let k = 0; k < 9; k++)
    for (const line of [
      Array.from({ length: 9 }, (_, m) => k * 9 + m),
      Array.from({ length: 9 }, (_, m) => m * 9 + k),
    ]) {
      const seen = new Map<number, CellIndex[]>();
      for (const c of line) {
        const d = grid[c]!;
        if (d) seen.set(d, [...(seen.get(d) ?? []), c]);
      }
      for (const cells of seen.values()) if (cells.length > 1) for (const c of cells) marked.add(c);
    }
  return [...marked].sort((a, b) => a - b);
}

/** The cycles of an arrangement's moving boxes (each place away from home is on exactly one), in place order. */
export function puzzleCycles(at: readonly number[]): number[][] {
  const seen = new Set<number>();
  const cycles: number[][] = [];
  for (const p of PUZZLE_PLACES) {
    if (seen.has(p) || at[p] === p) continue;
    const cycle: number[] = [];
    for (let q = p; !seen.has(q); q = at[q]!) {
      seen.add(q);
      cycle.push(q);
    }
    cycles.push(cycle);
  }
  return cycles;
}

/** The fewest swaps from `at` to every box home: one less than each cycle's length, summed. */
export const fewestSwaps = (at: readonly number[]): number =>
  puzzleCycles(at).reduce((n, c) => n + c.length - 1, 0);

// ---------------------------------------------------------------------------------------------------------
// State

export interface PuzzleState {
  config: PuzzleConfig;
  status: 'waiting' | 'running' | 'paused' | 'over';
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  pausedAt: number | null;
  /** seq of the last event. */
  seq: number;
  /** Time of the last event; time never runs backwards past it. */
  lastEventAt: number;
  /** When the time runs out: the start plus the limit, sooner by every penalty, later by every freeze. */
  endsAt: number | null;
  penaltyMs: number;
  /** at[place] = the home of the box standing there now (targets.start at first). */
  at: number[];
  /** at[place] started at this place: the view's stable id of each box (never its home). */
  ids: number[];
  /** The places whose box never moves: the fixed ones, and with lockOnCorrect the ones placed. */
  locked: boolean[];
  swaps: number;
  /** The wrong swaps [D70c]. */
  mistakes: number;
  result: PuzzleLevelOver | null;
}

/** What a player or the host can do in a puzzle. */
export type PuzzleAction =
  | { type: 'start' }
  /** [D65] The app left the foreground. */
  | { type: 'pause' }
  /** [D65] Back, after the 3, 2, 1 over the covered board. */
  | { type: 'resume' }
  | { type: 'swap'; playerId: PlayerId; from: number; to: number }
  /** The X, confirmed: the level ends 'quit' (allowed while frozen too). */
  | { type: 'quit'; playerId: PlayerId };

export interface PuzzleTransition {
  state: PuzzleState;
  events: PuzzleEvent[];
}

export interface PuzzleActionResult extends PuzzleTransition {
  /** Set when the action was refused; `events` then holds only the timers that ran before it. */
  rejected?: RejectReason;
}

// ---------------------------------------------------------------------------------------------------------
// Creating a puzzle

export interface PuzzleSetup {
  /** The attempt's id (the session's). */
  id: string;
  /** The level as played: attemptLevel(spec, attempt) [D63]. */
  spec: AppLevelOf<'puzzle'>;
  /** The player on this phone. */
  player: PlayerInfo;
  /** [D78b] Mark the repeated digits: puzzleConflictsOn(this puzzle's ordinal). Off by default. */
  conflicts?: boolean;
}

export interface PuzzleDeps {
  clock: Clock;
  /** 1 for the first attempt. */
  attempt: number;
  /** puzzleSwapPenaltyMs; LEVEL_RULES by default. */
  rules?: LevelRules;
}

/**
 * The shape of a puzzle level, as the engine needs it to play (the builder's levels:validate checks the rest:
 * one cycle, one valid arrangement, step by step). Throws a RangeError naming what is wrong.
 */
export function checkPuzzleSpec(spec: AppLevelOf<'puzzle'>): void {
  // A level of another kind can reach here only through an unchecked cast (the app routes by levelEngineOf).
  const kind: string = spec.kind;
  if (kind !== 'puzzle') throw new RangeError(`A ${kind} level is not a puzzle`);
  const { grid, solution } = spec.board;
  if (solution.length !== CELL_COUNT || !isSolvedGrid(parseGrid(solution)))
    throw new RangeError(`${spec.id}: a puzzle needs a solved 81-cell solution`);
  if (grid !== solution) throw new RangeError(`${spec.id}: a puzzle's grid is its solution`);
  if (!(Number.isFinite(spec.timeLimitMs) && spec.timeLimitMs > 0))
    throw new RangeError('timeLimitMs must be positive');
  const { start, fixed } = spec.targets;
  if (start.length !== 9 || !start.every(isPlace) || new Set(start).size !== 9)
    throw new RangeError(`${spec.id}: the start is not an arrangement of the nine boxes`);
  if (!fixed.every(isPlace) || new Set(fixed).size !== fixed.length)
    throw new RangeError(`${spec.id}: the fixed places are not places`);
  for (const p of fixed)
    if (start[p] !== p) throw new RangeError(`${spec.id}: the fixed box of place ${p} is not at home`);
}

/** The config of an attempt: the level as played, me, and its rules now. */
export function createPuzzleConfig(setup: PuzzleSetup, deps: Omit<PuzzleDeps, 'clock'>): PuzzleConfig {
  const { spec } = setup;
  checkPuzzleSpec(spec);
  if (!(Number.isInteger(deps.attempt) && deps.attempt >= 1)) throw new RangeError('An attempt is 1 or more');
  const levelRules = deps.rules ?? LEVEL_RULES;
  const rules: PuzzleRules = {
    swapPenaltyMs: levelRules.puzzleSwapPenaltyMs,
    lockOnCorrect: spec.targets.lockOnCorrect,
    conflicts: setup.conflicts === true,
  };
  return { id: setup.id, level: levelRunOf(spec, deps.attempt), spec, players: [setup.player], rules };
}

export function createPuzzle(setup: PuzzleSetup, deps: PuzzleDeps): PuzzleTransition {
  const config = createPuzzleConfig(setup, deps);
  const event: PuzzleEvent = { type: 'puzzleCreated', config, seq: 1, t: deps.clock.now() };
  return { state: evolvePuzzle(null, event), events: [event] };
}

// ---------------------------------------------------------------------------------------------------------
// The reducer

function initialPuzzleState(config: PuzzleConfig, createdAt: number): PuzzleState {
  const { start, fixed } = config.spec.targets;
  return {
    config,
    status: 'waiting',
    createdAt,
    startedAt: null,
    endedAt: null,
    pausedAt: null,
    seq: 1,
    lastEventAt: createdAt,
    endsAt: null,
    penaltyMs: 0,
    at: start.slice(),
    ids: PUZZLE_PLACES.slice(),
    locked: PUZZLE_PLACES.map((p) => fixed.includes(p)),
    swaps: 0,
    mistakes: 0,
    result: null,
  };
}

const draft = (s: PuzzleState): PuzzleState => ({
  ...s,
  at: s.at.slice(),
  ids: s.ids.slice(),
  locked: s.locked.slice(),
});

export function evolvePuzzle(state: PuzzleState | null, e: PuzzleEvent): PuzzleState {
  if (e.type === 'puzzleCreated') {
    if (state) throw new Error('puzzleCreated in the middle of a puzzle');
    if (e.seq !== 1) throw new Error(`puzzleCreated must be seq 1, got ${e.seq}`);
    return initialPuzzleState(e.config, e.t);
  }
  if (!state) throw new Error(`The first event must be puzzleCreated, got ${e.type}`);
  if (e.seq !== state.seq + 1) throw new Error(`Event seq ${e.seq} after ${state.seq}`);
  const s = draft(state);
  s.seq = e.seq;
  s.lastEventAt = Math.max(s.lastEventAt, e.t);

  switch (e.type) {
    case 'levelStarted':
      s.status = 'running';
      s.startedAt = e.t;
      s.endsAt = e.t + s.config.spec.timeLimitMs;
      break;

    case 'boxesSwapped': {
      const { from, to } = e;
      [s.at[from], s.at[to]] = [s.at[to]!, s.at[from]!];
      [s.ids[from], s.ids[to]] = [s.ids[to]!, s.ids[from]!];
      s.swaps++;
      if (e.penaltyMs > 0) {
        s.mistakes++;
        s.penaltyMs += e.penaltyMs;
        if (s.endsAt !== null) s.endsAt -= e.penaltyMs;
      }
      break;
    }

    case 'boxPlaced':
      s.locked[e.place] = true;
      break;

    case 'levelPaused':
      s.status = 'paused';
      s.pausedAt = e.t;
      break;

    case 'levelResumed':
      s.status = 'running';
      s.pausedAt = null;
      if (s.endsAt !== null) s.endsAt += e.pausedMs;
      break;

    case 'levelOver': {
      const { type: _type, seq: _seq, t: _t, ...over } = e;
      // Ended while frozen (a quit before the resume): the level clock stopped at the freeze.
      if (s.status === 'paused' && s.pausedAt !== null && s.endsAt !== null) s.endsAt += e.t - s.pausedAt;
      s.status = 'over';
      s.endedAt = e.t;
      s.pausedAt = null;
      s.result = over;
      break;
    }
  }
  return s;
}

/** The state at the end of a log (every state is evolvePuzzle's: replay is exact). */
export function replayPuzzle(events: readonly PuzzleEvent[]): PuzzleState {
  let state: PuzzleState | null = null;
  for (const e of events) state = evolvePuzzle(state, e);
  if (!state) throw new Error('An empty log');
  return state;
}

// ---------------------------------------------------------------------------------------------------------
// The machine

/** Emits events one by one; each is applied at once, so later checks see its effect. */
class Tx {
  readonly events: PuzzleEvent[] = [];
  constructor(public state: PuzzleState) {}

  emit(body: NewPuzzleEvent, t: number): void {
    const event: PuzzleEvent = { ...body, seq: this.state.seq + 1, t };
    this.state = evolvePuzzle(this.state, event);
    this.events.push(event);
  }
}

class Rejection extends Error {
  constructor(readonly reason: RejectReason) {
    super(reason);
  }
}
const reject = (reason: RejectReason): never => {
  throw new Rejection(reason);
};

/** The level clock at `at`: the time played plus the penalties; it stands still in a freeze. */
function elapsedAt(s: PuzzleState, at: number): number {
  if (s.startedAt === null || s.endsAt === null) return 0;
  const limit = s.config.spec.timeLimitMs;
  const t = s.status === 'paused' && s.pausedAt !== null ? s.pausedAt : at;
  return Math.min(limit, Math.max(0, limit - (s.endsAt - t)));
}

const solved = (s: PuzzleState): boolean => isValidArrangement(s.config.spec.board.solution, s.at);

function endPuzzle(tx: Tx, reason: PuzzleEndReason, at: number): void {
  const s = tx.state;
  const over: PuzzleLevelOver = {
    reason,
    elapsedMs: elapsedAt(s, at),
    penaltyMs: s.penaltyMs,
    swaps: s.swaps,
    mistakes: s.mistakes,
    stars: 0,
  };
  // The stars are levelOutcome's, so either reading of the end is the same (progress.ts).
  tx.emit({ type: 'levelOver', ...over, stars: levelOutcome(s.config.spec, over).stars }, at);
}

/**
 * Two boxes change places. Wrong when neither lands at home (and the puzzle is not solved by it) [D70c]; with
 * the lock, a box that lands home locks there [D71]; a solved board ends the level, and a penalty that reaches
 * the limit ends it too.
 */
function swap(tx: Tx, from: number, to: number, at: number): void {
  const s = tx.state;
  const after = s.at.slice();
  [after[from], after[to]] = [after[to]!, after[from]!];
  const done = isValidArrangement(s.config.spec.board.solution, after);
  const wrong = !done && after[from] !== from && after[to] !== to;
  tx.emit({ type: 'boxesSwapped', from, to, penaltyMs: wrong ? s.config.rules.swapPenaltyMs : 0 }, at);
  if (s.config.rules.lockOnCorrect)
    for (const p of [from, to]) if (tx.state.at[p] === p) tx.emit({ type: 'boxPlaced', place: p }, at);
  if (solved(tx.state)) return endPuzzle(tx, 'targetReached', at);
  const endsAt = tx.state.endsAt;
  if (endsAt !== null && endsAt <= at) endPuzzle(tx, 'timeUp', at);
}

function decide(tx: Tx, action: PuzzleAction, now: number): void {
  const s = tx.state;
  const live = (): void => {
    if (s.status === 'over') reject('gameOver');
    if (s.status === 'waiting') reject('notStarted');
  };
  const mine = (id: PlayerId): void => {
    if (!s.config.players.some((p) => p.id === id)) reject('unknownPlayer');
  };
  switch (action.type) {
    case 'start':
      if (s.status !== 'waiting') reject(s.status === 'over' ? 'gameOver' : 'alreadyStarted');
      tx.emit({ type: 'levelStarted' }, now);
      return;

    case 'pause':
      live();
      if (s.status !== 'running') reject('paused');
      tx.emit({ type: 'levelPaused' }, now);
      return;

    case 'resume':
      live();
      if (s.status !== 'paused') reject('badAction');
      tx.emit({ type: 'levelResumed', pausedMs: now - (s.pausedAt ?? now) }, now);
      return;

    case 'quit':
      live();
      mine(action.playerId);
      endPuzzle(tx, 'quit', now);
      return;

    case 'swap': {
      live();
      if (s.status === 'paused') reject('paused');
      mine(action.playerId);
      const { from, to } = action;
      if (!isPlace(from) || !isPlace(to) || from === to) reject('badCell');
      if (s.locked[from] || s.locked[to]) reject('boxFixed');
      swap(tx, from, to, now);
      return;
    }

    default:
      reject('badAction');
  }
}

/** Runs the time limit when it is due by `now`: a move at the deadline itself is too late (D52). */
function runDues(tx: Tx, now: number): void {
  const at = nextPuzzleDeadline(tx.state);
  if (at !== null && at <= now) endPuzzle(tx, 'timeUp', at);
}

export function applyPuzzle(state: PuzzleState, action: PuzzleAction, now: number): PuzzleActionResult {
  const t = Math.max(now, state.lastEventAt);
  const tx = new Tx(state);
  runDues(tx, t);
  const afterDues = { state: tx.state, events: tx.events.slice() };
  try {
    decide(tx, action, t);
  } catch (e) {
    if (!(e instanceof Rejection)) throw e;
    // Every check comes before the first emit, so a refused action leaves no trace.
    return { ...afterDues, rejected: e.reason };
  }
  return { state: tx.state, events: tx.events };
}

export function tickPuzzle(state: PuzzleState, now: number): PuzzleTransition {
  const tx = new Tx(state);
  runDues(tx, Math.max(now, state.lastEventAt));
  return { state: tx.state, events: tx.events };
}

/** The earliest time at which tickPuzzle has something to do (the limit, while it runs), or null. */
export function nextPuzzleDeadline(state: PuzzleState): number | null {
  return state.status === 'running' ? state.endsAt : null;
}

// ---------------------------------------------------------------------------------------------------------
// The view

/** level.puzzle of puzzleView, alone. */
export function puzzleLevelView(state: PuzzleState): LevelPuzzleView {
  const { spec, rules } = state.config;
  const fixed = spec.targets.fixed;
  const over = state.status === 'over';
  const slots = PUZZLE_PLACES.map((p): PuzzleSlotView => ({
    id: state.ids[p]!,
    // Without the lock a box at home still reads 'movable': the view never gives the answer away [D71].
    state: fixed.includes(p) ? 'fixed' : rules.lockOnCorrect && state.locked[p] ? 'placed' : 'movable',
  }));
  const conflicts =
    rules.conflicts && !over ? puzzleConflicts(assemblePuzzle(spec.board.solution, state.at)) : [];
  return {
    slots,
    moving: 9 - fixed.length,
    swaps: state.swaps,
    mistakes: state.mistakes,
    minSwaps: fewestSwaps(spec.targets.start),
    lockOnCorrect: rules.lockOnCorrect,
    conflicts,
    ...(over && state.result ? { over: { ...state.result } } : null),
  };
}

function levelViewOfPuzzle(s: PuzzleState, now: number): LevelView {
  const { spec, level: run } = s.config;
  const over = s.status === 'over';
  const at = over ? (s.endedAt ?? now) : now;
  const elapsedMs = elapsedAt(s, at);
  const limitMs = spec.timeLimitMs;
  const stars: Stars = over ? (s.result?.stars ?? 0) : starsFor(spec.stars, elapsedMs);
  return {
    id: run.id,
    rev: run.rev,
    kind: run.kind,
    boss: run.boss === true,
    attempt: run.attempt,
    elapsedMs,
    limitMs,
    endsAt: s.status === 'running' ? s.endsAt : null,
    remainingMs: Math.max(0, limitMs - elapsedMs),
    penaltyMs: s.penaltyMs,
    marks: { ...spec.stars },
    stars,
    final: over,
    editableCells: null,
    progress: { kind: 'swaps', used: s.swaps, mistakes: s.mistakes },
    lockTimer: false,
    puzzle: puzzleLevelView(s),
  };
}

/**
 * The picture of a puzzle for the screen, as a GameView (the GameHost interface): the boxes as they stand, every
 * digit drawn as an original one (givens all set, no owner), no keypad, no lock, no interference, and
 * level.puzzle. My mistakes are the wrong swaps. `result` stays null: the end is level.puzzle.over
 * (levelOutcome reads it); the solution comes only after the end.
 */
export function puzzleView(state: PuzzleState, viewer: PlayerId | null, now: number): GameView {
  const { config } = state;
  const spec = config.spec;
  const mode = levelModeFor(spec);
  const rules = defaultRules(mode, spec.gameType, levelRulesFor(spec));
  const me = config.players.find((p) => p.id === viewer) ?? null;
  const players = config.players.map((info, seat): PlayerView => ({
    id: info.id,
    seat,
    name: info.name ?? null,
    isBot: false,
    rating: null,
    status: 'active',
    connected: true,
    graceEndsAt: null,
    softEndsAt: null,
    score: 0,
    mistakes: state.mistakes,
    mistakePenalties: [],
    correct: 0,
    place: 1,
    isLeader: false,
    lock: null,
    hitBy: null,
    immuneUntil: 0,
    bestMove: null,
  }));
  return {
    gameId: config.id,
    mode,
    gameType: spec.gameType,
    status: state.status,
    seq: state.seq,
    startedAt: state.startedAt,
    pausedAt: state.pausedAt,
    rules: {
      turnModel: rules.turnModel,
      thinkTimeMs: rules.thinkTimeMs,
      interferenceMs: rules.interferenceMs,
      interferences: false,
      interferenceKinds: [],
      reactions: [],
      reactionCooldownMs: rules.reactionCooldownMs,
    },
    grid: assemblePuzzle(spec.board.solution, state.at),
    givens: new Array<boolean>(CELL_COUNT).fill(true),
    owner: new Array<number | null>(CELL_COUNT).fill(null),
    wrong: Array.from({ length: CELL_COUNT }, () => []),
    players,
    turn: null,
    me: me?.id ?? null,
    keypad: { remaining: new Array<number>(9).fill(0), disabled: [], enabled: false },
    cooldowns: [],
    interference: null,
    reactionReadyAt: 0,
    leaveGuards: null,
    result: null,
    solution: state.status === 'over' ? spec.board.solution : null,
    level: levelViewOfPuzzle(state, now),
  };
}

// ---------------------------------------------------------------------------------------------------------
// "למה?"

/** One step of "למה?": the place filled, the box that goes there (by where it stood at the start), and why. */
export interface PuzzleExplainStep {
  place: number;
  /** The place this box stood at in the level's start (the view's slot id). */
  from: number;
  /** Only this box fits the place, or this box fits only this place (no repeated digit in a row or column). */
  reason: 'onlyBoxForPlace' | 'onlyPlaceForBox';
}

/**
 * The puzzle solved one place at a time from its fixed boxes (levels-content.md §5.2): at each step, the first
 * place (in place order) that only one of the boxes left fits, beside the boxes placed; else the first box (by
 * where it started) that fits only one place left. Each step is forced, so it is always the box's home. Stops
 * where neither exists: a level the builder accepts is solved to the end (as many steps as moving boxes).
 */
export function puzzleStepsFrom(
  solution: string,
  fixed: readonly number[],
  start: readonly number[],
): PuzzleExplainStep[] {
  return puzzleStepsWithFit(puzzleFitOf(solution), fixed, start);
}

/** puzzleStepsFrom on the fit tables themselves (the order of the reasons is tested on made-up tables). */
export function puzzleStepsWithFit(
  fit: PuzzleFit,
  fixed: readonly number[],
  start: readonly number[],
): PuzzleExplainStep[] {
  const placed = new Map<number, number>(fixed.map((p) => [p, p]));
  let places = PUZZLE_PLACES.filter((p) => !placed.has(p));
  let boxes = places.map((p) => start[p]!);
  const startOf = (home: number): number => start.indexOf(home);
  const steps: PuzzleExplainStep[] = [];
  while (places.length) {
    let step: PuzzleExplainStep | null = null;
    let home = -1;
    for (const p of places) {
      const ok = boxes.filter((h) => boxFits(fit, h, p, placed));
      if (ok.length === 1) {
        home = ok[0]!;
        step = { place: p, from: startOf(home), reason: 'onlyBoxForPlace' };
        break;
      }
    }
    if (!step)
      for (const h of [...boxes].sort((a, b) => startOf(a) - startOf(b))) {
        const ok = places.filter((p) => boxFits(fit, h, p, placed));
        if (ok.length === 1) {
          home = h;
          step = { place: ok[0]!, from: startOf(h), reason: 'onlyPlaceForBox' };
          break;
        }
      }
    if (!step) break;
    const where = step.place;
    placed.set(where, home);
    places = places.filter((p) => p !== where);
    boxes = boxes.filter((h) => h !== home);
    steps.push(step);
  }
  return steps;
}

/** "למה?" of a puzzle: from its start to its solution, one place at a time, each with its reason. */
export function puzzleExplainSteps(level: AppLevelOf<'puzzle'>): readonly PuzzleExplainStep[] {
  return puzzleStepsFrom(level.board.solution, level.targets.fixed, level.targets.start);
}
