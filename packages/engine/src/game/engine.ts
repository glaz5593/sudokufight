import { CELL_COUNT, type CellIndex, type Digit, digitCount, isCellIndex, isDigit } from '../sudoku/board';
import { missedPoints, moveScore } from '../sudoku/scoring';
import type { Clock } from '../util/clock';
import type { Rng } from '../util/random';
import { evolve, isSoftOffline } from './evolve';
import { gameResult } from './results';
import type { ReleaseReason } from './rules';
import type {
  Action,
  EndReason,
  GameConfig,
  GameEvent,
  GameState,
  Lock,
  LockTimer,
  NewEvent,
  PlayerAction,
  PlayerId,
  PlayerState,
  RejectReason,
} from './types';

/**
 * The game's state machine (spec §6–§8, §16.2). Deterministic: the clock and the RNG are injected (spec §6).
 *
 *   createGame(config, { clock, rng })  → the first state and the gameCreated event
 *   applyAction(state, action, now)     → { state, events } (a new state; the old one is untouched)
 *                                         or { state, events, rejected }
 *   tick(state, now)                    → { state, events } for timers that are due (locks, interferences,
 *                                         the soft phase, grace)
 *   nextDeadline(state)                 → when tick next has something to do, so a host needs one timer
 *   abandonmentAt(state, playerId)      → when an away player abandons if not back (a seat is held that long)
 *
 * `now` is the injected clock's reading. applyAction first runs the timers that are due, so events always
 * come out in time order, and time never runs backwards: a `now` earlier than the last event counts as that
 * event's time. Every change goes through an event and the reducer (./evolve), which makes replay exact.
 *
 * A lost connection [D42] (spec §16.2): `disconnect` with `soft` starts a soft phase of rules.softGraceMs
 * (playerConnectionLost): the player is marked, and nothing else changes (no freeze, no release, every timer
 * runs, interferences at him are refused). Back in time: playerReconnected, and the game never stopped. Not
 * back: at softEndsAt the hard phase starts, exactly as a disconnect did before (playerDisconnected with the
 * grace of [D4], a freeze or a release). Moves he made on his phone meanwhile arrive after the return as
 * `offlineMove`, each decided on the board as it is when it arrives.
 */

export interface Transition {
  state: GameState;
  events: GameEvent[];
}

export interface ActionResult extends Transition {
  /** Set when the action was refused; `events` then holds only timers that ran before it. */
  rejected?: RejectReason;
}

/** Emits events one by one; each is applied at once, so later checks see its effect. */
class Tx {
  readonly events: GameEvent[] = [];
  constructor(public state: GameState) {}

