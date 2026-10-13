import { randomBytes } from 'node:crypto';
import path from 'node:path';

import type { RatingOption } from '@sudoku-fight/engine';
import { type AdminGoogleWebConfig, RECENT_SIGN_IN_MS } from '@sudoku-fight/protocol';
import { z } from 'zod';

import serverPackage from '../package.json';
import type { LegalSettings } from './legal/types';

/**
 * The server's settings, read once from the environment (apps/server/.env.example documents each one).
 * Everything else takes a ServerConfig, never process.env, so tests can pass their own.
 */

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const DEFAULT_PORT = 2567;
export const DEFAULT_ADMIN_TZ = 'Asia/Jerusalem';
/** apps/server/.data/pglite (gitignored). From src/ and from the bundle in dist/, one level up is apps/server. */
export const DEFAULT_PGLITE_DIR = path.resolve(__dirname, '..', '.data', 'pglite');
/** In development, with the local PGlite and no ADMIN_PASSWORD, the admin site takes this one. */
export const DEV_ADMIN_PASSWORD = 'sudoku-admin-dev';
/** In production a shorter ADMIN_PASSWORD leaves password sign-in off. */
export const MIN_ADMIN_PASSWORD_LENGTH = 8;
export const MIN_SESSION_SECRET_LENGTH = 32;

/** Where the data lives: Postgres (production) or PGlite, the in-process Postgres (development, tests). */
export type DatabaseConfig = { kind: 'postgres'; url: string } | { kind: 'pglite'; dataDir: string | null };

/**
 * Google sign-in for the admin site: through the app's Firebase project, for the addresses on ADMIN_EMAILS
 * only. On when FIREBASE_PROJECT_ID, FIREBASE_WEB_API_KEY and ADMIN_EMAILS are all set, and well formed.
 */
export interface AdminGoogleSignIn {
  /** For the page (GET /admin/api/auth/methods): public by design. */
  web: AdminGoogleWebConfig;
  /** ADMIN_EMAILS: lower case, each once. Stays on the server: never sent to the page or logged. */
  allowedEmails: readonly string[];
}

/**
 * The admin site (spec §27.3): on when at least one sign-in method is. `enabled: false` → every /admin/api
 * route answers 503 `disabled`.
 * - `password`: ADMIN_PASSWORD (or the dev password, `devPassword`), or null: password sign-in off.
 * - `google`: Google sign-in, or null: off.
 * - `sessionSecret` signs the session cookie; random per boot when ADMIN_SESSION_SECRET is unset, so a restart
 *   signs everyone out.
 */
export type AdminConfig =
  | {
      enabled: true;
      password: string | null;
      devPassword: boolean;
      google: AdminGoogleSignIn | null;
      sessionSecret: string;
    }
  | { enabled: false; reason: string; sessionSecret: string };

/** The admin site in the start-up line: which sign-in methods are on (never the addresses or the key). */
export function describeAdmin(admin: AdminConfig): string {
  if (!admin.enabled) return `off: ${admin.reason}`;
  const methods: string[] = [];
  if (admin.google !== null) {
    const n = admin.google.allowedEmails.length;
    methods.push(`Google sign-in for ${n} address${n === 1 ? '' : 'es'}`);
  }
  if (admin.password !== null) methods.push(admin.devPassword ? 'dev password' : 'password');
  return `on (${methods.join(', ')})`;
}

/** ADMIN_EMAILS' entries: separated by commas, semicolons or spaces; trimmed, lower case, each once. */
export function splitAdminEmails(raw: string): string[] {
  const entries = raw
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== '');
  return [...new Set(entries)];
}

const isEmail = (value: string) => z.email().max(254).safeParse(value).success;

/**
 * Anomaly flags (spec §21): a player whose average think time over `moves` consecutive correct moves of a ranked
 * game is below `thinkMs` gets a cheat_flags row, for a person to look at. No automatic action in V1.
 */
export interface CheatThresholds {
  /** CHEAT_FAST_THINK_MS (default 1200). */
  thinkMs: number;
  /** CHEAT_FAST_THINK_MOVES (default 20). */
  moves: number;
}

export const DEFAULT_CHEAT_THRESHOLDS: CheatThresholds = { thinkMs: 1200, moves: 20 };

