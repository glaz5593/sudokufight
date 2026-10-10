import type { ErrorRequestHandler, RequestHandler, Response } from 'express';

/**
 * JSON error answers for the Express routes: `{ error, message? }`, the shape of the protocol's
 * TelemetryError and AdminError.
 */

export function sendError(res: Response, status: number, error: string, message?: string): void {
  res.status(status).json(message === undefined ? { error } : { error, message });
}

/** 429 with Retry-After in whole seconds (at least 1). */
export function sendTooManyRequests(res: Response, retryAfterMs: number): void {
  res.set('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  sendError(res, 429, 'tooManyRequests');
}

export const notFound: RequestHandler = (_req, res) => sendError(res, 404, 'notFound');

/** The status an error asks for: body-parser and http-errors set `status` (4xx); anything else is ours: 500. */
function clientStatusOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const { status, statusCode } = err as { status?: unknown; statusCode?: unknown };
  const s = typeof status === 'number' ? status : statusCode;
  return typeof s === 'number' && s >= 400 && s < 500 ? s : undefined;
}

/** Postgres error fields that quote the row's values (e.g. `Key (email)=(…) already exists`). */
const VALUE_FIELDS = ['detail', 'where', 'parameters'];

/**
 * An error as it may go to the log: no personal data. A failed query (drizzle's DrizzleQueryError) carries its
 * parameters, which are the request's values (an email, a Firebase uid, a display name), in its message and
 * in `params`; the driver's error under it quotes values in `detail`. The query text, the SQLSTATE and the
 * constraint stay: they are what a fix needs.
 */
export function errorForLog(err: unknown, depth = 0): unknown {
  if (typeof err !== 'object' || err === null || depth > 4) return err;
  const e = err as Record<string, unknown>;
  const isQuery = typeof e.query === 'string' && Array.isArray(e.params);
  const hasValues = VALUE_FIELDS.some((f) => e[f] !== undefined);
  if (!isQuery && !hasValues && e.cause === undefined) return err;
  const safe: Record<string, unknown> = {
    name: e.name ?? (err instanceof Error ? err.name : undefined),
    message: isQuery ? `Failed query: ${String(e.query)}` : e.message,
  };
  if (isQuery) safe.params = `[${(e.params as unknown[]).length} redacted]`;
  for (const k of ['code', 'severity', 'constraint', 'constraint_name', 'table', 'table_name', 'column']) {
    if (e[k] !== undefined) safe[k] = e[k];
  }
  if (typeof e.stack === 'string') {
    // The stack starts with the message (values included): only its "at …" lines are kept.
    const frames = e.stack.split('\n').filter((line) => /^\s+at /.test(line));
    safe.stack = [`${String(safe.name)}: ${String(safe.message)}`, ...frames].join('\n');
  }
  if (e.cause !== undefined) safe.cause = errorForLog(e.cause, depth + 1);
  return safe;
}

/** Last in the chain: turns a thrown or rejected error into JSON, without leaking internals. */
export const jsonErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = clientStatusOf(err);
  if (status === 413) return sendError(res, 413, 'tooLarge');
  if (status !== undefined) {
    const type = (err as { type?: unknown }).type;
    return sendError(res, status, 'badRequest', type === 'entity.parse.failed' ? 'invalid JSON' : undefined);
  }
  console.error(`[http] ${req.method} ${req.path} failed`, errorForLog(err));
  sendError(res, 500, 'internal');
};
