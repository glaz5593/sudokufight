/**
 * What the server and the admin site need of the chapter table (levels.config.ts), without the builder's knobs
 * (levels-content.md §5.4, §7): the kind of every level, the rev it is at, and the boss's settings. The engine's
 * index exports this file and never levels.config.ts itself, whose many names (FIND, RACE, DUEL, …) are the
 * builder's.
 *
 * - kindOfLevel(n): the kind of level n (the seed data, the admin site's kind of a level).
 * - levelRev(id): the rev a level is at now (LEVEL_REV_BASE, or LEVEL_REVS for one rebuilt again later); the
 *   admin site shows the current rev's telemetry by default.
 * - BOSS: a boss's bot is the chapter's at this pace, Overlord from `overlordFrom` [D72].
 * - LEVEL_REV_BASE [D73] lives in progress.ts (exported from there): levels.config.ts imports it too, and a
 *   constant here would make an import cycle with it.
 */
export { BOSS, kindOfLevel, levelRev } from './levels.config';
