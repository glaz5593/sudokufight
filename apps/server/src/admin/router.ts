import { randomInt } from 'node:crypto';

import { createRng } from '@sudoku-fight/engine';
import {
  ADMIN_API_PREFIX,
  ADMIN_AUTH_METHODS_PATH,
  ADMIN_FRIEND_ROOMS_PATH,
  ADMIN_GOOGLE_LOGIN_PATH,
  ADMIN_LOGIN_PATH,
  type AdminAuthMethods,
  type AdminGoogleLoginErrorCode,
  type AdminGoogleWebConfig,
  type AdminSession,
} from '@sudoku-fight/protocol';
import { type CookieOptions, json, type Request, type RequestHandler, type Response, Router } from 'express';
import { z } from 'zod';

import { defaultBlockedWords } from '../accounts/blockedWords';
import { MAX_TOKEN_LENGTH, type TokenVerifier } from '../auth/firebaseToken';
import type { ServerConfig } from '../config';
import type { Db } from '../db';
import { clientKey } from '../http/clientKey';
import { notFound, sendError, sendTooManyRequests } from '../http/errors';
import { RateLimiter, type RateLimitRule } from '../http/rateLimiter';
import type { ModerationTools } from '../moderation/admin';
import { moderationAdminRoutes } from '../moderation/adminRoutes';
import { bundledQaCatalog, qaCatalogLoader, type QaCatalogSource } from '../qa';
import { inventPersonaName } from '../stealth/personas';
import {
  ADMIN_COOKIE_NAME,
  ADMIN_GOOGLE_MAX_AUTH_AGE_MS,
  ADMIN_SESSION_TTL_MS,
  DEFAULT_LOGIN_LIMIT,
} from './constants';
import { getGame, listGames } from './games';
import { getInstall, listInstalls } from './installs';
import { getLevels } from './levels';
import { getOverview } from './overview';
import {
  daysQuerySchema,
  gamesQuerySchema,
  levelsQuerySchema,
  pageQuerySchema,
  parseQuery,
  usersQuerySchema,
} from './params';
import { qaAdminRoutes } from './qa';
import { type FriendRoomsView, getFriendRooms } from './rooms';
import { getScreens } from './screens';
import {
  type AdminIdentity,
  passwordMatches,
  readCookie,
  SessionKeeper,
  type VerifiedSession,
} from './session';
import type { StatsWindow } from './sql';
import { type StealthSwitchControl, stealthAdminRoutes } from './stealth';
import { getUser, listUsers } from './users';

/**
 * The admin API (spec §27.3, routes in @sudoku-fight/protocol admin.ts): same-origin, behind a sign-in: Google
 * (an address on ADMIN_EMAILS) and/or the admin password, as the server's settings say. Read-only, except the
 * moderation actions (spec §3.5, approved by Moshe on 2026-10-12: ../moderation/adminRoutes), each written to
 * the audit log with the session's address.
 *
 * - Admin off in the settings (config.admin.enabled false): every route answers 503 `disabled`.
 * - GET /auth/methods → AdminAuthMethods: which sign-ins this server takes, and the Firebase web config for
 *   Google's. Public; never the allowed addresses.
 * - POST /login {password}: right → 204 and the session cookie (HttpOnly, SameSite=Strict, Path=/admin,
 *   Secure in production, 12 h); wrong → 401; password sign-in off → 403 `disabled`.
 * - POST /login/google {idToken}: a Firebase ID token of this server's project (signature by Google's keys,
 *   aud, iss, exp, iat: auth/firebaseToken), from a Google sign-in (`firebase.sign_in_provider` google.com)
 *   at most 5 minutes ago (`auth_time`, ADMIN_GOOGLE_MAX_AUTH_AGE_MS), with `email_verified` true and the
 *   address (any case) on ADMIN_EMAILS → 204 and the same cookie, with the address in the session; the server
 *   logs "admin sign-in: <address>". Else AdminGoogleLoginError.
 * - Both sign-ins together: more than 5 tries a minute from one IP → 429 + Retry-After. One IP: an IPv4
 *   address, or an IPv6 /64 (http/clientKey), so rotating addresses doesn't help. The bodies must be JSON
 *   (application/json), so a plain HTML form on another site can't post them.
 * - POST /logout → 204: clears the cookie and refuses that token from then on.
 * - GET /session → AdminSession, or 401. Every other route needs the cookie too (401 `unauthorized`). A session
 *   ends early when its method is turned off, or its address taken off ADMIN_EMAILS (checked on each request).
 * - Everything else is GET, but the moderation POSTs (JSON `{}` bodies only) and the stealth bot's switch
 *   (POST /stealth/switch `{"on": …}`, ./stealth); any other method or path is 404.
 * - The QA module (/qa, ./qa): before the session check, with a gate of its own that takes the session cookie
 *   or Claude's key (`Authorization: Bearer <QA_AGENT_TOKEN>`), and answers 503 `qaDisabled` with QA_ENABLED
 *   off. The key opens nothing else: every other route still wants the cookie.
 *   Answers are never cached (no-store).
 * - No CORS: configureHttp strips Colyseus's open CORS headers under /admin, and the guard answers preflights
 *   there without them (http/cors).
 */

