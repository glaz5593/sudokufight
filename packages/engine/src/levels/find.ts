import { BOT_MISS_AT, chooseWrongTap, findMsRange } from '../bot/finder';
import { BOT_CONFIG, type BotConfig, botLevel, botPlayer } from '../bot/levels';
import { defaultRules } from '../game/rules';
import type { PlayerId, PlayerInfo, RejectReason } from '../game/types';
import type { GameView, PlayerView } from '../game/view';
import {
  CELL_COUNT,
  type CellIndex,
  DIGITS,
  type Digit,
  digitCount,
  isCellIndex,
  parseGrid,
} from '../sudoku/board';
import type { Clock } from '../util/clock';
import { createRng, type Rng, seedFromString } from '../util/random';
import { LEVEL_RULES, type LevelRules, levelOutcome } from './progress';
import {
  type AppLevel,
  type BotSpotPlan,
  type FindConfig,
  type FindEndReason,
  type FindLevelOver,
  type FindRules,
  type FindTarget,
  isTapKind,
  LEVEL_PENALTY_MS,
  type LevelEvent,
  type LevelFindView,
  levelModeFor,
  levelRulesFor,
  levelRunOf,
  type LevelSpecOf,
  type LevelSpotView,
  type LevelView,
  type NewLevelEvent,
  type Stars,
} from './spec';
import { starsFor } from './stars';

/**
 * The tap engine (dev-plan §2ג): the levels played by tapping cells, with no keypad, no lock and no score
 * (find, findDuel, spotError; plan §2.1, §2.2, Idea-1). A small machine of its own, beside the game engine, with
 * the same shape (game/engine.ts): pure and deterministic, the clock and the RNG injected.
 *
 *   createFind(setup, { clock, attempt, rng? })  → the first state and the levelCreated event
 *   applyFind(state, action, now)                → { state, events } (a new state), or with `rejected`
 *   tickFind(state, now)                         → the timers that are due: the time limit, the bot's taps
 *   nextFindDeadline(state)                      → when tickFind next has something to do (one host timer)
 *   evolveFind(state, event)                     → the reducer; replayFind(events) folds a whole log
 *   findView(state, viewer, now)                 → the GameView of the screens, with level.find
 *
 * The rules:
 * - find: one target. A wrong tap costs 5 s (the time limit comes closer); the second ends the level
 *   ('tooManyMisses', 0 stars), and so does the limit (20 s: 'timeUp', 0 stars); the answer is in the view at
 *   the end. Scope 'board' takes any cell of the target's `accept`.
 * - findDuel: 5 spots, one after the other, against the bot; whoever taps the right cell first takes it. A wrong
 *   tap freezes the tapper 3 s, and a second wrong tap on the same spot keeps him out of it until the next one.
 *   At the limit (30 s) the open spot goes to nobody (spotVoid). The same ms: the time limit first, then my tap,
 *   then the bot's (before a player's action only the bot's dues strictly earlier run). The bot plays the plan
 *   drawn when the level was created; it misses now and then (and is frozen 3 s for it), and reacts to my wrong
 *   tap when its plan says so (spec §9; the player has no reactions button in a level, D62).
 * - spotError: a tap on a planted error finds it (the right digit shows); a tap on a right "mine" digit costs
 *   5 s; all found ends the level; the errors not found are in the view at the end.
 * - A tap on a filled cell (a given, a spot taken): nothing, or a wrong tap (LEVEL_RULES.tapOnFilled) [D52].
 * - The phone's own freeze [D65] (`pause` / `resume`): nothing runs out meanwhile, taps are refused 'paused',
 *   and every deadline (the limit, the freezes, the bot's plan) moves on by the pause.
 * - No interference of any kind [D49].
 *
 * The bot's plan is drawn in createFind from the level's seed and the attempt, within the search ranges frozen
 * in the level (spec.bot.findMs, missShare, reactShare), and stored in levelCreated: a replay needs no RNG, and a
 * later change of BOT_CONFIG.find never alters a built level.
 */

// ---------------------------------------------------------------------------------------------------------
// State

export interface FindPlayer {
  id: PlayerId;
  seat: number;
  isBot: boolean;
  /** findDuel: the spots taken; find: 1 once found; spotError: the errors found. */
  spots: number;
  wrongTaps: number;
  /** findDuel: the wrong taps on the current spot; the second keeps him out of it. */
  spotMisses: number;
  /** findDuel: taps refused ('frozen') until then, after a wrong one. */
  frozenUntil: number | null;
  /** findDuel: out of the current spot until the next one is shown. */
  out: boolean;
  lastReactionAt: number | null;
}