/**
 * Progress (spec §14.2, §15; stage 12, src/progress).
 * - `practiceXpDailyCap` (PRACTICE_XP_DAILY_CAP, default 1500): the most XP practice games may earn per UTC day
 *   of their end. Practice is played on the phone and only reported [D41], so the server can't check a result;
 *   the cap bounds what a forged one is worth. 1500 is about 25 bot games a day (20–50 XP each, plus a point per
 *   correct move), well above a keen player's day; 0 turns practice XP off.
 * - `inviteUrl` (INVITE_URL): the link the friends tab's "invite friends" button shares [D27]; null hides it.
 */
export interface ProgressConfig {
  practiceXpDailyCap: number;
  inviteUrl: string | null;
}

export const DEFAULT_PRACTICE_XP_DAILY_CAP = 1500;

/** Express's 'trust proxy' setting: false, true, a hop count, or addresses/subnets ("loopback, 10.0.0.0/8"). */
export type TrustProxy = boolean | number | string;

/** The server's version (apps/server/package.json), the base of Sentry's release name. */
export const SERVER_VERSION: string = serverPackage.version;

/**
 * Error reports and a sample of HTTP traces in Sentry (work plan stage 14; src/monitoring). Off, and the SDK
 * never even loaded, without SENTRY_DSN.
 * - `environment`: SENTRY_ENVIRONMENT, else NODE_ENV. Staging and production both run NODE_ENV=production, so
 *   their fly.toml files say which they are.
 * - `release`: SENTRY_RELEASE, else `sudoku-fight-server@<version>`, with `+<GIT_SHA>` (`fly deploy --env
 *   GIT_SHA=…`) or else `+<Fly's deployment>` (from FLY_IMAGE_REF, which Fly sets on every machine).
 * - `tracesSampleRate`: SENTRY_TRACES_SAMPLE_RATE, 0–1 (default 0.05: one HTTP request in 20); 0 turns tracing off.
 */
export interface SentryConfig {
  dsn: string;
  environment: string;
  release: string;
  tracesSampleRate: number;
}

export const DEFAULT_TRACES_SAMPLE_RATE = 0.05;

export interface ServerConfig {
  nodeEnv: NodeEnv;
  port: number;
  database: DatabaseConfig;
  admin: AdminConfig;
  /** The admin site counts days in this IANA time zone. */
  adminTz: string;
  trustProxy: TrustProxy;
  /**
   * Accounts (stage 8): the Firebase project whose ID tokens the server accepts (FIREBASE_PROJECT_ID), or
   * null. Outside production the server also takes development tokens (`dev:<uid>`), with or without a
   * project; in production without one, the account routes answer 503 `disabled`.
   */
  firebaseProjectId: string | null;
  /** RATING_OPTION [D7]: B (default) one rating per game type, A one per game type and player count. */
  ratingOption: RatingOption;
  /** CHEAT_FAST_THINK_MS and CHEAT_FAST_THINK_MOVES (spec §21). */
  cheat: CheatThresholds;
  /**
   * ACCOUNT_DELETE_MAX_AUTH_AGE_MS: DELETE /v1/me wants a sign-in (the ID token's auth_time) at most this long
   * ago, else 401 reauthRequired (default 5 minutes, Firebase's own rule for deleting a user).
   */
  accountDeleteMaxAuthAgeMs: number;
  /**
   * RANKED_REQUIRES_VERIFIED_EMAIL [D22] (default true): the ranked queue takes only an ID token whose email
   * is verified (`email_verified`), else it refuses with `emailNotVerified` (matchmaking/identity.ts). The
   * app asks the same before it searches (config/account.ts `verification.requiredForRanked`); this is the
   * server's own check. Development tokens count as verified: they are taken only outside production.
   */
  rankedRequiresVerifiedEmail: boolean;
  /** PRACTICE_XP_DAILY_CAP and INVITE_URL (stage 12). */
  progress: ProgressConfig;
  /** SENTRY_DSN and the rest (stage 14), or null: no error reports leave the server. */
  sentry: SentryConfig | null;
  /**
   * LEGAL_CONTACT_EMAIL and LEGAL_OPERATOR_NAME (stage 14): how to reach the game's operator, and who that is,
   * on the legal pages (src/legal). Unset (or absent, as in tests): the pages show visible placeholders and a
   * "draft" note.
   */
  legal?: LegalSettings;
}

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid server settings:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export interface LoadConfigOptions {
  /** Warnings about risky settings (default console.warn). */
  warn?: (message: string) => void;
  /** Makes the session secret when ADMIN_SESSION_SECRET is unset. */
  randomSecret?: () => string;
}

