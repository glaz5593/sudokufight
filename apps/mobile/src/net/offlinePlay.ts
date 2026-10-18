import {
  type CellIndex,
  type Digit,
  type GameEvent,
  type GameState,
  type LocalLock,
  type OfflineMove,
  type OfflinePlay,
  offlinePlaceRefusal,
  offlineSelectRefusal,
  type PlayerId,
  type RejectReason,
  unsettledOfflineMoves,
  withOfflinePlay,
} from '@sudoku-fight/engine';

/**
 * Playing on while the connection is lost (spec §16.2, the soft phase) [D42]: what RemoteGameHost keeps of it,
 * pure, on the engine's helpers (packages/engine offline.ts). Every time is in the server's clock (ClockSync),
 * like the view's deadlines.
 *
 * - The window: from the loss the phone noticed (`since`) to the end of its soft phase (`softEndsAt`). Inside
 *   it the player may lock a cell here (a LocalLock, with its own countdown) and enter a digit, which joins the
 *   queue as "waiting". After it nothing more is played here (the hard phase: the board is locked).
 * - The queue outlives the window: its moves go to the server as `offlineMove` once the phone is back (the
 *   snapshot), are answered by placedCorrect / placedWrong with `offline`, or refused (lost, no penalty). A
 *   move the snapshot already settles (its answer was lost with the connection) is dropped, never sent twice.
 * - A new loss before the answers came puts the sent moves back to be sent after the next snapshot; so does a
 *   sent move with no answer after a while (a message the server dropped, e.g. over its rate limit), so no move
 *   stays "waiting" for good.
 * - A cell let go of here (cancelled, or another one selected) is remembered: the server may still hold my lock
 *   on it (it kept the lock running in the soft phase), and the return lets go of it there too.
 *
 * Every decision is made from the clock when asked, never by counting timer ticks (iOS suspends JS timers):
 * the host only wakes up to draw again.
 */

/** A move made offline, and its message once sent (null: to send), with when it was sent (phone time). */
export interface QueuedEntry extends OfflineMove {
  clientSeq: number | null;
  sentAt: number | null;
}

/** What a return has to do besides sending the queue [D42]. */
export interface ReturnPlan {
  /** The cell held here without a digit, while its time still ran: selected again if it is free. */
  held: CellIndex | null;
  /** Cells whose lock was let go of here (cancelled, or another cell selected): released at the server too. */
  letGo: readonly CellIndex[];
}

/** A queued move as the board draws it ("waiting for the connection"). */
export interface QueuedMove {
  cell: CellIndex;
  digit: Digit;
}

export class OfflinePlayBook {
  private window: { since: number; softEndsAt: number } | null = null;
  private lock: LocalLock | null = null;
  private entries: QueuedEntry[] = [];
  /** Cells whose lock the player let go of here, by "ביטול בחירה" or by selecting another cell. */
  private readonly letGo = new Set<CellIndex>();

  /** Local play is on: the connection is lost and its window was opened (it may have run out since). */
  get active(): boolean {
    return this.window !== null;
  }

  /** When the loss was noticed (server clock); null while not active. */
  get since(): number | null {
    return this.window?.since ?? null;
  }

  /** When the soft phase ends here (server clock); null while not active. */
  get softEndsAt(): number | null {
    return this.window?.softEndsAt ?? null;
  }

  /** The cell held here, whatever its time; null without one. */
  get lockCell(): CellIndex | null {
    return this.lock?.cell ?? null;
  }

  /** The moves waiting for their answer, oldest first. */
  get queued(): QueuedMove[] {
    return this.entries.map(({ cell, digit }) => ({ cell, digit }));
  }

  get size(): number {
    return this.entries.length;
  }

  /**
   * The connection is lost: local play opens until `softEndsAt`, holding `lock` (the server's lock of the
   * moment, or a select it had not answered). Moves already queued stay.
   */
  start(since: number, softEndsAt: number, lock: LocalLock | null): void {
    this.window = { since, softEndsAt };
    this.lock = lock;
    this.letGo.clear();
  }

  /** The play as the engine's helpers take it, at `now`: a lock that ran out, or a window that did, holds nothing. */
  play(now: number): OfflinePlay | null {
    const w = this.window;
    if (!w) return null;
    const lock = this.lock && this.lock.expiresAt > now && now < w.softEndsAt ? this.lock : null;
    return { softEndsAt: w.softEndsAt, lock, queued: this.entries };
  }

  /** A tap on `cell` here: null when it is now held locally, else the engine's reason it can't be. */
  select(state: GameState, me: PlayerId, cell: CellIndex, now: number): RejectReason | null {
    const play = this.play(now);
    if (!play) return 'disconnected';
    const refusal = offlineSelectRefusal(state, me, play, cell, now);
    if (refusal) return refusal;
    if (play.lock) this.letGo.add(play.lock.cell); // a switch lets the other one go
    this.letGo.delete(cell);
    this.lock = { cell, lockedAt: now, expiresAt: now + state.config.rules.thinkTimeMs };
    return null;
  }

  /** "ביטול בחירה" here: null when the local lock is let go of. */
  release(now: number): RejectReason | null {
    const play = this.play(now);
    if (!play) return 'disconnected';
    if (!play.lock) return 'noLock';
    this.letGo.add(play.lock.cell);
    this.lock = null;
    return null;
  }

