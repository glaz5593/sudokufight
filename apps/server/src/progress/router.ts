import { GAME_TYPES } from '@sudoku-fight/engine';
import {
  LEADERBOARD_TABS,
  type LeaderboardTab,
  MAX_PRACTICE_RESULTS,
  PRACTICE_ID_PATTERN,
  PRACTICE_OUTCOMES,
  PROGRESS_PATHS,
  type ProgressError,
  type PracticeResult,
  type PracticeResultsResponse,
} from '@sudoku-fight/protocol';
import { json, type Request, type RequestHandler, type Response, Router } from 'express';
import { z } from 'zod';

import { findLiveUser } from '../accounts/store';
import { bearerToken, type TokenVerifier, type VerifiedToken } from '../auth/firebaseToken';
import type { Db } from '../db';
import { clientKey } from '../http/clientKey';
import { RateLimiter, type RateLimitRule } from '../http/rateLimiter';
import { readPlayerCard } from './card';
import { decodeLeaderboardCursor } from './cursor';
import { type LeaderboardPlayers, readLeaderboard } from './leaderboard';
import { recordPracticeResults } from './practice';
import type { ProgressSettings } from './settings';
import { readMyProgress } from './xp';

/**
 * The progress routes (spec §11.3, §14.2, §14.3, §15; the contract: packages/protocol/src/progress.ts):
 *   GET /v1/leaderboard · GET /v1/players/:id · GET /v1/me/progress · POST /v1/me/practice-results
 *
 * Each request passes, in order: a per-IP limit; the accounts switch (production without FIREBASE_PROJECT_ID:
 * 503 `disabled`); the token (`Authorization: Bearer`, required); a per-account limit (reads, or practice
 * writes); the account itself (none, or deleted: 404 `notRegistered`); for the practice results, the body
 * (JSON, PRACTICE_BODY_BYTES at most, MAX_PRACTICE_RESULTS results at most). Answers are never cached.
 */

export interface ProgressLimits {
  /** Every progress route, per IP, before the token is checked. */
  perIp: RateLimitRule;
  /** Leaderboards, cards and progress, per account. */
  reads: RateLimitRule;
  /** Practice result batches, per account. */
  writes: RateLimitRule;
}

export const DEFAULT_PROGRESS_LIMITS: ProgressLimits = {
  perIp: { limit: 300, windowMs: 60_000 },
  reads: { limit: 120, windowMs: 60_000 },
  writes: { limit: 20, windowMs: 60_000 },
};

/** MAX_PRACTICE_RESULTS results of about 150 bytes each, with room to spare. */
export const PRACTICE_BODY_BYTES = 32 * 1024;

/** A player id the card route takes: users' UUIDs (and short ids in tests). */
const PLAYER_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface ProgressRouterDeps {
  db: Db;
  now: () => number;
  tokens: TokenVerifier;
  settings: ProgressSettings;
  progressLimits?: ProgressLimits;
}

function send(res: Response, status: number, body: ProgressError): void {
  res.status(status).json(body);
}

const badRequest = (res: Response, message: string) => send(res, 400, { error: 'badRequest', message });

const TOKEN = 'progressToken';