const unsetIfBlank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(unsetIfBlank, z.string().optional());
const trimmedString = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim()) : v),
  z.string().optional(),
);

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function parseTrustProxy(raw: string | undefined): TrustProxy {
  const v = raw?.trim() ?? '';
  if (v === '' || v === 'false') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

const envSchema = z.object({
  NODE_ENV: z.preprocess(unsetIfBlank, z.enum(NODE_ENVS).default('development')),
  PORT: z.preprocess(unsetIfBlank, z.coerce.number().int().min(0).max(65535).default(DEFAULT_PORT)),
  DATABASE_URL: z.preprocess(
    unsetIfBlank,
    z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'must start with postgres:// or postgresql://')
      .optional(),
  ),
  PGLITE_DIR: optionalString,
  // Not trimmed: spaces may be part of a password. Only an empty value counts as unset.
  ADMIN_PASSWORD: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  ADMIN_SESSION_SECRET: z.preprocess(
    unsetIfBlank,
    z
      .string()
      .min(MIN_SESSION_SECRET_LENGTH, `must be at least ${MIN_SESSION_SECRET_LENGTH} characters`)
      .optional(),
  ),
  ADMIN_TZ: z.preprocess(
    unsetIfBlank,
    z.string().refine(isTimeZone, 'not an IANA time zone').default(DEFAULT_ADMIN_TZ),
  ),
  TRUST_PROXY: optionalString,
  // Firebase project ids: 6–30 lower-case letters, digits and hyphens, from a letter, not ending in a hyphen.
  FIREBASE_PROJECT_ID: z.preprocess(
    unsetIfBlank,
    z
      .string()
      .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, 'not a Firebase project id (e.g. sudoku-fight-1a2b3)')
      .optional(),
  ),
  // The admin site's Google sign-in: who may sign in, and the Firebase web app the page signs in with. Checked
  // in adminConfig (googleSettingProblems), not here: a bad value turns Google sign-in off with a warning, and
  // never keeps the game server from starting.
  ADMIN_EMAILS: optionalString,
  FIREBASE_WEB_API_KEY: trimmedString,
  FIREBASE_WEB_APP_ID: trimmedString,
  RATING_OPTION: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim().toUpperCase()) : v),
    z.enum(['A', 'B'], { error: 'expected A or B' }).default('B'),
  ),
  CHEAT_FAST_THINK_MS: z.preprocess(
    unsetIfBlank,
    z.coerce.number().int().min(1).max(60_000).default(DEFAULT_CHEAT_THRESHOLDS.thinkMs),
  ),
  CHEAT_FAST_THINK_MOVES: z.preprocess(
    unsetIfBlank,
    z.coerce.number().int().min(2).max(81).default(DEFAULT_CHEAT_THRESHOLDS.moves),
  ),
  ACCOUNT_DELETE_MAX_AUTH_AGE_MS: z.preprocess(
    unsetIfBlank,
    z.coerce
      .number()
      .int()
      .min(1000)
      .max(24 * 3600 * 1000)
      .default(RECENT_SIGN_IN_MS),
  ),
  RANKED_REQUIRES_VERIFIED_EMAIL: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim().toLowerCase()) : v),
    z
      .enum(['true', 'false', '1', '0'], { error: 'expected true or false' })
      .default('true')
      .transform((v) => v === 'true' || v === '1'),
  ),
  PRACTICE_XP_DAILY_CAP: z.preprocess(
    unsetIfBlank,
    z.coerce.number().int().min(0).max(1_000_000).default(DEFAULT_PRACTICE_XP_DAILY_CAP),
  ),
  INVITE_URL: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim()) : v),
    z
      .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
      .max(500)
      .optional(),
  ),
  // Sentry (stage 14). A DSN is https://<public key>@<host>/<project id>; it is not a secret (it only lets
  // someone send events), but it stays out of the repo all the same: fly secrets.
  SENTRY_DSN: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim()) : v),
    z
      .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
      .refine(isSentryDsn, 'not a Sentry DSN (https://<key>@<host>/<project id>)')
      .optional(),
  ),
  // Sentry's rules: no spaces or slashes, at most 64 characters.
  SENTRY_ENVIRONMENT: z.preprocess(
    unsetIfBlank,
    z
      .string()
      .regex(/^[\w.-]{1,64}$/, 'letters, digits, "_", "." and "-" only, at most 64')
      .optional(),
  ),
  // Sentry's rules: no whitespace or slashes, not "." or "..", at most 200 characters.
  SENTRY_RELEASE: z.preprocess(
    unsetIfBlank,
    z
      .string()
      .regex(/^(?!\.{1,2}$)[^\s/\\]{1,200}$/, 'no spaces or slashes, at most 200 characters')
      .optional(),
  ),
  SENTRY_TRACES_SAMPLE_RATE: z.preprocess(
    unsetIfBlank,
    z.coerce.number().min(0).max(1).default(DEFAULT_TRACES_SAMPLE_RATE),
  ),
  // The deployed commit, for the release name: `fly deploy --env GIT_SHA=$(git rev-parse --short HEAD)`.
  GIT_SHA: z.preprocess(
    unsetIfBlank,
    z
      .string()
      .regex(/^[0-9a-f]{7,40}$/i, 'a git commit hash (7–40 hex digits)')
      .optional(),
  ),
  // Set by Fly.io on every machine (registry.fly.io/<app>:deployment-<id>); read, never required.
  FLY_IMAGE_REF: optionalString,
  // The legal pages (stage 14, src/legal): the privacy contact address, and who runs the game.
  LEGAL_CONTACT_EMAIL: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim()) : v),
    z.email({ error: 'not an email address' }).max(254).optional(),
  ),
  LEGAL_OPERATOR_NAME: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim()) : v),
    z.string().max(120, 'at most 120 characters').optional(),
  ),
});

