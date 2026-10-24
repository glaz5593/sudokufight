import {
  ADMIN_QA_BUGS_PATH,
  ADMIN_QA_CATALOG_PATH,
  ADMIN_QA_PATH,
  ADMIN_QA_RUNS_PATH,
  QA_ID_PATTERN,
  QA_PLATFORMS,
  QA_RESULTS,
  QA_RUN_WHO,
  type QaCatalog,
} from '@sudoku-fight/protocol';
import { json, type Request, type RequestHandler, type Response, Router } from 'express';
import { z } from 'zod';

import type { QaSettings } from '../config';
import type { Db } from '../db';
import { clientKey } from '../http/clientKey';
import { notFound, sendError, sendTooManyRequests } from '../http/errors';
import { RateLimiter, type RateLimitRule } from '../http/rateLimiter';
import { adminName } from '../moderation/admin';
import {
  closeRun,
  getRun,
  isBugResult,
  listBugs,
  listRuns,
  markFixed,
  markResult,
  openRun,
  QA_AGENT_ACTOR,
  type QaCatalogResult,
} from '../qa';
import { DEFAULT_QA_AGENT_LIMIT } from './constants';
import { parseQuery, qaBugsQuerySchema, qaRunQuerySchema, qaRunsQuerySchema } from './params';
import { type AdminIdentity, passwordMatches } from './session';

/**
 * The QA module on the admin API (docs/handoff/2026-10-23/qa-module/plan.md; the contract in protocol admin.ts,
 * the data in src/qa): the catalog, runs, marks, fixes and bugs, under /admin/api/qa.
 *
 * Mounted by admin/router.ts before its session check, with a gate of its own:
 * - QA_ENABLED off (or no QA settings): every /qa route answers 503 `qaDisabled`, whoever asks.
 * - `Authorization: Bearer <QA_AGENT_TOKEN>`: Claude's key, compared in constant time (passwordMatches). Any
 *   Authorization header is taken as a key: a wrong one, another scheme, or one on a server without a key → 401
 *   (never on to the cookie). Requests with a header count on a rate limit of their own per IP (120 a minute):
 *   never the sign-ins' budget, so wrong keys can't keep Moshe from signing in. The key is never logged.
 * - Otherwise the admin's session cookie, checked as on every admin route (router.ts sessionOf); none → 401,
 *   unless QA_OPEN is on (staging, Moshe's word): then no sign-in is needed, and a caller without one is Claude
 *   (on the same rate limit as the key). A key sent to an open server that has none is not asked for.
 * The key opens the /qa routes only: everything else under /admin/api wants the cookie (router.ts).
 *
 * Writing (the POSTs): JSON bodies of at most 16 kB, nothing but the fields of the contract (`{}` to close a
 * run; 400 otherwise: a form or text is no JSON body, so a page of another site can't post one here). Like the moderation actions, a password session
 * on a server that offers Google sign-in may read here but not write (403 `googleRequired`): the shared password
 * names no one. Who did it is kept as `claude` (the key), the admin's address, or `password`.
 *
 * The catalog is read on first use (src/qa/catalog.ts): broken, GET /qa/catalog and POST /qa/runs answer 500
 * `qaCatalogInvalid` with its problems, and the runs already open keep working (they are copies).
 */

export interface QaAdminDeps {
  db: Db;
  now: () => number;
  /** QA_ENABLED and QA_AGENT_TOKEN (config.qa); absent: off. */
  settings: QaSettings | undefined;
  /** The catalog, read and checked once, on first use (src/qa/catalog.ts qaCatalogLoader). */
  catalog: () => QaCatalogResult;
  /** The admin of the request's session cookie, or null (router.ts: still allowed, not signed out). */
  sessionOf: (req: Request) => AdminIdentity | null;
  /** The server offers Google sign-in: a password session reads but does not write (403 googleRequired). */
  googleRequired: boolean;
  /** Requests with a key per IP (default DEFAULT_QA_AGENT_LIMIT; tests make it small). */
  agentLimit?: RateLimitRule;
  /** Where a broken catalog is told, once (default console.error). Never a key. */
  log?: (message: string) => void;
}

/** Who calls a /qa route: Claude with the key, or a signed-in admin. */
type QaCaller = { kind: 'agent' } | { kind: 'admin'; admin: AdminIdentity };

const actorOf = (caller: QaCaller): string =>
  caller.kind === 'agent' ? QA_AGENT_ACTOR : adminName(caller.admin);

/** The key after "Bearer " (any case, as RFC 6750 allows). */
const BEARER = /^Bearer +(.+)$/i;
/** A run's id: a small whole number. Anything else is no run (404). */
const RUN_ID = /^[1-9]\d{0,8}$/;
const BODY_LIMIT = '16kb';
const MAX_MARK_TEXT = 2000;
const MAX_FIX_NOTE = 4000;
/** Shown with a broken catalog's 500: its first problems. */
const PROBLEMS_SHOWN = 20;