export interface FindState {
  config: FindConfig;
  status: 'waiting' | 'running' | 'paused' | 'over';
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  pausedAt: number | null;
  /** seq of the last event. */
  seq: number;
  /** Time of the last event; time never runs backwards past it. */
  lastEventAt: number;
  /**
   * When the time runs out: the start plus the limit, sooner by every time penalty, later by every freeze; kept
   * at the end for the level clock. Null before the start.
   */
  endsAt: number | null;
  /** My time penalties so far. */
  penaltyMs: number;
  /** The board as shown: the givens, spotError's "mine" digits (a found error corrected), the spots taken. */
  grid: number[];
  givens: boolean[];
  /** The seat of whoever took a spot; mine (seat 0) for spotError's own digits; null otherwise. */
  owner: (number | null)[];
  /** The target now (find: 0; findDuel: the current spot; spotError: 0, unused). */
  spot: number;
  /** find and findDuel: each target as the view shows it. */
  spots: LevelSpotView[];
  /** spotError: the planted errors found, in order. */
  found: CellIndex[];
  /** findDuel: the bot's next taps on the current spot, in the clock the level runs on. */
  bot: { missAt: number | null; tapAt: number | null } | null;
  /** findDuel: when the bot's reaction to my wrong tap comes. */
  reactAt: number | null;
  /** Me first; the bot second in findDuel. */
  players: FindPlayer[];
  result: FindLevelOver | null;
}

/** What a player or the host can do in a tap level. */
export type FindAction =
  | { type: 'start' }
  /** [D65] The app left the foreground. */
  | { type: 'pause' }
  /** [D65] Back, after the 3, 2, 1 over the covered board. */
  | { type: 'resume' }
  | { type: 'tap'; playerId: PlayerId; cell: CellIndex }
  /** The X, confirmed: the level ends 'quit' (allowed while frozen too: leaving is always possible). */
  | { type: 'quit'; playerId: PlayerId }
  /** Only while FindRules.reactions lists any (none by default, D62). */
  | { type: 'react'; playerId: PlayerId; emoji: string };

export interface FindTransition {
  state: FindState;
  events: LevelEvent[];
}

export interface FindActionResult extends FindTransition {
  /** Set when the action was refused; `events` then holds only the timers that ran before it. */
  rejected?: RejectReason;
}

/** find: the second wrong tap ends the level (plan §2.1). */
const FIND_MISSES = 2;
/** findDuel: the second wrong tap on a spot keeps the tapper out of it (plan §2.2). */
const SPOT_MISSES = 2;

// ---------------------------------------------------------------------------------------------------------
// Creating a level

/** A tap level's attempt, before the bot's plan is drawn. */
export interface FindSetup {
  /** The attempt's id (the session's). */
  id: string;
  /** The level as played: attemptLevel(spec, attempt) [D63]. */
  spec: AppLevel;
  /** The player on this phone. */
  player: PlayerInfo;
  /** findDuel's opponent; botPlayer(spec.bot.level) by default. */
  bot?: PlayerInfo;
}

export interface FindDeps {
  clock: Clock;
  /** 1 for the first attempt. */
  attempt: number;
  /**
   * Draws the bot's plan. By default the level's own, from its seed and the attempt (findBotRng), so the first
   * attempt always meets the same bot and "שוב" draws again; the builder's simulation passes its own.
   */
  rng?: Rng;
  rules?: LevelRules;
  /** Only for a level that lacks its frozen search ranges and shares; and the race's freeze (3 s). */
  botConfig?: BotConfig;
  /** The reactions I may send: none by default [D62]; LEVEL_UI.reactions brings them back. */
  reactions?: readonly string[];
}

/** The bot's own random stream for an attempt: the level's seed, its id, rev and the attempt. */
export const findBotRng = (spec: Pick<AppLevel, 'id' | 'rev' | 'seed'>, attempt: number): Rng =>
  createRng(seedFromString(`${spec.id}:r${spec.rev}:a${attempt}`, spec.seed));

/** The targets of a tap level, in the order they are shown (none in spotError). */
export function tapTargetsOf(spec: AppLevel): readonly FindTarget[] {
  if (spec.kind === 'find') return [spec.targets.target];
  if (spec.kind === 'findDuel') return spec.targets.spots;
  return [];
}

/**
 * The bot's plan for each spot of a findDuel level (plan §2.2): its search time within the spot's frozen range
 * (spec.bot.findMs; findMsRange of BOT_CONFIG.find only for a level without it), a wrong tap first in
 * spec.bot.missShare of the spots (on a plausible cell, at 30–80% of its search; it costs it the freeze), and
 * whether it reacts to my wrong tap (spec.bot.reactShare). The spots after one are drawn as if it was taken.
 */
