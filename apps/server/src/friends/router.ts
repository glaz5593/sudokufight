import { isGameType } from '@sudoku-fight/engine';
import {
  FRIENDS_ERROR_STATUS,
  FRIENDS_PATHS,
  type FriendRoomCreateRequest,
  type FriendRoomJoinRequest,
  type FriendsError,
  type FriendsErrorCode,
  type FriendsField,
  normalizeFriendCode,
  parseDeclaredInterferenceKinds,
} from '@sudoku-fight/protocol';
import {
  type ErrorRequestHandler,
  json,
  type Request,
  type RequestHandler,
  type Response,
  Router,
} from 'express';

import { findLiveUser } from '../accounts/store';
import { bearerToken, type TokenVerifier, type VerifiedToken } from '../auth/firebaseToken';
import { DEFAULT_FRIENDS_LIMITS, type FriendsLimits } from '../config';
import type { Db } from '../db';
import { clientKey } from '../http/clientKey';
import { errorForLog } from '../http/errors';
import { RateLimiter, type RateLimitRule } from '../http/rateLimiter';
import { reportError } from '../monitoring/report';
import type { FriendRooms, FriendRoomsResult, FriendsCaller } from './service';

/**
 * The app's routes of playing with friends (1.0.4; docs/handoff/2026-10-19/friends-room.md §5; the contract:
 * packages/protocol/src/friends.ts):
 *   POST /v1/rooms        FriendRoomCreateRequest → 201 FriendRoomTicket (the caller hosts the room)
 *   POST /v1/rooms/join   FriendRoomJoinRequest   → 200 FriendRoomTicket
 *
 * Each request passes, in order: a per-IP flood limit (before the token is checked: checking one costs); the
 * accounts switch (production without FIREBASE_PROJECT_ID: 503 `disabled`); the token (required: 401
 * `unauthorized`); the limits of §5 [D86] (create: 10 an hour per account; join: 20 in 10 minutes per account
 * and 60 per IP; FRIENDS_* settings) → 429 `tooManyRequests` with Retry-After; the body (JSON, FRIENDS_BODY_BYTES
 * at most; a code is taken in any form normalizeFriendCode reads, and goes on in its canonical one); the
 * caller's live account (none: 404 `notRegistered`). Then the FriendRooms service decides, and its answer goes
 * out with the status of FRIENDS_ERROR_STATUS.
 *
 * Every error answer carries `rooms: true` (FriendsError): that is how the app tells "no room with this code"
 * (404 `notFound`) from a server older than these routes (its 404 has no `rooms`): friendsErrorOf(). Answers
 * are personal: never cached. No code or account goes to the log from here.
 */

/** At most this many bytes of JSON in a request body (a code, a game type, 16 kinds: well under it). */
export const FRIENDS_BODY_BYTES = 2048;

/** Every /v1/rooms request per IP, before the token is checked: only against floods. */
export const DEFAULT_FRIENDS_FLOOD_LIMIT: RateLimitRule = { limit: 120, windowMs: 60_000 };

export interface FriendsRouterDeps {
  db: Db;
  now: () => number;
  tokens: TokenVerifier;
  friendRooms: FriendRooms;
  /** The limits of §5 (ServerConfig.friends.limits; default DEFAULT_FRIENDS_LIMITS). */
  limits?: FriendsLimits;
  /** The flood limit per IP (default DEFAULT_FRIENDS_FLOOD_LIMIT); tests make it small. */
  floodLimit?: RateLimitRule;
}

interface FailDetails {
  message?: string;
  field?: FriendsField;
  retryAfterMs?: number;
  code?: string;
}

/** Whole seconds to wait, at least 1 (the Retry-After header and `retryAfterSec`). */
const retryAfterSecOf = (ms: number | undefined): number => Math.max(1, Math.ceil((ms ?? 1000) / 1000));

/** An error answer: its status, `rooms: true`, and for 429 the Retry-After header. */
export function sendFriendsError(res: Response, error: FriendsErrorCode, details: FailDetails = {}): void {
  const body: FriendsError = { error, rooms: true };
  if (details.message !== undefined) body.message = details.message;
  if (error === 'badRequest' && details.field !== undefined) body.field = details.field;
  if (error === 'tooManyRequests') {
    body.retryAfterSec = retryAfterSecOf(details.retryAfterMs);
    res.set('Retry-After', String(body.retryAfterSec));
  }
  if (error === 'tooManyRooms' && details.code !== undefined) body.code = details.code;
  res.status(FRIENDS_ERROR_STATUS[error]).json(body);
}