  emit(body: NewEvent, t: number): GameEvent {
    const event: GameEvent = { ...body, seq: this.state.seq + 1, t };
    this.state = evolve(this.state, event);
    this.events.push(event);
    return event;
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

// ---------------------------------------------------------------------------------------------------------

export interface GameDeps {
  clock: Clock;
  /** Draws the game's seed when the config has none. */
  rng?: Rng;
}

/** `deps` may also be a plain time, for tests and replays. */
export function createGame(config: GameConfig, deps: GameDeps | number): Transition {
  if (!config.players.length || config.players.length > 4) throw new RangeError('A game has 1–4 players');
  if (new Set(config.players.map((p) => p.id)).size !== config.players.length)
    throw new RangeError('Player ids must be unique');
  if (config.puzzle.givens.length !== CELL_COUNT || config.puzzle.solution.length !== CELL_COUNT)
    throw new RangeError('The puzzle needs 81 givens and an 81-cell solution');
  const { thinkTimeMs, turnPickMs, interferenceMs } = config.rules;
  if (!(thinkTimeMs > 0 && turnPickMs > 0 && interferenceMs > 0))
    throw new RangeError('Think time, turn time and interference time must be positive');
  const now = typeof deps === 'number' ? deps : deps.clock.now();
  const rng = typeof deps === 'number' ? undefined : deps.rng;
  const withSeed: GameConfig =
    config.seed === undefined && rng ? { ...config, seed: Math.floor(rng.next() * 2 ** 31) } : config;
  const event: GameEvent = { type: 'gameCreated', config: withSeed, seq: 1, t: now };
  return { state: evolve(null, event), events: [event] };
}

export function applyAction(state: GameState, action: Action, now: number): ActionResult {
  const t = Math.max(now, state.lastEventAt);
  const tx = new Tx(state);
  runTimers(tx, t);
  const afterTimers = { state: tx.state, events: tx.events.slice() };
  try {
    decide(tx, action, t);
  } catch (e) {
    if (!(e instanceof Rejection)) throw e;
    // Every check comes before the first emit, so a refused action leaves no trace.
    return { ...afterTimers, rejected: e.reason };
  }
  return { state: tx.state, events: tx.events };
}

export function tick(state: GameState, now: number): Transition {
  const tx = new Tx(state);
  runTimers(tx, Math.max(now, state.lastEventAt));
  return { state: tx.state, events: tx.events };
}

/** The earliest time at which tick() has something to do, or null. */
export function nextDeadline(state: GameState): number | null {
  return nextDue(state)?.at ?? null;
}

/**
 * When `playerId`, away now, abandons the game if he is not back (spec §16.2) [D4, D42]: the end of his grace,
 * or, in the soft phase, the end of the grace that will follow it. Null when he is not away, or nothing runs.
 */
export function abandonmentAt(state: GameState, playerId: PlayerId): number | null {
  if (state.status !== 'running' && state.status !== 'paused') return null;
  const p = playerOf(state, playerId);
  if (!p || p.status !== 'active') return null;
  if (p.graceEndsAt !== null) return p.graceEndsAt;
  if (isSoftOffline(p)) return p.softEndsAt! + state.config.rules.graceMs;
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Helpers

const playerOf = (s: GameState, id: PlayerId): PlayerState | undefined => s.players.find((p) => p.id === id);
const lockOf = (s: GameState, id: PlayerId) => s.locks.find((l) => l.playerId === id);
const inGame = (s: GameState) => s.players.filter((p) => p.status === 'active');
const isPractice = (s: GameState) => s.config.mode !== 'ranked';
const isBot = (s: GameState, p: PlayerState) => s.config.players[p.seat]?.isBot === true;

/**
 * What a wrong digit in `cell` costs (spec §6.5, Moshe's decision of 2026-10-15): the points the right digit
 * would score there on the board as it is now (wrong marks are never on the grid, so `s.grid` is the board
 * before the entry), with the game's Y rule [D13]. The same for every mode and every mistake number.
 */
function wrongDigitPenalty(s: GameState, cell: CellIndex): number {
  const right = Number(s.config.puzzle.solution[cell]);
  if (!isDigit(right)) throw new Error(`No solution digit for cell ${cell}`);
  return missedPoints(s.grid, cell, right, s.config.rules.scoreY).points;
}

/**
 * The next player (in seat order after `after`) who can take a turn: in the game and connected, and not in
 * the soft phase of a lost connection [D42] (he could not play it; a turn he already holds runs out as usual).
 */
function nextTurnPlayer(s: GameState, after: PlayerId | null): PlayerState | undefined {
  const n = s.players.length;
  const from = after === null ? -1 : (playerOf(s, after)?.seat ?? -1);
  for (let k = 1; k <= n; k++) {
    const p = s.players[(from + k + n) % n]!;
    if (p.status === 'active' && p.connected && !isSoftOffline(p)) return p;
  }
  return undefined;
}

/**
 * 'turns' [D1]: the turn goes to the next player who can take it. Nobody can (everyone still in the game is
 * disconnected): the turn is cleared and the first player back gets it. A turn that starts while the game is
 * frozen counts from the freeze, so the resume gives it its full time.
 */
function passTurn(tx: Tx, after: PlayerId | null, at: number): void {
  const s = tx.state;
  const rules = s.config.rules;
  if (rules.turnModel !== 'turns' || s.status === 'over') return;
  const next = nextTurnPlayer(s, after);
  if (!next) {
    if (s.turn) tx.emit({ type: 'turnCleared' }, at);
    return;
  }
  const stopped = rules.pauseLockWhileInterfered && next.hitBy !== null;
  const base = s.status === 'paused' && s.pausedAt !== null ? s.pausedAt : at;
  tx.emit(
    {
      type: 'turnStarted',
      playerId: next.id,
      endsAt: stopped ? null : base + rules.turnPickMs,
      remainingMs: rules.turnPickMs,
    },
    at,
  );
}

/**
 * In 'turns', a turn whose holder can't play any more (left, or disconnected in a game that goes on) moves on
 * to the next seat after `after`; with no turn at all, the first player who can take it gets it.
 */
function repairTurn(tx: Tx, after: PlayerId | null, at: number): void {
  const s = tx.state;
  const rules = s.config.rules;
  if (rules.turnModel !== 'turns' || (s.status !== 'running' && s.status !== 'paused')) return;
  const holder = s.turn ? playerOf(s, s.turn.playerId) : undefined;
  // In a freeze a disconnected holder keeps the turn, as locks are kept; only leaving the game moves it.
  if (holder && holder.status === 'active' && (holder.connected || s.status === 'paused')) return;
  passTurn(tx, holder?.id ?? after, at);
}

/**
 * After someone leaves: if only two players are left and one of them is away, the game freezes now, as it
 * would have when they disconnected (spec §16.2) [D4]. A player in the soft phase is not away yet [D42].
 */
function freezeIfNeeded(tx: Tx, at: number): void {
  const s = tx.state;
  if (s.status !== 'running') return;
  const left = inGame(s);
  if (left.length <= s.config.rules.freezeUpToPlayers && left.some((p) => !p.connected))
    tx.emit({ type: 'gamePaused', reason: 'disconnect' }, at);
}

function release(tx: Tx, playerId: PlayerId, reason: ReleaseReason, at: number): void {
  const lock = lockOf(tx.state, playerId);
  if (lock) tx.emit({ type: 'cellReleased', playerId, cell: lock.cell, reason }, at);
}

/** `digit` was already tried wrongly in `cell`, by anyone or by `me`, as the rules say [D12]. */
function digitTried(s: GameState, cell: CellIndex, digit: Digit, me: PlayerId): boolean {
  const rules = s.config.rules;
  return s.wrong[cell]!.some(
    (w) => w.digit === digit && (rules.wrongDigitDisabledFor === 'everyone' || w.playerId === me),
  );
}

/** A new lock for `me` on `cell`, with the full think time; it starts stopped under interference [D11]. */
function lockCell(tx: Tx, me: PlayerState, cell: CellIndex, now: number): void {
  const rules = tx.state.config.rules;
  const stopped = rules.pauseLockWhileInterfered && me.hitBy !== null;
  tx.emit(
    {
      type: 'cellLocked',
      playerId: me.id,
      cell,
      expiresAt: stopped ? null : now + rules.thinkTimeMs,
      remainingMs: rules.thinkTimeMs,
    },
    now,
  );
}

/**
 * `digit` in the cell of `lock`, which `meId` holds, every check done: placedCorrect (the board completes →
 * gameOver) or placedWrong (the penalty of §6.5, and the release of [D3]). The think time is the lock's,
 * or for a move made offline [D42] the one the phone measured (clamped by the caller); the event says
 * `offline: true` then.
 */
function placeDigit(
  tx: Tx,
  meId: PlayerId,
  lock: Lock,
  digit: Digit,
  now: number,
  offline?: { thinkMs: number },
): void {
  const s = tx.state;
  const rules = s.config.rules;
  const me = playerOf(s, meId)!;
  const flag = offline ? { offline: true as const } : {};

  if (Number(s.config.puzzle.solution[lock.cell]) === digit) {
    const breakdown = moveScore(s.grid, lock.cell, digit, rules.scoreY);
    const left = lock.expiresAt === null ? lock.remainingMs : lock.expiresAt - now;
    tx.emit(
      {
        type: 'placedCorrect',
        playerId: me.id,
        cell: lock.cell,
        digit,
        points: breakdown.points,
        breakdown,
        score: me.score + breakdown.points,
        thinkMs: offline ? offline.thinkMs : Math.max(0, rules.thinkTimeMs - left),
        ...flag,
      },
      now,
    );
    if (tx.state.grid.every((v) => v !== 0)) return endGame(tx, 'boardComplete', now);
    if (s.turn?.playerId === me.id) passTurn(tx, me.id, now);
    return;
  }

  const mistakes = me.mistakes + 1;
  const penalty = wrongDigitPenalty(s, lock.cell);
  const score = rules.negativeScore ? me.score - penalty : Math.max(0, me.score - penalty);
  tx.emit(
    { type: 'placedWrong', playerId: me.id, cell: lock.cell, digit, penalty, mistakes, score, ...flag },
    now,
  );
  if (rules.afterMistake === 'release') {
    release(tx, me.id, 'mistake', now);
    if (s.turn?.playerId === me.id) passTurn(tx, me.id, now);
  }
}

function endGame(tx: Tx, reason: EndReason, at: number): void {
  tx.emit({ type: 'gameOver', ...gameResult(tx.state, reason, at) }, at);
}

/**
 * After someone leaves. Practice (solo, or against a bot) ends when the human leaves: "end practice"
 * (spec §6.6). A game with opponents ends when at most one player is left (spec §6.7).
 */
function endIfLastStanding(tx: Tx, leaver: PlayerState, at: number): boolean {
  const s = tx.state;
  if (s.status === 'over') return true;
  if (isPractice(s) && !isBot(s, leaver)) {
    endGame(tx, 'practiceEnded', at);
    return true;
  }
  if (s.players.length > 1 && inGame(s).length <= 1) {
    endGame(tx, 'lastPlayerStanding', at);
    return true;
  }
  return false;
}

/** Resumes a frozen game once nobody still in it is disconnected (the soft phase does not hold it [D42]). */
function resumeIfClear(tx: Tx, reason: 'reconnect' | 'abandon', at: number): void {
  const s = tx.state;
  if (s.status !== 'paused' || s.pausedAt === null) return;
  if (inGame(s).some((p) => !p.connected)) return;
  const pausedMs = at - s.pausedAt;
  const locks: LockTimer[] = s.locks
    .filter((l) => l.expiresAt !== null)
    .map((l) => ({
      playerId: l.playerId,
      cell: l.cell,
      expiresAt: l.expiresAt! + pausedMs,
      remainingMs: Math.max(0, l.expiresAt! - s.pausedAt!),
    }));
  tx.emit({ type: 'gameResumed', reason, pausedMs, locks }, at);
}

// ---------------------------------------------------------------------------------------------------------
// Timers

type Due =
  | { kind: 'interferenceEnd'; at: number; playerId: PlayerId }
  | { kind: 'grace'; at: number; playerId: PlayerId }
  | { kind: 'softEnd'; at: number; playerId: PlayerId }
  | { kind: 'lockExpire'; at: number; playerId: PlayerId }
  | { kind: 'turnExpire'; at: number; playerId: PlayerId };

const DUE_ORDER: Record<Due['kind'], number> = {
  interferenceEnd: 0,
  grace: 1,
  softEnd: 2,
  lockExpire: 3,
  turnExpire: 4,
};

function nextDue(s: GameState): Due | null {
  if (s.status !== 'running' && s.status !== 'paused') return null;
  const due: Due[] = [];
  // The grace and the soft phase are never frozen: they run while the game is paused too.
  for (const p of s.players) {
    if (p.status !== 'active') continue;
    if (!p.connected && p.graceEndsAt !== null)
      due.push({ kind: 'grace', at: p.graceEndsAt, playerId: p.id });
    else if (isSoftOffline(p)) due.push({ kind: 'softEnd', at: p.softEndsAt!, playerId: p.id });
  }
  if (s.status === 'running') {
    for (const p of s.players)
      if (p.hitBy) due.push({ kind: 'interferenceEnd', at: p.hitBy.endsAt, playerId: p.id });
    for (const l of s.locks)
      if (l.expiresAt !== null) due.push({ kind: 'lockExpire', at: l.expiresAt, playerId: l.playerId });
    if (s.turn?.endsAt != null)
      due.push({ kind: 'turnExpire', at: s.turn.endsAt, playerId: s.turn.playerId });
  }
  due.sort((a, b) => a.at - b.at || DUE_ORDER[a.kind] - DUE_ORDER[b.kind]);
  return due[0] ?? null;
}

/**
 * Runs every timer that is due by `now`, in time order. A long catch-up is fine (a phone that slept through
 * hours of unplayed turns); what must never happen is a timer that changes nothing, or endless timers at one
 * instant.
 */
function runTimers(tx: Tx, now: number): void {
  let lastAt = Number.NEGATIVE_INFINITY;
  let sameInstant = 0;
  for (;;) {
    const due = nextDue(tx.state);
    if (!due || due.at > now) return;
    sameInstant = due.at === lastAt ? sameInstant + 1 : 0;
    lastAt = due.at;
    if (sameInstant > 1000) throw new Error(`Timers did not settle at ${due.at}`);
    const seq = tx.state.seq;
    handleDue(tx, due);
    if (tx.state.seq === seq) throw new Error(`A due ${due.kind} at ${due.at} changed nothing`);
  }
}

function handleDue(tx: Tx, due: Due): void {
  const s = tx.state;
  const rules = s.config.rules;
  const at = due.at;
  switch (due.kind) {
    case 'interferenceEnd': {
      const p = playerOf(s, due.playerId)!;
      const lock = lockOf(s, p.id);
      const locks: LockTimer[] =
        lock && lock.expiresAt === null
          ? [
              {
                playerId: p.id,
                cell: lock.cell,
                expiresAt: at + lock.remainingMs,
                remainingMs: lock.remainingMs,
              },
            ]
          : [];
      tx.emit(
        { type: 'interferenceEnded', fromId: p.hitBy!.fromId, targetId: p.id, kind: p.hitBy!.kind, locks },
        at,
      );
      return;
    }
    case 'lockExpire': {
      const lock = lockOf(s, due.playerId)!;
      const p = playerOf(s, due.playerId)!;
      const penalty = rules.timeoutPenalty;
      tx.emit(
        penalty > 0
          ? {
              type: 'cellReleased',
              playerId: p.id,
              cell: lock.cell,
              reason: 'timeout',
              penalty,
              score: rules.negativeScore ? p.score - penalty : Math.max(0, p.score - penalty),
            }
          : { type: 'cellReleased', playerId: p.id, cell: lock.cell, reason: 'timeout' },
        at,
      );
      if (s.turn?.playerId === p.id) passTurn(tx, p.id, at);
      return;
    }
    case 'turnExpire':
      passTurn(tx, due.playerId, at);
      return;
    case 'softEnd':
      // Not back within the soft phase [D42]: the hard phase starts now, its grace counted from now.
      goHard(tx, due.playerId, at);
      return;
    case 'grace': {
      const leaver = playerOf(s, due.playerId)!;
      release(tx, due.playerId, 'abandon', at);
      tx.emit({ type: 'playerAbandoned', playerId: due.playerId }, at);
      if (endIfLastStanding(tx, leaver, at)) return;
      resumeIfClear(tx, 'abandon', at);
      freezeIfNeeded(tx, at);
      repairTurn(tx, leaver.id, at);
      return;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// Actions

const PLAYER_ACTIONS = new Set([
  'select',
  'release',
  'place',
  'interfere',
  'react',
  'surrender',
  'offlineMove',
]);

function decide(tx: Tx, action: Action, now: number): void {
  const s = tx.state;
  if (action.type === 'start') {
    if (s.status !== 'waiting') reject(s.status === 'over' ? 'gameOver' : 'alreadyStarted');
    tx.emit({ type: 'gameStarted' }, now);
    passTurn(tx, null, now);
    return;
  }
  if (action.type !== 'disconnect' && action.type !== 'reconnect' && !PLAYER_ACTIONS.has(action.type))
    reject('badAction');
  if (s.status === 'over') reject('gameOver');
  if (s.status === 'waiting') reject('notStarted');

  if (action.type === 'disconnect' || action.type === 'reconnect') {
    const p = playerOf(s, action.playerId) ?? reject('unknownPlayer');
    if (p.status !== 'active') reject('notActive');
    return action.type === 'disconnect'
      ? disconnect(tx, p, now, action.soft === true)
      : reconnect(tx, p, now);
  }
  playerAction(tx, action, now);
}

/**
 * A connection report. `soft` (the connection dropped) starts the soft phase when the rules have one [D42];
 * otherwise (a deliberate leave) the player is away at once. A deliberate leave during the soft phase
 * hardens it now; a second drop report is refused.
 */
function disconnect(tx: Tx, p: PlayerState, now: number, soft: boolean): void {
  const softGraceMs = tx.state.config.rules.softGraceMs ?? 0;
  if (isSoftOffline(p)) {
    if (soft) reject('alreadyDisconnected');
    return goHard(tx, p.id, now);
  }
  if (!p.connected) reject('alreadyDisconnected');
  if (soft && softGraceMs > 0) {
    // A mark only: no freeze, no release; his lock and every timer run on, and may run out as usual.
    tx.emit({ type: 'playerConnectionLost', playerId: p.id, softEndsAt: now + softGraceMs }, now);
    return;
  }
  goHard(tx, p.id, now);
}

/**
 * The player is away (spec §16.2) [D4]: the grace starts (`at` + graceMs). Two players still in the game: it
 * freezes for both; locks are kept and timers stop. 3–4 players: the game goes on, and his lock is released.
 */
function goHard(tx: Tx, playerId: PlayerId, at: number): void {
  const s = tx.state;
  tx.emit({ type: 'playerDisconnected', playerId, graceEndsAt: at + s.config.rules.graceMs }, at);
  if (inGame(s).length <= s.config.rules.freezeUpToPlayers) {
    if (tx.state.status === 'running') tx.emit({ type: 'gamePaused', reason: 'disconnect' }, at);
    return;
  }
  release(tx, playerId, 'disconnect', at);
  repairTurn(tx, playerId, at);
}

/** Back: from the hard phase (the game resumes if nobody else is away), or from the soft phase [D42]. */
function reconnect(tx: Tx, p: PlayerState, now: number): void {
  if (p.connected && !isSoftOffline(p)) reject('alreadyConnected');
  tx.emit({ type: 'playerReconnected', playerId: p.id }, now);
  resumeIfClear(tx, 'reconnect', now);
  repairTurn(tx, null, now);
}

function playerAction(tx: Tx, action: PlayerAction, now: number): void {
  const s = tx.state;
  const rules = s.config.rules;
  const me = playerOf(s, action.playerId) ?? reject('unknownPlayer');
  if (me.status !== 'active') reject('notActive');
  // Away, hard or soft: a host reports the return before any action of his reaches the engine [D42].
  if (!me.connected || isSoftOffline(me)) reject('disconnected');
  const paused = s.status === 'paused';

  switch (action.type) {
    case 'select': {
      if (paused) reject('paused');
      // In 'turns' the first thing to say is whose turn it is.
      if (rules.turnModel === 'turns' && s.turn?.playerId !== me.id) reject('notYourTurn');
      const cell = action.cell;
      if (!isCellIndex(cell)) reject('badCell');
      if (s.grid[cell] !== 0) reject('cellFilled');
      const holder = s.locks.find((l) => l.cell === cell);
      if (holder) reject(holder.playerId === me.id ? 'alreadyHeld' : 'cellTaken');
      if (s.cooldowns.some((c) => c.playerId === me.id && c.cell === cell && c.until > now))
        reject('cooldown');
      const mine = lockOf(s, me.id);
      if (rules.turnModel === 'turns' && mine) reject('alreadyHeld'); // one lock per turn
      if (mine) release(tx, me.id, 'switch', now);
      lockCell(tx, me, cell, now);
      return;
    }

    case 'release': {
      if (paused) reject('paused');
      if (!lockOf(s, me.id)) reject('noLock');
      release(tx, me.id, 'cancel', now);
      if (s.turn?.playerId === me.id) passTurn(tx, me.id, now);
      return;
    }

    case 'place': {
      if (paused) reject('paused');
      const lock = lockOf(s, me.id) ?? reject('noLock');
      if (lock.cell !== action.cell) reject('notLockedCell');
      const digit = action.digit;
      if (!isDigit(digit)) reject('badDigit');
      if (digitTried(s, lock.cell, digit, me.id)) reject('digitTried');
      if (digitCount(s.grid, digit) >= 9) reject('digitComplete');
      placeDigit(tx, me.id, lock, digit, now);
      return;
    }

    case 'offlineMove': {
      // [D42] A digit entered while the connection was lost, decided now on the board as it is now. Every check
      // comes before the first event: a move that lost its cell leaves no trace and costs nothing.
      if (paused) reject('paused');
      if (rules.turnModel === 'turns') reject('notYourTurn');
      const open = me.offlineWindow;
      if (!open || now > open.until || open.left <= 0) reject('offlineClosed');
      const cell = action.cell;
      if (!isCellIndex(cell)) reject('badCell');
      const digit = action.digit;
      if (!isDigit(digit)) reject('badDigit');
      if (s.grid[cell] !== 0) reject('cellFilled');
      const holder = s.locks.find((l) => l.cell === cell);
      if (holder && holder.playerId !== me.id) reject('cellTaken');
      if (digitTried(s, cell, digit, me.id)) reject('digitTried');
      if (digitCount(s.grid, digit) >= 9) reject('digitComplete');

      if (!holder) {
        // He chose it while offline: lock it now, as select would. His own re-lock wait does not apply: on
        // his phone he never let it go.
        if (lockOf(s, me.id)) release(tx, me.id, 'switch', now);
        lockCell(tx, me, cell, now);
      }
      const claimed = Number.isFinite(action.thinkMs) ? Math.round(action.thinkMs) : rules.thinkTimeMs;
      const thinkMs = Math.min(rules.thinkTimeMs, Math.max(0, claimed));
      placeDigit(tx, me.id, lockOf(tx.state, me.id)!, digit, now, { thinkMs });
      return;
    }

    case 'interfere': {
      if (paused) reject('paused');
      // Off in solo practice and against a known bot [D44].
      if (!rules.interferences) reject('interferencesOff');
      // Only the room's kinds: a kind some player's app can't show never reaches it [D47].
      if (!rules.interferenceKinds.includes(action.kind)) reject('badKind');
      const target = playerOf(s, action.targetId);
      if (!target || target.id === me.id) return reject('badTarget');
      if (target.status !== 'active') reject('targetOut');
      if (!target.connected) reject('targetDisconnected');
      // In the soft phase he can't see it either [D42].
      if (isSoftOffline(target) && !rules.interfereSoftOffline) reject('targetDisconnected');
      if (target.hitBy || target.immuneUntil > now) reject('targetBusy');
      const cost = rules.interferenceCostBase ** (me.interferencesSent + 1);
      if (rules.interferenceNeedsScore && me.score < cost) reject('notEnoughPoints');
      const lock = lockOf(s, target.id);
      const locks: LockTimer[] =
        rules.pauseLockWhileInterfered && lock && lock.expiresAt !== null
          ? [
              {
                playerId: target.id,
                cell: lock.cell,
                expiresAt: null,
                remainingMs: Math.max(0, lock.expiresAt - now),
              },
            ]
          : [];
      tx.emit(
        {
          type: 'interference',
          fromId: me.id,
          targetId: target.id,
          kind: action.kind,
          cost,
          endsAt: now + rules.interferenceMs,
          score: rules.negativeScore ? me.score - cost : Math.max(0, me.score - cost),
          locks,
        },
        now,
      );
      return;
    }

    case 'react': {
      if (!rules.reactions.includes(action.emoji)) reject('badEmoji');
      if (me.lastReactionAt !== null && now - me.lastReactionAt < rules.reactionCooldownMs) reject('tooSoon');
      tx.emit({ type: 'reaction', playerId: me.id, emoji: action.emoji }, now);
      return;
    }

    case 'surrender': {
      release(tx, me.id, 'surrender', now);
      tx.emit({ type: 'playerSurrendered', playerId: me.id }, now);
      if (endIfLastStanding(tx, me, now)) return;
      freezeIfNeeded(tx, now);
      repairTurn(tx, me.id, now);
      return;
    }
  }
}