export function drawBotPlan(
  spec: LevelSpecOf<'findDuel'>,
  rng: Rng,
  config: BotConfig = BOT_CONFIG,
): BotSpotPlan[] {
  const bot = spec.bot;
  if (!bot) throw new RangeError(`Level ${spec.id} has no bot`);
  const grid = parseGrid(spec.board.grid);
  return spec.targets.spots.map((spot, k): BotSpotPlan => {
    const [min, max] = bot.findMs?.[k] ?? findMsRange(bot.level, spot.tier, bot.pace, config);
    if (!(min >= 0 && max >= min)) throw new RangeError(`Level ${spec.id}: spot ${k} has no search range`);
    const tapAtMs = Math.round(min + rng.next() * (max - min));
    let miss: BotSpotPlan['miss'] = null;
    if (rng.next() < (bot.missShare ?? config.find.missShare[bot.level])) {
      const cell = chooseWrongTap(grid, spot, rng);
      const share = BOT_MISS_AT.min + rng.next() * (BOT_MISS_AT.max - BOT_MISS_AT.min);
      if (cell !== null) miss = { atMs: Math.round(tapAtMs * share), cell };
    }
    const react = rng.next() < (bot.reactShare ?? config.find.reactShare[bot.level]);
    for (const c of spot.accept) grid[c] = spot.digit;
    return { tapAtMs, miss, react };
  });
}

function checkTarget(spec: AppLevel, t: FindTarget, givens: readonly number[], where: string): void {
  if (!t.accept.length) throw new RangeError(`${where}: a target needs a cell`);
  for (const c of t.accept)
    if (!isCellIndex(c) || givens[c] !== 0 || Number(spec.board.solution[c]) !== t.digit)
      throw new RangeError(`${where}: ${c} is not an empty cell of ${t.digit}`);
  if (t.cell !== null && !t.accept.includes(t.cell))
    throw new RangeError(`${where}: its cell is not accepted`);
}

function checkSpec(spec: AppLevel): void {
  if (!isTapKind(spec.kind)) throw new RangeError(`A ${spec.kind} level is played by the game engine`);
  if (spec.board.grid.length !== CELL_COUNT || spec.board.solution.length !== CELL_COUNT)
    throw new RangeError('A level needs 81 givens and an 81-cell solution');
  if (!(Number.isFinite(spec.timeLimitMs) && spec.timeLimitMs > 0))
    throw new RangeError('timeLimitMs must be positive');
  const givens = parseGrid(spec.board.grid);
  if (spec.kind === 'find') checkTarget(spec, spec.targets.target, givens, spec.id);
  if (spec.kind === 'findDuel') {
    if (!spec.targets.spots.length) throw new RangeError(`${spec.id}: a race needs spots`);
    spec.targets.spots.forEach((t, k) => checkTarget(spec, t, givens, `${spec.id} spot ${k}`));
    if (!spec.bot) throw new RangeError(`Level ${spec.id} has no bot`);
  }
  if (spec.kind === 'spotError') {
    const mine = spec.board.mine;
    if (mine === undefined || mine.length !== CELL_COUNT)
      throw new RangeError(`${spec.id}: no "mine" digits`);
    if (!spec.targets.errors.length) throw new RangeError(`${spec.id}: no planted error`);
    for (const e of spec.targets.errors)
      if (
        givens[e.cell] !== 0 ||
        Number(mine[e.cell]) !== e.digit ||
        Number(spec.board.solution[e.cell]) === e.digit
      )
        throw new RangeError(`${spec.id}: ${e.cell} is not a planted error`);
  }
}

/** The config of an attempt: the level as played, its players, its rules now, and the bot's plan drawn. */
export function createFindConfig(setup: FindSetup, deps: Omit<FindDeps, 'clock'>): FindConfig {
  const { spec } = setup;
  checkSpec(spec);
  if (!(Number.isInteger(deps.attempt) && deps.attempt >= 1)) throw new RangeError('An attempt is 1 or more');
  const config = deps.botConfig ?? BOT_CONFIG;
  const levelRules = deps.rules ?? LEVEL_RULES;
  let players = [setup.player];
  let botPlan: BotSpotPlan[] | null = null;
  let botReaction: string | null = null;
  if (spec.kind === 'findDuel') {
    const level = spec.bot!.level;
    const bot = setup.bot ?? botPlayer(level);
    if (bot.id === setup.player.id) throw new RangeError('Player ids must be unique');
    players = [setup.player, { ...bot, isBot: true }];
    botPlan = drawBotPlan(spec, deps.rng ?? findBotRng(spec, deps.attempt), config);
    botReaction = botLevel(level, config).reactions.opponentMistake?.emoji ?? null;
  }
  const rules: FindRules = {
    penaltyMs: LEVEL_PENALTY_MS,
    freezeMs: config.find.wrongFreezeMs,
    tapOnFilled: levelRules.tapOnFilled,
    reactions: deps.reactions ?? [],
    botReaction,
    reactAfterMs: config.find.reactAfterMs,
  };
  return { id: setup.id, level: levelRunOf(spec, deps.attempt), spec, players, botPlan, rules };
}