  /**
   * A digit in the cell held here: null when it is queued (the lock is let go of, as a digit does online), else
   * the engine's reason it can't be. Its think time runs from the lock to now; the server clamps it.
   */
  place(state: GameState, me: PlayerId, cell: CellIndex, digit: number, now: number): RejectReason | null {
    const play = this.play(now);
    if (!play) return 'disconnected';
    const refusal = offlinePlaceRefusal(state, me, play, cell, digit, now);
    if (refusal || !play.lock) return refusal ?? 'noLock';
    this.entries.push({
      cell,
      digit: digit as Digit,
      thinkMs: Math.max(0, Math.round(now - play.lock.lockedAt)),
      clientSeq: null,
      sentAt: null,
    });
    this.lock = null;
    return null;
  }

  /** Lets go of a local lock whose time (or window) ran out by `now`; true when one went. */
  expire(now: number): boolean {
    if (!this.lock || !this.window) return false;
    if (this.lock.expiresAt > now && now < this.window.softEndsAt) return false;
    this.lock = null;
    return true;
  }

  /** The state as the screen shows it while local play is on (withOfflinePlay); the state itself otherwise. */
  overlay(state: GameState, me: PlayerId, now: number): GameState {
    const play = this.play(now);
    return play ? withOfflinePlay(state, me, play, now) : state;
  }

  /**
   * When the picture changes by itself next (server clock): the local lock or another player's runs out, or
   * the window closes. Null when nothing will.
   */
  nextWake(state: GameState, me: PlayerId, now: number): number | null {
    const w = this.window;
    if (!w) return null;
    const times: number[] = [];
    if (now < w.softEndsAt) times.push(w.softEndsAt);
    if (this.lock && this.lock.expiresAt > now) times.push(this.lock.expiresAt);
    for (const l of state.locks)
      if (l.playerId !== me && l.expiresAt !== null && l.expiresAt > now) times.push(l.expiresAt);
    return times.length ? Math.min(...times) : null;
  }

  /**
   * The phone is back (the snapshot came): local play ends; the queue stays to be sent. Returns what else the
   * return does [D42]: the cell held here without a digit, while its time still ran, is selected again if it is
   * free; the cells let go of here are released at the server if it still holds my lock on one.
   */
  end(now: number): ReturnPlan {
    const held = this.play(now)?.lock?.cell ?? null;
    const letGo = [...this.letGo].filter((cell) => cell !== held);
    this.window = null;
    this.lock = null;
    this.letGo.clear();
    return { held, letGo };
  }

  /**
   * The moves to send now, in order: those `state` already settles are dropped first (their answer was lost:
   * the digit is on the board as mine, or my wrong try is there); those sent and not answered yet wait.
   */
  entriesToSend(state: GameState, me: PlayerId): QueuedEntry[] {
    this.entries = unsettledOfflineMoves(state, me, this.entries);
    return this.entries.filter((e) => e.clientSeq === null);
  }

  /** `entry` went out as `clientSeq` at `at` (phone time). */
  markSent(entry: QueuedEntry, clientSeq: number, at: number): void {
    entry.clientSeq = clientSeq;
    entry.sentAt = at;
  }

  /** When the oldest move sent and not answered yet went out (phone time); null when none waits for one. */
  get oldestSentAt(): number | null {
    let oldest: number | null = null;
    for (const m of this.entries)
      if (m.clientSeq !== null && m.sentAt !== null) oldest = Math.min(oldest ?? m.sentAt, m.sentAt);
    return oldest;
  }

  /**
   * The moves sent at `at` or before and still not answered (the server dropped the message, e.g. over its rate
   * limit) are to be sent again; returns how many.
   */
  resetSentBy(at: number): number {
    let reset = 0;
    for (const m of this.entries) {
      if (m.clientSeq === null || m.sentAt === null || m.sentAt > at) continue;
      m.clientSeq = null;
      m.sentAt = null;
      reset++;
    }
    return reset;
  }

  /** `e` answers a queued move (my digit, made offline, on its cell): the move is settled. */
  answered(e: GameEvent, me: PlayerId): boolean {
    if ((e.type !== 'placedCorrect' && e.type !== 'placedWrong') || e.playerId !== me || !e.offline)
      return false;
    const before = this.entries.length;
    this.entries = this.entries.filter((m) => m.cell !== e.cell);
    return this.entries.length !== before;
  }

  /** The server refused the move sent as `clientSeq`: it is lost (no penalty). Returns it, or null. */
  rejected(clientSeq: number): QueuedEntry | null {
    const entry = this.entries.find((m) => m.clientSeq === clientSeq) ?? null;
    if (entry) this.entries = this.entries.filter((m) => m !== entry);
    return entry;
  }

  /** The connection went again before their answers: the moves sent go out again after the next snapshot. */
  resetUnanswered(): void {
    for (const m of this.entries) {
      m.clientSeq = null;
      m.sentAt = null;
    }
  }

  /** The game is over, or this player out of it: nothing will be sent. */
  clear(): void {
    this.window = null;
    this.lock = null;
    this.entries = [];
    this.letGo.clear();
  }
}
