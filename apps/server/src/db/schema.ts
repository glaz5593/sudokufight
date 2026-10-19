import { randomUUID } from 'node:crypto';

import {
  type AdminAuditAction,
  HEBREW_FINAL_LETTERS,
  HEBREW_REGULAR_LETTERS,
  LEVEL_ID_PATTERN,
  type Platform,
  REPORT_REASONS,
  REPORT_STATUSES,
  type TelemetryEventName,
  type TelemetryProps,
} from '@sudoku-fight/protocol';
import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * The database (spec §19 and §27.2). Postgres in production, PGlite in development and tests: the same SQL.
 *
 * - Ids are text: UUIDs we make (users, games), the client's UUIDs (installs, app_events), or a stable hash
 *   (puzzles, shared with the app).
 * - Times are timestamptz (JS Date). Scores are real: they move in halves (spec §6.4).
 * - After a change here: `npm run db:generate -w @sudoku-fight/server`, and commit the new SQL in drizzle/.
 *   The server applies pending migrations when it starts.
 */

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const newId = () => randomUUID();

export const PUZZLE_POOLS = ['offline', 'ranked'] as const;
export type PuzzlePool = (typeof PUZZLE_POOLS)[number];

// ---------------------------------------------------------------------------------------------------------
// Accounts (stage 8)

/**
 * A display name in the form names are compared in: the protocol's normalizeForCompare() in SQL (lower case,
 * Hebrew final letters as regular ones). The unique index and every "is it taken" query use this very
 * expression, so the index serves the query; a test keeps it equal to normalizeForCompare().
 */
export const displayNameKey = (column: AnyPgColumn | SQL): SQL =>
  sql`translate(lower(${column}), ${sql.raw(`'${HEBREW_FINAL_LETTERS}'`)}, ${sql.raw(`'${HEBREW_REGULAR_LETTERS}'`)})`;

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    /**
     * The Firebase uid (`dev:<uid>` for a development account). A deleted account's becomes
     * `deleted:<id>`: the person is no longer linked to the row, and may register again.
     */
    firebaseUid: text('firebase_uid').notNull().unique(),
    /** A deleted account's becomes `deleted:<uuid>` (no valid name has a colon): its name is free again. */
    displayName: text('display_name').notNull(),
    displayNameChangedAt: timestamptz('display_name_changed_at'),
    country: text('country'),
    avatarId: text('avatar_id'),
    email: text('email'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    /** The account was deleted (spec §3.3); the row stays so games keep their players. */
    deletedAt: timestamptz('deleted_at'),
    /**
     * Suspended by an admin (spec §3.5): no ranked games and no account changes until it is lifted (null).
     * Cleared when the account is deleted.
     */
    suspendedAt: timestamptz('suspended_at'),
    /**
     * An admin reset the display name to a temporary one: the app asks for a new name, and that rename is free
     * of the 30-day rule [D20]. False again after it.
     */
    nameResetRequired: boolean('name_reset_required').notNull().default(false),
  },
  (t) => [
    // Spec §19's unique lower(display_name), widened to Hebrew final letters, among accounts not deleted.
    uniqueIndex('users_display_name_key_uq')
      .on(displayNameKey(t.displayName))
      .where(sql`${t.deletedAt} is null`),
    // The few deleted accounts: what the leaderboards leave out ("not exists" against this small index is
    // cheaper than a join with every user, src/progress/leaderboard.ts).
    index('users_deleted_idx')
      .on(t.id)
      .where(sql`${t.deletedAt} is not null`),
  ],
);

export const ratings = pgTable(
  'ratings',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Which rating (spec §11.1), e.g. a game type, or 'general'. */
    ratingKey: text('rating_key').notNull(),
    rating: real('rating').notNull(),
    games: integer('games').notNull().default(0),
    provisional: boolean('provisional').notNull().default(true),
    peak: real('peak').notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.ratingKey] }),
    // The leaderboards (spec §14.2; src/progress/leaderboard.ts) rank only keys with a rated game, best first,
    // equal ratings by user id: the keyset their pages walk. A game-type tab: one key.
    index('ratings_board_idx')
      .on(t.ratingKey, t.rating.desc(), t.userId)
      .where(sql`${t.games} > 0`),
    // The 'general' tab: every key at once, each user at their best row.
    index('ratings_general_idx')
      .on(t.rating.desc(), t.userId)
      .where(sql`${t.games} > 0`),
  ],
);

// ---------------------------------------------------------------------------------------------------------
// Puzzles (spec §20)

