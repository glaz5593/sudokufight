import {
  ACCOUNT_PATHS,
  type AccountError,
  type AccountField,
  isAvatarId,
  isCountryCode,
  type NameAvailability,
} from '@sudoku-fight/protocol';
import { json, type Request, type RequestHandler, type Response, Router } from 'express';
import { z } from 'zod';

import { bearerToken, type TokenVerifier, type VerifiedToken } from '../auth/firebaseToken';
import type { ServerConfig } from '../config';
import type { Db } from '../db';
import { clientKey } from '../http/clientKey';
import { RateLimiter, type RateLimitRule } from '../http/rateLimiter';
import { type BlockedWords, defaultBlockedWords } from './blockedWords';
import { checkName } from './names';
import {
  createUser,
  deleteUser,
  findLiveUser,
  isNameTaken,
  type NewUser,
  syncEmail,
  toMe,
  updateUser,
  type UserChanges,
} from './store';

/**
 * The account routes (spec §18 "HTTP API"; the contract with its answers: packages/protocol/src/account.ts):
 *   GET /v1/names/available · POST /v1/users · GET, PATCH and DELETE /v1/me
 *
 * Each request passes, in order: a per-IP limit (cheap, before anything is read); the accounts switch
 * (production without FIREBASE_PROJECT_ID: 503 `disabled`); the token (`Authorization: Bearer`, optional for
 * the name check); a per-account limit (per IP for an anonymous name check); the body (JSON, 2 KB at most).
 * DELETE /v1/me also wants a recent sign-in (ACCOUNT_DELETE_MAX_AUTH_AGE_MS, default protocol
 * RECENT_SIGN_IN_MS).
 * Answers are never cached (`Cache-Control: no-store`): they are personal.
 */

export interface AccountLimits {
  /** Every account route, per IP, before the token is checked. */
  perIp: RateLimitRule;
  /** The name check while typing (300 ms debounce), per account, or per IP before registration. */
  names: RateLimitRule;
  /** GET /v1/me, per account. */
  reads: RateLimitRule;
  /** POST /v1/users, PATCH and DELETE /v1/me, per account. */
  writes: RateLimitRule;
}

export const DEFAULT_ACCOUNT_LIMITS: AccountLimits = {
  perIp: { limit: 300, windowMs: 60_000 },
  names: { limit: 60, windowMs: 60_000 },
  reads: { limit: 60, windowMs: 60_000 },
  writes: { limit: 10, windowMs: 60_000 },
};

export const MAX_ACCOUNT_BODY_BYTES = 2048;

export interface AccountsRouterDeps {
  config: Pick<ServerConfig, 'ratingOption' | 'nodeEnv' | 'accountDeleteMaxAuthAgeMs'>;
  db: Db;
  now: () => number;
  tokens: TokenVerifier;
  accountLimits?: AccountLimits;
  /** Default: apps/server/data/blocked-words.json. */
  blockedWords?: BlockedWords;
}

function send(res: Response, status: number, body: AccountError): void {
  res.status(status).json(body);
}

const badRequest = (res: Response, field: AccountField, message: string) =>
  send(res, 400, { error: 'badRequest', field, message });

function unauthorized(res: Response, message: string, invalidToken: boolean): void {
  res.set('WWW-Authenticate', invalidToken ? 'Bearer error="invalid_token"' : 'Bearer');
  send(res, 401, { error: 'unauthorized', message });
}

type DeleteRules = Pick<ServerConfig, 'nodeEnv' | 'accountDeleteMaxAuthAgeMs'>;

/**
 * Deleting the account needs a fresh sign-in (ACCOUNT_DELETE_MAX_AUTH_AGE_MS, default 5 minutes: Firebase's
 * own rule): the token's sign-in time (auth_time), which a refreshed token keeps, so a phone left signed in
 * for days can't delete the account without the password. A token with no sign-in time is a development
 * token: taken as fresh outside production only (production refuses development tokens anyway; this keeps
 * deletion closed to them should that ever change).
 */
function signedInRecently(token: VerifiedToken, now: number, rules: DeleteRules): boolean {
  if (token.signedInAt === null) return token.kind === 'dev' && rules.nodeEnv !== 'production';
  return now - token.signedInAt <= rules.accountDeleteMaxAuthAgeMs;
}

const howLong = (ms: number) =>
  ms === 60_000 ? '1 minute' : ms % 60_000 === 0 ? `${ms / 60_000} minutes` : `${ms / 1000} seconds`;

/** 401 reauthRequired, with RFC 9470's step-up answer saying what is missing. */
function signInAgain(res: Response, maxAgeMs: number): void {
  res.set(
    'WWW-Authenticate',
    'Bearer error="insufficient_user_authentication", ' +
      `error_description="A recent sign-in is required", max_age=${Math.floor(maxAgeMs / 1000)}`,
  );
  send(res, 401, {
    error: 'reauthRequired',
    message: `Sign in again: deleting the account needs a sign-in within the last ${howLong(maxAgeMs)}`,
  });
}