/** One line of text: no control characters (tabs, line breaks…), no line or paragraph separators. */
const ONE_LINE = /^[^\p{Cc}\u2028\u2029]*$/u;
const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1, 'required')
    .max(max, `at most ${max} characters`)
    .regex(ONE_LINE, 'one line, without control characters');
/** An optional line: missing, null or blank is none (null). */
const optionalLine = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    oneLine(max)
      .nullish()
      .transform((v) => v ?? null),
  );
/**
 * Free text (line breaks welcome) has no NUL: Postgres can't keep one in a text column, so it would be a 500
 * (trim leaves it in). One-line fields have none already (ONE_LINE).
 */
const noNul = (s: string) => !s.includes('\u0000');
const NO_NUL = 'no NUL characters';
/** Free text, trimmed: missing, null or blank is none (null). */
const freeText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `at most ${max} characters`)
    .refine(noNul, NO_NUL)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === '' ? null : v));

const openRunBody = z.strictObject({
  title: oneLine(80),
  appVersion: oneLine(40),
  device: optionalLine(80),
  platform: z
    .enum(QA_PLATFORMS, { error: 'expected android or ios' })
    .nullish()
    .transform((v) => v ?? null),
  categories: z
    .array(z.string().max(80, 'not a category id'))
    .min(1, 'at least one category (or leave it out: all of them)')
    .max(100)
    .optional()
    .transform((v) => (v === undefined ? null : [...new Set(v)])),
  who: z.enum(QA_RUN_WHO, { error: 'expected claude, moshe or all' }).default('all'),
});

const resultBody = z
  .strictObject({
    result: z.enum(QA_RESULTS, { error: 'expected untested, pass, partial or fail' }),
    actual: freeText(MAX_MARK_TEXT),
    note: freeText(MAX_MARK_TEXT),
  })
  .superRefine((body, ctx) => {
    if (isBugResult(body.result) && body.actual === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['actual'],
        message: 'required with partial and fail: what happened ("מה קרה בפועל")',
      });
    }
  });

const fixBody = z.strictObject({
  fixNote: z
    .string()
    .trim()
    .min(1, 'required')
    .max(MAX_FIX_NOTE, `at most ${MAX_FIX_NOTE} characters`)
    .refine(noNul, NO_NUL),
  fixedIn: oneLine(40),
});

/** Closing a run: a JSON body with nothing in it (`{}`), as the moderation actions take. */
const closeBody = z.strictObject({});

/** The body, checked; else the 400 is sent and null comes back. */
function bodyOf<T>(schema: z.ZodType<T>, req: Request, res: Response): T | null {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    sendError(res, 400, 'badRequest', 'send Content-Type: application/json and a JSON object');
    return null;
  }
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
  sendError(res, 400, 'badRequest', `${where}${issue?.message ?? 'invalid'}`);
  return null;
}