export const puzzles = pgTable(
  'puzzles',
  {
    /** A stable hash of the givens: the same id on the phone and on the server. */
    id: text('id').primaryKey(),
    givens: char('givens', { length: 81 }).notNull(),
    solution: char('solution', { length: 81 }).notNull(),
    gameType: text('game_type').notNull(),
    techniques: text('techniques')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    givensCount: smallint('givens_count').notNull(),
    source: text('source').notNull(),
    /** 'offline' ships in the app; 'ranked' never leaves the server (spec §21). */
    pool: text('pool', { enum: PUZZLE_POOLS }).notNull(),
    /**
     * When the puzzle left the bank file (`npm run db:seed-puzzles`, spec §20) [D43]: kept for the games and
     * histories that point at it, never picked for a new game. Null: in the pool.
     */
    retiredAt: timestamptz('retired_at'),
  },
  (t) => [
    index('puzzles_pool_type_idx').on(t.pool, t.gameType),
    check('puzzles_pool_check', sql`${t.pool} in ('offline', 'ranked')`),
  ],
);

/**
 * No repeat puzzles (original §32): every play, one row per user, puzzle and time. The engine's selectPuzzle
 * walks a player's plays in time order to find where their history starts over (spec §20: past 80% of a
 * type's pool), so a replay is a new row, not a moved one (stage 9).
 */
export const puzzleHistory = pgTable(
  'puzzle_history',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    puzzleId: text('puzzle_id')
      .notNull()
      .references(() => puzzles.id, { onDelete: 'cascade' }),
    playedAt: timestamptz('played_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.puzzleId, t.playedAt] })],
);

/** No repeat opponents (original §7). */
export const opponentHistory = pgTable(
  'opponent_history',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    opponentId: text('opponent_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gameType: text('game_type').notNull(),
    playedAt: timestamptz('played_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.opponentId, t.gameType] })],
);

// ---------------------------------------------------------------------------------------------------------
// Games on the server (ranked; stage 7 on)

export const games = pgTable(
  'games',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    mode: text('mode').notNull(),
    gameType: text('game_type').notNull(),
    playerCount: smallint('player_count').notNull(),
    puzzleId: text('puzzle_id')
      .notNull()
      .references(() => puzzles.id),
    /** The engine's rules for this game, as played. */
    rules: jsonb('rules').notNull(),
    startedAt: timestamptz('started_at').notNull(),
    endedAt: timestamptz('ended_at'),
    endReason: text('end_reason'),
  },
  (t) => [
    index('games_started_at_idx').on(t.startedAt),
    index('games_mode_started_at_idx').on(t.mode, t.startedAt),
  ],
);

export const gamePlayers = pgTable(
  'game_players',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    /** Null for a seat without an account (a bot). */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    seat: smallint('seat').notNull(),
    finalScore: real('final_score'),
    mistakes: integer('mistakes'),
    place: smallint('place'),
    status: text('status').notNull(),
    ratingKey: text('rating_key'),
    ratingBefore: real('rating_before'),
    ratingAfter: real('rating_after'),
    /**
     * The points of this seat's best correct move (the engine's stats.bestMove), written at the end; null
     * without a correct move, and for games stored before stage 12 (no backfill: their events could give it,
     * but the player card simply starts counting from here).
     */
    bestMovePoints: real('best_move_points'),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.seat] }), index('game_players_user_idx').on(t.userId)],
);

/** The engine's events of a game, for the replay (original §21). */
export const gameEvents = pgTable(
  'game_events',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    tMs: bigint('t_ms', { mode: 'number' }).notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.seq] })],
);

// ---------------------------------------------------------------------------------------------------------
// Progress (spec §15)

export const achievements = pgTable('achievements', {
  id: text('id').primaryKey().$defaultFn(newId),
  key: text('key').notNull().unique(),
  nameHe: text('name_he').notNull(),
  nameEn: text('name_en').notNull(),
  rule: jsonb('rule').notNull(),
});

export const userAchievements = pgTable(
  'user_achievements',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    achievementId: text('achievement_id')
      .notNull()
      .references(() => achievements.id, { onDelete: 'cascade' }),
    earnedAt: timestamptz('earned_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.achievementId] })],
);

/**
 * A player's XP (spec §15) [D38]: the total, and the level it reaches (the engine's levelFor(), kept here for
 * SQL readers such as the admin site; the routes compute it again from `xp`). Written by the end of a ranked
 * game (persistence/records.ts), by practice results (src/progress/practice.ts) and by the levels' progress
 * (src/progress/levels.ts).
 */
export const xp = pgTable('xp', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  level: integer('level').notNull().default(1),
  xp: integer('xp').notNull().default(0),
});

export const PRACTICE_MODES = ['solo', 'bot'] as const;

/**
 * Practice games the phone reported for their XP [D41] (spec §15): played on the phone, queued while offline,
 * sent when there is a connection. One row per game: the phone's id, so a resend is counted once. `xp` is what
 * the result actually earned (the daily practice cap may cut it, to 0 too); `ended_at` is the phone's clock.
 */