const TOKEN = 'friendsToken';

function tokenOf(res: Response): VerifiedToken {
  const token = res.locals[TOKEN] as VerifiedToken | undefined;
  if (token === undefined) throw new Error('friends route without the auth step');
  return token;
}

/** The bearer token, verified: none or a bad one → 401 (503 when it can't be checked right now). */
function auth(tokens: TokenVerifier): RequestHandler {
  return async (req, res, next) => {
    const raw = bearerToken(req.get('authorization'));
    if (raw === undefined) {
      res.set('WWW-Authenticate', 'Bearer');
      return sendFriendsError(res, 'unauthorized', { message: 'Sign in: Authorization: Bearer <token>' });
    }
    const result = await tokens.verifyIdToken(raw);
    if (result.ok) {
      res.locals[TOKEN] = result.token;
      return next();
    }
    if (result.failure === 'unavailable')
      return sendFriendsError(res, 'unavailable', { message: result.message });
    res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
    sendFriendsError(res, 'unauthorized', {
      message: `${result.failure === 'expired' ? 'Expired' : 'Invalid'} token: ${result.message}`,
    });
  };
}

function limit(limiter: RateLimiter, key: (req: Request, res: Response) => string): RequestHandler {
  return (req, res, next) => {
    const r = limiter.take(key(req, res));
    if (r.ok) return next();
    sendFriendsError(res, 'tooManyRequests', { retryAfterMs: r.retryAfterMs });
  };
}

// ---- bodies -----------------------------------------------------------------------------------------------------

type Parsed<T> = { ok: true; value: T } | { ok: false; field: FriendsField; message: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const bad = (field: FriendsField, message: string): Parsed<never> => ({ ok: false, field, message });

/**
 * The optional fields both bodies may have. Keys this server does not know are left out, not refused: a newer
 * app may send more.
 */
function parseKinds(body: Record<string, unknown>): Parsed<{ interferenceKinds?: string[] }> {
  if (body.interferenceKinds === undefined) return { ok: true, value: {} };
  const kinds = parseDeclaredInterferenceKinds(body.interferenceKinds);
  if (kinds === undefined)
    return bad(
      'interferenceKinds',
      'a list of at most 16 interference kinds (strings of 32 characters at most)',
    );
  return { ok: true, value: { interferenceKinds: kinds } };
}

/** POST /v1/rooms: every field is optional, so no body at all is `{}`. */
export function parseCreateRequest(raw: unknown): Parsed<FriendRoomCreateRequest> {
  const body = raw === undefined ? {} : raw;
  if (!isRecord(body)) return bad('body', 'expected a JSON object (Content-Type: application/json)');
  const request: FriendRoomCreateRequest = {};
  if (body.gameType !== undefined) {
    if (!isGameType(body.gameType)) return bad('gameType', 'one of fast, normal, hard');
    request.gameType = body.gameType;
  }
  const kinds = parseKinds(body);
  if (!kinds.ok) return kinds;
  if (kinds.value.interferenceKinds !== undefined) request.interferenceKinds = kinds.value.interferenceKinds;
  if (body.replace !== undefined) {
    if (typeof body.replace !== 'boolean') return bad('replace', 'true or false');
    request.replace = body.replace;
  }
  return { ok: true, value: request };
}

/** POST /v1/rooms/join: the code in any form normalizeFriendCode reads ("123 456", "123-456"), canonical after. */
export function parseJoinRequest(raw: unknown): Parsed<FriendRoomJoinRequest> {
  if (!isRecord(raw)) return bad('body', 'expected a JSON object (Content-Type: application/json)');
  const code = normalizeFriendCode(raw.code);
  if (code === null) return bad('code', 'a room code: 6 digits');
  const request: FriendRoomJoinRequest = { code };
  const kinds = parseKinds(raw);
  if (!kinds.ok) return kinds;
  if (kinds.value.interferenceKinds !== undefined) request.interferenceKinds = kinds.value.interferenceKinds;
  return { ok: true, value: request };
}

// ---- errors -----------------------------------------------------------------------------------------------------

/** The status an error asks for: body-parser sets `status` (4xx); anything else is ours: 500. */
function clientStatusOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const { status, statusCode } = err as { status?: unknown; statusCode?: unknown };
  const s = typeof status === 'number' ? status : statusCode;
  return typeof s === 'number' && s >= 400 && s < 500 ? s : undefined;
}

