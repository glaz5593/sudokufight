import {
  type BlockedPlayer,
  type BlockList,
  MAX_BLOCKS,
  MODERATION_PATHS,
  type ModerationError,
  type ModerationField,
  PLAYER_ID_PATTERN,
  REPORT_REASONS,
  REPORT_RESPONSE_HOURS,
  type ReportReceipt,
} from '@sudoku-fight/protocol';
import { json, type Request, type RequestHandler, type Response, Router } from 'express';
import { z } from 'zod';

import { findLiveUser } from '../accounts/store';
import { bearerToken, type TokenVerifier, type VerifiedToken } from '../auth/firebaseToken';
import type { Db } from '../db';
import type { User } from '../db/schema';
import { clientKey } from '../http/clientKey';
import { RateLimiter, type RateLimitRule } from '../http/rateLimiter';
import { publicPlayers } from '../progress/players';
import type { ProgressSettings } from '../progress/settings';
import { addBlock, createReport, listBlocks, liveUserById, removeBlock } from './store';
import type { BlockWatch } from './watch';

/**
 * The app's moderation routes (spec §3.5; the contract: packages/protocol/src/moderation.ts):
 *   POST /v1/reports · GET, POST /v1/me/blocks · DELETE /v1/me/blocks/:playerId
 *
 * Each request passes, in order: a per-IP limit; the accounts switch (production without FIREBASE_PROJECT_ID:
 * 503 `disabled`); the token (required); a per-account limit; the body (JSON, MODERATION_BODY_BYTES at most);
 * the caller's account (none, or deleted: 404 `notRegistered`). Answers are never cached. The report quota
 * (REPORTS_PER_HOUR, 429 `rateLimited`) is counted in the database, so a restart doesn't reset it; the
 * per-account limit is only against floods. A block or an unblock is told to the BlockWatch, for the game
 * rooms that mute reactions.
 */

export interface ModerationLimits {
  /** Every route, per IP, before the token is checked. */
  perIp: RateLimitRule;
  /** GET /v1/me/blocks, per account. */
  reads: RateLimitRule;
  /** POST /v1/reports, POST and DELETE /v1/me/blocks, per account. */
  writes: RateLimitRule;
}

export const DEFAULT_MODERATION_LIMITS: ModerationLimits = {
  perIp: { limit: 300, windowMs: 60_000 },
  reads: { limit: 60, windowMs: 60_000 },
  writes: { limit: 30, windowMs: 60_000 },
};

export const MODERATION_BODY_BYTES = 1024;

export interface ModerationRouterDeps {
  db: Db;
  now: () => number;
  tokens: TokenVerifier;
  /** For the blocked players' public cards (league and level). */
  settings: ProgressSettings;
  watch: BlockWatch;
  moderationLimits?: ModerationLimits;
}

function send(res: Response, status: number, body: ModerationError): void {
  res.status(status).json(body);
}

const badRequest = (res: Response, field: ModerationField, message: string) =>
  send(res, 400, { error: 'badRequest', field, message });

const TOKEN = 'moderationToken';

function tokenOf(res: Response): VerifiedToken {
  const token = res.locals[TOKEN] as VerifiedToken | undefined;
  if (token === undefined) throw new Error('moderation route without the auth step');
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
    if (r.ok) return next();
    res.set('Retry-After', String(Math.max(1, Math.ceil(r.retryAfterMs / 1000))));
    send(res, 429, { error: 'tooManyRequests' });
  };
}

// ---- bodies -------------------------------------------------------------------------------------------------

const playerId = z.string().regex(PLAYER_ID_PATTERN, '1–64 letters, digits, _ or -');
const reportSchema = z.strictObject({
  playerId,
  reason: z.enum(REPORT_REASONS, { error: `one of ${REPORT_REASONS.join(', ')}` }),
  gameId: playerId.optional(),
});
const blockSchema = z.strictObject({ playerId });
const FIELDS: readonly ModerationField[] = ['playerId', 'reason', 'gameId'];

type Parsed<T> = { ok: true; value: T } | { ok: false; field: ModerationField; message: string };

function parseBody<T>(schema: z.ZodType<T>, body: unknown): Parsed<T> {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    return { ok: false, field: 'body', message: 'expected a JSON object (Content-Type: application/json)' };
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  const key = issue?.code === 'unrecognized_keys' ? undefined : issue?.path[0];
  return {
    ok: false,
    field: FIELDS.find((f) => f === key) ?? 'body',
    message: issue?.message ?? 'invalid',
  };
}

// ---- the router ---------------------------------------------------------------------------------------------

