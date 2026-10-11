import { errorForLog } from './redact';
import { flushReports, reportError } from './report';

/**
 * The process' last resorts (work plan stage 14), the same with or without Sentry:
 * - An unhandled promise rejection is logged and reported, and the server goes on. (Node's default would end
 *   the process, and with it every game in progress: a lost promise is one failed operation, not a broken
 *   process.) This is also what Sentry's own handler does.
 * - An uncaught exception is logged and reported, the report gets up to `flushMs` to leave, and the process
 *   ends with code 1 as Node's default would: after a throw nobody caught, the rooms' state can't be trusted.
 *   Fly.io starts the machine again; the games it cut short end as serverRestart (persistence).
 */

export interface ProcessLike {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
  on(event: 'uncaughtException', listener: (error: Error) => void): unknown;
  exit(code: number): void;
}

export interface ProcessHandlerOptions {
  proc?: ProcessLike;
  log?: (message: string, detail?: unknown) => void;
  /** How long the last report may take before the process exits. */
  flushMs?: number;
}

export function installProcessHandlers({
  proc = process,
  log = console.error,
  flushMs = 2000,
}: ProcessHandlerOptions = {}): void {
  proc.on('unhandledRejection', (reason) => {
    log('[server] unhandled promise rejection (the server goes on)', errorForLog(reason));
    reportError(reason, { area: 'process', tags: { handler: 'unhandledRejection' } });
  });
  let exiting = false;
  proc.on('uncaughtException', (error) => {
    log('[server] uncaught exception: stopping', errorForLog(error));
    reportError(error, { area: 'process', tags: { handler: 'uncaughtException' } });
    if (exiting) return;
    exiting = true;
    void flushReports(flushMs).finally(() => proc.exit(1));
  });
}