export const practiceResults = pgTable(
  'practice_results',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The practice game's id on the phone. */
    id: text('id').notNull(),
    mode: text('mode', { enum: PRACTICE_MODES }).notNull(),
    gameType: text('game_type').notNull(),
    outcome: text('outcome').notNull(),
    correct: smallint('correct').notNull(),
    endedAt: timestamptz('ended_at').notNull(),
    xp: integer('xp').notNull(),
    receivedAt: timestamptz('received_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    // The daily cap: a user's practice XP of one day.
    index('practice_results_user_ended_idx').on(t.userId, t.endedAt),
    check('practice_results_mode_check', sql`${t.mode} in ('solo', 'bot')`),
  ],
);

/**
 * Staged practice's progress (spec §5.3.7, §15; 1.0.2) [D55, D57]: each level's best as the phone reports it
 * (PUT /v1/me/levels), kept at the max ever sent: the best stars and the plays that counted. Levels are played
 * and kept on the phone (levels.db); this copy brings them back on a new phone, and level XP is paid from it
 * (src/progress/levels.ts). A row only for a level played or with stars (never 0 and 0).
 */
export const userLevels = pgTable(
  'user_levels',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** "L001" … (the protocol's LEVEL_ID_PATTERN). */
    levelId: text('level_id').notNull(),
    bestStars: smallint('best_stars').notNull(),
    plays: integer('plays').notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.levelId] }),
    check('user_levels_level_id_check', sql`${t.levelId} ~ ${sql.raw(`'${LEVEL_ID_PATTERN.source}'`)}`),
    check('user_levels_best_stars_check', sql`${t.bestStars} between 0 and 3`),
    check('user_levels_plays_check', sql`${t.plays} >= 0`),
  ],
);

/**
 * The level XP paid to a player on each UTC day (src/progress/levels.ts): what all of them add up to is what
 * was paid of the levels' worth, and a day's row counts in that day's cap, which practice shares.
 */