/** The /qa routes, mounted by admin/router.ts before its session check (they check their own callers). */
export function qaAdminRoutes({
  db,
  now,
  settings,
  catalog,
  sessionOf,
  googleRequired,
  agentLimit = DEFAULT_QA_AGENT_LIMIT,
  log = console.error,
}: QaAdminDeps): Router {
  const router = Router();
  const enabled = settings?.enabled === true;
  const agentToken = settings?.agentToken ?? null;
  const open = settings?.open === true;
  const agentLimiter = new RateLimiter({ ...agentLimit, now });
  const callers = new WeakMap<Request, QaCaller>();

  /** The caller of a request, or null when the answer (401, 429) is sent. */
  function authenticate(req: Request, res: Response): QaCaller | null {
    const header = req.get('authorization');
    if (header !== undefined) {
      const limit = agentLimiter.take(clientKey(req.ip));
      if (!limit.ok) {
        sendTooManyRequests(res, limit.retryAfterMs);
        return null;
      }
      if (open && agentToken === null) return { kind: 'agent' };
      const key = BEARER.exec(header)?.[1];
      if (agentToken === null || key === undefined || !passwordMatches(key, agentToken)) {
        sendError(res, 401, 'unauthorized');
        return null;
      }
      return { kind: 'agent' };
    }
    const admin = sessionOf(req);
    if (admin !== null) return { kind: 'admin', admin };
    if (open) {
      const limit = agentLimiter.take(clientKey(req.ip));
      if (!limit.ok) {
        sendTooManyRequests(res, limit.retryAfterMs);
        return null;
      }
      return { kind: 'agent' };
    }
    sendError(res, 401, 'unauthorized');
    return null;
  }

  router.use(ADMIN_QA_PATH, (req, res, next) => {
    if (!enabled)
      return sendError(res, 503, 'qaDisabled', 'the QA module is off on this server (QA_ENABLED)');
    const caller = authenticate(req, res);
    if (caller === null) return;
    callers.set(req, caller);
    next();
  });

  const callerOf = (req: Request): QaCaller => {
    const caller = callers.get(req);
    if (caller === undefined) throw new Error('a /qa route without its caller');
    return caller;
  };

  /** Before a write: a password session where Google sign-in is offered may not (403). */
  const mayWrite: RequestHandler = (req, res, next) => {
    const caller = callerOf(req);
    if (googleRequired && caller.kind === 'admin' && caller.admin.method !== 'google') {
      return sendError(res, 403, 'googleRequired', 'QA marks need a Google sign-in (they name who marked)');
    }
    next();
  };
  const write: RequestHandler[] = [mayWrite, json({ limit: BODY_LIMIT })];

  let toldBroken = false;
  /** The catalog; else the 500 is sent (and told once) and null comes back. */
  function catalogOf(res: Response): QaCatalog | null {
    const result = catalog();
    if (result.ok) return result.catalog;
    if (!toldBroken) {
      toldBroken = true;
      log(`[qa] the catalog is not valid: ${result.problems.slice(0, 5).join('; ')}`);
    }
    sendError(res, 500, 'qaCatalogInvalid', result.problems.slice(0, PROBLEMS_SHOWN).join('\n'));
    return null;
  }

  /** `:runId` as a number; null (no such run) for anything else. */
  const runIdOf = (req: Request): number | null => {
    const raw = req.params.runId ?? '';
    return RUN_ID.test(raw) ? Number(raw) : null;
  };
  /** `:taskId`, a catalog id (QA_ID_PATTERN, as every stored one); null (no such task) for anything else. */
  const taskIdOf = (req: Request): string | null => {
    const raw = req.params.taskId ?? '';
    return QA_ID_PATTERN.test(raw) ? raw : null;
  };

  router.get(ADMIN_QA_CATALOG_PATH, (_req, res) => {
    const c = catalogOf(res);
    if (c !== null) res.json(c);
  });

  router.get(ADMIN_QA_RUNS_PATH, async (req, res) => {
    const q = parseQuery(qaRunsQuerySchema, req.query);
    if (!q.ok) return sendError(res, 400, 'badRequest', q.message);
    res.json(await listRuns(db, q.value));
  });

  router.post(ADMIN_QA_RUNS_PATH, ...write, async (req, res) => {
    const body = bodyOf(openRunBody, req, res);
    if (body === null) return;
    const c = catalogOf(res);
    if (c === null) return;
    const opened = await openRun(db, c, body, actorOf(callerOf(req)), now());
    if (!opened.ok) return sendError(res, 400, 'badRequest', opened.message);
    res.status(201).json(opened.run);
  });

  router.get(`${ADMIN_QA_RUNS_PATH}/:runId`, async (req, res) => {
    const q = parseQuery(qaRunQuerySchema, req.query);
    if (!q.ok) return sendError(res, 400, 'badRequest', q.message);
    const runId = runIdOf(req);
    const run = runId === null ? null : await getRun(db, runId, q.value);
    if (run === null) return sendError(res, 404, 'notFound');
    res.json(run);
  });

  router.post(`${ADMIN_QA_RUNS_PATH}/:runId/close`, ...write, async (req, res) => {
    if (bodyOf(closeBody, req, res) === null) return;
    const runId = runIdOf(req);
    const run = runId === null ? null : await closeRun(db, runId, actorOf(callerOf(req)), now());
    if (run === null) return sendError(res, 404, 'notFound');
    res.json(run);
  });

  router.post(`${ADMIN_QA_RUNS_PATH}/:runId/items/:taskId/result`, ...write, async (req, res) => {
    const body = bodyOf(resultBody, req, res);
    if (body === null) return;
    const runId = runIdOf(req);
    const taskId = taskIdOf(req);
    if (runId === null || taskId === null) return sendError(res, 404, 'notFound');
    const marked = await markResult(db, runId, taskId, body, actorOf(callerOf(req)), now());
    if (marked.ok) res.json(marked.item);
    else if (marked.error === 'notFound') sendError(res, 404, 'notFound');
    else sendError(res, 409, 'qaRunClosed', 'the run is closed: only its bugs may be tested again');
  });

  router.post(`${ADMIN_QA_RUNS_PATH}/:runId/items/:taskId/fix`, ...write, async (req, res) => {
    const body = bodyOf(fixBody, req, res);
    if (body === null) return;
    const runId = runIdOf(req);
    const taskId = taskIdOf(req);
    if (runId === null || taskId === null) return sendError(res, 404, 'notFound');
    const fixed = await markFixed(db, runId, taskId, body, actorOf(callerOf(req)), now());
    if (fixed.ok) res.json(fixed.item);
    else if (fixed.error === 'notFound') sendError(res, 404, 'notFound');
    else sendError(res, 409, 'qaNotBug', 'only a task marked fail or partial can be handled');
  });

  router.get(ADMIN_QA_BUGS_PATH, async (req, res) => {
    const q = parseQuery(qaBugsQuerySchema, req.query);
    if (!q.ok) return sendError(res, 400, 'badRequest', q.message);
    res.json(await listBugs(db, q.value));
  });

  // Anything else under /qa: 404 here, never on to the session check (which would say 401 to the key).
  router.use(ADMIN_QA_PATH, notFound);
  return router;
}
