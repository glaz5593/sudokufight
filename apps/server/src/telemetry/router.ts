import { MAX_BATCH_BYTES, TELEMETRY_PATH, type TelemetryResponse } from '@sudoku-fight/protocol';
import { json, Router } from 'express';

import { liveUserId } from '../accounts/store';
import { bearerToken, type TokenVerifier } from '../auth/firebaseToken';
import type { Db } from '../db';
import { clientKey } from '../http/clientKey';
import { sendError, sendTooManyRequests } from '../http/errors';
import { RateLimiter, type RateLimitRule } from '../http/rateLimiter';
import { parseBatch } from './schema';
import { storeBatch } from './store';

/**
 * `POST /v1/events` (spec §27.2): a batch of usage events from the app → 202 TelemetryResponse. Events of a
 * name this server does not know (a newer app's) are skipped and counted in `ignored`, which the answer has
 * only when there were some (1.0.2; an older app never sees it).
 *
 * Order matters: the per-IP limit runs before the body is even read, so a flood costs little; the
 * per-install limit runs on a valid batch (its installId is known only then).
 *
 * Who sent it (stage 8): an optional `Authorization: Bearer <Firebase ID token>`. A valid token of a live
 * account puts that account on the batch's events and on the install; no token, a bad one or one without an
 * account changes nothing, and the batch is stored anonymous all the same (usage data must not be lost to an
 * expired token). Never from the body.
 */

export interface TelemetryLimits {
  perIp: RateLimitRule;
  perInstall: RateLimitRule;
}

/** A phone sends a batch every few seconds at most; an IP may stand for many phones (a NAT, a carrier). */
export const DEFAULT_TELEMETRY_LIMITS: TelemetryLimits = {
  perIp: { limit: 120, windowMs: 60_000 },
  perInstall: { limit: 30, windowMs: 60_000 },
};

export interface TelemetryRouterDeps {
  db: Db;
  now: () => number;
  telemetryLimits?: TelemetryLimits;
  /** Checks the optional token; without one, every batch is anonymous. */
  tokens?: TokenVerifier;
}

export function createTelemetryRouter({
  db,
  now,
  telemetryLimits = DEFAULT_TELEMETRY_LIMITS,
  tokens,
}: TelemetryRouterDeps): Router {
  const byIp = new RateLimiter({ ...telemetryLimits.perIp, now });
  const byInstall = new RateLimiter({ ...telemetryLimits.perInstall, now });

  /** The users.id of the batch's sender, or null. */
  async function senderOf(authorization: string | undefined): Promise<string | null> {
    const raw = bearerToken(authorization);
    if (tokens === undefined || raw === undefined) return null;
    const result = await tokens.verifyIdToken(raw);
    return result.ok ? liveUserId(db, result.token.uid) : null;
  }

  const router = Router();
  router.post(
    TELEMETRY_PATH,
    (req, res, next) => {
      const r = byIp.take(clientKey(req.ip));
      if (r.ok) next();
      else sendTooManyRequests(res, r.retryAfterMs);
    },
    json({ limit: MAX_BATCH_BYTES }),
    async (req, res) => {
      const parsed = parseBatch(req.body, now());
      if (!parsed.ok) return sendError(res, 400, 'badRequest', parsed.message);
      const r = byInstall.take(parsed.batch.installId);
      if (!r.ok) return sendTooManyRequests(res, r.retryAfterMs);
      const userId = await senderOf(req.get('authorization'));
      const stored = await storeBatch(db, parsed.batch, now(), userId);
      const answer: TelemetryResponse = parsed.ignored > 0 ? { ...stored, ignored: parsed.ignored } : stored;
      res.status(202).json(answer);
    },
  );
  return router;
}