export const levelXpDays = pgTable(
  'level_xp_days',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The UTC day it was paid on, as days since 1970-01-01 (the server's clock). */
    day: integer('day').notNull(),
    xp: integer('xp').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

/** Anomalies to look at (spec §21); no automatic action in V1. */
export const cheatFlags = pgTable(
  'cheat_flags',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gameId: text('game_id').references(() => games.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    value: real('value'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('cheat_flags_user_idx').on(t.userId),
    index('cheat_flags_created_at_idx').on(t.createdAt),
    // One flag per game, player and reason: recording a game again (a retry) adds nothing.
    uniqueIndex('cheat_flags_game_user_reason_uq').on(t.gameId, t.userId, t.reason),
  ],
);

// ---------------------------------------------------------------------------------------------------------
// Moderation (spec §3.5: report a player, block, and the admin's two actions)

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * Reports on players (src/moderation). One open report per reporter, player and reason (the partial unique
 * index: a second one is `duplicate`); closed ones stay as the record. `game_id` only when it names a ranked
 * game both sat in. When the reported account is deleted, its open reports are dismissed by `system`.
 */
export const playerReports = pgTable(
  'player_reports',
  {
    id: text('id').primaryKey().$defaultFn(newId),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reportedId: text('reported_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason', { enum: REPORT_REASONS }).notNull(),
    gameId: text('game_id').references(() => games.id, { onDelete: 'set null' }),
    status: text('status', { enum: REPORT_STATUSES }).notNull().default('open'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    resolvedAt: timestamptz('resolved_at'),
    /** An admin's address, `password`, or `system` (the reported account was deleted). */
    resolvedBy: text('resolved_by'),
  },
  (t) => [
    uniqueIndex('player_reports_open_uq')
      .on(t.reporterId, t.reportedId, t.reason)
      .where(sql`${t.status} = 'open'`),
    // The admin's list: by status, newest first, grouped by the reported player.
    index('player_reports_status_idx').on(t.status, t.reportedId, t.createdAt),
    index('player_reports_reported_idx').on(t.reportedId, t.createdAt),
    // The hourly quota: a reporter's reports of the last hour.
    index('player_reports_reporter_idx').on(t.reporterId, t.createdAt),
    check('player_reports_reason_check', sql`${t.reason} in (${inList(REPORT_REASONS)})`),
    check('player_reports_status_check', sql`${t.status} in (${inList(REPORT_STATUSES)})`),
    check('player_reports_not_self', sql`${t.reporterId} <> ${t.reportedId}`),
  ],
);

/**
 * Blocks (spec §3.5): matchmaking never groups the two, and a game that brings them together anyway mutes the
 * blocked player's reactions for the blocker. Both rows go when either account is deleted.
 */
export const userBlocks = pgTable(
  'user_blocks',
  {
    blockerId: text('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: text('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    // "Who blocked me": matchmaking reads both directions.
    index('user_blocks_blocked_idx').on(t.blockedId),
    check('user_blocks_not_self', sql`${t.blockerId} <> ${t.blockedId}`),
  ],
);

/**
 * Names an admin reset away as offensive (spec §3.5): nobody may take one again (registration, a rename, the
 * live name check all answer `blocked`), so a reset can't be undone by choosing the old name again, by that
 * player or another. Only the compare form (displayNameKey, protocol normalizeForCompare), linked to no one.
 */
export const retiredNames = pgTable('retired_names', {
  nameKey: text('name_key').primaryKey(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

/**
 * The sign-in of a suspended account that was deleted (spec §3.5): one-way fingerprints (SHA-256, never the
 * uid or the address itself) of its Firebase uid and of its verified email, so a new account with the same
 * sign-in starts suspended for an admin to review, instead of the deletion lifting the suspension. They go
 * when a new account matches them (it carries the suspension from then on). `user_id` is the deleted account:
 * the admins' link to its games and reports.
 */
export const suspendedSignIns = pgTable(
  'suspended_sign_ins',
  {
    fingerprint: text('fingerprint').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    suspendedAt: timestamptz('suspended_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('suspended_sign_ins_user_idx').on(t.userId)],
);

/**
 * What admins did (spec §3.5, §27.3): every moderation action, with the session's address (`system` for what
 * the server did itself: a suspension carried to a new account of the same sign-in). Never deleted; a
 * deleted account's names are scrubbed from `details` (accounts/store.ts deleteUser).
 */
export const adminAudit = pgTable(
  'admin_audit',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    adminEmail: text('admin_email').notNull(),
    action: text('action').$type<AdminAuditAction>().notNull(),
    targetUserId: text('target_user_id').references(() => users.id, { onDelete: 'set null' }),
    details: jsonb('details').$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('admin_audit_created_at_idx').on(t.createdAt),
    index('admin_audit_target_idx').on(t.targetUserId),
  ],
);

// ---------------------------------------------------------------------------------------------------------
// Usage data (spec §27.2)

/** One row per app install. No uninstall tracking: last_seen tells who left (spec §27.1). */
export const installs = pgTable(
  'installs',
  {
    /** The app's installId (a UUID, lower case). */
    id: text('id').primaryKey(),
    platform: text('platform').$type<Platform>().notNull(),
    /** The latest version this install reported. */
    appVersion: text('app_version').notNull(),
    firstSeen: timestamptz('first_seen').notNull(),
    lastSeen: timestamptz('last_seen').notNull(),
    /** Set once the install signs in (stage 8). */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('installs_last_seen_idx').on(t.lastSeen),
    index('installs_first_seen_idx').on(t.firstSeen),
    index('installs_user_idx').on(t.userId),
  ],
);

export const appEvents = pgTable(
  'app_events',
  {
    /** The event's UUID from the phone (lower case): a batch sent twice is stored once. */
    id: text('id').primaryKey(),
    installId: text('install_id')
      .notNull()
      .references(() => installs.id, { onDelete: 'cascade' }),
    /** Never from the request body: only from a verified sign-in (stage 8). */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').$type<TelemetryEventName>().notNull(),
    props: jsonb('props').$type<TelemetryProps>().notNull().default({}),
    /** The phone's clock. */
    tClient: timestamptz('t_client').notNull(),
    /** When the server stored it. */
    tServer: timestamptz('t_server').notNull().defaultNow(),
  },
  (t) => [
    index('app_events_install_t_idx').on(t.installId, t.tClient),
    index('app_events_name_t_server_idx').on(t.name, t.tServer),
    index('app_events_t_server_idx').on(t.tServer),
  ],
);

export type User = typeof users.$inferSelect;
export type Install = typeof installs.$inferSelect;
export type AppEvent = typeof appEvents.$inferSelect;
export type Game = typeof games.$inferSelect;
export type GamePlayer = typeof gamePlayers.$inferSelect;
export type Puzzle = typeof puzzles.$inferSelect;
export type CheatFlag = typeof cheatFlags.$inferSelect;
export type PracticeResultRow = typeof practiceResults.$inferSelect;
export type UserLevelRow = typeof userLevels.$inferSelect;
export type PlayerReport = typeof playerReports.$inferSelect;
export type UserBlock = typeof userBlocks.$inferSelect;
export type AdminAuditRow = typeof adminAudit.$inferSelect;
export type SuspendedSignIn = typeof suspendedSignIns.$inferSelect;
