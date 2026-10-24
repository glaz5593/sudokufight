import { randomBytes } from 'node:crypto';
import path from 'node:path';

import type { RatingOption } from '@sudoku-fight/engine';
import {
  type AdminGoogleWebConfig,
  parseQueueKey,
  type QueueKey,
  queueKey,
  RECENT_SIGN_IN_MS,
} from '@sudoku-fight/protocol';
import { z } from 'zod';

import serverPackage from '../package.json';
import type { RateLimitRule } from './http/rateLimiter';
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
 *   The levels of staged practice (1.0.2, src/progress/levels.ts) share it: their XP of a day counts in it.
 * - `inviteUrl` (INVITE_URL): the link the friends tab's "invite friends" button shares [D27]; null hides it.
 * - `levelXpCarryOver` (LEVEL_XP_CARRY_OVER, default true) [D55]: level XP that does not fit in a day's cap is
 *   paid on a later day (the next PUT /v1/me/levels), so all of it (10,450 at most) arrives in the end; false:
 *   what does not fit is lost, as practice XP is. Absent when the variable is not set (the default applies).
 */
export interface ProgressConfig {
  practiceXpDailyCap: number;
  inviteUrl: string | null;
  levelXpCarryOver?: boolean;
}

export const DEFAULT_PRACTICE_XP_DAILY_CAP = 1500;
export const DEFAULT_LEVEL_XP_CARRY_OVER = true;

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

/**
 * The SHA-256 of the debug key in React Native's project template (android/app/debug.keystore, alias
 * androiddebugkey, password "android"), which signs the APKs of `npm run apk`; its SHA-1 is app.config.ts's
 * TEMPLATE_DEBUG_KEY_SHA1. `keytool -list -v -keystore apps/mobile/android/app/debug.keystore -alias
 * androiddebugkey -storepass android` prints both. The key is public: it is the same in every React Native project,
 * so anyone can sign an APK named com.mosheg.sudokufight with it. Listed in assetlinks.json, such an APK would
 * be given the room links. Fine for a test server's test phones (staging); a production server refuses it
 * unless ANDROID_APP_LINK_ALLOW_DEBUG_KEY says otherwise (friends-room.md §6.2).
 */
export const TEMPLATE_DEBUG_KEY_SHA256 =
  'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C';

/** At most this many fingerprints in ANDROID_APP_LINK_SHA256 (the keys that sign the app: a handful). */
export const MAX_APP_LINK_FINGERPRINTS = 10;

/**
 * A SHA-256 certificate fingerprint as assetlinks.json wants it, 32 bytes as "AB:CD:…" in upper case, from
 * what keytool, `eas credentials` or Play Console show (with or without colons, any case); null when it is not
 * one.
 */
export function canonicalSha256(raw: string): string | null {
  const hex = raw.trim().replace(/:/g, '').toUpperCase();
  return /^[0-9A-F]{64}$/.test(hex) ? (hex.match(/../g) ?? []).join(':') : null;
}

/**
 * An iOS app id for apple-app-site-association: "<Team ID>.<bundle id>", the Team ID being 10 upper-case letters
 * and digits (Apple Developer → Membership), e.g. "ABCDE12345.com.mosheg.sudokufight".
 */
const IOS_APP_ID_PATTERN = /^[A-Z0-9]{10}\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

/**
 * Room links of playing with friends (1.0.4; docs/handoff/2026-10-19/friends-room.md §6; src/friends/links.ts).
 * None of it is a secret: the files they make are public by design.
 * - `androidSha256` (ANDROID_APP_LINK_SHA256): the SHA-256 of every key that signs the Android app this server's
 *   links open (staging: the PC's test key and EAS's; production: EAS's and Google Play's app signing key), in
 *   GET /.well-known/assetlinks.json. Empty: that file answers 404, and the links open in the browser.
 * - `iosAppId` (IOS_APP_ID): for GET /.well-known/apple-app-site-association; null: 404 (no iOS build yet).
 * - `storeUrls` (STORE_URL_ANDROID, STORE_URL_IOS): the store pages the link's browser page offers; null: the
 *   page says the app is still in testing.
 */
export interface FriendsLinksConfig {
  androidSha256: readonly string[];
  iosAppId: string | null;
  storeUrls: { android: string | null; ios: string | null };
}

