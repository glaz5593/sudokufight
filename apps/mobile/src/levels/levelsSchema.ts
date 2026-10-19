import { LEVEL_END_REASONS } from '@sudoku-fight/engine';

import { type Migration, migrate } from '../game/practiceRepo';
import type { SqlDb } from '../game/sqlDb';

/**
 * Staged practice's database on the phone (1.0.2; dev-plan §1.4, §2ו): its own file, levels.db, apart from
 * the practices' practice.db. An older app installed over a newer one refuses a database newer than it knows
 * (migrate), and that must never stop the practices being saved. Every row has its owner (the Firebase uid),
 * so on a shared phone one account never gets another's stars.
 *
 * - level_progress: a level's best ever (stars that never drop, mergeBest), the plays that count
 *   (countsAsPlayed), the best measure, and what the server is known to have (synced_*: -1 stars until it
 *   has the row). `rejected`: the server refused the row on its own (400): it is not sent again until it
 *   changes.
 * - level_attempts: one row per attempt that ended (any end: a quit too), as levelOutcome read it.
 * - level_gates: the chapters a gate opened once (they stay open even if gateStars rises, isLevelOpen), and
 *   whether "פרק חדש נפתח" was shown.
 */

export const LEVELS_DB_LABEL = 'levels database (levels.db)';

const REASONS = LEVEL_END_REASONS.map((r) => `'${r}'`).join(', ');

export const LEVELS_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE level_progress (
        owner TEXT NOT NULL,
        level_id TEXT NOT NULL,
        best_stars INTEGER NOT NULL DEFAULT 0 CHECK (best_stars BETWEEN 0 AND 3),
        plays INTEGER NOT NULL DEFAULT 0 CHECK (plays >= 0),
        best_metric REAL,
        best_rev INTEGER,
        first_played_at INTEGER,
        last_played_at INTEGER,
        synced_stars INTEGER NOT NULL DEFAULT -1,
        synced_plays INTEGER NOT NULL DEFAULT 0,
        rejected INTEGER NOT NULL DEFAULT 0 CHECK (rejected IN (0, 1)),
        PRIMARY KEY (owner, level_id)
      ) WITHOUT ROWID;
      CREATE TABLE level_attempts (
        id INTEGER PRIMARY KEY,
        owner TEXT NOT NULL,
        level_id TEXT NOT NULL,
        rev INTEGER NOT NULL,
        attempt INTEGER NOT NULL CHECK (attempt >= 1),
        chapter INTEGER NOT NULL,
        kind TEXT NOT NULL,
        stars INTEGER NOT NULL CHECK (stars BETWEEN 0 AND 3),
        prev_best INTEGER NOT NULL CHECK (prev_best BETWEEN 0 AND 3),
        metric REAL,
        mistakes INTEGER NOT NULL DEFAULT 0,
        reason TEXT NOT NULL CHECK (reason IN (${REASONS})),
        quick INTEGER NOT NULL DEFAULT 0 CHECK (quick IN (0, 1)),
        bot_level INTEGER,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        engine_version TEXT NOT NULL
      );
      CREATE INDEX level_attempts_level ON level_attempts (owner, level_id);
      CREATE TABLE level_gates (
        owner TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        opened_at INTEGER NOT NULL,
        celebrated INTEGER NOT NULL DEFAULT 0 CHECK (celebrated IN (0, 1)),
        PRIMARY KEY (owner, chapter)
      ) WITHOUT ROWID;
    `,
  },
];

/** Brings levels.db up to LEVELS_MIGRATIONS; a newer file is refused, saying it is levels.db. */
export const migrateLevels = (db: SqlDb, migrations: readonly Migration[] = LEVELS_MIGRATIONS) =>
  migrate(db, migrations, LEVELS_DB_LABEL);