export function createFind(setup: FindSetup, deps: FindDeps): FindTransition {
  const config = createFindConfig(setup, deps);
  const event: LevelEvent = { type: 'levelCreated', config, seq: 1, t: deps.clock.now() };
  return { state: evolveFind(null, event), events: [event] };
}

// ---------------------------------------------------------------------------------------------------------
// The reducer

function initialFindState(config: FindConfig, createdAt: number): FindState {
  const spec = config.spec;
  const givens = parseGrid(spec.board.grid);
  const mine = spec.kind === 'spotError' && spec.board.mine !== undefined ? parseGrid(spec.board.mine) : null;
  const grid = givens.map((v, i) => (v !== 0 ? v : (mine?.[i] ?? 0)));
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
    grid,
    givens: givens.map((v) => v !== 0),
    owner: grid.map((v, i) => (givens[i] === 0 && v !== 0 ? 0 : null)),
    spot: 0,
    spots: tapTargetsOf(spec).map((): LevelSpotView => ({ state: 'waiting' })),
    found: [],
    bot: null,
    reactAt: null,
    players: config.players.map((p, seat): FindPlayer => ({
      id: p.id,
      seat,
      isBot: p.isBot === true,
      spots: 0,
      wrongTaps: 0,
      spotMisses: 0,
      frozenUntil: null,
      out: false,
      lastReactionAt: null,
    })),
    result: null,
  };
}

function draft(s: FindState): FindState {
  return {
    ...s,
    grid: s.grid.slice(),
    owner: s.owner.slice(),
    spots: s.spots.slice(),
    found: s.found.slice(),
    bot: s.bot && { ...s.bot },
    players: s.players.map((p) => ({ ...p })),
  };
}

function player(s: FindState, id: PlayerId): FindPlayer {
  const p = s.players.find((q) => q.id === id);
  if (!p) throw new Error(`Event for an unknown player: ${id}`);
  return p;
}

const botOf = (s: FindState): FindPlayer | undefined => s.players.find((p) => p.isBot);

/**
 * The bot's taps on spot `index`, shown at `shownAt`, by its plan: the wrong one (not before its own freeze ends)
 * and the right one, the freeze later after a miss.
 */
function botDuesOf(s: FindState, index: number, shownAt: number): FindState['bot'] {
  const plan = s.config.botPlan?.[index];
  const bot = botOf(s);
  if (!plan || !bot) return null;
  const ready = Math.max(shownAt, bot.frozenUntil ?? shownAt);
  if (!plan.miss) return { missAt: null, tapAt: Math.max(shownAt + plan.tapAtMs, ready) };
  const missAt = Math.max(shownAt + plan.miss.atMs, ready);
  return { missAt, tapAt: Math.max(shownAt + plan.tapAtMs, missAt) + s.config.rules.freezeMs };
}