export interface AdminRouterDeps {
  config: ServerConfig;
  db: Db;
  now: () => number;
  /** Checks Google sign-ins' Firebase ID tokens: the verifier of the app's accounts (one cache of keys). */
  tokens: TokenVerifier;
  /** Sign-in attempts per IP (tests make it small). */
  adminLoginLimit?: RateLimitRule;
  /** Where sign-ins are logged (default console.log). Never a token or a password. */
  log?: (message: string) => void;
  /** The moderation actions' word filter and randomness (default: the server's list, crypto randomInt). */
  moderationTools?: ModerationTools;
  /**
   * The friends rooms (1.0.4; friends/service.ts), for GET /rooms: the ones open now and their counts. Absent
   * (a server without them): no open rooms; the games per day still come from the database.
   */
  friendRooms?: FriendRoomsView;
  /**
   * The stealth bot's switch (stealth-bot.md §8; src/stealth/switch.ts), for GET /stealth and POST
   * /stealth/switch. Absent (a server without it): as STEALTH_BOT_ENABLED off, no switch.
   */
  stealthSwitch?: StealthSwitchControl;
  /**
   * The QA catalog's JSON (default: apps/server/data/qa-catalog.json, bundled), read and checked on the first
   * /qa route that needs it (src/qa/catalog.ts). Tests pass their own.
   */
  qaCatalog?: QaCatalogSource;
  /** Requests with the QA agent's key per IP (default 120 a minute; tests make it small). */
  qaAgentLimit?: RateLimitRule;
}

/**
 * The admin site's Content Security Policy. The site shows what anyone can send (event props, display names),
 * so even if some of it slipped into the page as markup, nothing but the site's own files may run or load:
 * scripts and requests from this origin only, styles from here and Google Fonts (index.html loads Rubik),
 * no inline scripts, no plugins, no framing, and no form posting elsewhere. React's `style={…}` values are
 * set through the CSSOM, which style-src does not block.
 *
 * With Google sign-in, what the Firebase JS SDK's signInWithPopup needs (checked in @firebase/auth 12):
 * Google's gapi loader (https://apis.google.com/js/api.js, a script it adds to the page), its hidden iframe
 * on the auth domain (`https://<project>.firebaseapp.com/__/auth/iframe`), and its API calls to Identity
 * Toolkit and Secure Token. The sign-in itself opens in a popup window, which frame-src does not govern.
 */
