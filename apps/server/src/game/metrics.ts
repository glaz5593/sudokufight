import type { ClientMessageType } from '@sudoku-fight/protocol';

import type { DropReason } from './gate';

/**
 * How fast the server handles actions (spec §18: "action update time" is one of the five measures; the other
 * four are measured on the phone). Cheap: a ring of the last N durations, sorted only when someone asks.
 * GET /dev/metrics shows them outside production; each game logs its own summary when it ends.
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

export interface GameMetricsReport {
  rooms: { open: number; created: number };
  games: { started: number; over: number };
  /** Handling time of actions, from the message's arrival to the answers being sent. */
  actions: LatencySummary & { byType: Partial<Record<ClientMessageType, number>> };
  pings: number;
  dropped: Record<DropReason, number>;
  kicks: number;
}

/** One per server, shared by its game rooms. */
export class GameMetrics {
  private readonly actionTimes = new LatencyStats(4096);
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

  report(): GameMetricsReport {
    return {
      rooms: { open: this.roomsOpen, created: this.roomsCreated },
      games: { started: this.gamesStarted, over: this.gamesOver },
      actions: { ...this.actionTimes.summary(), byType: { ...this.byType } },
      pings: this.pings,
      dropped: { ...this.dropped },
      kicks: this.kicks,
    };
  }
}
