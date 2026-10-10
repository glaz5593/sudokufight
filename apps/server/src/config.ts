import { randomBytes } from 'node:crypto';
import path from 'node:path';

import type { RatingOption } from '@sudoku-fight/engine';
import { RECENT_SIGN_IN_MS } from '@sudoku-fight/protocol';
import { z } from 'zod';

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
/** In production a shorter ADMIN_PASSWORD leaves the admin site off. */
export const MIN_ADMIN_PASSWORD_LENGTH = 12;
export const MIN_SESSION_SECRET_LENGTH = 32;

/** Where the data lives: Postgres (production) or PGlite, the in-process Postgres (development, tests). */
export type DatabaseConfig = { kind: 'postgres'; url: string } | { kind: 'pglite'; dataDir: string | null };

/**
 * The admin site (spec §27.3). `enabled: false` → every /admin/api route answers 503 `disabled`.
 * `sessionSecret` signs the session cookie; random per boot when ADMIN_SESSION_SECRET is unset, so a restart
 * signs everyone out.
 */
export type AdminConfig =
  | { enabled: true; password: string; sessionSecret: string; devPassword: boolean }
  | { enabled: false; reason: string; sessionSecret: string };

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
  /** PRACTICE_XP_DAILY_CAP and INVITE_URL (stage 12). */
  progress: ProgressConfig;
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
});

/**
 * Reads the settings. Throws ConfigError listing every bad value, so the server fails at start, not later.
 *
 * - DATABASE_URL set → Postgres. Unset → PGlite in PGLITE_DIR (default apps/server/.data/pglite; in-memory
 *   under NODE_ENV=test, or with PGLITE_DIR=memory). Production needs DATABASE_URL unless PGLITE_DIR is set.
 * - ADMIN_PASSWORD: production needs at least 12 characters, and not the (public) dev password, else the
 *   admin site stays off. Elsewhere, unset means the fixed dev password, but only with the local PGlite (never
 *   against a real database).
 * - FIREBASE_PROJECT_ID: unset in production → accounts off, with a warning (the server still starts: the
 *   game and the admin site don't need it).
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

  const sessionSecret = e.ADMIN_SESSION_SECRET ?? randomSecret();
  let admin: AdminConfig;
  const password = e.ADMIN_PASSWORD;
  if (password !== undefined) {
    const weak =
      password.length < MIN_ADMIN_PASSWORD_LENGTH
        ? `ADMIN_PASSWORD is shorter than ${MIN_ADMIN_PASSWORD_LENGTH} characters`
        : password === DEV_ADMIN_PASSWORD
          ? 'ADMIN_PASSWORD is the dev password, which is public (it is in the code)'
          : null;
    if (production && weak !== null) {
      warn(`[config] admin site disabled: ${weak}`);
      admin = { enabled: false, reason: weak, sessionSecret };
    } else {
      admin = { enabled: true, password, sessionSecret, devPassword: false };
    }
  } else if (!production && database.kind === 'pglite') {
    admin = { enabled: true, password: DEV_ADMIN_PASSWORD, sessionSecret, devPassword: true };
    if (e.NODE_ENV === 'development') {
      warn(
        [
          '',
          '!!! ===================================================================',
          `!!! ADMIN_PASSWORD is not set: the admin site takes the dev password "${DEV_ADMIN_PASSWORD}".`,
          `!!! Set ADMIN_PASSWORD (${MIN_ADMIN_PASSWORD_LENGTH}+ characters) before this server goes online.`,
          '!!! ===================================================================',
          '',
        ].join('\n'),
      );
    }
  } else {
    const reason = production
      ? 'ADMIN_PASSWORD is not set'
      : 'ADMIN_PASSWORD is not set (the dev password works only with the local PGlite)';
    warn(`[config] admin site disabled: ${reason}`);
    admin = { enabled: false, reason, sessionSecret };
  }
  if (admin.enabled && production && e.ADMIN_SESSION_SECRET === undefined) {
    warn('[config] ADMIN_SESSION_SECRET is not set: admin sessions end when the server restarts');
  }

  const firebaseProjectId = e.FIREBASE_PROJECT_ID ?? null;
  if (production && firebaseProjectId === null) {
    warn('[config] accounts disabled: FIREBASE_PROJECT_ID is not set (the account routes answer 503)');
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
    progress: { practiceXpDailyCap: e.PRACTICE_XP_DAILY_CAP, inviteUrl: e.INVITE_URL ?? null },
  };
}
