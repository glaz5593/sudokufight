import { LEVEL_KINDS, type LevelKind } from '@sudoku-fight/engine';

import type { AvatarId, NO_AVATAR_ID } from './account';
import type { ReportReason, ReportStatus } from './moderation';
import type { TelemetryEventName, TelemetryProps } from './telemetry';

/**
 * The admin site's API (spec §27.3): under `/admin/api`, behind a sign-in. The site (apps/admin) and the server
 * (apps/server) both build on these types. Read-only, except the moderation actions below (spec §3.5, approved
 * by Moshe on 2026-10-12: UGC-PROPOSAL option A), each written to the audit log.
 *
 * Signing in: with Google (a Firebase ID token of an address on the server's ADMIN_EMAILS list), and/or with
 * the admin password (ADMIN_PASSWORD; in development, the dev password). Which of them a server offers is
 * public: GET /admin/api/auth/methods. Both end in the same session cookie.
 *
 * Times are epoch ms. Days are 'YYYY-MM-DD' in the admin time zone (server setting, Asia/Jerusalem by default).
 *
 * Routes:
 *   GET  /admin/api/auth/methods → AdminAuthMethods (no session needed)
 *   POST /admin/api/login        AdminLoginRequest → 204 and an HttpOnly session cookie · 401 wrong password ·
 *                                403 disabled (password sign-in is off) · 429 too many tries
 *   POST /admin/api/login/google AdminGoogleLoginRequest → 204 and the same cookie · AdminGoogleLoginError
 *   POST /admin/api/logout       → 204
 *   GET  /admin/api/session      → AdminSession · 401 when not signed in (every route below answers 401 too)
 *   GET  /admin/api/overview?days=30                      → AdminOverview
 *   GET  /admin/api/installs?search=&page=1&pageSize=50   → AdminPage<AdminInstallRow>
 *   GET  /admin/api/installs/:id                          → AdminInstallDetail · 404
 *   GET  /admin/api/users?search=&page=1&pageSize=50      → AdminPage<AdminUserRow>
 *   GET  /admin/api/users/:id                             → AdminUserDetail · 404
 *   GET  /admin/api/games?mode=&search=&page=1&pageSize=50 → AdminPage<AdminGameRow>
 *   GET  /admin/api/games/:id                             → AdminGameDetail · 404
 *   GET  /admin/api/screens?days=30                       → AdminScreens
 *   GET  /admin/api/levels?days=30                        → AdminLevels (staged practice, 1.0.2)
 *
 * Moderation (spec §3.5; AdminActionError for the codes):
 *   GET  /admin/api/reports?status=open&page=1&pageSize=50 → AdminPage<AdminReportedPlayer>
 *        status: open (default) | resolved | dismissed | all. One item per reported player (total: players).
 *   POST /admin/api/reports/:id/resolve                    → AdminReport · 404 · 409 notOpen
 *   POST /admin/api/reports/:id/dismiss                    → AdminReport · 404 · 409 notOpen
 *   POST /admin/api/users/:id/reset-name                   → AdminModerationResult · 404 · 409 accountDeleted
 *   POST /admin/api/users/:id/suspend                      → AdminModerationResult · 404 · 409 accountDeleted
 *   POST /admin/api/users/:id/unsuspend                    → AdminModerationResult · 404
 *   GET  /admin/api/audit?page=1&pageSize=50               → AdminPage<AdminAuditEntry> (newest first)
 * The POSTs want `Content-Type: application/json` and a JSON object body with no fields (`{}`): anything else
 * is 400 badRequest (a form on another site can't send JSON without a preflight, which /admin refuses). Each
 * action that changes something writes one AdminAuditEntry with the session's address; one that changes
 * nothing (suspending a suspended account) answers the same and writes none (`audit: null`). The confirmation
 * step is the site's. On a server that offers Google sign-in, a password session may read but not act: the
 * POSTs answer 403 `googleRequired` (the shared password names no one in the audit log). On a server with the
 * password only (development), the password acts, logged as `password`.
 *
 * With the admin site off on the server (no sign-in method set up), every route answers 503 `disabled`,
 * auth/methods included.
 */

export const ADMIN_API_PREFIX = '/admin/api';
export const ADMIN_DEFAULT_PAGE_SIZE = 50;
export const ADMIN_MAX_PAGE_SIZE = 200;