export function evolveFind(state: FindState | null, e: LevelEvent): FindState {
  if (e.type === 'levelCreated') {
    if (state) throw new Error('levelCreated in the middle of a level');
    if (e.seq !== 1) throw new Error(`levelCreated must be seq 1, got ${e.seq}`);
    return initialFindState(e.config, e.t);
  }
  if (!state) throw new Error(`The first event must be levelCreated, got ${e.type}`);
  if (e.seq !== state.seq + 1) throw new Error(`Event seq ${e.seq} after ${state.seq}`);
  const s = draft(state);
  s.seq = e.seq;
  s.lastEventAt = Math.max(s.lastEventAt, e.t);
  const { spec, rules } = s.config;

  switch (e.type) {
    case 'levelStarted':
      s.status = 'running';
      s.startedAt = e.t;
      s.endsAt = e.t + spec.timeLimitMs;
      break;

    case 'targetShown':
      s.spot = e.index;
      s.spots[e.index] = { state: 'open' };
      for (const p of s.players) {
        p.spotMisses = 0;
        p.out = false;
      }
      s.bot = botDuesOf(s, e.index, e.t);
      break;

    case 'tapped': {
      const p = player(s, e.playerId);
      if (e.right) {
        // spotError: the error is found, and its right digit shows. (find, findDuel: spotWon takes the cell.)
        if (spec.kind === 'spotError') {
          s.found.push(e.cell);
          s.grid[e.cell] = Number(spec.board.solution[e.cell]);
          p.spots++;
        }
        break;
      }
      const first = p.spotMisses === 0;
      p.wrongTaps++;
      p.spotMisses++;
      if (e.penaltyMs !== undefined) {
        if (!p.isBot) s.penaltyMs += e.penaltyMs;
        if (s.endsAt !== null) s.endsAt -= e.penaltyMs;
      }
      if (e.frozenUntil !== undefined) p.frozenUntil = e.frozenUntil;
      if (spec.kind === 'findDuel' && p.spotMisses >= SPOT_MISSES) p.out = true;
      if (p.isBot) {
        if (s.bot) s.bot.missAt = null;
      } else if (
        first &&
        rules.botReaction !== null &&
        s.reactAt === null &&
        s.config.botPlan?.[s.spot]?.react === true
      ) {
        // The bot laughs at my first wrong tap on a spot, when its plan says so (spec §9).
        s.reactAt = e.t + rules.reactAfterMs;
      }
      break;
    }

    case 'spotWon': {
      const p = player(s, e.playerId);
      s.spots[e.index] = { state: 'won', playerId: e.playerId, cell: e.cell };
      s.grid[e.cell] = tapTargetsOf(spec)[e.index]!.digit;
      s.owner[e.cell] = p.seat;
      p.spots++;
      s.bot = null;
      break;
    }

    case 'spotVoid':
      s.spots[e.index] = { state: 'void' };
      s.bot = null;
      break;

    case 'reacted': {
      const p = player(s, e.playerId);
      p.lastReactionAt = e.t;
      if (p.isBot) s.reactAt = null;
      break;
    }

    case 'levelPaused':
      s.status = 'paused';
      s.pausedAt = e.t;
      break;

    case 'levelResumed': {
      // Everything that stood still moves on by the length of the pause.
      const d = e.pausedMs;
      const pausedAt = s.pausedAt ?? e.t - d;
      s.status = 'running';
      s.pausedAt = null;
      if (s.endsAt !== null) s.endsAt += d;
      for (const p of s.players) if (p.frozenUntil !== null && p.frozenUntil > pausedAt) p.frozenUntil += d;
      if (s.bot)
        s.bot = {
          missAt: s.bot.missAt === null ? null : s.bot.missAt + d,
          tapAt: s.bot.tapAt === null ? null : s.bot.tapAt + d,
        };
      if (s.reactAt !== null) s.reactAt += d;
      break;
    }

    case 'levelOver': {
      const { type: _type, seq: _seq, t: _t, ...over } = e;
      // Ended while frozen (a quit before the resume): the level clock stopped at the freeze.
      if (s.status === 'paused' && s.pausedAt !== null && s.endsAt !== null) s.endsAt += e.t - s.pausedAt;
      s.status = 'over';
      s.endedAt = e.t;
      s.pausedAt = null;
      s.bot = null;
      s.reactAt = null;
      s.result = over;
      break;
    }
  }
  return s;
}

/** The state at the end of a log (every state is evolveFind's: replay is exact, and needs no RNG). */
export function replayFind(events: readonly LevelEvent[]): FindState {
  let state: FindState | null = null;
  for (const e of events) state = evolveFind(state, e);
  if (!state) throw new Error('An empty log');
  return state;
}

// ---------------------------------------------------------------------------------------------------------
// The machine

/** Emits events one by one; each is applied at once, so later checks see its effect. */
class Tx {
  readonly events: LevelEvent[] = [];
  constructor(public state: FindState) {}

