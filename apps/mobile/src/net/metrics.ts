import type { ClientAction, GameEvent, PlayerId } from '@sudoku-fight/engine';
import type { TelemetryEventName, TelemetryProps } from '@sudoku-fight/protocol';

import { RollingStats, type StatsSummary } from './rollingStats';

/**
 * What an online game measures (spec §18, work plan stage 7: "the five measures, on a debug screen and in
 * track('latency_sample')"):
 *
 * - c2s, client → server: from sending an action to the server's time on the event that answers it;
 * - s2c, server → client: from the server's time on an event to its arrival (one sample per message);
 * - action: from sending an action (the tap) to its answer arriving (an event, or a refusal);
 * - reconnect: from starting to come back after a drop until the room sent the snapshot;
 * - sync: from that snapshot until the game is current again (this player connected, the game running).
 *
 * c2s and s2c cross the two clocks, so they need the offset from ping/pong (ClockSync) and are only taken
 * once the clock is synced. Each measure keeps a rolling window for its p50/p95. Every `reportEvery` new
 * samples (c2s, s2c and action together) it reports `latency_sample { c2sP95, s2cP95, actionP95 }`
 * (spec §22), never more than once per `reportMinIntervalMs`. Pure: times come in as arguments.
 */

export type MetricsTrack = (name: TelemetryEventName, props: TelemetryProps) => void;

export interface NetMetricsOptions {
  /** Samples kept per measure. */
  window?: number;
  /** Report after this many new samples… */
  reportEvery?: number;
  /** …but never twice within this long (ms). */
  reportMinIntervalMs?: number;
  /** On close: report what is left if at least this many new samples are waiting (and the interval allows). */
  flushMin?: number;
  /** An action without an answer after this long is counted as lost (rate-limited or lost with a drop). */
  answerExpireMs?: number;
  track?: MetricsTrack;
}

export interface NetMetricsSummary {
  c2s: StatsSummary;
  s2c: StatsSummary;
  action: StatsSummary;
  reconnect: StatsSummary;
  sync: StatsSummary;
  /** Actions never answered. */
  lost: number;
  /** latency_sample reports sent so far. */
  reports: number;
}

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

interface InFlight {
  clientSeq: number;
  action: ClientAction;
  /** Phone time when it went out. */
  at: number;
}

export class NetMetrics {
  readonly c2s: RollingStats;
  readonly s2c: RollingStats;
  readonly action: RollingStats;
  readonly reconnect: RollingStats;
  readonly sync: RollingStats;
  /** Actions never answered. */
  lost = 0;
  /** latency_sample reports sent. */
  reports = 0;

  private inFlight: InFlight[] = [];
  private fresh = 0;
  private lastReportAt: number | null = null;
  private readonly reportEvery: number;
  private readonly reportMinIntervalMs: number;
  private readonly flushMin: number;
  private readonly answerExpireMs: number;
  private readonly track: MetricsTrack | undefined;

  constructor({
    window = 200,
    reportEvery = 50,
    reportMinIntervalMs = 60_000,
    flushMin = 10,
    answerExpireMs = 10_000,
    track,
  }: NetMetricsOptions = {}) {
    this.c2s = new RollingStats(window);
    this.s2c = new RollingStats(window);
    this.action = new RollingStats(window);
    this.reconnect = new RollingStats(window);
    this.sync = new RollingStats(window);
    this.reportEvery = Math.max(1, reportEvery);
    this.reportMinIntervalMs = reportMinIntervalMs;
    this.flushMin = Math.max(1, flushMin);
    this.answerExpireMs = answerExpireMs;
    this.track = track;
  }

  /** An action went out at `at` (phone time). */
  sent(clientSeq: number, action: ClientAction, at: number): void {
    this.expire(at);
    this.inFlight.push({ clientSeq, action, at });
  }

  /** Actions waiting for their answer. */
  get waiting(): number {
    return this.inFlight.length;
  }

  /**
   * New events arrived at `at`. `offsetMs` is the server's clock minus the phone's, or null while the clock
   * is not synced (then only the action time is taken).
   */
  events(events: readonly GameEvent[], me: PlayerId, at: number, offsetMs: number | null): void {
    if (events.length === 0) return;
    if (offsetMs !== null) {
      const newest = Math.max(...events.map((e) => e.t));
      this.add(this.s2c, at + offsetMs - newest, at);
    }
    for (const e of events) {
      const k = this.inFlight.findIndex((p) => answers(p.action, e, me));
      if (k < 0) continue;
      const [answered] = this.inFlight.splice(k, 1);
      if (offsetMs !== null) this.add(this.c2s, e.t - (answered!.at + offsetMs), at);
      this.add(this.action, at - answered!.at, at);
    }
    this.expire(at);
  }

  /** The server refused action `clientSeq` (its answer, too). */
  rejected(clientSeq: number, at: number): void {
    const k = this.inFlight.findIndex((p) => p.clientSeq === clientSeq);
    if (k < 0) return;
    const [answered] = this.inFlight.splice(k, 1);
    this.add(this.action, at - answered!.at, at);
  }

  /** The connection dropped: the answers to what is on the way will never come. */
  dropped(): void {
    this.lost += this.inFlight.length;
    this.inFlight = [];
  }

  /** Back after a drop: how long coming back took, and how long until the game was current again. */
  cameBack(reconnectMs: number, syncMs: number): void {
    this.reconnect.add(Math.max(0, reconnectMs));
    this.sync.add(Math.max(0, syncMs));
  }

  /** The props of a latency_sample report now (spec §22). */
  latencyProps(): TelemetryProps {
    const p95 = (s: RollingStats) => {
      const v = s.percentile(95);
      return v === null ? null : Math.round(v);
    };
    return { c2sP95: p95(this.c2s), s2cP95: p95(this.s2c), actionP95: p95(this.action) };
  }

  /** The game is closing: reports what is left when enough is waiting and the interval allows. */
  flush(now: number): void {
    if (this.fresh >= this.flushMin) this.report(now);
  }

  summary(): NetMetricsSummary {
    return {
      c2s: this.c2s.summary(),
      s2c: this.s2c.summary(),
      action: this.action.summary(),
      reconnect: this.reconnect.summary(),
      sync: this.sync.summary(),
      lost: this.lost,
      reports: this.reports,
    };
  }

  private add(stats: RollingStats, ms: number, now: number): void {
    stats.add(Math.max(0, ms));
    this.fresh++;
    if (this.fresh >= this.reportEvery) this.report(now);
  }

  private report(now: number): void {
    if (this.lastReportAt !== null && now - this.lastReportAt < this.reportMinIntervalMs) return;
    this.lastReportAt = now;
    this.fresh = 0;
    this.reports++;
    try {
      this.track?.('latency_sample', this.latencyProps());
    } catch {
      // Analytics never breaks a game.
    }
  }

  private expire(now: number): void {
    const before = this.inFlight.length;
    this.inFlight = this.inFlight.filter((p) => now - p.at < this.answerExpireMs);
    this.lost += before - this.inFlight.length;
  }
}
