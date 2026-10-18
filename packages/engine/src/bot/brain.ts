import { isSoftOffline } from '../game/evolve';
import type { InterferenceKind } from '../game/rules';
import type { GameState, PlayerId, PlayerState } from '../game/types';
import type { GameType } from '../gameType';
import { type CellIndex, CELL_COUNT, type Digit, DIGITS, missingDigits, unitsOf } from '../sudoku/board';
import { LogicBoard, type Technique, TECHNIQUES } from '../sudoku/logic';
import { pick, type Rng } from '../util/random';
import {
  BOT_CONFIG,
  type BotConfig,
  type BotLevel,
  type BotReactionTrigger,
  type CellTechnique,
  type MsRange,
} from './levels';

/**
 * What a bot decides (spec §9), as pure functions of the game state and an injected RNG. The runner
 * (./runner) only times these decisions and sends them to the host.
 *
 * The bot reads the full state, solution included: it runs next to a LocalGameHost on the phone (practice
 * against a bot never touches the server, spec §5.1). It plays like a person all the same: it looks for
 * easy cells, thinks longer on hard ones, and its mistakes are digits a person could have believed in.
 */

const bit = (d: number): number => 1 << (d - 1);
const digitsOf = (mask: number): Digit[] => DIGITS.filter((d) => (mask & bit(d)) !== 0);
function popcount(m: number): number {
  let n = 0;
  for (let x = m; x; x &= x - 1) n++;
  return n;
}

/** A value drawn uniformly from a range. */
export const drawMs = (rng: Rng, range: MsRange): number =>
  Math.round(range.min + rng.next() * (range.max - range.min));

const playerOf = (s: GameState, id: PlayerId): PlayerState | undefined => s.players.find((p) => p.id === id);

/** The opponents still in the game. */
const opponentsOf = (s: GameState, id: PlayerId): PlayerState[] =>
  s.players.filter((p) => p.id !== id && p.status === 'active');

/**
 * How far `id` is ahead of the best opponent still in the game (negative: behind); null without one.
 */
export function leadOver(state: GameState, id: PlayerId): number | null {
  const me = playerOf(state, id);
  const others = opponentsOf(state, id);
  if (!me || !others.length) return null;
  return me.score - Math.max(...others.map((p) => p.score));
}

// ---------------------------------------------------------------------------------------------------------
// Cells

/**
 * A logical board of the current state (givens and solved cells) whose candidates leave out the digits
 * already tried wrongly in each cell, which everyone sees (spec §6.5) [D12].
 */
function logicBoardOf(state: GameState): LogicBoard {
  const board = new LogicBoard(state.grid);
  state.wrong.forEach((tries, cell) => {
    for (const w of tries) board.cand[cell]! &= ~bit(w.digit);
  });
  return board;
}

/** The options cellDifficulty counts: the cell's candidates without the digits tried there. */
export const cellOptions = (state: GameState, cell: CellIndex): Digit[] =>
  state.grid[cell] === 0 ? digitsOf(logicBoardOf(state).cand[cell]!) : [];

/** Whether `cell` is a naked or a hidden single with these candidates (`masks`, 0 for a filled cell). */
function singleAt(grid: readonly number[], masks: readonly number[], cell: CellIndex): boolean {
  const mask = masks[cell]!;
  if (popcount(mask) === 1) return true;
  for (const unit of unitsOf(cell)) {
    let elsewhere = 0;
    for (const c of unit.cells) if (c !== cell && grid[c] === 0) elsewhere |= masks[c]!;
    // A digit that fits nowhere else in a row, column or box goes here.
    if ((mask & ~elsewhere) !== 0) return true;
  }
  return false;
}

/** The eliminations of the logical solver, simplest first (sudoku/logic). */
const ELIMINATIONS: ReadonlySet<Technique> = new Set(
  TECHNIQUES.filter((t) => t !== 'nakedSingle' && t !== 'hiddenSingle'),
);
/** A guard: every elimination removes a candidate, so a board runs out of them long before this. */
const MAX_ELIMINATIONS = 729;

interface BoardReading {
  /** The options of each cell (a digit mask; 0 for a filled cell). */
  readonly masks: readonly number[];
  /** The deduction that solves each empty cell (null for a filled one). */
  readonly techniques: readonly (CellTechnique | null)[];
}

/**
 * One reading per state: a move reads the same state more than once (the cell to choose, then its think
 * time), and a state never changes once it is made (game/evolve). Weak: a state that is gone takes its
 * reading with it.
 */
const readings = new WeakMap<GameState, BoardReading>();

function readBoard(state: GameState): BoardReading {
  let reading = readings.get(state);
  if (!reading) {
    reading = computeReading(state);
    readings.set(state, reading);
  }
  return reading;
}