function isSentryDsn(dsn: string): boolean {
  try {
    const url = new URL(dsn);
    return url.username !== '' && /^\/(?:.+\/)?\d+$/.test(url.pathname);
  } catch {
    return false;
  }
}

/** Sentry's release name: SENTRY_RELEASE, or the server's version with the commit or Fly's deployment. */
export function sentryRelease(env: {
  SENTRY_RELEASE?: string;
  GIT_SHA?: string;
  FLY_IMAGE_REF?: string;
}): string {
  if (env.SENTRY_RELEASE !== undefined) return env.SENTRY_RELEASE;
  const base = `sudoku-fight-server@${SERVER_VERSION}`;
  if (env.GIT_SHA !== undefined) return `${base}+${env.GIT_SHA.toLowerCase().slice(0, 12)}`;
  const deployment = /:(deployment-[A-Za-z0-9]+)$/.exec(env.FLY_IMAGE_REF ?? '')?.[1];
  return deployment === undefined ? base : `${base}+${deployment}`;
}

type Env = z.output<typeof envSchema>;

/** The settings Google sign-in needs; FIREBASE_PROJECT_ID alone is the app's accounts, not a half-set admin. */
const GOOGLE_ADMIN_SETTINGS = ['FIREBASE_PROJECT_ID', 'FIREBASE_WEB_API_KEY', 'ADMIN_EMAILS'] as const;

/** A browser API key: "AIza" and 35 more characters (Firebase → Project settings → the web app → apiKey). */
const FIREBASE_WEB_API_KEY_PATTERN = /^AIza[\w-]{35}$/;
/** The web app's id, 1:<project number>:web:<hex> (appId in the same place). */
const FIREBASE_WEB_APP_ID_PATTERN = /^1:\d{1,20}:web:[0-9a-f]{1,40}$/;

/**
 * What is wrong with the admin's Google settings that are set, each as `NAME: why`; none → []. An entry of
 * ADMIN_EMAILS that is not an address is named (it is a typo, not an address anyone signs in with).
 */
function googleSettingProblems(e: {
  ADMIN_EMAILS?: string;
  FIREBASE_WEB_API_KEY?: string;
  FIREBASE_WEB_APP_ID?: string;
}): string[] {
  const problems: string[] = [];
  if (e.ADMIN_EMAILS !== undefined) {
    const emails = splitAdminEmails(e.ADMIN_EMAILS);
    if (emails.length === 0) problems.push('ADMIN_EMAILS: no email address in it');
    for (const bad of emails.filter((x) => !isEmail(x))) {
      problems.push(`ADMIN_EMAILS: "${bad}" is not an email address`);
    }
  }
  if (e.FIREBASE_WEB_API_KEY !== undefined && !FIREBASE_WEB_API_KEY_PATTERN.test(e.FIREBASE_WEB_API_KEY)) {
    problems.push('FIREBASE_WEB_API_KEY: not a Firebase web API key (apiKey: "AIza" and 35 more characters)');
  }
  if (e.FIREBASE_WEB_APP_ID !== undefined && !FIREBASE_WEB_APP_ID_PATTERN.test(e.FIREBASE_WEB_APP_ID)) {
    problems.push('FIREBASE_WEB_APP_ID: not a Firebase web app id (appId: 1:<number>:web:<hex>)');
  }
  return problems;
}