export function adminCsp(google: AdminGoogleWebConfig | null = null): string {
  return [
    "default-src 'none'",
    google === null ? "script-src 'self'" : "script-src 'self' https://apis.google.com",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    google === null
      ? "connect-src 'self'"
      : "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com",
    ...(google === null ? [] : [`frame-src https://${google.authDomain}`]),
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** The policy without Google sign-in. */
export const ADMIN_CSP = adminCsp(null);

/**
 * Hardening for every answer under /admin (API and site): the CSP, no framing, no sniffing, no referrer, and
 * a browsing context of its own. With Google sign-in, the opener policy lets the page keep its popup
 * (same-origin-allow-popups): under same-origin the SDK loses sight of the window it opened and reports the
 * sign-in as closed by the user.
 */
export function adminSecurityHeaders(google: AdminGoogleWebConfig | null = null): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': adminCsp(google),
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': google === null ? 'same-origin' : 'same-origin-allow-popups',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}

const loginSchema = z.object({ password: z.string().min(1).max(1024) });
const googleLoginSchema = z.object({ idToken: z.string().min(1).max(MAX_TOKEN_LENGTH) });
/** A Firebase ID token is 1–2 KB; MAX_TOKEN_LENGTH and the JSON around it fit. */
const GOOGLE_LOGIN_BODY_LIMIT = 8 * 1024;
const MAX_ID_LENGTH = 200;

const sendGoogleError = (res: Response, status: number, error: AdminGoogleLoginErrorCode, message: string) =>
  sendError(res, status, error, message);

/**
 * The moderation actions' tools on a real server: its word filter, crypto randomness, and a stealth bot's
 * persona's new name on a reset, invented as the personas' names are (stealth/personas.ts), from a fresh seed.
 */
function defaultModerationTools(): ModerationTools {
  const blockedWords = defaultBlockedWords();
  return {
    blockedWords,
    random: randomInt,
    personaName: (db, { country }) =>
      inventPersonaName(db, {
        rng: createRng(randomInt(0x1_0000_0000)),
        country: country ?? '',
        words: blockedWords,
      }),
  };
}

export function createAdminRouter({
  config,
  db,
  now,
  tokens,
  adminLoginLimit = DEFAULT_LOGIN_LIMIT,
  log = console.log,
  moderationTools,
  friendRooms,
  stealthSwitch,
  qaCatalog = bundledQaCatalog,
  qaAgentLimit,
}: AdminRouterDeps): Router {
  const { admin } = config;
  const google = admin.enabled ? admin.google : null;

  const router = Router();
  const securityHeaders = adminSecurityHeaders(google?.web ?? null);
  router.use('/admin', (_req, res, next) => {
    res.set(securityHeaders);
    next();
  });

  const api = Router();
  router.use(ADMIN_API_PREFIX, api);
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  if (!admin.enabled) {
    api.use((_req, res) => sendError(res, 503, 'disabled'));
    return router;
  }

  const { password } = admin;
  const allowedEmails = new Set(google?.allowedEmails ?? []);
  const sessions = new SessionKeeper({
    secret: admin.sessionSecret,
    password,
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

  /** Whether this admin may still be signed in: their method is on, and a Google address still listed. */
  const stillAllowed = (who: AdminIdentity) =>
    who.method === 'password' ? password !== null : allowedEmails.has(who.email);
  const sessionOf = (req: Request): VerifiedSession | null => {
    const session = sessions.verify(tokenOf(req));
    return session !== null && stillAllowed(session.admin) ? session : null;
  };
  const signIn = (res: Response, who: AdminIdentity) => {
    const { token } = sessions.issue(who);
    res.cookie(ADMIN_COOKIE_NAME, token, { ...cookie, maxAge: ADMIN_SESSION_TTL_MS });
    log(`[admin] admin sign-in: ${who.method === 'google' ? who.email : 'password'}`);
    res.sendStatus(204);
  };

  /** Both sign-ins draw on one budget per IP. */
  const limitSignIns: RequestHandler = (req, res, next) => {
    const r = loginLimiter.take(clientKey(req.ip));
    if (r.ok) next();
    else sendTooManyRequests(res, r.retryAfterMs);
  };

  api.get(ADMIN_AUTH_METHODS_PATH, (_req, res) => {
    // Field by field, so nothing else of the settings (the allowed addresses) can ride along.
    const web = google?.web;
    res.json({
      password: password !== null,
      google:
        web === undefined
          ? null
          : { apiKey: web.apiKey, authDomain: web.authDomain, projectId: web.projectId, appId: web.appId },
    } satisfies AdminAuthMethods);
  });

  api.post(
    ADMIN_LOGIN_PATH,
    (_req, res, next) => {
      if (password === null) {
        return sendError(res, 403, 'disabled', 'password sign-in is off on this server: sign in with Google');
      }
      next();
    },
    limitSignIns,
    json({ limit: 1024 }),
    (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return sendError(res, 400, 'badRequest', 'expected JSON {"password": "…"}');
      if (password === null || !passwordMatches(parsed.data.password, password)) {
        return sendError(res, 401, 'unauthorized', 'wrong password');
      }
      signIn(res, { method: 'password' });
    },
  );

  api.post(
    ADMIN_GOOGLE_LOGIN_PATH,
    (_req, res, next) => {
      if (google === null) {
        return sendGoogleError(res, 403, 'disabled', 'Google sign-in is off on this server');
      }
      next();
    },
    limitSignIns,
    json({ limit: GOOGLE_LOGIN_BODY_LIMIT }),
    async (req, res) => {
      const parsed = googleLoginSchema.safeParse(req.body);
      if (!parsed.success) return sendGoogleError(res, 400, 'badRequest', 'expected JSON {"idToken": "…"}');
      const result = await tokens.verifyIdToken(parsed.data.idToken);
      if (!result.ok) {
        if (result.failure === 'unavailable') {
          return sendGoogleError(res, 503, 'unavailable', "Google's keys can't be reached right now");
        }
        return sendGoogleError(res, 401, 'invalidToken', result.message);
      }
      const token = result.token;
      // A development token (`dev:…`, taken outside production for the app) never signs an admin in.
      if (token.kind !== 'firebase') {
        return sendGoogleError(res, 401, 'invalidToken', 'only a Firebase ID token signs in here');
      }
      if (token.signInProvider !== 'google.com') {
        return sendGoogleError(res, 403, 'wrongProvider', 'sign in with Google');
      }
      // A fresh sign-in only (ADMIN_GOOGLE_MAX_AUTH_AGE_MS): not a token refreshed long after it.
      if (token.signedInAt === null || now() - token.signedInAt > ADMIN_GOOGLE_MAX_AUTH_AGE_MS) {
        return sendGoogleError(res, 401, 'invalidToken', 'the Google sign-in is too old: sign in again');
      }
      if (!token.emailVerified || token.email === null) {
        return sendGoogleError(res, 403, 'unverifiedEmail', 'Google does not vouch for this address');
      }
      const email = token.email.trim().toLowerCase();
      if (!allowedEmails.has(email)) {
        log('[admin] admin sign-in refused: an address not on ADMIN_EMAILS');
        return sendGoogleError(res, 403, 'notAllowed', 'this Google account may not use the admin site');
      }
      signIn(res, { method: 'google', email });
    },
  );

  api.post('/logout', (req, res) => {
    sessions.revoke(tokenOf(req));
    res.clearCookie(ADMIN_COOKIE_NAME, cookie);
    res.sendStatus(204);
  });

  api.get('/session', (req, res) => {
    const session = sessionOf(req);
    if (session === null) return sendError(res, 401, 'unauthorized');
    const { admin: who, expiresAt } = session;
    res.json({
      ok: true,
      expiresAt,
      method: who.method,
      email: who.method === 'google' ? who.email : null,
    } satisfies AdminSession);
  });

  // The QA module (./qa): its own gate, which takes Claude's key as well as the session, so it comes before the
  // session check below. The key opens the /qa routes only: everything after this line wants the cookie.
  api.use(
    qaAdminRoutes({
      db,
      now,
      settings: config.qa,
      catalog: qaCatalogLoader(qaCatalog),
      sessionOf: (req) => sessionOf(req)?.admin ?? null,
      googleRequired: google !== null,
      agentLimit: qaAgentLimit,
      log,
    }),
  );

  // Everything below needs a session.
  api.use((req, res, next) => {
    if (sessionOf(req) === null) sendError(res, 401, 'unauthorized');
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
  // Staged practice (1.0.2, plan §5.5): how each level plays, and the gates players get stuck at. By default
  // only each level's rev now (1.0.3, D73); ?allRevs=1 counts the plays from before a rebuild too.
  api.get(
    '/levels',
    handle(levelsQuerySchema, (q) => getLevels(db, windowOf(q.days), { allRevs: q.allRevs })),
  );
  // Friends rooms (1.0.4): the ones open now (no codes) and the games with friends per day.
  api.get(
    ADMIN_FRIEND_ROOMS_PATH,
    handle(daysQuerySchema, (q) => getFriendRooms(db, friendRooms, windowOf(q.days))),
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
  // People by default; ?kind=persona the stealth bot's personas, ?kind=all both (stealth-bot.md §8).
  api.get(
    '/users',
    handle(usersQuerySchema, (q) => listUsers(db, q)),
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
  // Reports, the audit log and the moderation actions (spec §3.5).
  api.use(
    moderationAdminRoutes({
      db,
      now,
      tools: moderationTools ?? defaultModerationTools(),
      adminOf: (req) => sessionOf(req)?.admin ?? null,
      googleRequired: google !== null,
    }),
  );
  // The stealth bot's switch (stealth-bot.md §8): GET /stealth, POST /stealth/switch.
  api.use(
    stealthAdminRoutes({
      db,
      now,
      control: stealthSwitch,
      adminOf: (req) => sessionOf(req)?.admin ?? null,
      googleRequired: google !== null,
    }),
  );

  api.use(notFound);
  return router;
}