function tooMany(res: Response, retryAfterMs: number): void {
  res.set('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  send(res, 429, { error: 'tooManyRequests' });
}

const TOKEN = 'accountToken';

/** The verified token of this request (set by the auth step), if any. */
function tokenOf(res: Response): VerifiedToken | undefined {
  return res.locals[TOKEN] as VerifiedToken | undefined;
}

function requiredToken(res: Response): VerifiedToken {
  const token = tokenOf(res);
  if (token === undefined) throw new Error('account route without the auth step');
  return token;
}

/**
 * The bearer token, verified. `required`: none or a bad one → 401 (503 when it can't be checked right now).
 * Optional: none or a bad one → the request goes on anonymous.
 */
function auth(tokens: TokenVerifier, required: boolean): RequestHandler {
  return async (req, res, next) => {
    const raw = bearerToken(req.get('authorization'));
    if (raw === undefined) {
      if (required) return unauthorized(res, 'Sign in: Authorization: Bearer <Firebase ID token>', false);
      return next();
    }
    const result = await tokens.verifyIdToken(raw);
    if (result.ok) {
      res.locals[TOKEN] = result.token;
      return next();
    }
    if (!required) return next();
    // Google's keys are out of reach: not the player's fault, so no 401 (the app would sign them out).
    if (result.failure === 'unavailable') {
      return send(res, 503, { error: 'unavailable', message: result.message });
    }
    unauthorized(
      res,
      `${result.failure === 'expired' ? 'Expired' : 'Invalid'} token: ${result.message}`,
      true,
    );
  };
}

function limit(limiter: RateLimiter, key: (req: Request, res: Response) => string): RequestHandler {
  return (req, res, next) => {
    const r = limiter.take(key(req, res));
    if (r.ok) next();
    else tooMany(res, r.retryAfterMs);
  };
}

// ---- bodies -------------------------------------------------------------------------------------------------

const createSchema = z.strictObject({ displayName: z.string(), avatarId: z.string(), country: z.string() });
const updateSchema = z.strictObject({
  displayName: z.string().optional(),
  avatarId: z.string().optional(),
  country: z.string().optional(),
});
const FIELDS: readonly AccountField[] = ['displayName', 'avatarId', 'country'];

type Parsed<T> = { ok: true; value: T } | { ok: false; field: AccountField; message: string };
type RawFields = { displayName?: string; avatarId?: string; country?: string };

/** The body checked by `schema`, with a choosable avatar and a known country, as T. */
function parseBody<T extends RawFields>(schema: z.ZodType<RawFields>, body: unknown): Parsed<T> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, field: 'body', message: 'expected a JSON object (Content-Type: application/json)' };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const key = issue?.code === 'unrecognized_keys' ? undefined : issue?.path[0];
    const field = FIELDS.find((f) => f === key) ?? 'body';
    return { ok: false, field, message: issue?.message ?? 'invalid' };
  }
  const value = parsed.data;
  if (value.avatarId !== undefined && !isAvatarId(value.avatarId)) {
    return { ok: false, field: 'avatarId', message: 'not an avatar one can choose (AVATAR_IDS)' };
  }
  if (value.country !== undefined && !isCountryCode(value.country)) {
    return { ok: false, field: 'country', message: 'not an ISO 3166-1 alpha-2 code (upper case)' };
  }
  return { ok: true, value: value as T };
}

/** Sends the answer for a name that breaks the rules; true when it did. */
function refuseName(res: Response, name: string, words: BlockedWords): boolean {
  const check = checkName(name, words);
  if (check.ok) return false;
  if (check.reason === 'invalid') {
    send(res, 400, { error: 'invalidName', problem: check.problem, message: 'see NAME_RULES' });
  } else {
    send(res, 422, { error: 'blocked', message: 'the name contains a word that is not allowed' });
  }
  return true;
}

// ---- the router -----------------------------------------------------------------------------------------------