/**
 * The admin site's sign-in (spec §27.3), from ADMIN_EMAILS, FIREBASE_*, ADMIN_PASSWORD and ADMIN_SESSION_SECRET.
 * - Google: on with FIREBASE_PROJECT_ID, FIREBASE_WEB_API_KEY and ADMIN_EMAILS (FIREBASE_WEB_APP_ID optional).
 *   Some of them without the rest, or a bad value among them (googleSettingProblems): off, with a warning
 *   saying what is missing or wrong. Never a ConfigError: an admin-only setting (say, a typo in ADMIN_EMAILS
 *   set on the live server) must not keep the game from starting.
 * - Password: ADMIN_PASSWORD; production wants at least 8 characters and not the (public) dev password, else
 *   password sign-in stays off (with a warning). Elsewhere, unset means the fixed dev password, but only with
 *   the local PGlite (never against a real database).
 * - Neither: the admin site is off, and the warning says why.
 */
function adminConfig(
  e: Env,
  {
    production,
    database,
    warn,
    randomSecret,
  }: {
    production: boolean;
    database: DatabaseConfig;
    warn: (message: string) => void;
    randomSecret: () => string;
  },
): AdminConfig {
  const sessionSecret = e.ADMIN_SESSION_SECRET ?? randomSecret();

  // Google sign-in.
  let google: AdminGoogleSignIn | null = null;
  let googleOff: string;
  const projectId = e.FIREBASE_PROJECT_ID;
  const apiKey = e.FIREBASE_WEB_API_KEY;
  const emails = e.ADMIN_EMAILS;
  const problems = googleSettingProblems(e);
  if (problems.length === 0 && projectId !== undefined && apiKey !== undefined && emails !== undefined) {
    google = {
      web: {
        apiKey,
        authDomain: `${projectId}.firebaseapp.com`,
        projectId,
        appId: e.FIREBASE_WEB_APP_ID ?? null,
      },
      allowedEmails: splitAdminEmails(emails),
    };
    googleOff = '';
  } else {
    const missing = GOOGLE_ADMIN_SETTINGS.filter((name) => e[name] === undefined);
    const why = [...problems, ...(missing.length === 0 ? [] : [`${missing.join(', ')} not set`])];
    const partial = apiKey !== undefined || emails !== undefined || e.FIREBASE_WEB_APP_ID !== undefined;
    googleOff =
      problems.length === 0
        ? `Google sign-in needs ${missing.join(', ')}`
        : `Google sign-in is off: ${why.join('; ')}`;
    if (partial) warn(`[config] admin Google sign-in off: ${why.join('; ')}`);
  }

  // Password sign-in.
  let password: string | null = null;
  let devPassword = false;
  let passwordOff = '';
  if (e.ADMIN_PASSWORD !== undefined) {
    const weak =
      e.ADMIN_PASSWORD.length < MIN_ADMIN_PASSWORD_LENGTH
        ? `ADMIN_PASSWORD is shorter than ${MIN_ADMIN_PASSWORD_LENGTH} characters`
        : e.ADMIN_PASSWORD === DEV_ADMIN_PASSWORD
          ? 'ADMIN_PASSWORD is the dev password, which is public (it is in the code)'
          : null;
    if (production && weak !== null) {
      passwordOff = weak;
      if (google !== null) warn(`[config] admin password sign-in off: ${weak}`);
    } else {
      password = e.ADMIN_PASSWORD;
    }
  } else if (!production && database.kind === 'pglite') {
    password = DEV_ADMIN_PASSWORD;
    devPassword = true;
    if (e.NODE_ENV === 'development') {
      warn(
        [
          '',
          '!!! ===================================================================',
          `!!! ADMIN_PASSWORD is not set: the admin site takes the dev password "${DEV_ADMIN_PASSWORD}".`,
          '!!! A server that goes online signs admins in with Google (ADMIN_EMAILS, FIREBASE_WEB_API_KEY)',
          `!!! or with an ADMIN_PASSWORD of ${MIN_ADMIN_PASSWORD_LENGTH}+ characters.`,
          '!!! ===================================================================',
          '',
        ].join('\n'),
      );
    }
  } else {
    passwordOff = production
      ? 'ADMIN_PASSWORD is not set'
      : 'ADMIN_PASSWORD is not set (the dev password works only with the local PGlite)';
  }

  if (google === null && password === null) {
    const reason = `no sign-in method: ${googleOff}; ${passwordOff}`;
    warn(`[config] admin site disabled: ${reason}`);
    return { enabled: false, reason, sessionSecret };
  }
  if (production && e.ADMIN_SESSION_SECRET === undefined) {
    warn('[config] ADMIN_SESSION_SECRET is not set: admins sign in again after each restart');
  }
  return { enabled: true, password, devPassword, google, sessionSecret };
}

