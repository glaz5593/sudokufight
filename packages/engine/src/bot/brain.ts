import type { InterferenceKind } from '../game/rules';
import type { GameState, PlayerId, PlayerState } from '../game/types';
import type { GameType } from '../gameType';
import { type CellIndex, CELL_COUNT, type Digit, DIGITS, missingDigits, unitsOf } from '../sudoku/board';
import { LogicBoard } from '../sudoku/logic';
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
 * The options of every cell: its candidates on the current board (givens and solved cells) without the
 * digits already tried wrongly there, which everyone sees (spec §6.5) [D12]. 0 for a filled cell.
 */
function optionMasks(state: GameState): number[] {
  const board = new LogicBoard(state.grid);
  return board.cand.map((mask, cell) => {
    let m = mask;
    for (const w of state.wrong[cell]!) m &= ~bit(w.digit);
    return m;
  });
}

/** The options cellDifficulty counts: the cell's candidates without the digits tried there. */
export const cellOptions = (state: GameState, cell: CellIndex): Digit[] =>
  state.grid[cell] === 0 ? digitsOf(optionMasks(state)[cell]!) : [];

export interface CellDifficulty {
  /** Digits that still fit the cell. */
  options: number;
  /** The simplest technique that solves the cell on the board as it is. */
  technique: CellTechnique;
  /** Think time multiplier (spec §9): 1 for a naked single, more for the rest. */
  factor: number;
}

function difficultyAt(
  state: GameState,
  masks: readonly number[],
  cell: CellIndex,
  config: BotConfig,
): CellDifficulty {
  const mask = masks[cell]!;
  const options = popcount(mask);
  let technique: CellTechnique = 'harder';
  if (options === 1) technique = 'nakedSingle';
  else {
    for (const unit of unitsOf(cell)) {
      let elsewhere = 0;
      for (const c of unit.cells) if (c !== cell && state.grid[c] === 0) elsewhere |= masks[c]!;
      // A digit that fits nowhere else in a row, column or box goes here.
      if ((mask & ~elsewhere) !== 0) {
        technique = 'hiddenSingle';
        break;
      }
    }
  }
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
  return difficultyAt(state, optionMasks(state), cell, config);
}

/** The difficulty of every cell; null for filled ones. */
export function cellDifficulties(
  state: GameState,
  config: BotConfig = BOT_CONFIG,
): (CellDifficulty | null)[] {
  const masks = optionMasks(state);
  return Array.from({ length: CELL_COUNT }, (_, cell) =>
    state.grid[cell] === 0 ? difficultyAt(state, masks, cell, config) : null,
  );
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
 * A move's think time in ms (spec §9): a base drawn from the level's range (for 'normal'), × the pace of the
 * game type, × the difficulty of the cell, × the adaptation.
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
  if (me.status !== 'active' || !me.connected) return false;
  if (target.status !== 'active' || !target.connected) return false;
  if (target.hitBy || target.immuneUntil > now) return false;
  const cost = rules.interferenceCostBase ** (me.interferencesSent + 1);
  return !rules.interferenceNeedsScore || me.score >= cost;
}

/**
 * Whether to send an interference now, and on whom (spec §9 table) [D40]: the level's policy (how many a
 * game, how far behind), then its chance. The target is the leading opponent that can take one.
 */
export function decideInterference(
  state: GameState,
  botId: PlayerId,
  level: BotLevel,
  now: number,
  rng: Rng,
): { targetId: PlayerId; kind: InterferenceKind } | null {
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
  if (!me || me.status !== 'active' || !me.connected) return false;
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