/** The sign-in routes, under ADMIN_API_PREFIX. */
export const ADMIN_AUTH_METHODS_PATH = '/auth/methods';
export const ADMIN_LOGIN_PATH = '/login';
export const ADMIN_GOOGLE_LOGIN_PATH = '/login/google';

export type AdminSignInMethod = 'password' | 'google';

/**
 * The Firebase web app's settings, for the site's Firebase JS SDK (initializeApp, then GoogleAuthProvider and
 * signInWithPopup). Public by design: a web app's config is visible in any page that uses it.
 */
export interface AdminGoogleWebConfig {
  apiKey: string;
  /** `<projectId>.firebaseapp.com`: where the sign-in popup opens. */
  authDomain: string;
  projectId: string;
  /** The web app's id (`1:<number>:web:<hex>`); null when the server has none (sign-in works without it). */
  appId: string | null;
}

/**
 * GET /admin/api/auth/methods: how this server lets an admin sign in. Never says who may: the list of allowed
 * addresses stays on the server.
 */
export interface AdminAuthMethods {
  /** POST /login takes a password. */
  password: boolean;
  /** POST /login/google takes a Google sign-in; null when it is off. */
  google: AdminGoogleWebConfig | null;
}

export interface AdminLoginRequest {
  password: string;
}

/** POST /admin/api/login/google: the Firebase ID token of the user signInWithPopup just signed in. */
export interface AdminGoogleLoginRequest {
  idToken: string;
}

/**
 * What POST /admin/api/login/google answers instead of 204, by HTTP status:
 * - 400 badRequest: the body is not JSON `{"idToken": "…"}`; 413 tooLarge: the body is too big.
 * - 401 invalidToken: not a valid Firebase ID token of this server's project (forged, expired, for another
 *   project, a development token…), or one of a sign-in more than 5 minutes old (`auth_time`; a refreshed
 *   token keeps its first sign-in's). Signing in again in Google's popup gives a fresh one.
 * - 403 wrongProvider: the token is not from a Google sign-in (e.g. email and password).
 * - 403 unverifiedEmail: Google does not vouch for the address (`email_verified` is not true).
 * - 403 notAllowed: the address is not on the server's list of admins.
 * - 403 disabled: Google sign-in is off on this server (see auth/methods). 503 disabled: the admin site is off.
 * - 429 tooManyRequests: too many sign-in tries from this address (password and Google count together),
 *   with Retry-After in seconds.
 * - 503 unavailable: the server can't reach Google's keys to check the token right now; try again later.
 */
export const ADMIN_GOOGLE_LOGIN_ERRORS = [
  'badRequest',
  'tooLarge',
  'invalidToken',
  'wrongProvider',
  'unverifiedEmail',
  'notAllowed',
  'disabled',
  'tooManyRequests',
  'unavailable',
  'internal',
] as const;

export type AdminGoogleLoginErrorCode = (typeof ADMIN_GOOGLE_LOGIN_ERRORS)[number];

export interface AdminGoogleLoginError {
  error: AdminGoogleLoginErrorCode;
  message?: string;
}

export function isAdminGoogleLoginErrorCode(value: unknown): value is AdminGoogleLoginErrorCode {
  return typeof value === 'string' && (ADMIN_GOOGLE_LOGIN_ERRORS as readonly string[]).includes(value);
}

export interface AdminSession {
  ok: true;
  /** When the session cookie runs out. */
  expiresAt: number;
  /** How this session signed in. */
  method: AdminSignInMethod;
  /** The admin's address (lower case) for a Google sign-in; null for the password. */
  email: string | null;
}

/**
 * 400 badRequest (a bad query string or login body) · 401 unauthorized · 403 disabled (POST /login while
 * password sign-in is off) · 404 notFound · 413 tooLarge (login body) · 429 tooManyRequests (with Retry-After
 * seconds) · 500 internal · 503 disabled (the admin site is off: no sign-in method set up on the server).
 * POST /login/google has its own codes: AdminGoogleLoginError.
 */
export interface AdminError {
  error:
    'unauthorized' | 'notFound' | 'badRequest' | 'tooManyRequests' | 'disabled' | 'tooLarge' | 'internal';
  message?: string;
}

