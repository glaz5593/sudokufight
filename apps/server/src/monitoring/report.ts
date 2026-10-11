import { reportableError } from './redact';

/**
 * Where the server's unexpected errors go besides the log (work plan stage 14): one Monitor for the process,
 * Sentry when SENTRY_DSN is set (./sentry.ts), else nothing. The rest of the server calls reportError() and
 * never knows which: the HTTP routes' last error handler (http/errors), the game and matchmaking rooms (their
 * log's errors, and Colyseus' onUncaughtException), and the process' own handlers (./process.ts).
 *
 * Reporting never throws, never waits, and never reports the same error object twice (a room logs an error
 * that Colyseus then hands to onUncaughtException as well).
 */

export interface ErrorContext {
  /** Where it happened, a tag: 'http', 'rooms', 'process', 'startup'. */
  area: string;
  /** What was going on, e.g. "[game ABC123] message place from <user id> failed" (no personal data). */
  message?: string;
  /** Short tags, e.g. { method: 'GET', route: '/v1/me' }. */
  tags?: Record<string, string>;
}

export interface Monitor {
  readonly enabled: boolean;
  /** Sends the error (already safe for reporting), with its context. */
  capture(error: Error, context: ErrorContext): void;
  /** Waits up to `timeoutMs` for what is still being sent; false when it ran out. Never rejects. */
  flush(timeoutMs: number): Promise<boolean>;
}

export const NO_MONITOR: Monitor = {
  enabled: false,
  capture: () => undefined,
  flush: () => Promise.resolve(true),
};

let current: Monitor = NO_MONITOR;
let reported = new WeakSet<object>();

/** The process' monitor (src/index.ts sets it once, at start). */
export function setMonitor(monitor: Monitor): void {
  current = monitor;
  reported = new WeakSet();
}

export function currentMonitor(): Monitor {
  return current;
}

/**
 * Reports an unexpected error: anything thrown, made safe first (reportableError: a failed query loses its
 * values). A no-op without a monitor.
 */
export function reportError(thrown: unknown, context: ErrorContext): void {
  if (!current.enabled) return;
  try {
    if (typeof thrown === 'object' && thrown !== null) {
      if (reported.has(thrown)) return;
      reported.add(thrown);
    }
    current.capture(reportableError(thrown), context);
  } catch {
    // Reporting must never be what breaks the server.
  }
}

/** Waits for the reports still on their way (before the process exits). Never rejects. */
export async function flushReports(timeoutMs: number): Promise<boolean> {
  try {
    return await current.flush(timeoutMs);
  } catch {
    return false;
  }
}