/**
 * The routes' own last step, so even a body that can't be read or a bug answers with `rooms: true` (the
 * server's jsonErrorHandler would answer without it). A 500 is logged and reported, as there.
 */
const friendsErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = clientStatusOf(err);
  if (status === 413) return sendFriendsError(res, 'tooLarge');
  if (status !== undefined) {
    const type = (err as { type?: unknown }).type;
    return sendFriendsError(res, 'badRequest', {
      field: 'body',
      message: type === 'entity.parse.failed' ? 'invalid JSON' : 'the body could not be read',
    });
  }
  console.error(`[http] ${req.method} ${req.path} failed`, errorForLog(err));
  const pattern = (req as { route?: { path?: unknown } }).route?.path;
  const route = typeof pattern === 'string' ? `${req.baseUrl}${pattern}` : req.path;
  reportError(err, { area: 'http', tags: { method: req.method, route } });
  sendFriendsError(res, 'internal');
};

// ---- the router -------------------------------------------------------------------------------------------------

export function createFriendsRouter({
  db,
  now,
  tokens,
  friendRooms,
  limits = DEFAULT_FRIENDS_LIMITS,
  floodLimit = DEFAULT_FRIENDS_FLOOD_LIMIT,
}: FriendsRouterDeps): Router {
  const flood = new RateLimiter({ ...floodLimit, now });
  const creates = new RateLimiter({ ...limits.create, now });
  const joinsByAccount = new RateLimiter({ ...limits.joinPerAccount, now });
  const joinsByIp = new RateLimiter({ ...limits.joinPerIp, now });
  const enabled = tokens.projectId !== null || tokens.devTokens;
  const ipKey = (req: Request) => clientKey(req.ip);
  const accountKey = (_req: Request, res: Response) => tokenOf(res).uid;

  const before: RequestHandler[] = [
    (_req, res, next) => {
      res.set('Cache-Control', 'no-store');
      next();
    },
    limit(flood, ipKey),
    (_req, res, next) => {
      if (enabled) return next();
      sendFriendsError(res, 'disabled', { message: 'Accounts are off: FIREBASE_PROJECT_ID is not set' });
    },
    auth(tokens),
  ];
  const body = json({ limit: FRIENDS_BODY_BYTES });

  /** The caller as the service takes it, or undefined (the answer is sent: 404 notRegistered). */
  async function callerOf(req: Request, res: Response): Promise<FriendsCaller | undefined> {
    const user = await findLiveUser(db, tokenOf(res).uid);
    if (user === undefined) {
      sendFriendsError(res, 'notRegistered', { message: 'no account: register' });
      return undefined;
    }
    return {
      userId: user.id,
      name: user.displayName,
      suspended: user.suspendedAt !== null,
      ipKey: clientKey(req.ip),
    };
  }

  function answer(res: Response, result: FriendRoomsResult, okStatus: 200 | 201): void {
    if (result.ok) {
      res.status(okStatus).json(result.ticket);
      return;
    }
    const { error, message, field, retryAfterMs, code } = result;
    sendFriendsError(res, error, { message, field, retryAfterMs, code });
  }

  const router = Router();

  router.post(FRIENDS_PATHS.rooms, ...before, limit(creates, accountKey), body, async (req, res) => {
    const parsed = parseCreateRequest(req.body);
    if (!parsed.ok) return sendFriendsError(res, 'badRequest', parsed);
    const caller = await callerOf(req, res);
    if (caller === undefined) return;
    answer(res, await friendRooms.create(caller, parsed.value), 201);
  });

  router.post(
    FRIENDS_PATHS.join,
    ...before,
    limit(joinsByAccount, accountKey),
    limit(joinsByIp, ipKey),
    body,
    async (req, res) => {
      const parsed = parseJoinRequest(req.body);
      if (!parsed.ok) return sendFriendsError(res, 'badRequest', parsed);
      const caller = await callerOf(req, res);
      if (caller === undefined) return;
      answer(res, await friendRooms.join(caller, parsed.value), 200);
    },
  );

  // Under /v1/rooms only: a body that can't be read, or a bug, still answers with `rooms: true`.
  router.use(FRIENDS_PATHS.rooms, friendsErrorHandler);
  return router;
}