/**
 * The moderation actions' extra refusals (on top of AdminError's codes):
 * - 409 notOpen: the report is resolved or dismissed already.
 * - 409 accountDeleted: the account is deleted (nothing to reset or suspend).
 * - 403 googleRequired: a password session on a server that offers Google sign-in: sign in with Google.
 */
export const ADMIN_ACTION_ERRORS = ['notOpen', 'accountDeleted', 'googleRequired'] as const;
export type AdminActionErrorCode = (typeof ADMIN_ACTION_ERRORS)[number];

export interface AdminActionError {
  error: AdminError['error'] | AdminActionErrorCode;
  message?: string;
}

export interface AdminPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminDayCount {
  day: string;
  count: number;
}

export interface AdminOverview {
  days: number;
  totals: {
    installs: number;
    users: number;
    /** Ranked games on the server. */
    games: number;
    /** Practice games the apps reported (game_end with mode solo or bot). */
    practiceGames: number;
    events: number;
  };
  /** Installs whose first launch was that day. */
  installsPerDay: AdminDayCount[];
  /** Installs that sent anything that day. */
  activePerDay: AdminDayCount[];
  /** Installs active in the last 1 and 7 days, up to now. */
  activeToday: number;
  activeThisWeek: number;
  /** Ranked games that started that day. */
  gamesPerDay: AdminDayCount[];
  /** Practice games the apps reported ending that day. */
  practicePerDay: AdminDayCount[];
}

export interface AdminInstallRow {
  id: string;
  platform: string;
  appVersion: string;
  firstSeen: number;
  lastSeen: number;
  userId: string | null;
  userName: string | null;
  events: number;
}

export interface AdminEventRow {
  id: string;
  name: TelemetryEventName;
  props: TelemetryProps;
  /** The phone's clock. */
  tClient: number;
  /** When the server stored it. */
  tServer: number;
}

export interface AdminInstallDetail extends AdminInstallRow {
  /** The latest events, newest first (at most 200). */
  recentEvents: AdminEventRow[];
  /** Screens in the order they were opened, newest session first (at most 20 sessions). */
  sessions: { startedAt: number; endedAt: number; screens: string[] }[];
}

export interface AdminRating {
  key: string;
  rating: number;
  games: number;
  provisional: boolean;
  peak: number;
}

export interface AdminUserRow {
  id: string;
  displayName: string;
  email: string | null;
  country: string | null;
  /**
   * The stored avatar through normalizeAvatarId (an old pack's id as its replacement, an unknown one as
   * NO_AVATAR_ID); null when none is stored (a deleted account).
   */
  avatarId: AvatarId | typeof NO_AVATAR_ID | null;
  createdAt: number;
  deletedAt: number | null;
  /** Latest activity of any of the user's installs. */
  lastSeen: number | null;
  games: number;
  /** The highest of the user's ratings (spec §14.2 "general"), null before any. */
  bestRating: number | null;
  /**
   * Moderation (spec §3.5). This server always sends the three; they are optional only so older fixtures
   * still type-check. When the account was suspended, null when it is not.
   */
  suspendedAt?: number | null;
  /** The name was reset by an admin and the player has not chosen a new one yet. */
  nameResetRequired?: boolean;
  /** Open reports about this player. */
  openReports?: number;
}

export interface AdminUserGame {
  gameId: string;
  mode: string;
  gameType: string;
  playerCount: number;
  startedAt: number;
  endedAt: number | null;
  place: number | null;
  finalScore: number | null;
  mistakes: number | null;
  status: string;
  ratingKey: string | null;
  ratingBefore: number | null;
  ratingAfter: number | null;
}

/** An anomaly flagged for review (spec §21); V1 takes no action on it. */
export interface AdminCheatFlag {
  gameId: string | null;
  /** 'fastThinking': a low average think time over consecutive correct moves (CHEAT_FAST_THINK_*). */
  reason: string;
  /** fastThinking: that average, in ms. */
  value: number | null;
  createdAt: number;
}

