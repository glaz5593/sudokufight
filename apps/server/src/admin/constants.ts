import type { RateLimitRule } from '../http/rateLimiter';

/**
 * The admin site's numbers in one place (spec §27.3). Changing one here changes the API, the answers that
 * report them (AdminScreens), and the tests.
 */

/** A session (of app use) ends after this many minutes without events. */
export const SESSION_GAP_MINUTES = 30;
/** An install that sent nothing for this many days counts as gone ("where people stop"). */
export const GONE_AFTER_DAYS = 7;

/** The `days` of /overview and /screens: default, and the most one request may ask for. */
export const DEFAULT_STATS_DAYS = 30;
export const MAX_STATS_DAYS = 366;

/** Install detail: the latest events and sessions shown. */
export const RECENT_EVENTS_LIMIT = 200;
export const RECENT_SESSIONS_LIMIT = 20;
/** User detail: the latest games shown. */
export const RECENT_GAMES_LIMIT = 100;
/** Longer search strings are refused (400). */
export const MAX_SEARCH_LENGTH = 100;

/** The admin's sign-in lasts this long (not extended by use). */
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const ADMIN_COOKIE_NAME = 'sf_admin';
/** Sign-in attempts per IP, right or wrong: 5 at once, then one every 12 s. */
export const DEFAULT_LOGIN_LIMIT: RateLimitRule = { limit: 5, windowMs: 60_000 };