export function createAccountsRouter({
  config,
  db,
  now,
  tokens,
  accountLimits = DEFAULT_ACCOUNT_LIMITS,
  blockedWords = defaultBlockedWords(),
}: AccountsRouterDeps): Router {
  const byIp = new RateLimiter({ ...accountLimits.perIp, now });
  const names = new RateLimiter({ ...accountLimits.names, now });
  const reads = new RateLimiter({ ...accountLimits.reads, now });
  const writes = new RateLimiter({ ...accountLimits.writes, now });
  // Production without a Firebase project has no way to sign anyone in.
  const enabled = tokens.projectId !== null || tokens.devTokens;

  const ipKey = (req: Request) => clientKey(req.ip);
  const accountKey = (_req: Request, res: Response) => requiredToken(res).uid;

  const before: RequestHandler[] = [
    (_req, res, next) => {
      res.set('Cache-Control', 'no-store');
      next();
    },
    limit(byIp, ipKey),
    (_req, res, next) => {
      if (enabled) return next();
      send(res, 503, { error: 'disabled', message: 'Accounts are off: FIREBASE_PROJECT_ID is not set' });
    },
  ];
  const body = json({ limit: MAX_ACCOUNT_BODY_BYTES });

  const router = Router();

  router.get(
    ACCOUNT_PATHS.namesAvailable,
    ...before,
    auth(tokens, false),
    limit(names, (req, res) => tokenOf(res)?.uid ?? `ip:${ipKey(req)}`),
    async (req, res) => {
      const { name } = req.query;
      if (typeof name !== 'string') return badRequest(res, 'name', 'expected one ?name=');
      const check = checkName(name, blockedWords);
      let answer: NameAvailability;
      if (!check.ok) {
        answer =
          check.reason === 'invalid'
            ? { available: false, reason: 'invalid', problem: check.problem }
            : { available: false, reason: 'blocked' };
      } else {
        // The caller's own name (any case) is theirs to keep: available.
        const token = tokenOf(res);
        const self = token === undefined ? undefined : await findLiveUser(db, token.uid);
        answer = (await isNameTaken(db, name, self?.id))
          ? { available: false, reason: 'taken' }
          : { available: true };
      }
      res.json(answer);
    },
  );

  router.post(
    ACCOUNT_PATHS.users,
    ...before,
    auth(tokens, true),
    limit(writes, accountKey),
    body,
    async (req, res) => {
      const token = requiredToken(res);
      const parsed = parseBody<NewUser>(createSchema, req.body);
      if (!parsed.ok) return badRequest(res, parsed.field, parsed.message);
      if (refuseName(res, parsed.value.displayName, blockedWords)) return;
      // A clear answer for a second registration; the unique uid catches two at once.
      if ((await findLiveUser(db, token.uid)) !== undefined) {
        return send(res, 409, { error: 'alreadyRegistered', message: 'this sign-in already has an account' });
      }
      const t = now();
      const created = await createUser(db, token, parsed.value, config.ratingOption, t);
      if (!created.ok) {
        return created.error === 'taken'
          ? send(res, 409, { error: 'taken', message: 'the name is taken' })
          : send(res, 409, { error: 'alreadyRegistered', message: 'this sign-in already has an account' });
      }
      res.status(201).json(await toMe(db, created.user, token, config.ratingOption, t));
    },
  );

  router.get(ACCOUNT_PATHS.me, ...before, auth(tokens, true), limit(reads, accountKey), async (_req, res) => {
    const token = requiredToken(res);
    const user = await findLiveUser(db, token.uid);
    if (user === undefined)
      return send(res, 404, { error: 'notRegistered', message: 'no account: register' });
    res.json(await toMe(db, await syncEmail(db, user, token), token, config.ratingOption, now()));
  });

  router.patch(
    ACCOUNT_PATHS.me,
    ...before,
    auth(tokens, true),
    limit(writes, accountKey),
    body,
    async (req, res) => {
      const token = requiredToken(res);
      const parsed = parseBody<UserChanges>(updateSchema, req.body);
      if (!parsed.ok) return badRequest(res, parsed.field, parsed.message);
      const changes = parsed.value;
      if (
        changes.displayName === undefined &&
        changes.avatarId === undefined &&
        changes.country === undefined
      ) {
        return badRequest(res, 'body', 'nothing to change: displayName, avatarId or country');
      }
      const user = await findLiveUser(db, token.uid);
      if (user === undefined)
        return send(res, 404, { error: 'notRegistered', message: 'no account: register' });
      // The name is checked only when it changes: a name from before a word was listed may stay.
      if (changes.displayName !== undefined && changes.displayName !== user.displayName) {
        if (refuseName(res, changes.displayName, blockedWords)) return;
      }
      const t = now();
      const updated = await updateUser(db, token, changes, t);
      if (!updated.ok) {
        if (updated.error === 'renameTooSoon') {
          return send(res, 409, {
            error: 'renameTooSoon',
            nextRenameAt: updated.nextRenameAt,
            message: 'the name can change once in 30 days',
          });
        }
        if (updated.error === 'taken')
          return send(res, 409, { error: 'taken', message: 'the name is taken' });
        return send(res, 404, { error: 'notRegistered', message: 'no account: register' });
      }
      res.json(await toMe(db, updated.user, token, config.ratingOption, t));
    },
  );

  router.delete(
    ACCOUNT_PATHS.me,
    ...before,
    auth(tokens, true),
    limit(writes, accountKey),
    async (_req, res) => {
      const token = requiredToken(res);
      if (!signedInRecently(token, now(), config)) return signInAgain(res, config.accountDeleteMaxAuthAgeMs);
      const deleted = await deleteUser(db, token, now());
      if (!deleted)
        return send(res, 404, { error: 'notRegistered', message: 'no account (already deleted?)' });
      res.status(204).end();
    },
  );

  return router;
}