/**
 * The deduction that solves each empty cell on the board as it is (CELL_TECHNIQUES), and the options of
 * each: the logical solver's own steps (sudoku/logic, as in the explanations), nothing the bot works out by
 * itself.
 *   1. On the board as it is: the last gap of a unit or of a digit, a naked single, a hidden single.
 *   2. The rest: the solver's eliminations, simplest first, one at a time (pointing, claiming, naked and
 *      hidden pairs; no digit is placed). A cell that becomes a single gets the hardest technique used so
 *      far: the simplest one that reaches it.
 *   3. What is left needs other cells first, or more than the solver knows: 'harder'.
 */
function computeReading(state: GameState): BoardReading {
  const grid = state.grid;
  const board = logicBoardOf(state);
  const masks = board.cand.slice();
  const count = new Array<number>(10).fill(0);
  for (const v of grid) count[v]!++;
  const techniques = new Array<CellTechnique | null>(CELL_COUNT).fill(null);
  const pending: CellIndex[] = [];
  for (let cell = 0; cell < CELL_COUNT; cell++) {
    if (grid[cell] !== 0) continue;
    const mask = masks[cell]!;
    const lastOfUnit = unitsOf(cell).some((u) => u.cells.every((c) => c === cell || grid[c] !== 0));
    // A digit with eight on the board has one place left, and only that cell still lists it.
    const lastOfDigit = digitsOf(mask).some((d) => count[d] === 8);
    if (lastOfUnit || lastOfDigit) techniques[cell] = 'lastGap';
    else if (popcount(mask) === 1) techniques[cell] = 'nakedSingle';
    else if (singleAt(grid, masks, cell)) techniques[cell] = 'hiddenSingle';
    else pending.push(cell);
  }
  let hardest = -1;
  for (let k = 0; k < MAX_ELIMINATIONS && pending.length; k++) {
    const step = board.findStep(ELIMINATIONS);
    if (!step) break;
    board.apply(step);
    hardest = Math.max(hardest, TECHNIQUES.indexOf(step.technique));
    for (let i = pending.length - 1; i >= 0; i--) {
      const cell = pending[i]!;
      if (!singleAt(grid, board.cand, cell)) continue;
      techniques[cell] = TECHNIQUES[hardest]!;
      pending.splice(i, 1);
    }
  }
  for (const cell of pending) techniques[cell] = 'harder';
  return { masks, techniques };
}

export interface CellDifficulty {
  /** Digits that still fit the cell. */
  options: number;
  /** The deduction that solves the cell on the board as it is (CELL_TECHNIQUES). */
  technique: CellTechnique;
  /** Think time multiplier (spec §9): 1 for a naked single, less for a last gap, more for the rest. */
  factor: number;
}

function difficultyOf(mask: number, technique: CellTechnique, config: BotConfig): CellDifficulty {
  const options = popcount(mask);
  const d = config.difficulty;
  const factor = Math.min(d.max, d.technique[technique] * (1 + d.perExtraOption * Math.max(0, options - 1)));
  return { options, technique, factor };
}

/** The difficulty of an empty cell on the current board (spec §9). */
export function cellDifficulty(
  state: GameState,
  cell: CellIndex,
  config: BotConfig = BOT_CONFIG,
): CellDifficulty {
  if (state.grid[cell] !== 0) throw new RangeError(`Cell ${cell} is not empty`);
  const { masks, techniques } = readBoard(state);
  return difficultyOf(masks[cell]!, techniques[cell]!, config);
}

/** The difficulty of every cell; null for filled ones. */
export function cellDifficulties(
  state: GameState,
  config: BotConfig = BOT_CONFIG,
): (CellDifficulty | null)[] {
  const { masks, techniques } = readBoard(state);
  return techniques.map((t, cell) => (t === null ? null : difficultyOf(masks[cell]!, t, config)));
}

/** Digits that may still be entered in a cell: not tried wrongly there [D12], not all nine on the board. */
export function playableDigits(state: GameState, cell: CellIndex): Digit[] {
  if (state.grid[cell] !== 0) return [];
  const tried = new Set<number>(state.wrong[cell]!.map((w) => w.digit));
  const count = new Array<number>(10).fill(0);
  for (const v of state.grid) count[v]!++;
  return DIGITS.filter((d) => !tried.has(d) && count[d]! < 9);
}

/**
 * A cell `botId` may lock now (spec §6.2): empty, not locked by anyone, not in its own re-lock wait [D2], and
 * with a digit left to enter.
 */
export function isEligibleCell(state: GameState, botId: PlayerId, cell: CellIndex, now: number): boolean {
  if (state.grid[cell] !== 0) return false;
  if (state.locks.some((l) => l.cell === cell)) return false;
  if (state.cooldowns.some((c) => c.playerId === botId && c.cell === cell && c.until > now)) return false;
  return playableDigits(state, cell).length > 0;
}

