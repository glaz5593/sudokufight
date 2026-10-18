import type { RejectReason } from '@sudoku-fight/engine';
import type { ClientMessageType } from '@sudoku-fight/protocol';

import type { DropReason } from './gate';

/**
 * How fast the server handles actions (spec §18: "action update time" is one of the five measures; the other
 * four are measured on the phone). Cheap: a ring of the last N durations, sorted only when someone asks.
 * GET /dev/metrics shows them outside production; each game logs its own summary when it ends.
 *
 * And how connections fare [D42]: lost connections (the soft phase), returns within it, hard disconnects
 * (a soft phase that ran out, or a deliberate leave) and returns from them, and the moves made offline that
 * were applied or lost on the return, by reason. Per server (GameMetrics) and per game (ConnectionStats).
 */

export interface LatencySummary {
  count: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export class LatencyStats {
  private readonly ring: number[] = [];
  private next = 0;
  private total = 0;
  private max = 0;

  constructor(private readonly size = 1024) {}

  add(ms: number): void {
    if (this.ring.length < this.size) this.ring.push(ms);
    else this.ring[this.next] = ms;
    this.next = (this.next + 1) % this.size;
    this.total++;
    if (ms > this.max) this.max = ms;
  }

  /** p in [0, 100], over the last `size` samples (nearest rank); 0 with none. */
  percentile(p: number): number {
    if (this.ring.length === 0) return 0;
    const sorted = this.ring.slice().sort((a, b) => a - b);
    const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
    return sorted[rank - 1]!;
  }

  summary(): LatencySummary {
    const round = (ms: number) => Math.round(ms * 100) / 100;
    return {
      count: this.total,
      p50Ms: round(this.percentile(50)),
      p95Ms: round(this.percentile(95)),
      maxMs: round(this.max),
    };
  }
}

/**
 * A change of a player's connection, as the engine's events tell it [D42]: 'soft' a lost connection
 * (playerConnectionLost), 'backInSoft' a return within its soft phase, 'hard' a hard disconnect
 * (playerDisconnected: a soft phase that ran out, a deliberate leave, a drop with the soft phase off), and
 * 'backHard' a return from one.
 */
export type ConnectionChange = 'soft' | 'backInSoft' | 'hard' | 'backHard';

export type ConnectionCounts = Record<ConnectionChange, number>;

/** Moves made offline [D42]: applied on the return, or lost (refused, with no penalty) by reason. */
export interface OfflineMoveCounts {
  applied: number;
  lost: Partial<Record<RejectReason, number>>;
}

/** Connections and offline moves: one per server (in GameMetrics), and one per game for its summary line. */
export class ConnectionStats {
  private readonly counts: ConnectionCounts = { soft: 0, backInSoft: 0, hard: 0, backHard: 0 };
  private applied = 0;
  private readonly lost: Partial<Record<RejectReason, number>> = {};

  connection(change: ConnectionChange): void {
    this.counts[change]++;
  }

  /** An offlineMove handled: applied, or refused for `rejected`. */
  offlineMove(rejected?: RejectReason): void {
    if (rejected === undefined) this.applied++;
    else this.lost[rejected] = (this.lost[rejected] ?? 0) + 1;
  }

  get connections(): ConnectionCounts {
    return { ...this.counts };
  }

  get offlineMoves(): OfflineMoveCounts {
    return { applied: this.applied, lost: { ...this.lost } };
  }

  /**
   * For a game's summary line: "lost connections 2 (back in the soft phase 1), hard disconnects 1 (back 0);
   * offline moves 3 applied, 1 lost (cellTaken 1)". Empty when nothing of the kind happened.
   */
  summary(): string {
    const { soft, backInSoft, hard, backHard } = this.counts;
    const lost = Object.entries(this.lost);
    const lostCount = lost.reduce((n, [, k]) => n + (k ?? 0), 0);
    const parts: string[] = [];
    if (soft || hard)
      parts.push(
        `lost connections ${soft} (back in the soft phase ${backInSoft}), ` +
          `hard disconnects ${hard} (back ${backHard})`,
      );
    if (this.applied || lostCount) {
      const why = lost.length ? ` (${lost.map(([reason, k]) => `${reason} ${k}`).join(', ')})` : '';
      parts.push(`offline moves ${this.applied} applied, ${lostCount} lost${why}`);
    }
    return parts.join('; ');
  }
}

export interface GameMetricsReport {
  rooms: { open: number; created: number };
  games: { started: number; over: number };
  /** Handling time of actions, from the message's arrival to the answers being sent. */
  actions: LatencySummary & { byType: Partial<Record<ClientMessageType, number>> };
  pings: number;
  dropped: Record<DropReason, number>;
  kicks: number;
  /** Players' connections in the games [D42] (see ConnectionChange). */
  connections: ConnectionCounts;
  /** Moves made offline, sent on the return [D42]. */
  offlineMoves: OfflineMoveCounts;
}

/** One per server, shared by its game rooms. */
export class GameMetrics {
  private readonly actionTimes = new LatencyStats(4096);
  private readonly connectionStats = new ConnectionStats();
  private readonly byType: Partial<Record<ClientMessageType, number>> = {};
  private readonly dropped: Record<DropReason, number> = {
    unknownType: 0,
    malformed: 0,
    rateLimited: 0,
    duplicate: 0,
  };
  private roomsOpen = 0;
  private roomsCreated = 0;
  private gamesStarted = 0;
  private gamesOver = 0;
  private pings = 0;
  private kicks = 0;

  roomOpened(): void {
    this.roomsOpen++;
    this.roomsCreated++;
  }

  roomClosed(): void {
    this.roomsOpen = Math.max(0, this.roomsOpen - 1);
  }

  gameStarted(): void {
    this.gamesStarted++;
  }

  gameOver(): void {
    this.gamesOver++;
  }

  action(type: ClientMessageType, ms: number): void {
    this.actionTimes.add(ms);
    this.byType[type] = (this.byType[type] ?? 0) + 1;
  }

  ping(): void {
    this.pings++;
  }

  drop(reason: DropReason): void {
    this.dropped[reason]++;
  }

  kick(): void {
    this.kicks++;
  }

  /** A player's connection changed [D42]. */
  connection(change: ConnectionChange): void {
    this.connectionStats.connection(change);
  }

  /** A move made offline was applied, or lost for `rejected` [D42]. */
  offlineMove(rejected?: RejectReason): void {
    this.connectionStats.offlineMove(rejected);
  }

  report(): GameMetricsReport {
    return {
      rooms: { open: this.roomsOpen, created: this.roomsCreated },
      games: { started: this.gamesStarted, over: this.gamesOver },
      actions: { ...this.actionTimes.summary(), byType: { ...this.byType } },
      pings: this.pings,
      dropped: { ...this.dropped },
      kicks: this.kicks,
      connections: this.connectionStats.connections,
      offlineMoves: this.connectionStats.offlineMoves,
    };
  }
}