function tokenOf(res: Response): VerifiedToken {
  const token = res.locals[TOKEN] as VerifiedToken | undefined;
  if (token === undefined) throw new Error('progress route without the auth step');
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

// ---- queries and bodies ---------------------------------------------------------------------------------

/** The one value of a query parameter: undefined when absent, null when repeated or not a string. */
function single(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : null;
}

const isTab = (v: string): v is LeaderboardTab => (LEADERBOARD_TABS as readonly string[]).includes(v);

const practiceSchema = z.strictObject({
  results: z
    .array(
      z.strictObject({
        id: z.string().regex(PRACTICE_ID_PATTERN, 'id: 1–64 letters, digits, _ or -'),
        mode: z.enum(['solo', 'bot']),
        gameType: z.enum(GAME_TYPES),
        outcome: z.enum(PRACTICE_OUTCOMES),
        // A board has 81 cells: nobody places more correct digits than that.
        correct: z.number().int().min(0).max(81),
        endedAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      }),
    )
    .max(MAX_PRACTICE_RESULTS, `at most ${MAX_PRACTICE_RESULTS} results a request`),
});

function issueText(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return 'invalid';
  const where = issue.path.join('.');
  return where === '' ? issue.message : `${where}: ${issue.message}`;
}

// ---- the router -----------------------------------------------------------------------------------------

export function createProgressRouter({
  db,
  now,
  tokens,
  settings,
  progressLimits = DEFAULT_PROGRESS_LIMITS,
}: ProgressRouterDeps): Router {
  const byIp = new RateLimiter({ ...progressLimits.perIp, now });
  const reads = new RateLimiter({ ...progressLimits.reads, now });
  const writes = new RateLimiter({ ...progressLimits.writes, now });
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

  /** The caller's live account id, or undefined (the answer is sent). */
  async function accountOf(res: Response): Promise<string | undefined> {
    const user = await findLiveUser(db, tokenOf(res).uid);
    if (user === undefined) send(res, 404, { error: 'notRegistered', message: 'no account: register' });
    return user?.id;
  }

  const router = Router();

  router.get(PROGRESS_PATHS.leaderboard, ...before, limit(reads, accountKey), async (req, res) => {
    const tab = single(req.query.tab) ?? 'general';
    if (tab === null || !isTab(tab)) return badRequest(res, `tab: one of ${LEADERBOARD_TABS.join(', ')}`);
    const rawPlayers = single(req.query.players);
    let players: LeaderboardPlayers | null = null;
    if (rawPlayers !== undefined) {
      if (rawPlayers !== '2' && rawPlayers !== '3' && rawPlayers !== '4')
        return badRequest(res, 'players: 2, 3 or 4');
      players = Number(rawPlayers) as LeaderboardPlayers;
    }
    const rawCursor = single(req.query.cursor);
    const cursor = rawCursor === undefined ? null : decodeLeaderboardCursor(rawCursor);
    if (rawCursor !== undefined && cursor === null)
      return badRequest(res, 'cursor: send back a nextCursor as it came');
    const userId = await accountOf(res);
    if (userId === undefined) return;
    res.json(await readLeaderboard(db, userId, { tab, players, cursor }, settings));
  });

  router.get(PROGRESS_PATHS.player, ...before, limit(reads, accountKey), async (req, res) => {
    const id = req.params.id;
    if (typeof id !== 'string' || !PLAYER_ID.test(id)) return badRequest(res, 'not a player id');
    const userId = await accountOf(res);
    if (userId === undefined) return;
    const card = await readPlayerCard(db, id, settings);
    if (card === null) return send(res, 404, { error: 'notFound' });
    res.json(card);
  });

  router.get(PROGRESS_PATHS.myProgress, ...before, limit(reads, accountKey), async (_req, res) => {
    const userId = await accountOf(res);
    if (userId === undefined) return;
    res.json(await readMyProgress(db, userId, settings));
  });

  router.post(
    PROGRESS_PATHS.practiceResults,
    ...before,
    limit(writes, accountKey),
    json({ limit: PRACTICE_BODY_BYTES }),
    async (req, res) => {
      const parsed = practiceSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, issueText(parsed.error));
      const userId = await accountOf(res);
      if (userId === undefined) return;
      const results: PracticeResult[] = parsed.data.results;
      const tally = await recordPracticeResults(db, userId, results, now(), settings);
      const answer: PracticeResultsResponse = {
        accepted: tally.accepted,
        duplicates: tally.duplicates,
        rejected: tally.rejected,
        progress: await readMyProgress(db, userId, settings),
      };
      res.json(answer);
    },
  );

  return router;
}
