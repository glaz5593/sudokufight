import {
  decodeHistoryCursor,
  GAME_ID_PATTERN,
  HISTORY_PATHS,
  type HistoryError,
  type HistoryPage,
  type ReplayAnswer,
} from '@sudoku-fight/protocol';
import { type Request, type RequestHandler, type Response, Router } from 'express';

import { findLiveUser } from '../accounts/store';
import { bearerToken, type TokenVerifier, type VerifiedToken } from '../auth/firebaseToken';
import type { Db } from '../db';
import { clientKey } from '../http/clientKey';
import { RateLimiter, type RateLimitRule } from '../http/rateLimiter';
import { listUserGames, readReplay } from './store';

/**
 * The history routes (spec §13, §14.1, §21; the contract: packages/protocol/src/history.ts):
 *   GET /v1/me/games?cursor=…  ·  GET /v1/games/:id/replay
 *
 * Each request passes, in order: a per-IP limit; the accounts switch (production without FIREBASE_PROJECT_ID:
 * 503 `disabled`); the token (`Authorization: Bearer`, required); a per-account limit; the account itself
 * (none, or deleted: 404 `notRegistered`). Answers are personal: never cached.
 */

export interface HistoryLimits {
  /** Every history route, per IP, before the token is checked. */
  perIp: RateLimitRule;
  /** Pages and replays, per account. */
  reads: RateLimitRule;
}

export const DEFAULT_HISTORY_LIMITS: HistoryLimits = {
  perIp: { limit: 300, windowMs: 60_000 },
  reads: { limit: 120, windowMs: 60_000 },
};

export interface HistoryRouterDeps {
  db: Db;
  now: () => number;
  tokens: TokenVerifier;
  historyLimits?: HistoryLimits;
}

function send(res: Response, status: number, body: HistoryError): void {
  res.status(status).json(body);
}

function tooMany(res: Response, retryAfterMs: number): void {
  res.set('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  send(res, 429, { error: 'tooManyRequests' });
}

const TOKEN = 'historyToken';

function tokenOf(res: Response): VerifiedToken {
  const token = res.locals[TOKEN] as VerifiedToken | undefined;
  if (token === undefined) throw new Error('history route without the auth step');
  return token;
}

/** The bearer token, verified: none or a bad one → 401 (503 when it can't be checked right now). */
function auth(tokens: TokenVerifier): RequestHandler {
  return async (req, res, next) => {
    const raw = bearerToken(req.get('authorization'));
    if (raw === undefined) {
      res.set('WWW-Authenticate', 'Bearer');
      return send(res, 401, { error: 'unauthorized', message: 'Sign in: Authorization: Bearer <token>' });
    }
    const result = await tokens.verifyIdToken(raw);
    if (result.ok) {
      res.locals[TOKEN] = result.token;
      return next();
    }
    if (result.failure === 'unavailable')
      return send(res, 503, { error: 'unavailable', message: result.message });
    res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
    send(res, 401, {
      error: 'unauthorized',
      message: `${result.failure === 'expired' ? 'Expired' : 'Invalid'} token: ${result.message}`,
    });
  };
}

function limit(limiter: RateLimiter, key: (req: Request, res: Response) => string): RequestHandler {
  return (req, res, next) => {
    const r = limiter.take(key(req, res));
    if (r.ok) next();
    else tooMany(res, r.retryAfterMs);
  };
}

export function createHistoryRouter({
  db,
  now,
  tokens,
  historyLimits = DEFAULT_HISTORY_LIMITS,
}: HistoryRouterDeps): Router {
  const byIp = new RateLimiter({ ...historyLimits.perIp, now });
  const reads = new RateLimiter({ ...historyLimits.reads, now });
  const enabled = tokens.projectId !== null || tokens.devTokens;

  const before: RequestHandler[] = [
    (_req, res, next) => {
      res.set('Cache-Control', 'no-store');
      next();
    },
    limit(byIp, (req) => clientKey(req.ip)),
    (_req, res, next) => {
      if (enabled) return next();
      send(res, 503, { error: 'disabled', message: 'Accounts are off: FIREBASE_PROJECT_ID is not set' });
    },
    auth(tokens),
    limit(reads, (_req, res) => tokenOf(res).uid),
  ];

  /** The caller's live account id, or undefined (the answer is sent). */
  async function accountOf(res: Response): Promise<string | undefined> {
    const user = await findLiveUser(db, tokenOf(res).uid);
    if (user === undefined) send(res, 404, { error: 'notRegistered', message: 'no account: register' });
    return user?.id;
  }

  const router = Router();

  router.get(HISTORY_PATHS.myGames, ...before, async (req, res) => {
    const raw = req.query.cursor;
    const cursor = raw === undefined ? null : decodeHistoryCursor(raw);
    if (raw !== undefined && cursor === null)
      return send(res, 400, { error: 'badRequest', message: 'cursor: send back a nextCursor as it came' });
    const userId = await accountOf(res);
    if (userId === undefined) return;
    const page: HistoryPage = await listUserGames(db, userId, cursor);
    res.json(page);
  });

  router.get(HISTORY_PATHS.replay, ...before, async (req, res) => {
    const id = req.params.id;
    if (typeof id !== 'string' || !GAME_ID_PATTERN.test(id))
      return send(res, 400, { error: 'badRequest', message: 'not a game id' });
    const userId = await accountOf(res);
    if (userId === undefined) return;
    const read = await readReplay(db, id, userId);
    if (read.kind === 'notFound') return send(res, 404, { error: 'notFound' });
    if (read.kind === 'notFinished')
      return send(res, 409, { error: 'notFinished', message: 'the game is not over (or not stored yet)' });
    const answer: ReplayAnswer = { game: read.game, events: read.events };
    res.json(answer);
  });

  return router;
}