/**
 * The rate limits of the /v1/rooms routes (friends-room.md §5 [D86]; token buckets, src/http/rateLimiter.ts):
 * - `create` (FRIENDS_CREATES_PER_HOUR, default 10): rooms one account may open in an hour;
 * - `joinPerAccount` (FRIENDS_JOINS_PER_10_MIN, default 20): tries to join (with a code or a link) per account
 *   in 10 minutes;
 * - `joinPerIp` (FRIENDS_JOINS_PER_10_MIN_PER_IP, default 60): the same per IP address (an IPv6 /64 is one).
 * With 100 rooms open, 20 random tries in 10 minutes find one in about 3.5 days, and then only reach a waiting
 * room whose host can remove them. Past a limit: 429 `tooManyRequests` with Retry-After.
 */
export interface FriendsLimits {
  create: RateLimitRule;
  joinPerAccount: RateLimitRule;
  joinPerIp: RateLimitRule;
}

const MINUTE_MS = 60_000;

export const DEFAULT_FRIENDS_LIMITS: FriendsLimits = {
  create: { limit: 10, windowMs: 60 * MINUTE_MS },
  joinPerAccount: { limit: 20, windowMs: 10 * MINUTE_MS },
  joinPerIp: { limit: 60, windowMs: 10 * MINUTE_MS },
};

/** Playing with friends (1.0.4): its links and its rate limits. */
export interface FriendsConfig {
  links: FriendsLinksConfig;
  limits: FriendsLimits;
}

export const NO_FRIENDS_LINKS: FriendsLinksConfig = {
  androidSha256: [],
  iosAppId: null,
  storeUrls: { android: null, ios: null },
};

/** A range of milliseconds, both ends included. */
export interface MsSpan {
  min: number;
  max: number;
}

/**
 * The stealth bot (docs/handoff/2026-10-19/stealth-bot.md §4, §7, §8) [D90–D99; Moshe's "yes" of 2026-10-20]:
 * when a ranked two-player search finds nobody, the server may seat a bot that plays like a person (src/stealth).
 * Built OFF: switching it on in staging waits for Moshe's word [D90].
 * - `enabled` (STEALTH_BOT_ENABLED, default false): the master switch. False: the feature does not exist on this
 *   server (matchmaking behaves as before it, and the admin site has no switch). True: the admin site's switch
 *   (server_settings, src/stealth/switch.ts; off until an admin turns it on) decides, with no restart.
 * - `queues` (STEALTH_BOT_QUEUES, default fast-2p,normal-2p,hard-2p): the queues it may enter; two-player
 *   queues only [D94].
 * - `afterMs` (STEALTH_BOT_AFTER_MS, default 8000-20000) [D94]: a wait drawn in this span when a search starts;
 *   the bot may come only after it, and only while nobody the player could meet is searching.
 * - `hideNobody` (STEALTH_BOT_HIDE_NOBODY, default true) [D95]: while the bot is on and a persona is within the
 *   player's reach, `searching` carries no `nextRange` (the app shows the range bar, as before 15.10), instead of
 *   "nobody else is searching".
 * - `personaPoolMax` (STEALTH_PERSONA_POOL_MAX, default 1000) [D91]: the most personas the server makes.
 * - `readyAfterMs` (300–1500 ms; not an environment setting): the persona connects to the game room this long
 *   after the room opens, as a person's app does (D37: connected = ready).
 * - `secret` (STEALTH_BOT_SECRET; random per start when unset): the key of the bot's private seed
 *   (HMAC(secret, game id)), so the game's public seed tells an app nothing of the bot's moves. Set it to replay a
 *   reported game's bot later. Never logged, never sent.
 */
export interface StealthBotSettings {
  enabled: boolean;
  queues: readonly QueueKey[];
  afterMs: MsSpan;
  hideNobody: boolean;
  personaPoolMax: number;
  readyAfterMs: MsSpan;
  secret: string;
}

export const STEALTH_BOT_QUEUES: readonly QueueKey[] = ['fast-2p', 'normal-2p', 'hard-2p'];

export const DEFAULT_STEALTH_BOT: Omit<StealthBotSettings, 'secret'> = {
  enabled: false,
  queues: STEALTH_BOT_QUEUES,
  afterMs: { min: 8000, max: 20_000 },
  hideNobody: true,
  personaPoolMax: 1000,
  readyAfterMs: { min: 300, max: 1500 },
};