export interface AdminUserDetail extends AdminUserRow {
  /** Spec §15 (stage 12): total XP, ranked games and practice together, and the level it reaches. */
  xp: number;
  level: number;
  ratings: AdminRating[];
  stats: {
    games: number;
    wins: number;
    losses: number;
    /** 0–1, null without games. */
    winRate: number | null;
    avgMistakes: number | null;
    avgScore: number | null;
  };
  /** Newest first, at most 100. */
  recentGames: AdminUserGame[];
  installs: AdminInstallRow[];
  /** Newest first, at most 100. */
  cheatFlags: AdminCheatFlag[];
  /**
   * Staged practice (1.0.2), from the progress the account synced (user_levels): the levels played and their
   * best stars, summed. Only when it synced any; an account without is answered as before.
   */
  levels?: AdminUserLevels;
}

export interface AdminUserLevels {
  /** Levels played at least once. */
  played: number;
  /** The best stars of every level, summed (0 … 3 × the levels). */
  stars: number;
}

export interface AdminGamePlayer {
  userId: string | null;
  displayName: string | null;
  seat: number;
  finalScore: number | null;
  mistakes: number | null;
  place: number | null;
  status: string;
  ratingKey: string | null;
  ratingBefore: number | null;
  ratingAfter: number | null;
}

export interface AdminGameRow {
  id: string;
  mode: string;
  gameType: string;
  playerCount: number;
  puzzleId: string;
  startedAt: number;
  endedAt: number | null;
  endReason: string | null;
  players: AdminGamePlayer[];
}

export interface AdminGameEvent {
  seq: number;
  tMs: number;
  type: string;
  payload: unknown;
}

export interface AdminGameDetail extends AdminGameRow {
  rules: unknown;
  events: AdminGameEvent[];
}

export interface AdminScreenStat {
  screen: string;
  views: number;
  /** Distinct installs that opened it. */
  installs: number;
  /** Sessions whose last screen was this one. */
  exits: number;
  /** exits / sessions that opened it, 0–1. */
  exitRate: number;
  /** Installs not seen for `goneAfterDays` whose very last screen was this one: where people stop. */
  lastScreenOfGone: number;
}

export interface AdminScreens {
  days: number;
  /** A session ends after this many minutes without events. */
  sessionGapMinutes: number;
  /** An install counts as gone after this many days without events. */
  goneAfterDays: number;
  sessions: number;
  screens: AdminScreenStat[];
}

// ---------------------------------------------------------------------------------------------------------
// Staged practice (1.0.2, plan §5.5): how each level plays, and where players stop at a gate

/** The kinds a level's `kind` takes (the engine's LEVEL_KINDS), for the site's words for them. */
export const ADMIN_LEVEL_KINDS: readonly LevelKind[] = LEVEL_KINDS;

/**
 * One level, over the window's level events (level_start, level_end, level_quit). A player is an install.
 * A rate is null when there is nothing to divide by.
 */
export interface AdminLevelStat {
  /** "L001" … */
  levelId: string;
  chapter: number;
  /** The last level of every chapter. */
  boss: boolean;
  /** As the phones report it (the most frequent); null before any event names one. */
  kind: LevelKind | null;
  /** level_start events: one per start, when the level clock starts. */
  starts: number;
  /** level_end events: every end, a quit with the X too. */
  plays: number;
  /** Distinct installs with a play. */
  players: number;
  /** The plays by stars: [0★, 1★, 2★, 3★]; they add up to `plays`. */
  stars: [number, number, number, number];
  /** The median level clock at the end, over the plays but the quits (ms). */
  medianMs: number | null;
  /** Plays that were a second attempt or later ("שוב"), out of the plays. */
  replayRate: number | null;
  /** Starts left without an end (level_quit: the app went away), out of the starts; at most 1. */
  midQuitRate: number | null;
  /** Plays ended with the X, out of the plays. */
  quitRate: number | null;
  /** Plays that were a first attempt. */
  firstTries: number;
  /** First attempts with 0 stars, out of `firstTries`: above AdminLevels.tooHardShare, the level is too hard. */
  firstTryZeroRate: number | null;
}

/**
 * One gate, over every chapter_gate event ever sent (not only the window's: getting stuck builds up over
 * time). An attempt is an end of a level of the chapter before it once its boss was played, while the gate
 * was closed.
 */