  emit(body: NewLevelEvent, t: number): void {
    const event: LevelEvent = { ...body, seq: this.state.seq + 1, t };
    this.state = evolveFind(this.state, event);
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

const playerOf = (s: FindState, id: PlayerId): FindPlayer | undefined => s.players.find((p) => p.id === id);
const human = (s: FindState): FindPlayer => s.players.find((p) => !p.isBot) ?? s.players[0]!;

/** The level clock at `at`: the time played plus the penalties; it stands still in a freeze. */
function elapsedAt(s: FindState, at: number): number {
  if (s.startedAt === null || s.endsAt === null) return 0;
  const limit = s.config.spec.timeLimitMs;
  const t = s.status === 'paused' && s.pausedAt !== null ? s.pausedAt : at;
  return Math.min(limit, Math.max(0, limit - (s.endsAt - t)));
}

function endLevel(tx: Tx, reason: FindEndReason, at: number): void {
  const s = tx.state;
  const me = human(s);
  // A race's bot: its spots go with the end, so levelOutcome().bossBeaten reads mine against its own (1.0.3).
  const bot = s.config.spec.kind === 'findDuel' ? s.players.find((p) => p.isBot) : undefined;
  const over: FindLevelOver = {
    reason,
    elapsedMs: elapsedAt(s, at),
    penaltyMs: s.penaltyMs,
    spots: me.spots,
    ...(bot ? { opponentSpots: bot.spots } : {}),
    found: s.found.length,
    stars: 0,
  };
  // The stars are levelOutcome's, so either host's end reads the same (progress.ts).
  tx.emit({ type: 'levelOver', ...over, stars: levelOutcome(s.config.spec, over).stars }, at);
}

/** The next spot of a race, or the end once every spot is decided. */
function nextSpot(tx: Tx, at: number): void {
  const next = tx.state.spot + 1;
  if (next >= tx.state.spots.length) return endLevel(tx, 'targetReached', at);
  showTarget(tx, next, at);
}

function showTarget(tx: Tx, index: number, at: number): void {
  const dues = botDuesOf(tx.state, index, at);
  tx.emit({ type: 'targetShown', index, botTapAt: dues?.tapAt ?? null }, at);
}

/** A tap on the right cell of the current target (or on a planted error). */
function rightTap(tx: Tx, p: FindPlayer, cell: CellIndex, at: number): void {
  const kind = tx.state.config.spec.kind;
  tx.emit({ type: 'tapped', playerId: p.id, cell, right: true }, at);
  if (kind === 'spotError') {
    const s = tx.state;
    if (s.config.spec.kind === 'spotError' && s.found.length >= s.config.spec.targets.errors.length)
      endLevel(tx, 'targetReached', at);
    return;
  }
  tx.emit({ type: 'spotWon', index: tx.state.spot, playerId: p.id, cell }, at);
  if (kind === 'find') return endLevel(tx, 'targetReached', at);
  nextSpot(tx, at);
}

/**
 * A wrong tap: in find and spotError it costs time (a penalty that reaches the limit ends the level at once, and
 * find's second ends it anyway); in the race it freezes the tapper, and the spot goes to nobody once everyone is
 * out of it.
 */
function wrongTap(tx: Tx, p: FindPlayer, cell: CellIndex, at: number): void {
  const { spec, rules } = tx.state.config;
  if (spec.kind !== 'findDuel') {
    tx.emit({ type: 'tapped', playerId: p.id, cell, right: false, penaltyMs: rules.penaltyMs }, at);
    const s = tx.state;
    if (spec.kind === 'find' && player(s, p.id).wrongTaps >= FIND_MISSES)
      return endLevel(tx, 'tooManyMisses', at);
    if (s.endsAt !== null && s.endsAt <= at) endLevel(tx, 'timeUp', at);
    return;
  }
  tx.emit({ type: 'tapped', playerId: p.id, cell, right: false, frozenUntil: at + rules.freezeMs }, at);
  if (tx.state.players.every((q) => q.out)) {
    tx.emit({ type: 'spotVoid', index: tx.state.spot }, at);
    nextSpot(tx, at);
  }
}

function tap(tx: Tx, p: FindPlayer, cell: CellIndex, at: number): void {
  const s = tx.state;
  const { spec, rules } = s.config;
  const filled = () => (rules.tapOnFilled === 'ignore' ? reject('cellFilled') : wrongTap(tx, p, cell, at));
  if (spec.kind === 'spotError') {
    if (s.found.includes(cell)) reject('cellFilled'); // found already: nothing more to find there
    if (spec.targets.errors.some((e) => e.cell === cell)) return rightTap(tx, p, cell, at);
    if (s.givens[cell]) return filled();
    if (s.grid[cell] === 0) reject('badCell'); // no digit there to be wrong
    return wrongTap(tx, p, cell, at); // a right digit of mine
  }
  if (s.spots[s.spot]?.state !== 'open') reject('badAction');
  if (s.grid[cell] !== 0) return filled();
  return tapTargetsOf(spec)[s.spot]!.accept.includes(cell)
    ? rightTap(tx, p, cell, at)
    : wrongTap(tx, p, cell, at);
}

function decide(tx: Tx, action: FindAction, now: number): void {
  const s = tx.state;
  const live = (): void => {
    if (s.status === 'over') reject('gameOver');
    if (s.status === 'waiting') reject('notStarted');
  };
  switch (action.type) {
    case 'start':
      if (s.status !== 'waiting') reject(s.status === 'over' ? 'gameOver' : 'alreadyStarted');
      tx.emit({ type: 'levelStarted' }, now);
      if (s.spots.length) showTarget(tx, 0, now);
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

    case 'quit': {
      live();
      const p = playerOf(s, action.playerId) ?? reject('unknownPlayer');
      if (p.isBot) reject('badAction');
      endLevel(tx, 'quit', now);
      return;
    }

    case 'react': {
      live();
      if (s.status === 'paused') reject('paused');
      const p = playerOf(s, action.playerId) ?? reject('unknownPlayer');
      const allowed = s.config.rules.reactions;
      if (!allowed.length) reject('badAction'); // no reactions button in a level [D62]
      if (!allowed.includes(action.emoji)) reject('badEmoji');
      const cooldown = defaultRules('solo', s.config.spec.gameType).reactionCooldownMs;
      if (p.lastReactionAt !== null && now - p.lastReactionAt < cooldown) reject('tooSoon');
      tx.emit({ type: 'reacted', playerId: p.id, emoji: action.emoji }, now);
      return;
    }

    case 'tap': {
      live();
      if (s.status === 'paused') reject('paused');
      const p = playerOf(s, action.playerId) ?? reject('unknownPlayer');
      if (!isCellIndex(action.cell)) reject('badCell');
      if (p.out || (p.frozenUntil !== null && now < p.frozenUntil)) reject('frozen');
      tap(tx, p, action.cell, now);
      return;
    }

    default:
      reject('badAction');
  }
}

// ---------------------------------------------------------------------------------------------------------
// Timers

type FindDue =
  | { kind: 'timeUp'; at: number }
  | { kind: 'botReact'; at: number }
  | { kind: 'botMiss'; at: number }
  | { kind: 'botTap'; at: number };

/** At one instant: the time limit first (a tap at the deadline itself is too late), then the bot. */
const DUE_ORDER: Record<FindDue['kind'], number> = { timeUp: 0, botReact: 1, botMiss: 2, botTap: 3 };

function nextDue(s: FindState): FindDue | null {
  if (s.status !== 'running') return null;
  const due: FindDue[] = [];
  if (s.endsAt !== null) due.push({ kind: 'timeUp', at: s.endsAt });
  if (s.reactAt !== null) due.push({ kind: 'botReact', at: s.reactAt });
  if (s.bot?.missAt != null) due.push({ kind: 'botMiss', at: s.bot.missAt });
  if (s.bot?.tapAt != null) due.push({ kind: 'botTap', at: s.bot.tapAt });
  due.sort((a, b) => a.at - b.at || DUE_ORDER[a.kind] - DUE_ORDER[b.kind]);
  return due[0] ?? null;
}

function handleDue(tx: Tx, due: FindDue): void {
  const s = tx.state;
  const at = due.at;
  // Only a race has the bot's timers.
  const bot = (): FindPlayer => {
    const b = botOf(s);
    if (!b) throw new Error(`A bot's ${due.kind} in a level without a bot`);
    return b;
  };
  switch (due.kind) {
    case 'timeUp':
      // The race: the open spot goes to nobody.
      if (s.config.spec.kind === 'findDuel' && s.spots[s.spot]?.state === 'open')
        tx.emit({ type: 'spotVoid', index: s.spot }, at);
      endLevel(tx, 'timeUp', at);
      return;
    case 'botReact':
      tx.emit({ type: 'reacted', playerId: bot().id, emoji: s.config.rules.botReaction ?? '😂' }, at);
      return;
    case 'botMiss': {
      const cell = s.config.botPlan?.[s.spot]?.miss?.cell;
      if (cell === undefined) throw new Error(`No planned miss on spot ${s.spot}`);
      const frozenUntil = at + s.config.rules.freezeMs;
      tx.emit({ type: 'tapped', playerId: bot().id, cell, right: false, frozenUntil }, at);
      return;
    }
    case 'botTap': {
      const target = tapTargetsOf(s.config.spec)[s.spot]!;
      const cell = target.cell ?? target.accept.find((c) => s.grid[c] === 0) ?? target.accept[0]!;
      rightTap(tx, bot(), cell, at);
      return;
    }
  }
}

/**
 * Runs every timer due by `now`, in time order. Before a player's action (`beforePlayer`) the bot's timers of
 * that very ms wait: the same ms is the player's (plan §2.2), while the time limit still comes first.
 */
function runDues(tx: Tx, now: number, beforePlayer: boolean): void {
  let lastAt = Number.NEGATIVE_INFINITY;
  let sameInstant = 0;
  for (;;) {
    const due = nextDue(tx.state);
    if (!due || due.at > now) return;
    if (beforePlayer && due.kind !== 'timeUp' && due.at === now) return;
    sameInstant = due.at === lastAt ? sameInstant + 1 : 0;
    lastAt = due.at;
    if (sameInstant > 100) throw new Error(`Timers did not settle at ${due.at}`);
    const seq = tx.state.seq;
    handleDue(tx, due);
    if (tx.state.seq === seq) throw new Error(`A due ${due.kind} at ${due.at} changed nothing`);
  }
}

export function applyFind(state: FindState, action: FindAction, now: number): FindActionResult {
  const t = Math.max(now, state.lastEventAt);
  const tx = new Tx(state);
  runDues(tx, t, action.type === 'tap' || action.type === 'quit' || action.type === 'react');
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

export function tickFind(state: FindState, now: number): FindTransition {
  const tx = new Tx(state);
  runDues(tx, Math.max(now, state.lastEventAt), false);
  return { state: tx.state, events: tx.events };
}

/** The earliest time at which tickFind has something to do, or null. */
export function nextFindDeadline(state: FindState): number | null {
  return nextDue(state)?.at ?? null;
}

// ---------------------------------------------------------------------------------------------------------
// The view

/** After the end: where the target was (find), the errors not found (spotError). */
function answerOf(s: FindState): readonly CellIndex[] | undefined {
  const spec = s.config.spec;
  if (spec.kind === 'find') return spec.targets.target.accept.slice();
  if (spec.kind === 'spotError')
    return spec.targets.errors.map((e) => e.cell).filter((c) => !s.found.includes(c));
  return undefined;
}

function levelViewOfFind(s: FindState, me: FindPlayer | null, now: number): LevelView {
  const { spec, level: run } = s.config;
  const over = s.status === 'over';
  const at = over ? (s.endedAt ?? now) : now;
  const elapsedMs = elapsedAt(s, at);
  const limitMs = spec.timeLimitMs;
  const stars: Stars = over
    ? (s.result?.stars ?? 0)
    : starsFor(spec.stars, spec.stars.by === 'spots' ? (me?.spots ?? 0) : elapsedMs);
  const target = tapTargetsOf(spec)[s.spot] ?? null;
  const standstill = s.status === 'paused' && s.pausedAt !== null ? s.pausedAt : at;
  const frozenUntil = !over && me?.frozenUntil != null && me.frozenUntil > standstill ? me.frozenUntil : null;
  const answer = over ? answerOf(s) : undefined;
  const find: LevelFindView = {
    digit: target?.digit ?? null,
    scope: target ? { ...target.scope } : null,
    spotIndex: s.spot,
    spots: s.spots.map((v) => ({ ...v })),
    frozenUntil,
    wrongTaps: me?.wrongTaps ?? 0,
    found: s.found.slice(),
    out: !over && (me?.out ?? false),
    ...(answer ? { answer } : null),
    ...(over && s.result ? { over: { ...s.result } } : null),
  };
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
    progress: null,
    lockTimer: false,
    find,
  };
}

/**
 * The picture of a tap level for a player's screen, as a GameView (the GameHost interface): the board with the
 * spots taken (a seat's colour and shape on each), no keypad, no lock, no interference, and level.find. A
 * player's score is the spots he took (findDuel), or the errors found. `result` stays null: the end is
 * level.find.over (levelOutcome reads it).
 */
export function findView(state: FindState, viewer: PlayerId | null, now: number): GameView {
  const { config } = state;
  const spec = config.spec;
  const mode = levelModeFor(spec);
  const rules = defaultRules(mode, spec.gameType, levelRulesFor(spec));
  const me = state.players.find((p) => p.id === viewer) ?? null;
  const placeOf = (p: FindPlayer) => 1 + state.players.filter((q) => q.spots > p.spots).length;
  const players = state.players.map((p): PlayerView => {
    const info = config.players[p.seat]!;
    const place = placeOf(p);
    return {
      id: p.id,
      seat: p.seat,
      name: info.name ?? null,
      isBot: p.isBot,
      rating: null,
      status: 'active',
      connected: true,
      graceEndsAt: null,
      softEndsAt: null,
      score: p.spots,
      mistakes: p.wrongTaps,
      mistakePenalties: [],
      correct: p.spots,
      place,
      isLeader: state.players.length > 1 && place === 1,
      lock: null,
      hitBy: null,
      immuneUntil: 0,
      bestMove: null,
    };
  });
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
      reactions: config.rules.reactions,
      reactionCooldownMs: rules.reactionCooldownMs,
    },
    grid: state.grid.slice(),
    givens: state.givens.slice(),
    owner: state.owner.slice(),
    wrong: Array.from({ length: CELL_COUNT }, () => []),
    players,
    turn: null,
    me: me?.id ?? null,
    keypad: {
      remaining: DIGITS.map((d: Digit) => 9 - digitCount(state.grid, d)),
      disabled: [],
      enabled: false,
    },
    cooldowns: [],
    interference: null,
    reactionReadyAt: me?.lastReactionAt != null ? me.lastReactionAt + rules.reactionCooldownMs : 0,
    leaveGuards: null,
    result: null,
    solution: state.status === 'over' ? spec.board.solution : null,
    level: levelViewOfFind(state, me, now),
  };
}