export function eligibleCells(state: GameState, botId: PlayerId, now: number): CellIndex[] {
  const out: CellIndex[] = [];
  for (let cell = 0; cell < CELL_COUNT; cell++) if (isEligibleCell(state, botId, cell, now)) out.push(cell);
  return out;
}

/**
 * The next cell (spec §9): easy cells — few options, a simple technique — are more likely, with random
 * noise (a softmax over the difficulty factor). Null when no cell can be locked now.
 */
export function chooseCell(
  state: GameState,
  botId: PlayerId,
  now: number,
  rng: Rng,
  config: BotConfig = BOT_CONFIG,
): CellIndex | null {
  const cells = eligibleCells(state, botId, now);
  if (!cells.length) return null;
  const diffs = cellDifficulties(state, config);
  const factors = cells.map((c) => diffs[c]!.factor);
  const easiest = Math.min(...factors);
  const t = config.cellChoiceTemperature;
  if (!(t > 0))
    return pick(
      rng,
      cells.filter((_, k) => factors[k] === easiest),
    );
  const weights = factors.map((f) => Math.exp(-(f - easiest) / t));
  let r = rng.next() * weights.reduce((a, b) => a + b, 0);
  for (let k = 0; k < cells.length; k++) {
    r -= weights[k]!;
    if (r < 0) return cells[k]!;
  }
  return cells[cells.length - 1]!;
}

// ---------------------------------------------------------------------------------------------------------
// Time

/**
 * Adaptation (spec §9): a level marked `adaptive` (1–3) slows down a little while the human trails by more
 * than `humanTrailingBy` points. 1 otherwise.
 */
export function adaptationFactor(
  state: GameState,
  botId: PlayerId,
  level: BotLevel,
  config: BotConfig = BOT_CONFIG,
): number {
  if (!level.adaptive) return 1;
  const lead = leadOver(state, botId);
  return lead !== null && lead > config.adaptation.humanTrailingBy ? config.adaptation.slowdown : 1;
}

export interface ThinkTimeInput {
  level: BotLevel;
  gameType: GameType;
  /** The cell's difficulty factor. */
  factor: number;
  /** The adaptation factor; 1 by default. */
  adapt?: number;
}

/**
 * A move's think time in ms (spec §9): a base drawn uniformly from the level's range (an ordinary move, a
 * naked single), × the difficulty of the cell (the deduction it needs), × the pace of the game type (1 by
 * default), × the adaptation.
 *
 * Only the hesitation before locking can be long: splitThinkTime keeps the part after locking within the
 * lock time, and in 'turns' the runner keeps the hesitation within the turn [D1].
 */
export function thinkTime(
  { level, gameType, factor, adapt = 1 }: ThinkTimeInput,
  rng: Rng,
  config: BotConfig = BOT_CONFIG,
): number {
  const { min, max } = level.thinkMs;
  const base = min + rng.next() * (max - min);
  return Math.round(base * config.pace[gameType] * factor * adapt);
}

/**
 * The two phases of a move (spec §9): hesitation before locking, then the digit within `placeWithin` (80%)
 * of the lock time, so the bot's lock does not run out. Together they make the move's think time.
 */
export function splitThinkTime(
  totalMs: number,
  lockMs: number,
  rng: Rng,
  config: BotConfig = BOT_CONFIG,
): { hesitateMs: number; solveMs: number } {
  const { min, max } = config.solveShare;
  const share = min + rng.next() * (max - min);
  const solveMs = Math.max(0, Math.min(Math.round(totalMs * share), Math.floor(lockMs * config.placeWithin)));
  return { hesitateMs: Math.max(0, totalMs - solveMs), solveMs };
}

// ---------------------------------------------------------------------------------------------------------
// Digits

/**
 * The wrong digits a person could believe in for a cell (spec §9: "one of the options left for the cell,
 * not a random digit"), never the solution nor a digit already tried there [D12]: those that fit the most of
 * the cell's row, column and box.
 *   - Fitting all three: the cell's other candidates on the board as it is.
 *   - A naked single has none; then the digits that fit two of the three — the person overlooked the one
 *     peer that holds it — and so on. Without this a bot that picks easy cells would almost never err.
 * Empty when the cell is the last gap of its row, its column and its box.
 */
export function plausibleWrongDigits(state: GameState, cell: CellIndex): Digit[] {
  if (state.grid[cell] !== 0) return [];
  const right = solutionDigit(state, cell);
  const missing = unitsOf(cell).map((u) => new Set<number>(missingDigits(state.grid, u)));
  const fits = new Map<Digit, number>();
  for (const d of playableDigits(state, cell))
    if (d !== right) fits.set(d, missing.filter((m) => m.has(d)).length);
  const best = Math.max(0, ...fits.values());
  return best ? [...fits].filter(([, n]) => n === best).map(([d]) => d) : [];
}

