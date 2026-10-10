import type { NetMetricsSummary } from '../../../net/metrics';
import type { StatsSummary } from '../../../net/rollingStats';

/**
 * The network measures of an online game for the debug screen (spec §18, work plan stage 7: "the five
 * measures on a debug screen"): client → server, server → client, the action's update time, the reconnect
 * time and the sync time (RemoteGameHost's NetMetrics), and the ping round trip and clock offset (ClockSync).
 * Pure: it reads the summaries and checks each p95 against its target. Nothing is measured here.
 */

export type MeasureKey = 'rtt' | 'c2s' | 's2c' | 'action' | 'reconnect' | 'sync';

export interface MeasureRow {
  key: MeasureKey;
  stats: StatsSummary;
  /** The spec's target for the p95 (ms). */
  targetMs: number;
  /** Null without samples. */
  withinTarget: boolean | null;
}

export interface NetMetricsModel {
  rows: MeasureRow[];
  /** Server time minus phone time; null before the first pong. */
  offsetMs: number | null;
  /** Actions never answered (rate-limited, or lost with a drop). */
  lost: number;
  /** latency_sample reports sent (spec §22). */
  reports: number;
}

/** Spec §18: an action's response p95 ≤ 150 ms (4G, same region); a resync ≤ 2 s. */
export const ACTION_TARGET_MS = 150;
export const RESYNC_TARGET_MS = 2000;

const ORDER: readonly { key: MeasureKey; targetMs: number }[] = [
  { key: 'rtt', targetMs: ACTION_TARGET_MS },
  { key: 'c2s', targetMs: ACTION_TARGET_MS },
  { key: 's2c', targetMs: ACTION_TARGET_MS },
  { key: 'action', targetMs: ACTION_TARGET_MS },
  { key: 'reconnect', targetMs: RESYNC_TARGET_MS },
  { key: 'sync', targetMs: RESYNC_TARGET_MS },
];

export interface NetMetricsInput {
  summary: NetMetricsSummary;
  rtt: StatsSummary;
  /** Null when the clock is not synced yet. */
  offsetMs: number | null;
}

export function netMetricsModel({ summary, rtt, offsetMs }: NetMetricsInput): NetMetricsModel {
  const stats: Record<MeasureKey, StatsSummary> = {
    rtt,
    c2s: summary.c2s,
    s2c: summary.s2c,
    action: summary.action,
    reconnect: summary.reconnect,
    sync: summary.sync,
  };
  return {
    rows: ORDER.map(({ key, targetMs }) => {
      const s = stats[key];
      return { key, stats: s, targetMs, withinTarget: s.p95 === null ? null : s.p95 <= targetMs };
    }),
    offsetMs: offsetMs === null ? null : Math.round(offsetMs),
    lost: summary.lost,
    reports: summary.reports,
  };
}
