import type { ClientAction, GameEvent, PlayerId } from '@sudoku-fight/engine';
import type { ClientMessageType } from '@sudoku-fight/protocol';

import { DEFAULT_MESSAGE_LIMITS, type MessageLimits } from '../../game/gate';
import { LatencyStats } from '../../game/metrics';
import { RateLimiter } from '../../http/rateLimiter';

/**
 * What a client measures (spec §18, the five measures) and how it keeps within the server's rate limits.
 * Pure: every time comes in as an argument or an injected clock, so tests drive it by hand.
 */

// ---------------------------------------------------------------------------------------------------------
// Clock sync and round-trip time

/**
 * Round-trip times from ping/pong, and the offset between this client's clock and the server's (spec §18:
 * timers are shown by `expiresAt` in server time). The ping carries `t`, a monotonic time (performance.now());
 * the pong echoes it with the server's epoch time. The offset comes from the sample with the shortest round
 * trip, where "the server answered halfway" is the least wrong.
 */
export class ClockSync {
  readonly rtt = new LatencyStats(4096);
  private best: { rttMs: number; offsetMs: number } | null = null;
  private readonly inFlight = new Set<number>();

  /** The `t` of a ping sent now. */
  ping(monoNow: number): number {
    let t = monoNow;
    // Two pings in the same instant still need telling apart.
    while (this.inFlight.has(t)) t += 0.001;
    this.inFlight.add(t);
    return t;
  }

  /** A pong: its round trip in ms, or null when it answers no ping of ours. */
  pong(t: number, serverTime: number, monoNow: number, epochNow: number): number | null {
    if (!this.inFlight.delete(t)) return null;
    const rttMs = Math.max(0, monoNow - t);
    this.rtt.add(rttMs);
    // The server read its clock about halfway through the round trip.
    const offsetMs = serverTime + rttMs / 2 - epochNow;
    if (this.best === null || rttMs <= this.best.rttMs) this.best = { rttMs, offsetMs };
    return rttMs;
  }

  /** Pings sent and not answered (lost with a drop, or still on the way). */
  get unanswered(): number {
    return this.inFlight.size;
  }

  /** Server time minus client time; 0 before the first pong. */
  get offsetMs(): number {
    return this.best?.offsetMs ?? 0;
  }

  get synced(): boolean {
    return this.best !== null;
  }

  /** A connection dropped: pings on the way will never be answered. */
  forgetInFlight(): void {
    this.inFlight.clear();
  }
}

// ---------------------------------------------------------------------------------------------------------
// Action answer times

/** Whether `e` is the server's answer to `action` of player `me`. */
export function answers(action: ClientAction, e: GameEvent, me: PlayerId): boolean {
  switch (action.type) {
    case 'select':
      return e.type === 'cellLocked' && e.playerId === me && e.cell === action.cell;
    case 'release':
      return e.type === 'cellReleased' && e.playerId === me && e.reason === 'cancel';
    case 'place':
      return (
        (e.type === 'placedCorrect' || e.type === 'placedWrong') &&
        e.playerId === me &&
        e.cell === action.cell
      );
    case 'interfere':
      return e.type === 'interference' && e.fromId === me && e.targetId === action.targetId;
    case 'react':
      return e.type === 'reaction' && e.playerId === me;
    case 'surrender':
      return e.type === 'playerSurrendered' && e.playerId === me;
  }
}

/**
 * How long the server takes to answer an action (spec §18: "p95 of the action response time ≤ 150 ms"),
 * from sending it to its event or its refusal. An action not answered within `expireMs` is counted as lost.
 */
export class ActionTracker {
  readonly latency = new LatencyStats(4096);
  /** Actions never answered (lost with a drop, or dropped by the server). */
  lost = 0;
  private pending: { clientSeq: number; action: ClientAction; at: number }[] = [];

  constructor(private readonly expireMs = 10_000) {}

  sent(clientSeq: number, action: ClientAction, monoNow: number): void {
    this.expire(monoNow);
    this.pending.push({ clientSeq, action, at: monoNow });
  }

  /** New events: each answers the oldest action it matches. */
  events(events: readonly GameEvent[], me: PlayerId, monoNow: number): void {
    for (const e of events) {
      const k = this.pending.findIndex((p) => answers(p.action, e, me));
      if (k >= 0) this.settle(k, monoNow);
    }
    this.expire(monoNow);
  }

  rejected(clientSeq: number, monoNow: number): void {
    const k = this.pending.findIndex((p) => p.clientSeq === clientSeq);
    if (k >= 0) this.settle(k, monoNow);
  }

  /** The connection dropped: answers to what is on the way may never come. */
  reset(): void {
    this.lost += this.pending.length;
    this.pending = [];
  }

  get waiting(): number {
    return this.pending.length;
  }

  private settle(k: number, monoNow: number): void {
    const [p] = this.pending.splice(k, 1);
    this.latency.add(Math.max(0, monoNow - p!.at));
  }

  private expire(monoNow: number): void {
    const before = this.pending.length;
    this.pending = this.pending.filter((p) => monoNow - p.at < this.expireMs);
    this.lost += before - this.pending.length;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Pacing

/**
 * The server's limits per message type (spec §21), kept on the client's side with a margin: one token less
 * per burst and a window 10% longer, so network jitter that bunches messages up still fits the server's
 * buckets. A person never comes near them; a fast test client would, and an over-the-limit message is
 * dropped without an answer (and counts towards being disconnected for abuse).
 */
export class Pacer {
  private readonly limiters: Map<ClientMessageType, RateLimiter>;

  constructor(now: () => number, limits: MessageLimits = DEFAULT_MESSAGE_LIMITS) {
    this.limiters = new Map(
      (Object.keys(limits) as ClientMessageType[]).map((type) => {
        const { limit, windowMs } = limits[type];
        const rule = { limit: Math.max(1, limit - 1), windowMs: Math.ceil(windowMs * 1.1) };
        return [type, new RateLimiter({ ...rule, now, maxKeys: 1 })];
      }),
    );
  }

  /** 0: send it now (the token is taken); otherwise how many ms to wait before asking again. */
  take(type: ClientMessageType): number {
    const r = this.limiters.get(type)!.take('me');
    return r.ok ? 0 : Math.max(1, Math.ceil(r.retryAfterMs));
  }
}