export function createModerationRouter({
  db,
  now,
  tokens,
  settings,
  watch,
  moderationLimits = DEFAULT_MODERATION_LIMITS,
}: ModerationRouterDeps): Router {
  const byIp = new RateLimiter({ ...moderationLimits.perIp, now });
  const reads = new RateLimiter({ ...moderationLimits.reads, now });
  const writes = new RateLimiter({ ...moderationLimits.writes, now });
  const enabled = tokens.projectId !== null || tokens.devTokens;
  const accountKey = (_req: Request, res: Response) => tokenOf(res).uid;

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
  ];
  const body = json({ limit: MODERATION_BODY_BYTES });

  /** The caller's live account, or undefined (the answer is sent). */
  async function accountOf(res: Response): Promise<User | undefined> {
    const user = await findLiveUser(db, tokenOf(res).uid);
    if (user === undefined) send(res, 404, { error: 'notRegistered', message: 'no account: register' });
    return user;
  }

  /** The other live player of a report or a block, or undefined (the answer is sent). */
  async function targetOf(res: Response, me: User, id: string): Promise<string | undefined> {
    if (id === me.id) {
      send(res, 400, { error: 'self', message: 'that is your own account' });
      return undefined;
    }
    const target = await liveUserById(db, id);
    if (target === undefined) send(res, 404, { error: 'notFound', message: 'no such player' });
    return target?.id;
  }

  async function blockedPlayer(id: string, blockedAt: Date): Promise<BlockedPlayer | null> {
    const card = (await publicPlayers(db, [id], settings)).get(id);
    return card === undefined ? null : { ...card, blockedAt: blockedAt.getTime() };
  }

  const router = Router();

  router.post(MODERATION_PATHS.reports, ...before, limit(writes, accountKey), body, async (req, res) => {
    const parsed = parseBody(reportSchema, req.body);
    if (!parsed.ok) return badRequest(res, parsed.field, parsed.message);
    const me = await accountOf(res);
    if (me === undefined) return;
    if (me.suspendedAt !== null)
      return send(res, 403, { error: 'suspended', message: 'this account is suspended' });
    const { playerId: target, reason, gameId } = parsed.value;
    const reportedId = await targetOf(res, me, target);
    if (reportedId === undefined) return;
    const t = now();
    const result = await createReport(
      db,
      { reporterId: me.id, reportedId, reason, gameId: gameId ?? null },
      t,
    );
    if (!result.ok) {
      if (result.error === 'duplicate') {
        return send(res, 409, {
          error: 'duplicate',
          reportId: result.reportId,
          message: 'this report is open already: we will review it',
        });
      }
      res.set('Retry-After', String(Math.max(1, Math.ceil((result.retryAt - t) / 1000))));
      return send(res, 429, {
        error: 'rateLimited',
        retryAt: result.retryAt,
        message: 'too many reports in the last hour',
      });
    }
    const { report } = result;
    const receipt: ReportReceipt = {
      id: report.id,
      playerId: report.reportedId,
      reason: report.reason,
      status: 'open',
      gameId: report.gameId,
      createdAt: report.createdAt.getTime(),
      respondWithinHours: REPORT_RESPONSE_HOURS,
    };
    res.status(201).json(receipt);
  });

  router.get(MODERATION_PATHS.blocks, ...before, limit(reads, accountKey), async (_req, res) => {
    const me = await accountOf(res);
    if (me === undefined) return;
    const rows = await listBlocks(db, me.id);
    const cards = await publicPlayers(
      db,
      rows.map((r) => r.blockedId),
      settings,
    );
    const answer: BlockList = {
      blocks: rows.flatMap((r) => {
        const card = cards.get(r.blockedId);
        return card === undefined ? [] : [{ ...card, blockedAt: r.createdAt.getTime() }];
      }),
      max: MAX_BLOCKS,
    };
    res.json(answer);
  });

  router.post(MODERATION_PATHS.blocks, ...before, limit(writes, accountKey), body, async (req, res) => {
    const parsed = parseBody(blockSchema, req.body);
    if (!parsed.ok) return badRequest(res, parsed.field, parsed.message);
    const me = await accountOf(res);
    if (me === undefined) return;
    const blockedId = await targetOf(res, me, parsed.value.playerId);
    if (blockedId === undefined) return;
    const result = await addBlock(db, me.id, blockedId, now());
    if (!result.ok) {
      return send(res, 409, {
        error: 'limitReached',
        max: MAX_BLOCKS,
        message: `at most ${MAX_BLOCKS} blocked players`,
      });
    }
    if (result.created) watch.notify({ blockerId: me.id, blockedId, blocked: true });
    const player = await blockedPlayer(blockedId, result.blockedAt);
    // Deleted between the check and the card: as if it never was.
    if (player === null) return send(res, 404, { error: 'notFound', message: 'no such player' });
    res.status(result.created ? 201 : 200).json(player);
  });

  router.delete(MODERATION_PATHS.block, ...before, limit(writes, accountKey), async (req, res) => {
    const id = req.params.playerId;
    if (typeof id !== 'string' || !PLAYER_ID_PATTERN.test(id))
      return badRequest(res, 'playerId', 'not a player id');
    const me = await accountOf(res);
    if (me === undefined) return;
    if (await removeBlock(db, me.id, id)) watch.notify({ blockerId: me.id, blockedId: id, blocked: false });
    res.status(204).end();
  });

  return router;
}
