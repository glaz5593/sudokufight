import type { Application } from 'express';

import { type AccountLimits, createAccountsRouter } from '../accounts/router';
import { createAdminRouter, createAdminSiteRouter, findAdminSiteDir } from '../admin';
import { type TokenVerifier, tokenVerifierFor } from '../auth/firebaseToken';
import type { ServerConfig } from '../config';
import type { Db } from '../db';
import { createHistoryRouter } from '../history';
import { createLegalRouter } from '../legal';
import {
  createProgressRouter,
  type ProgressLimits,
  progressSettings,
  type ProgressSettings,
} from '../progress';
import { createTelemetryRouter, type TelemetryLimits } from '../telemetry/router';
import { SAME_ORIGIN_PREFIXES } from './cors';
import { jsonErrorHandler, notFound } from './errors';
import type { RateLimitRule } from './rateLimiter';

/**
 * Everything the server answers over plain HTTP besides Colyseus's own routes (/health, /matchmake):
 * POST /v1/events, the account routes (/v1/names/available, /v1/users, /v1/me), history (stage 11), progress
 * (stage 12: leaderboards, player cards, XP), the admin API (/admin/api), the admin site's files (/admin) and
 * the legal pages (stage 14: /legal/privacy, /legal/terms, /legal/delete-account).
 *
 * Colyseus 0.18 builds an Express 5 app on its HTTP server when `defineServer({ express })` is given, and
 * passes it here once the database is open (createAppServer). A request that no Colyseus route matches
 * falls through to this app. Tests call configureHttp() on a bare express() (testing/http.ts).
 *
 * To add routes: mount a Router below, before the 404 and error handlers, and take what it needs from
 * HttpDeps.
 */

export interface HttpDeps {
  config: ServerConfig;
  db: Db;
  /** The clock (epoch ms). Injected so tests can move time. */
  now: () => number;
  /** Rate limits of POST /v1/events; tests make them small. */
  telemetryLimits?: TelemetryLimits;
  /** Admin sign-in attempts per IP (default 5 a minute). */
  adminLoginLimit?: RateLimitRule;
  /** The built admin site (default apps/admin/dist when it has an index.html); null serves none. */
  adminSiteDir?: string | null;
  /**
   * Checks Firebase ID tokens (accounts, and the sender of telemetry). Default: for the settings, with
   * Google's keys (auth/firebaseToken); tests pass one with their own keys (testing/tokens).
   */
  tokens?: TokenVerifier;
  /** Rate limits of the account routes; tests make them small. */
  accountLimits?: AccountLimits;
  /** Rate limits of the progress routes (stage 12); tests make them small. */
  progressLimits?: ProgressLimits;
  /** Progress settings over the ones from `config` (tests: a small daily cap, other rules). */
  progress?: Partial<ProgressSettings>;
}

/**
 * The CORS headers Colyseus puts on every response: any origin, with credentials. Fine for the game API;
 * the admin site and /v1 are same-origin only (./cors), so they come off there. Preflights there never get
 * here: the guard answers them (./guard).
 */
const CORS_HEADERS = [
  'Access-Control-Allow-Origin',
  'Access-Control-Allow-Credentials',
  'Access-Control-Allow-Headers',
  'Access-Control-Allow-Methods',
  'Access-Control-Max-Age',
];

export function configureHttp(app: Application, deps: HttpDeps): void {
  app.disable('x-powered-by');
  // Behind a proxy (Fly.io: 1 hop) req.ip is the client's address only when this says how many to trust.
  app.set('trust proxy', deps.config.trustProxy);

  app.use([...SAME_ORIGIN_PREFIXES], (_req, res, next) => {
    for (const h of CORS_HEADERS) res.removeHeader(h);
    next();
  });

  const tokens = deps.tokens ?? tokenVerifierFor(deps.config, deps.now);
  app.use(createTelemetryRouter({ ...deps, tokens }));
  app.use(createAccountsRouter({ ...deps, tokens }));
  app.use(createHistoryRouter({ ...deps, tokens })); // GET /v1/me/games, /v1/games/:id/replay (stage 11)
  // GET /v1/leaderboard, /v1/players/:id, /v1/me/progress; POST /v1/me/practice-results (stage 12)
  app.use(createProgressRouter({ ...deps, tokens, settings: progressSettings(deps.config, deps.progress) }));
  // The API first: it answers everything under /admin/api (404 included), so the site never does.
  app.use(createAdminRouter(deps));
  app.use(createAdminSiteRouter(deps.adminSiteDir === undefined ? findAdminSiteDir() : deps.adminSiteDir));
  // The privacy policy, terms of use and account deletion page, public (src/legal).
  app.use(createLegalRouter({ legal: deps.config.legal ?? { contactEmail: null, operatorName: null } }));

  app.use('/v1', notFound);
  app.use(jsonErrorHandler);
}