export interface AdminGateStat {
  /** The chapter behind the gate (2 … the chapters): the gate at the end of chapter − 1. */
  chapter: number;
  /** Players with at least one attempt. */
  reached: number;
  /** Players for whom it opened. */
  opened: number;
  /** Players who reached it and never opened it. */
  stuck: number;
  /** Players with at least AdminLevels.stuckAttempts closed attempts who never opened it. */
  stuckAfter3: number;
  /** stuckAfter3 / reached: above AdminLevels.stuckShare, chapter − 1 should be softened. */
  stuckAfter3Rate: number | null;
}

export interface AdminLevels {
  days: number;
  /** A level is "too hard" when more than this share of first attempts end with 0 stars (0.6). */
  tooHardShare: number;
  /** A chapter needs softening when more than this share of a gate's players are stuck after… (0.3) */
  stuckShare: number;
  /** …this many closed attempts (3). */
  stuckAttempts: number;
  /** Every level, in order: the ones nobody played with zeros and nulls. */
  levels: AdminLevelStat[];
  /** Every gate, in order (chapter 2 first). */
  gates: AdminGateStat[];
}

// ---------------------------------------------------------------------------------------------------------
// Moderation (spec §3.5)

/** The `status` filter of GET /admin/api/reports. */
export const ADMIN_REPORT_FILTERS = ['open', 'resolved', 'dismissed', 'all'] as const;
export type AdminReportFilter = (typeof ADMIN_REPORT_FILTERS)[number];

/** A reported player's reports shown in one AdminReportedPlayer, newest first. */
export const ADMIN_REPORTS_PER_PLAYER = 50;

export interface AdminReport {
  id: string;
  /** The reported player. */
  playerId: string;
  reason: ReportReason;
  status: ReportStatus;
  /** The ranked game it is about (AdminGameDetail), when the app sent one both players sat in. */
  gameId: string | null;
  createdAt: number;
  resolvedAt: number | null;
  /**
   * Who closed it: an admin's address, `password` (the password sign-in), or `system` (the reported account
   * was deleted while the report was open: dismissed).
   */
  resolvedBy: string | null;
  reporter: {
    id: string;
    /** Null when the reporter's account is deleted. */
    displayName: string | null;
  };
}

export interface AdminReportedPlayer {
  player: {
    id: string;
    /** The current name; null when the account is deleted. */
    displayName: string | null;
    avatarId: AvatarId | typeof NO_AVATAR_ID | null;
    country: string | null;
    deletedAt: number | null;
    suspendedAt: number | null;
    nameResetRequired: boolean;
  };
  /**
   * The player's reports that match the filter: by reason, in all, and the different accounts that sent them
   * (`reporters`: the list is sorted by it first, so many reports from one account don't push a player up).
   */
  counts: Record<ReportReason, number> & { total: number; reporters: number };
  /** Open reports about the player, whatever the filter. */
  open: number;
  /**
   * When the oldest of those open reports was sent (null: none open), whatever the filter and however many
   * reports the item carries: the 48-hour promise (REPORT_RESPONSE_HOURS) is measured from it.
   */
  oldestOpenAt: number | null;
  /** The newest report that matches the filter. */
  lastReportedAt: number;
  /** Those reports, newest first (at most ADMIN_REPORTS_PER_PLAYER). */
  reports: AdminReport[];
}

export const ADMIN_AUDIT_ACTIONS = [
  'resetName',
  'suspend',
  'unsuspend',
  'resolveReport',
  'dismissReport',
] as const;
export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

/**
 * One admin action (admin_audit). `details` by action:
 * - resetName: `{ fromName, toName }` (the names; scrubbed when the account is deleted later);
 * - suspend, unsuspend: `{}`; a suspend by `system` (a new account of the sign-in of a suspended account that
 *   was deleted starts suspended): `{ previousUserId }`, the deleted account;
 * - resolveReport, dismissReport: `{ reportId, reason }`.
 */
export interface AdminAuditEntry {
  id: string;
  /** The admin's address, `password` for the password sign-in, or `system` (the server itself). */
  adminEmail: string;
  action: AdminAuditAction;
  /** The player acted on (the reported player, for a report). */
  targetUserId: string | null;
  details: Record<string, string | number | boolean | null>;
  createdAt: number;
}

/** What reset-name, suspend and unsuspend answer: the player as the users list shows them now. */
export interface AdminModerationResult {
  user: AdminUserRow;
  /** The entry written; null when nothing changed (no entry). */
  audit: AdminAuditEntry | null;
}