export const MIN_STEALTH_BOT_SECRET_LENGTH = 32;

/**
 * The QA module (docs/handoff/2026-10-23/qa-module/plan.md; src/qa, admin/qa.ts): test runs from a fixed
 * catalog, marked on the admin site or by Claude over the API.
 * - `enabled` (QA_ENABLED, default false): off, every /admin/api/qa route answers 503 `qaDisabled` [Q1: on in
 *   staging and locally only].
 * - `agentToken` (QA_AGENT_TOKEN; 32+ characters, not trimmed): Claude's key for the /qa routes only
 *   (`Authorization: Bearer …`); null: only the admin's own sign-in works there. A secret: fly secrets, never
 *   the repo, never logged.
 * - `open` (QA_OPEN, default false): the /qa routes need no sign-in and no key; such a caller is Claude.
 *   Moshe, 2026-10-24: a key is one thing too many on staging, which keeps no money or private data. On in
 *   staging only (fly.toml), like QA_ENABLED.
 */
export interface QaSettings {
  enabled: boolean;
  agentToken: string | null;
  /** Absent (as in older tests): false. */
  open?: boolean;
}

export const MIN_QA_AGENT_TOKEN_LENGTH = 32;

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
  /** PRACTICE_XP_DAILY_CAP and INVITE_URL (stage 12); LEVEL_XP_CARRY_OVER (1.0.2). */
  progress: ProgressConfig;
  /** SENTRY_DSN and the rest (stage 14), or null: no error reports leave the server. */
  sentry: SentryConfig | null;
  /**
   * LEGAL_CONTACT_EMAIL and LEGAL_OPERATOR_NAME (stage 14): how to reach the game's operator, and who that is,
   * on the legal pages (src/legal). Unset (or absent, as in tests): the pages show visible placeholders and a
   * "draft" note.
   */
  legal?: LegalSettings;
  /**
   * Playing with friends (1.0.4): ANDROID_APP_LINK_SHA256, IOS_APP_ID, STORE_URL_* and the FRIENDS_* limits.
   * loadConfig always sets it; absent (as in tests): no app-link files, no store links, DEFAULT_FRIENDS_LIMITS.
   */
  friends?: FriendsConfig;
  /**
   * The stealth bot (STEALTH_BOT_* and STEALTH_PERSONA_POOL_MAX): loadConfig always sets it, off by default;
   * absent (as in tests): off.
   */
  stealth?: StealthBotSettings;
  /** QA_ENABLED and QA_AGENT_TOKEN: loadConfig always sets it, off by default; absent (as in tests): off. */
  qa?: QaSettings;
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
  LEVEL_XP_CARRY_OVER: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim().toLowerCase()) : v),
    z
      .enum(['true', 'false', '1', '0'], { error: 'expected true or false' })
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1')),
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
  // Playing with friends (1.0.4): the room links' app-link files and browser page (src/friends/links.ts).
  ANDROID_APP_LINK_SHA256: z.preprocess(
    unsetIfBlank,
    z
      .string()
      .optional()
      .transform((raw, ctx) => {
        if (raw === undefined) return [];
        const fingerprints: string[] = [];
        for (const entry of raw.split(/[\s,;]+/).filter((x) => x !== '')) {
          const fingerprint = canonicalSha256(entry);
          if (fingerprint === null) {
            ctx.addIssue({
              code: 'custom',
              message: `"${entry.slice(0, 120)}" is not a SHA-256 fingerprint (32 bytes in hex, e.g. FA:C6:17:…)`,
            });
            return z.NEVER;
          }
          if (!fingerprints.includes(fingerprint)) fingerprints.push(fingerprint);
        }
        if (fingerprints.length > MAX_APP_LINK_FINGERPRINTS) {
          ctx.addIssue({ code: 'custom', message: `at most ${MAX_APP_LINK_FINGERPRINTS} fingerprints` });
          return z.NEVER;
        }
        return fingerprints;
      }),
  ),
  ANDROID_APP_LINK_ALLOW_DEBUG_KEY: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim().toLowerCase()) : v),
    z
      .enum(['true', 'false', '1', '0'], { error: 'expected true or false' })
      .default('false')
      .transform((v) => v === 'true' || v === '1'),
  ),
  IOS_APP_ID: z.preprocess(
    unsetIfBlank,
    z
      .string()
      .trim()
      .regex(IOS_APP_ID_PATTERN, 'not an iOS app id (<Team ID: 10 letters and digits>.<bundle id>)')
      .optional(),
  ),
  STORE_URL_ANDROID: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim()) : v),
    z
      .url({ protocol: /^https$/, error: 'must be an https URL' })
      .max(500)
      .optional(),
  ),
  STORE_URL_IOS: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim()) : v),
    z
      .url({ protocol: /^https$/, error: 'must be an https URL' })
      .max(500)
      .optional(),
  ),
  FRIENDS_CREATES_PER_HOUR: z.preprocess(
    unsetIfBlank,
    z.coerce.number().int().min(1).max(1000).default(DEFAULT_FRIENDS_LIMITS.create.limit),
  ),
  FRIENDS_JOINS_PER_10_MIN: z.preprocess(
    unsetIfBlank,
    z.coerce.number().int().min(1).max(1000).default(DEFAULT_FRIENDS_LIMITS.joinPerAccount.limit),
  ),
  FRIENDS_JOINS_PER_10_MIN_PER_IP: z.preprocess(
    unsetIfBlank,
    z.coerce.number().int().min(1).max(100_000).default(DEFAULT_FRIENDS_LIMITS.joinPerIp.limit),
  ),
  // The stealth bot (src/stealth; stealth-bot.md §8) [D90]: off unless STEALTH_BOT_ENABLED says otherwise.
  STEALTH_BOT_ENABLED: booleanSetting(DEFAULT_STEALTH_BOT.enabled),
  STEALTH_BOT_QUEUES: z.preprocess(
    unsetIfBlank,
    z
      .string()
      .optional()
      .transform((raw, ctx) => {
        if (raw === undefined) return [...DEFAULT_STEALTH_BOT.queues];
        const keys: QueueKey[] = [];
        for (const entry of raw.split(/[\s,;]+/).filter((x) => x !== '')) {
          const spec = parseQueueKey(entry.trim().toLowerCase());
          if (spec === null || spec.players !== 2) {
            ctx.addIssue({
              code: 'custom',
              message: `"${entry.slice(0, 40)}" is not a two-player queue (fast-2p, normal-2p, hard-2p) [D94]`,
            });
            return z.NEVER;
          }
          const key = queueKey(spec.gameType, spec.players);
          if (!keys.includes(key)) keys.push(key);
        }
        return keys;
      }),
  ),
  STEALTH_BOT_AFTER_MS: z.preprocess(
    unsetIfBlank,
    z
      .string()
      .optional()
      .transform((raw, ctx) => {
        if (raw === undefined) return { ...DEFAULT_STEALTH_BOT.afterMs };
        const m = /^\s*(\d{1,7})\s*(?:-\s*(\d{1,7})\s*)?$/.exec(raw);
        const min = m ? Number(m[1]) : NaN;
        const max = m ? Number(m[2] ?? m[1]) : NaN;
        if (!m || min > max || max > 600_000) {
          ctx.addIssue({
            code: 'custom',
            message: 'expected "<min>-<max>" in ms (e.g. 8000-20000), min ≤ max ≤ 600000',
          });
          return z.NEVER;
        }
        return { min, max };
      }),
  ),
  STEALTH_BOT_HIDE_NOBODY: booleanSetting(DEFAULT_STEALTH_BOT.hideNobody),
  STEALTH_PERSONA_POOL_MAX: z.preprocess(
    unsetIfBlank,
    z.coerce.number().int().min(1).max(100_000).default(DEFAULT_STEALTH_BOT.personaPoolMax),
  ),
  // Not trimmed, like a password: only an empty value counts as unset.
  STEALTH_BOT_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .min(MIN_STEALTH_BOT_SECRET_LENGTH, `must be at least ${MIN_STEALTH_BOT_SECRET_LENGTH} characters`)
      .optional(),
  ),
  // The QA module (src/qa): off unless QA_ENABLED says otherwise.
  QA_ENABLED: booleanSetting(false),
  QA_OPEN: booleanSetting(false),
  // Not trimmed, like a password: only an empty value counts as unset.
  QA_AGENT_TOKEN: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .min(MIN_QA_AGENT_TOKEN_LENGTH, `must be at least ${MIN_QA_AGENT_TOKEN_LENGTH} characters`)
      .optional(),
  ),
});