function solutionDigit(state: GameState, cell: CellIndex): Digit {
  const d = Number(state.config.puzzle.solution[cell]);
  if (!(d >= 1 && d <= 9)) throw new RangeError('A bot needs the solution: give it the full game state');
  return d as Digit;
}

/**
 * The digit for a locked cell: the right one with probability 1 − mistakeRate, otherwise a plausible wrong
 * one. With no plausible wrong digit the bot plays the right one.
 */
export function chooseDigit(
  state: GameState,
  cell: CellIndex,
  mistakeRate: number,
  rng: Rng,
): { digit: Digit; mistake: boolean } {
  const right = solutionDigit(state, cell);
  if (rng.next() >= mistakeRate) return { digit: right, mistake: false };
  const wrong = plausibleWrongDigits(state, cell);
  return wrong.length ? { digit: pick(rng, wrong), mistake: true } : { digit: right, mistake: false };
}

// ---------------------------------------------------------------------------------------------------------
// Interferences (spec §7.2)

/** Whether the engine would take an interference from `fromId` on `targetId` now [D10, D11]. */
export function canInterfere(state: GameState, fromId: PlayerId, targetId: PlayerId, now: number): boolean {
  const rules = state.config.rules;
  if (state.status !== 'running' || !rules.interferences || !rules.interferenceKinds.length) return false;
  const me = playerOf(state, fromId);
  const target = playerOf(state, targetId);
  if (!me || !target || me === target) return false;
  if (me.status !== 'active' || !me.connected || isSoftOffline(me)) return false;
  if (target.status !== 'active' || !target.connected) return false;
  if (isSoftOffline(target) && !rules.interfereSoftOffline) return false; // [D42]
  if (target.hitBy || target.immuneUntil > now) return false;
  const cost = rules.interferenceCostBase ** (me.interferencesSent + 1);
  return !rules.interferenceNeedsScore || me.score >= cost;
}

/**
 * Whether to send an interference now, and on whom (spec §9 table) [D40]: the level's policy (how many a
 * game, how far behind), then its chance. The target is the leading opponent that can take one; the kind is
 * one of the game's `rules.interferenceKinds` (a room's kinds [D47]).
 *
 * In a game with interferences off it never sends one [D44]: practice against a bot has none, so the bot
 * never interferes there. It returns before drawing from `rng`, so a bot game's random stream (and its
 * replay) does not depend on the policy.
 */
export function decideInterference(
  state: GameState,
  botId: PlayerId,
  level: BotLevel,
  now: number,
  rng: Rng,
): { targetId: PlayerId; kind: InterferenceKind } | null {
  if (!state.config.rules.interferences) return null; // [D44]
  const policy = level.interference;
  const me = playerOf(state, botId);
  if (!me || policy.chance <= 0) return null;
  if (policy.maxPerGame !== null && me.interferencesSent >= policy.maxPerGame) return null;
  if (policy.minDeficit !== null) {
    const lead = leadOver(state, botId);
    if (lead === null || !(-lead > 0 && -lead >= policy.minDeficit)) return null;
  }
  const targets = opponentsOf(state, botId)
    .filter((p) => canInterfere(state, botId, p.id, now))
    .sort((a, b) => b.score - a.score || a.seat - b.seat);
  if (!targets.length) return null;
  if (rng.next() >= policy.chance) return null;
  return { targetId: targets[0]!.id, kind: pick(rng, state.config.rules.interferenceKinds) };
}

// ---------------------------------------------------------------------------------------------------------
// Reactions (spec §8)

/** Whether the engine would take a reaction from `id` now: in the game, and the rate limit [D19]. */
export function canReact(state: GameState, id: PlayerId, now: number): boolean {
  const me = playerOf(state, id);
  if (!me || me.status !== 'active' || !me.connected || isSoftOffline(me)) return false;
  if (state.status !== 'running') return false;
  const cooldown = state.config.rules.reactionCooldownMs;
  return me.lastReactionAt === null || now - me.lastReactionAt >= cooldown;
}

/** The level's reaction to a trigger, drawn by its chance; null for none (spec §9 table). */
export function decideReaction(
  trigger: BotReactionTrigger,
  state: GameState,
  level: BotLevel,
  rng: Rng,
): string | null {
  const r = level.reactions[trigger];
  if (!r || r.chance <= 0 || state.status === 'over') return null;
  if (!state.config.rules.reactions.includes(r.emoji)) return null;
  return rng.next() < r.chance ? r.emoji : null;
}
