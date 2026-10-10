import type { TelemetryEventName, TelemetryProps } from './telemetry';

/**
 * The admin site's API (spec §27.3): read-only, under `/admin/api`, behind the admin password from the
 * server's settings. The site (apps/admin) and the server (apps/server) both build on these types.
 *
 * Times are epoch ms. Days are 'YYYY-MM-DD' in the admin time zone (server setting, Asia/Jerusalem by default).
 *
 * Routes:
 *   POST /admin/api/login    AdminLoginRequest → 204 and an HttpOnly session cookie · 401 wrong · 429 too many tries
 *   POST /admin/api/logout   → 204
 *   GET  /admin/api/session  → AdminSession · 401 when not signed in (every route below answers 401 too)
 *   GET  /admin/api/overview?days=30                      → AdminOverview
 *   GET  /admin/api/installs?search=&page=1&pageSize=50   → AdminPage<AdminInstallRow>
 *   GET  /admin/api/installs/:id                          → AdminInstallDetail · 404
 *   GET  /admin/api/users?search=&page=1&pageSize=50      → AdminPage<AdminUserRow>
 *   GET  /admin/api/users/:id                             → AdminUserDetail · 404
 *   GET  /admin/api/games?mode=&search=&page=1&pageSize=50 → AdminPage<AdminGameRow>
 *   GET  /admin/api/games/:id                             → AdminGameDetail · 404
 *   GET  /admin/api/screens?days=30                       → AdminScreens
 */

export const ADMIN_API_PREFIX = '/admin/api';
export const ADMIN_DEFAULT_PAGE_SIZE = 50;
export const ADMIN_MAX_PAGE_SIZE = 200;

export interface AdminLoginRequest {
  password: string;
}

export interface AdminSession {
  ok: true;
  /** When the session cookie runs out. */
  expiresAt: number;
}

/**
 * 400 badRequest (a bad query string or login body) · 401 unauthorized · 404 notFound · 413 tooLarge (login
 * body) · 429 tooManyRequests (with Retry-After seconds) · 500 internal · 503 disabled (no admin password
 * set on the server).
 */
export interface AdminError {
  error:
    'unauthorized' | 'notFound' | 'badRequest' | 'tooManyRequests' | 'disabled' | 'tooLarge' | 'internal';
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
  avatarId: string | null;
  createdAt: number;
  deletedAt: number | null;
  /** Latest activity of any of the user's installs. */
  lastSeen: number | null;
  games: number;
  /** The highest of the user's ratings (spec §14.2 "general"), null before any. */
  bestRating: number | null;
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