/** A true/false setting: true, false, 1 or 0 (any case); unset or blank → `fallback`. */
function booleanSetting(fallback: boolean) {
  return z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim().toLowerCase()) : v),
    z
      .enum(['true', 'false', '1', '0'], { error: 'expected true or false' })
      .optional()
      .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1')),
  );
}

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
 * - ANDROID_APP_LINK_SHA256 with React Native's public debug key: production refuses to start, unless
 *   ANDROID_APP_LINK_ALLOW_DEBUG_KEY=true (a test server; friendsConfig below).
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
  const friends = friendsConfig(e, { production, warn });

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
    progress: {
      practiceXpDailyCap: e.PRACTICE_XP_DAILY_CAP,
      inviteUrl: e.INVITE_URL ?? null,
      ...(e.LEVEL_XP_CARRY_OVER === undefined ? {} : { levelXpCarryOver: e.LEVEL_XP_CARRY_OVER }),
    },
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
    friends,
    stealth: {
      enabled: e.STEALTH_BOT_ENABLED,
      queues: e.STEALTH_BOT_QUEUES,
      afterMs: e.STEALTH_BOT_AFTER_MS,
      hideNobody: e.STEALTH_BOT_HIDE_NOBODY,
      personaPoolMax: e.STEALTH_PERSONA_POOL_MAX,
      readyAfterMs: { ...DEFAULT_STEALTH_BOT.readyAfterMs },
      secret: e.STEALTH_BOT_SECRET ?? randomSecret(),
    },
    qa: { enabled: e.QA_ENABLED, agentToken: e.QA_AGENT_TOKEN ?? null, open: e.QA_OPEN },
  };
}

