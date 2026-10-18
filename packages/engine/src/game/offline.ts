import { type CellIndex, type Digit, digitCount, isCellIndex, isDigit } from '../sudoku/board';
import type { GameState, Lock, PlayerId, RejectReason } from './types';

/**
 * Playing on while the connection is lost (the soft phase, spec §16.2) [D42]: pure helpers for the phone.
 *
 * In a ranked game the phone has no solution, so a digit entered offline can't be judged there. The phone keeps
 * a lock of its own (LocalLock) and a queue of moves (OfflineMove), shows them as "waiting", and sends them as
 * `offlineMove` when it is back; the server decides each one on the board as it is then. These helpers answer,
 * from the last state the phone had, what the local play may do, and draw it: they never evolve the state.
 * Times are on the server's clock (the phone's ClockSync), except thinkMs, a difference of phone times.
 */

/** A move made offline, queued until the phone is back. */
export interface OfflineMove {
  cell: CellIndex;
  digit: Digit;
  /** How long it took, from the lock to the digit (phone time). The server clamps it to [0, thinkTimeMs]. */
  thinkMs: number;
}

/** The cell the player holds on his phone while offline (server clock). */
export interface LocalLock {
  cell: CellIndex;
  lockedAt: number;
  expiresAt: number;
}

export interface OfflinePlay {
  /** When the phone's soft phase ends (server clock): after it, nothing is played locally. */
  softEndsAt: number;
  lock: LocalLock | null;
  /** In the order they were made. */
  queued: readonly OfflineMove[];
}

/**
 * Whether `me` may play on locally once the connection is lost: a running game in the 'simultaneous' model, he
 * is in it, and the rules have a soft phase and offline moves. Rules without those fields come from an older
 * server, which would refuse the moves: then local play stays off, as before.
 */
export function offlinePlayable(state: GameState, me: PlayerId): boolean {
  const rules = state.config.rules;
  const p = state.players.find((q) => q.id === me);
  return (
    state.status === 'running' &&
    rules.turnModel === 'simultaneous' &&
    p?.status === 'active' &&
    p.connected &&
    (rules.softGraceMs ?? 0) > 0 &&
    (rules.offlineMovesMax ?? 0) > 0
  );
}

/**
 * The state as the offline player's screen shows it, and as the local checks see it; never evolved further.
 * Only this changes: he is marked as in the soft phase; his lock is the local one (or none); another player's
 * lock whose time has run out by `now` is gone (it ran out, or a digit filled it: offline, nobody knows which);
 * a stopped lock (under interference) stays.
 */
export function withOfflinePlay(state: GameState, me: PlayerId, play: OfflinePlay, now: number): GameState {
  const locks: Lock[] = state.locks
    .filter((l) => l.playerId !== me && (l.expiresAt === null || l.expiresAt > now))
    .map((l) => ({ ...l }));
  if (play.lock)
    locks.push({
      playerId: me,
      cell: play.lock.cell,
      lockedAt: play.lock.lockedAt,
      expiresAt: play.lock.expiresAt,
      remainingMs: state.config.rules.thinkTimeMs,
    });
  return {
    ...state,
    locks,
    players: state.players.map((p) => (p.id === me ? { ...p, softEndsAt: play.softEndsAt } : p)),
  };
}

/** Why nothing can be played locally now; null when it can. */
function playRefusal(state: GameState, me: PlayerId, play: OfflinePlay, now: number): RejectReason | null {
  if (state.status === 'paused') return 'paused';
  if (state.status === 'over') return 'gameOver';
  if (state.status === 'waiting') return 'notStarted';
  const p = state.players.find((q) => q.id === me);
  if (!p || p.status !== 'active') return 'notActive';
  if (state.config.rules.turnModel === 'turns') return 'notYourTurn';
  // Local play off (an older server), the soft phase over, or as many moves queued as may be sent.
  if (!offlinePlayable(state, me) || now >= play.softEndsAt) return 'disconnected';
  if (play.queued.length >= (state.config.rules.offlineMovesMax ?? 0)) return 'disconnected';
  return null;
}

/** Whether my local lock still runs at `now`. */
const holding = (play: OfflinePlay, now: number): play is OfflinePlay & { lock: LocalLock } =>
  play.lock !== null && play.lock.expiresAt > now;

/**
 * Why `me` can't take `cell` locally now, the engine's reason for a select; null when he can. 'cellFilled': on
 * the board, or a move of his queued there. 'cellTaken': another player's lock, still running or stopped.
 * 'cooldown': his re-lock wait from the server is still running.
 */
export function offlineSelectRefusal(
  state: GameState,
  me: PlayerId,
  play: OfflinePlay,
  cell: CellIndex,
  now: number,
): RejectReason | null {
  const refusal = playRefusal(state, me, play, now);
  if (refusal) return refusal;
  if (!isCellIndex(cell)) return 'badCell';
  if (state.grid[cell] !== 0 || play.queued.some((m) => m.cell === cell)) return 'cellFilled';
  if (holding(play, now) && play.lock.cell === cell) return 'alreadyHeld';
  if (withOfflinePlay(state, me, play, now).locks.some((l) => l.cell === cell && l.playerId !== me))
    return 'cellTaken';
  if (state.cooldowns.some((c) => c.playerId === me && c.cell === cell && c.until > now)) return 'cooldown';
  return null;
}

/**
 * Why `me` can't enter `digit` in `cell` locally now, the engine's reason for a place; null when he can.
 * 'digitTried' follows [D12]; 'digitComplete' counts his queued digits too.
 */
export function offlinePlaceRefusal(
  state: GameState,
  me: PlayerId,
  play: OfflinePlay,
  cell: CellIndex,
  digit: number,
  now: number,
): RejectReason | null {
  const refusal = playRefusal(state, me, play, now);
  if (refusal) return refusal;
  if (!holding(play, now)) return 'noLock';
  if (play.lock.cell !== cell) return 'notLockedCell';
  if (!isDigit(digit)) return 'badDigit';
  const everyone = state.config.rules.wrongDigitDisabledFor === 'everyone';
  if (state.wrong[cell]!.some((w) => w.digit === digit && (everyone || w.playerId === me)))
    return 'digitTried';
  if (digitCount(state.grid, digit) + play.queued.filter((m) => m.digit === digit).length >= 9)
    return 'digitComplete';
  return null;
}

/**
 * The queued moves the state does not settle yet: drops a move whose digit is on the board as mine, or whose
 * wrong try by me is there (its answer was lost with the connection; sending it again would only be refused).
 * A move on a cell someone else filled is kept: the server refuses it, and the player sees he lost it.
 */
export function unsettledOfflineMoves<M extends OfflineMove>(
  state: GameState,
  me: PlayerId,
  moves: readonly M[],
): M[] {
  const seat = state.players.find((p) => p.id === me)?.seat;
  return moves.filter(
    (m) =>
      !(seat !== undefined && state.grid[m.cell] === m.digit && state.owner[m.cell] === seat) &&
      !state.wrong[m.cell]?.some((w) => w.digit === m.digit && w.playerId === me),
  );
}