/**
 * Reads the settings. Throws ConfigError listing every bad value, so the server fails at start, not later.
 *
 * - DATABASE_URL set → Postgres. Unset → PGlite in PGLITE_DIR (default apps/server/.data/pglite; in-memory
 *   under NODE_ENV=test, or with PGLITE_DIR=memory). Production needs DATABASE_URL unless PGLITE_DIR is set.
 * - The admin site: Google sign-in for ADMIN_EMAILS, and/or ADMIN_PASSWORD (adminConfig above). Production
 *   refuses a password shorter than 8 characters or the (public) dev password; elsewhere, unset means the fixed
 *   dev password, but only with the local PGlite (never against a real database). A bad ADMIN_EMAILS or
 *   FIREBASE_WEB_* turns Google sign-in off with a warning; it never stops the server.
 * - FIREBASE_PROJECT_ID: unset in production → accounts off, with a warning (the server still starts: the
 *   game and the admin site don't need it).
 * - SENTRY_DSN: unset → `sentry: null`, no error reports (the start says so; src/index.ts).
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  { warn = console.warn, randomSecret = () => randomBytes(32).toString('hex') }: LoadConfigOptions = {},
): ServerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';

  let database: DatabaseConfig;
  if (e.DATABASE_URL !== undefined) {
    database = { kind: 'postgres', url: e.DATABASE_URL };
  } else if (production && e.PGLITE_DIR === undefined) {
    throw new ConfigError([
      'DATABASE_URL: required in production (or set PGLITE_DIR to run on PGlite on purpose)',
    ]);
  } else {
    const dir = e.PGLITE_DIR ?? (e.NODE_ENV === 'test' ? 'memory' : DEFAULT_PGLITE_DIR);
    database = { kind: 'pglite', dataDir: /^memory(:\/\/)?$/.test(dir) ? null : path.resolve(dir) };
    if (production) warn('[config] production on PGlite: data stays on this machine only');
  }

  const admin = adminConfig(e, { production, database, warn, randomSecret });

  const firebaseProjectId = e.FIREBASE_PROJECT_ID ?? null;
  if (production && firebaseProjectId === null) {
    warn('[config] accounts disabled: FIREBASE_PROJECT_ID is not set (the account routes answer 503)');
  }
  const legal: LegalSettings = {
    contactEmail: e.LEGAL_CONTACT_EMAIL ?? null,
    operatorName: e.LEGAL_OPERATOR_NAME ?? null,
  };
  if (production && (legal.contactEmail === null || legal.operatorName === null)) {
    warn('[config] LEGAL_CONTACT_EMAIL or LEGAL_OPERATOR_NAME is not set: the legal pages show placeholders');
  }

  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    database,
    admin,
    adminTz: e.ADMIN_TZ,
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
    firebaseProjectId,
    ratingOption: e.RATING_OPTION,
    cheat: { thinkMs: e.CHEAT_FAST_THINK_MS, moves: e.CHEAT_FAST_THINK_MOVES },
    accountDeleteMaxAuthAgeMs: e.ACCOUNT_DELETE_MAX_AUTH_AGE_MS,
    rankedRequiresVerifiedEmail: e.RANKED_REQUIRES_VERIFIED_EMAIL,
    progress: { practiceXpDailyCap: e.PRACTICE_XP_DAILY_CAP, inviteUrl: e.INVITE_URL ?? null },
    sentry:
      e.SENTRY_DSN === undefined
        ? null
        : {
            dsn: e.SENTRY_DSN,
            environment: e.SENTRY_ENVIRONMENT ?? e.NODE_ENV,
            release: sentryRelease(e),
            tracesSampleRate: e.SENTRY_TRACES_SAMPLE_RATE,
          },
    legal,
  };
}
