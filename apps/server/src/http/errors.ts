import type { ErrorRequestHandler, RequestHandler, Response } from 'express';

import { errorForLog } from '../monitoring/redact';
import { reportError } from '../monitoring/report';

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

/**
 * An error as it may go to the log: no personal data (a failed query loses the values it quotes). It lives
 * with the rest of the redaction, in src/monitoring.
 */
export { errorForLog };

/**
 * Last in the chain: turns a thrown or rejected error into JSON, without leaking internals. A 500 is a bug:
 * logged, and reported (Sentry, when the server has a DSN), by its route's pattern, not its path.
 */
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
  // Express sets req.route (the matched route) when a route handler threw; its type doesn't say so.
  const pattern = (req as { route?: { path?: unknown } }).route?.path;
  const route = typeof pattern === 'string' ? `${req.baseUrl}${pattern}` : req.path;
  reportError(err, { area: 'http', tags: { method: req.method, route } });
  sendError(res, 500, 'internal');
};
