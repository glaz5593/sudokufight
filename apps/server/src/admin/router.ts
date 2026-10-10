import { ADMIN_API_PREFIX, type AdminSession } from '@sudoku-fight/protocol';
import { type CookieOptions, json, type Request, type RequestHandler, Router } from 'express';
import { z } from 'zod';

import type { ServerConfig } from '../config';
import type { Db } from '../db';
import { clientKey } from '../http/clientKey';
import { notFound, sendError, sendTooManyRequests } from '../http/errors';
import { RateLimiter, type RateLimitRule } from '../http/rateLimiter';
import { ADMIN_COOKIE_NAME, ADMIN_SESSION_TTL_MS, DEFAULT_LOGIN_LIMIT } from './constants';
import { getGame, listGames } from './games';
import { getInstall, listInstalls } from './installs';
import { getOverview } from './overview';
import { daysQuerySchema, gamesQuerySchema, pageQuerySchema, parseQuery } from './params';
import { getScreens } from './screens';
import { passwordMatches, readCookie, SessionKeeper } from './session';
import type { StatsWindow } from './sql';
import { getUser, listUsers } from './users';

/**
 * The admin API (spec §27.3, routes in @sudoku-fight/protocol admin.ts): read-only, same-origin, behind the
 * admin password from the server's settings.
 *
 * - Admin off in the settings (config.admin.enabled false): every route answers 503 `disabled`.
 * - POST /login {password}: right → 204 and the session cookie (HttpOnly, SameSite=Strict, Path=/admin,
 *   Secure in production, 12 h); wrong → 401; more than 5 tries a minute from one IP → 429 + Retry-After.
 *   One IP: an IPv4 address, or an IPv6 /64 (http/clientKey), so rotating addresses doesn't help.
 *   The body must be JSON (application/json), so a plain HTML form on another site can't post it.
 * - POST /logout → 204: clears the cookie and refuses that token from then on.
 * - GET /session → AdminSession, or 401. Every other route needs the cookie too (401 `unauthorized`).
 * - Everything else is GET; any other method or path is 404. Answers are never cached (no-store).
 * - No CORS: configureHttp strips Colyseus's open CORS headers under /admin, and the guard answers preflights
 *   there without them (http/cors).
 */

export interface AdminRouterDeps {
  config: ServerConfig;
  db: Db;
  now: () => number;
  /** Sign-in attempts per IP (tests make it small). */
  adminLoginLimit?: RateLimitRule;
}

/**
 * The admin site's Content Security Policy. The site shows what anyone can send (event props, display names),
 * so even if some of it slipped into the page as markup, nothing but the site's own files may run or load:
 * scripts and requests from this origin only, styles from here and Google Fonts (index.html loads Rubik),
 * no inline scripts, no plugins, no framing, and no form posting elsewhere. React's `style={…}` values are
 * set through the CSSOM, which style-src does not block.
 */
export const ADMIN_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Hardening for every answer under /admin (API and site): the CSP, no framing, no sniffing, no referrer. */
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': ADMIN_CSP,
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const loginSchema = z.object({ password: z.string().min(1).max(1024) });
const MAX_ID_LENGTH = 200;

export function createAdminRouter({
  config,
  db,
  now,
  adminLoginLimit = DEFAULT_LOGIN_LIMIT,
}: AdminRouterDeps): Router {
  const router = Router();
  router.use('/admin', (_req, res, next) => {
    res.set(SECURITY_HEADERS);
    next();
  });

  const api = Router();
  router.use(ADMIN_API_PREFIX, api);
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const { admin } = config;
  if (!admin.enabled) {
    api.use((_req, res) => sendError(res, 503, 'disabled'));
    return router;
  }

  const sessions = new SessionKeeper({
    secret: admin.sessionSecret,
    password: admin.password,
    ttlMs: ADMIN_SESSION_TTL_MS,
    now,
  });
  const loginLimiter = new RateLimiter({ ...adminLoginLimit, now });
  const cookie: CookieOptions = {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.nodeEnv === 'production',
    path: '/admin',
  };
  const tokenOf = (req: Request) => readCookie(req.get('cookie'), ADMIN_COOKIE_NAME);

  api.post(
    '/login',
    (req, res, next) => {
      const r = loginLimiter.take(clientKey(req.ip));
      if (r.ok) next();
      else sendTooManyRequests(res, r.retryAfterMs);
    },
    json({ limit: 1024 }),
    (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, 'badRequest', 'expected JSON {"password": "…"}');
      if (!passwordMatches(parsed.data.password, admin.password)) {
        return sendError(res, 401, 'unauthorized', 'wrong password');
      }
      const { token } = sessions.issue();
      res.cookie(ADMIN_COOKIE_NAME, token, { ...cookie, maxAge: ADMIN_SESSION_TTL_MS });
      res.sendStatus(204);
    },
  );

  api.post('/logout', (req, res) => {
    sessions.revoke(tokenOf(req));
    res.clearCookie(ADMIN_COOKIE_NAME, cookie);
    res.sendStatus(204);
  });

  api.get('/session', (req, res) => {
    const expiresAt = sessions.verify(tokenOf(req));
    if (expiresAt === null) return sendError(res, 401, 'unauthorized');
    res.json({ ok: true, expiresAt } satisfies AdminSession);
  });

  // Everything below needs a session.
  api.use((req, res, next) => {
    if (sessions.verify(tokenOf(req)) === null) sendError(res, 401, 'unauthorized');
    else next();
  });

  const windowOf = (days: number): StatsWindow => ({ tz: config.adminTz, now: now(), days });

  /** Parses the query string (400 on a bad one), runs, and answers the result, or 404 for null. */
  function handle<Q>(
    schema: z.ZodType<Q>,
    run: (query: Q, req: Request) => Promise<object | null>,
  ): RequestHandler {
    return async (req, res) => {
      const query = parseQuery(schema, req.query);
      if (!query.ok) return sendError(res, 400, 'badRequest', query.message);
      const body = await run(query.value, req);
      if (body === null) return sendError(res, 404, 'notFound');
      res.json(body);
    };
  }
  /** A detail route: `:id`, of a sane length. */
  const byId = (find: (id: string) => Promise<object | null>): RequestHandler =>
    handle(z.object({}), async (_q, req) => {
      const id = req.params.id ?? '';
      return id.length > MAX_ID_LENGTH ? null : find(id);
    });

  api.get(
    '/overview',
    handle(daysQuerySchema, (q) => getOverview(db, windowOf(q.days))),
  );
  api.get(
    '/screens',
    handle(daysQuerySchema, (q) => getScreens(db, windowOf(q.days))),
  );
  api.get(
    '/installs',
    handle(pageQuerySchema, (q) => listInstalls(db, q)),
  );
  // Install ids are stored in lower case (telemetry), so any spelling finds one.
  api.get(
    '/installs/:id',
    byId((id) => getInstall(db, id.toLowerCase())),
  );
  api.get(
    '/users',
    handle(pageQuerySchema, (q) => listUsers(db, q)),
  );
  api.get(
    '/users/:id',
    byId((id) => getUser(db, id)),
  );
  api.get(
    '/games',
    handle(gamesQuerySchema, (q) => listGames(db, q)),
  );
  api.get(
    '/games/:id',
    byId((id) => getGame(db, id)),
  );

  api.use(notFound);
  return router;
}
