import {
  type EndReason,
  ENGINE_VERSION,
  evolve,
  type GameEvent,
  type GameMode,
  type GameResult,
  type GameState,
  type GameType,
  loggedMs,
  type PlayerInfo,
  type PlayRecord,
} from '@sudoku-fight/engine';

import { isOutcome, type Outcome, outcomeOf } from './outcome';
import type { SqlDb, SqlValue } from './sqlDb';

/**
 * Practice games saved on the phone [D25]: each game's row, its FULL event log (gameCreated with the
 * solution, so stage 11 can build the replay from it), and the puzzles played, for choosing without repeats
 * (spec §20). A practice against a bot (stage 5) also keeps who the opponents were and how it ended for the
 * local player (win, loss or tie), for the recent list and the player card (spec §4.3). SQLite through the
 * small SqlDb interface: expo-sqlite in the app, sql.js in tests.
 *
 * Every call runs after the previous one has finished (one queue), so writes land in the order they were made
 * and a read sees every write before it. expo-sqlite's transactions are not exclusive, which the queue makes
 * safe.
 */

// ---------------------------------------------------------------------------------------------------------
// Schema

export interface Migration {
  /** PRAGMA user_version after it. */
  version: number;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE practice_games (
        id TEXT PRIMARY KEY NOT NULL,
        mode TEXT NOT NULL,
        game_type TEXT NOT NULL,
        puzzle_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        seed INTEGER,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        status TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'finished', 'interrupted')),
        end_reason TEXT,
        score REAL,
        mistakes INTEGER,
        correct INTEGER,
        duration_ms INTEGER,
        result_json TEXT,
        engine_version TEXT NOT NULL
      );
      CREATE INDEX practice_games_started ON practice_games (started_at);
      CREATE INDEX practice_games_status ON practice_games (status);
      CREATE TABLE practice_events (
        game_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        PRIMARY KEY (game_id, seq)
      ) WITHOUT ROWID;
      CREATE TABLE puzzle_plays (
        puzzle_id TEXT NOT NULL,
        game_type TEXT NOT NULL,
        played_at INTEGER NOT NULL
      );
      CREATE INDEX puzzle_plays_type ON puzzle_plays (game_type, played_at);
    `,
  },
  {
    // Stage 5, practice against a bot. Every game saved before it is a solo practice (a bot game could not be
    // started), so the defaults suit the old rows: no opponents, no place, no outcome.
    version: 2,
    sql: `
      ALTER TABLE practice_games ADD COLUMN opponents_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE practice_games ADD COLUMN place INTEGER;
      ALTER TABLE practice_games ADD COLUMN outcome TEXT;
      CREATE INDEX practice_games_mode ON practice_games (mode, started_at);
    `,
  },
];

/**
 * Brings the database up to the newest migration; returns its version. Each step is one transaction.
 * `label` names the database in the error (the levels' own file says so, not "practice").
 */
export async function migrate(
  db: SqlDb,
  migrations: readonly Migration[] = MIGRATIONS,
  label = 'practice database',
): Promise<number> {
  const steps = [...migrations].sort((a, b) => a.version - b.version);
  const latest = steps[steps.length - 1]?.version ?? 0;
  let version =
    (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []))?.user_version ?? 0;
  if (version > latest)
    throw new Error(`The ${label} is v${version}, newer than this app knows (v${latest})`);
  for (const step of steps) {
    if (step.version <= version) continue;
    await db.withTransactionAsync(async () => {
      await db.execAsync(step.sql);
      await db.execAsync(`PRAGMA user_version = ${Math.floor(step.version)}`);
    });
    version = step.version;
  }
  return version;
}

// ---------------------------------------------------------------------------------------------------------
// Records

export type PracticeStatus = 'playing' | 'finished' | 'interrupted';

export interface NewPracticeGame {
  id: string;
  mode: GameMode;
  gameType: GameType;
  puzzleId: string;
  /** The player on this phone: whose score the row keeps. */
  playerId: string;
  seed: number | null;
  /** Also the time of the puzzle play. */
  startedAt: number;
  /** The other players (a bot), in seat order; the row keeps their id, name and isBot. None when solo. */
  opponents?: readonly PlayerInfo[];
  engineVersion?: string;
}

/** Another player of a saved game, as the recent list shows them. */
export interface PracticeOpponent {
  id: string;
  name: string | null;
  isBot: boolean;
}

/** A row of the recent list. Score, mistakes and correct are the local player's. */
export interface PracticeGameRecord {
  id: string;
  mode: GameMode;
  gameType: GameType;
  puzzleId: string;
  playerId: string;
  seed: number | null;
  startedAt: number;
  endedAt: number | null;
  status: PracticeStatus;
  /** Set when finished; null for an interrupted game. */
  endReason: EndReason | null;
  score: number | null;
  mistakes: number | null;
  correct: number | null;
  durationMs: number | null;
  /** In seat order; empty for a solo practice. */
  opponents: PracticeOpponent[];
  /** My place in a finished game with opponents (spec §6.7); null otherwise. */
  place: number | null;
  /** What that place means (win, loss or tie); null for a solo practice or a game that did not finish. */
  outcome: Outcome | null;
  engineVersion: string;
}

export interface PracticeGame extends PracticeGameRecord {
  result: GameResult | null;
}

export interface FinishedGame {
  result: GameResult;
  endedAt: number;
}

export interface PracticeRepo {
  /** The game's row, and the puzzle's play (for no-repeat selection), in one transaction. */
  createGame(game: NewPracticeGame): Promise<void>;
  /** Appends to the event log, in one transaction. Idempotent on seq: an event already saved is skipped. */
  appendEvents(gameId: string, events: readonly GameEvent[]): Promise<void>;
  finishGame(gameId: string, end: FinishedGame): Promise<void>;
  /**
   * Games left 'playing' (the app was killed, or the screen closed mid-game) become 'interrupted', with the
   * numbers their saved log reaches; their events stay. A log that already holds gameOver finishes the game
   * instead. Without an id: every such game (on app start). Returns how many rows changed.
   */
  markInterrupted(gameId?: string): Promise<number>;
  /** Newest first, interrupted games included. */
  listRecent(limit?: number): Promise<PracticeGameRecord[]>;
  /** Every game of one mode, newest first (the bot games: for the win rate and the streak). */
  listByMode(mode: GameMode): Promise<PracticeGameRecord[]>;
  getGame(id: string): Promise<PracticeGame | null>;
  /** The full log, in seq order. */
  loadEvents(id: string): Promise<GameEvent[]>;
  /** The puzzles played in a game type, oldest first. */
  playHistory(gameType: GameType): Promise<PlayRecord[]>;
}

interface GameRow {
  id: string;
  mode: string;
  game_type: string;
  puzzle_id: string;
  player_id: string;
  seed: number | null;
  started_at: number;
  ended_at: number | null;
  status: string;
  end_reason: string | null;
  score: number | null;
  mistakes: number | null;
  correct: number | null;
  duration_ms: number | null;
  result_json: string | null;
  opponents_json: string;
  place: number | null;
  outcome: string | null;
  engine_version: string;
}

const RECORD_COLUMNS =
  'id, mode, game_type, puzzle_id, player_id, seed, started_at, ended_at, status, end_reason, score, ' +
  'mistakes, correct, duration_ms, opponents_json, place, outcome, engine_version';

const toRecord = (r: GameRow): PracticeGameRecord => ({
  id: r.id,
  mode: r.mode as GameMode,
  gameType: r.game_type as GameType,
  puzzleId: r.puzzle_id,
  playerId: r.player_id,
  seed: r.seed,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  status: r.status as PracticeStatus,
  endReason: r.end_reason as EndReason | null,
  score: r.score,
  mistakes: r.mistakes,
  correct: r.correct,
  durationMs: r.duration_ms,
  opponents: opponentsOf(r.opponents_json),
  place: r.place,
  outcome: isOutcome(r.outcome) ? r.outcome : null,
  engineVersion: r.engine_version,
});

/** What a row keeps of a player: id, name and isBot (a rating has no place in a practice). */
const toOpponent = (p: PlayerInfo): PracticeOpponent => ({
  id: p.id,
  name: p.name ?? null,
  isBot: p.isBot ?? false,
});

/** The opponents column, read with care: a damaged value lists nobody rather than failing the whole list. */
function opponentsOf(json: string): PracticeOpponent[] {
  let list: unknown;
  try {
    list = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list.flatMap((item: unknown) => {
    const o = item as Partial<PracticeOpponent> | null;
    if (typeof o?.id !== 'string') return [];
    return [{ id: o.id, name: typeof o.name === 'string' ? o.name : null, isBot: o.isBot === true }];
  });
}

/** The local player's numbers in a finished game; place and outcome only when there were opponents. */
function finishedValues(result: GameResult, playerId: string, endedAt: number): SqlValue[] {
  const me = result.ranking.find((r) => r.playerId === playerId);
  const outcome = outcomeOf(result, playerId);
  return [
    endedAt,
    result.reason,
    me?.score ?? null,
    me?.mistakes ?? null,
    me?.correct ?? null,
    result.durationMs,
    JSON.stringify(result),
    outcome === null ? null : (me?.place ?? null),
    outcome,
  ];
}

const FINISH_SQL =
  "UPDATE practice_games SET status = 'finished', ended_at = ?, end_reason = ?, score = ?, mistakes = ?, " +
  'correct = ?, duration_ms = ?, result_json = ?, place = ?, outcome = ? WHERE id = ?';

// ---------------------------------------------------------------------------------------------------------

export async function openPracticeRepo(
  db: SqlDb,
  { migrations = MIGRATIONS }: { migrations?: readonly Migration[] } = {},
): Promise<PracticeRepo> {
  await migrate(db, migrations);
  return new SqlPracticeRepo(db);
}

class SqlPracticeRepo implements PracticeRepo {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: SqlDb) {}

  /** One call at a time, in call order; a failed call doesn't stop the ones after it. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  createGame(game: NewPracticeGame): Promise<void> {
    return this.serial(() =>
      this.db.withTransactionAsync(async () => {
        await this.db.runAsync(
          'INSERT INTO practice_games (id, mode, game_type, puzzle_id, player_id, seed, started_at, status, ' +
            "opponents_json, engine_version) VALUES (?, ?, ?, ?, ?, ?, ?, 'playing', ?, ?)",
          [
            game.id,
            game.mode,
            game.gameType,
            game.puzzleId,
            game.playerId,
            game.seed,
            game.startedAt,
            JSON.stringify((game.opponents ?? []).map(toOpponent)),
            game.engineVersion ?? ENGINE_VERSION,
          ],
        );
        await this.db.runAsync(
          'INSERT INTO puzzle_plays (puzzle_id, game_type, played_at) VALUES (?, ?, ?)',
          [game.puzzleId, game.gameType, game.startedAt],
        );
      }),
    );
  }

  appendEvents(gameId: string, events: readonly GameEvent[]): Promise<void> {
    if (!events.length) return this.serial(async () => undefined);
    const batch = [...events].sort((a, b) => a.seq - b.seq);
    return this.serial(() =>
      this.db.withTransactionAsync(async () => {
        for (const e of batch)
          await this.db.runAsync(
            'INSERT OR IGNORE INTO practice_events (game_id, seq, event_json) VALUES (?, ?, ?)',
            [gameId, e.seq, JSON.stringify(e)],
          );
      }),
    );
  }

  finishGame(gameId: string, { result, endedAt }: FinishedGame): Promise<void> {
    return this.serial(async () => {
      const row = await this.db.getFirstAsync<{ player_id: string }>(
        'SELECT player_id FROM practice_games WHERE id = ?',
        [gameId],
      );
      if (!row) throw new Error(`No practice game ${gameId}`);
      await this.db.runAsync(FINISH_SQL, [...finishedValues(result, row.player_id, endedAt), gameId]);
    });
  }

  markInterrupted(gameId?: string): Promise<number> {
    return this.serial(async () => {
      const rows = await this.db.getAllAsync<Pick<GameRow, 'id' | 'player_id' | 'started_at'>>(
        "SELECT id, player_id, started_at FROM practice_games WHERE status = 'playing'" +
          (gameId === undefined ? '' : ' AND id = ?'),
        gameId === undefined ? [] : [gameId],
      );
      for (const row of rows) {
        const last = lastState(await this.events(row.id));
        if (last?.status === 'over' && last.result && last.endedAt !== null) {
          // The game ended, but the app went away before it was marked finished.
          await this.db.runAsync(FINISH_SQL, [
            ...finishedValues(last.result, row.player_id, last.endedAt),
            row.id,
          ]);
          continue;
        }
        const me = last?.players.find((p) => p.id === row.player_id);
        await this.db.runAsync(
          "UPDATE practice_games SET status = 'interrupted', ended_at = ?, score = ?, mistakes = ?, correct = ?, " +
            'duration_ms = ? WHERE id = ?',
          [
            last ? last.lastEventAt : null,
            me?.score ?? null,
            me?.mistakes ?? null,
            me?.correct ?? null,
            // The time played to its last event: a background freeze [D65] left out.
            last ? loggedMs(last) : null,
            row.id,
          ],
        );
      }
      return rows.length;
    });
  }

  listRecent(limit = 20): Promise<PracticeGameRecord[]> {
    return this.serial(async () =>
      (
        await this.db.getAllAsync<GameRow>(
          `SELECT ${RECORD_COLUMNS} FROM practice_games ORDER BY started_at DESC, rowid DESC LIMIT ?`,
          [Math.max(0, Math.floor(limit))],
        )
      ).map(toRecord),
    );
  }

  listByMode(mode: GameMode): Promise<PracticeGameRecord[]> {
    return this.serial(async () =>
      (
        await this.db.getAllAsync<GameRow>(
          `SELECT ${RECORD_COLUMNS} FROM practice_games WHERE mode = ? ORDER BY started_at DESC, rowid DESC`,
          [mode],
        )
      ).map(toRecord),
    );
  }

  getGame(id: string): Promise<PracticeGame | null> {
    return this.serial(async () => {
      const row = await this.db.getFirstAsync<GameRow>(
        `SELECT ${RECORD_COLUMNS}, result_json FROM practice_games WHERE id = ?`,
        [id],
      );
      if (!row) return null;
      return {
        ...toRecord(row),
        result: row.result_json === null ? null : (JSON.parse(row.result_json) as GameResult),
      };
    });
  }

  loadEvents(id: string): Promise<GameEvent[]> {
    return this.serial(() => this.events(id));
  }

  playHistory(gameType: GameType): Promise<PlayRecord[]> {
    return this.serial(async () =>
      (
        await this.db.getAllAsync<{ puzzle_id: string; played_at: number }>(
          'SELECT puzzle_id, played_at FROM puzzle_plays WHERE game_type = ? ORDER BY played_at, rowid',
          [gameType],
        )
      ).map((r) => ({ puzzleId: r.puzzle_id, playedAt: r.played_at })),
    );
  }

  /** Not queued: for use inside a queued call. */
  private async events(id: string): Promise<GameEvent[]> {
    const rows = await this.db.getAllAsync<{ event_json: string }>(
      'SELECT event_json FROM practice_events WHERE game_id = ? ORDER BY seq',
      [id],
    );
    return rows.map((r) => JSON.parse(r.event_json) as GameEvent);
  }
}

/** The state a saved log reaches: as far as it replays (up to a gap or a damaged row); null for none. */
function lastState(events: readonly GameEvent[]): GameState | null {
  let state: GameState | null = null;
  for (const e of events) {
    try {
      state = evolve(state, e);
    } catch {
      break;
    }
  }
  return state;
}