/** The QA module in the start-up line: on or off, and whether Claude's key is set (never the key). */
export function describeQa(qa: QaSettings | undefined): string {
  if (qa === undefined || !qa.enabled) return 'QA module off (QA_ENABLED=false)';
  if (qa.open === true) return 'QA module on (open: no sign-in needed)';
  return `QA module on (${qa.agentToken === null ? 'no agent key: admin sign-in only' : 'agent key set'})`;
}

/**
 * Playing with friends' settings (friends-room.md §5, §6.2). A production server (staging too: both run
 * NODE_ENV=production) refuses to start when ANDROID_APP_LINK_SHA256 lists React Native's public debug key
 * (TEMPLATE_DEBUG_KEY_SHA256), unless ANDROID_APP_LINK_ALLOW_DEBUG_KEY=true says it is a test server on purpose
 * (fly.toml, for the APKs of `npm run apk`); then it warns at every start. Never in fly.production.toml.
 */
function friendsConfig(
  e: Env,
  { production, warn }: { production: boolean; warn: (message: string) => void },
): FriendsConfig {
  const androidSha256 = e.ANDROID_APP_LINK_SHA256;
  if (production && androidSha256.includes(TEMPLATE_DEBUG_KEY_SHA256)) {
    if (!e.ANDROID_APP_LINK_ALLOW_DEBUG_KEY) {
      throw new ConfigError([
        'ANDROID_APP_LINK_SHA256: lists the public debug key of React Native (FA:C6:17:…:3B:9C), which anyone ' +
          "can sign an APK with: such an APK would get this server's room links. Take it out, or on a test server " +
          'only set ANDROID_APP_LINK_ALLOW_DEBUG_KEY=true',
      ]);
    }
    warn(
      "[config] assetlinks.json lists React Native's public debug key (ANDROID_APP_LINK_ALLOW_DEBUG_KEY): " +
        'for a test server only',
    );
  }
  return {
    links: {
      androidSha256,
      iosAppId: e.IOS_APP_ID ?? null,
      storeUrls: { android: e.STORE_URL_ANDROID ?? null, ios: e.STORE_URL_IOS ?? null },
    },
    limits: {
      create: { ...DEFAULT_FRIENDS_LIMITS.create, limit: e.FRIENDS_CREATES_PER_HOUR },
      joinPerAccount: { ...DEFAULT_FRIENDS_LIMITS.joinPerAccount, limit: e.FRIENDS_JOINS_PER_10_MIN },
      joinPerIp: { ...DEFAULT_FRIENDS_LIMITS.joinPerIp, limit: e.FRIENDS_JOINS_PER_10_MIN_PER_IP },
    },
  };
}
