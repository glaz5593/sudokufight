import {
  type AppLevel,
  chapterOf,
  countsAsPlayed,
  ENGINE_VERSION,
  type GameResult,
  gateState,
  type GateState,
  isBetterMetric,
  isLevelId,
  isLevelOpen,
  LEVEL_PENALTY_MS,
  LEVEL_RULES,
  type LevelBest,
  type LevelEndOf,
  type LevelEndReason,
  levelIdOf,
  type LevelKind,
  levelNumber,
  type LevelOutcome,
  levelOutcome,
  type LevelRecord,
  type LevelRules,
  maxLevel,
  mergeBest,
  openedChaptersOf,
  type PuzzleLevelOver,
  type Stars,
} from '@sudoku-fight/engine';
import type { LevelBest as ServerLevelBest } from '@sudoku-fight/protocol';

import type { Migration } from '../game/practiceRepo';
import type { SqlDb, SqlValue } from '../game/sqlDb';
import { LEVELS_MIGRATIONS, migrateLevels } from './levelsSchema';

/**
 * Staged practice's progress on the phone (1.0.2; plan §4.5, §5.4; dev-plan §2ו), in levels.db
 * (levelsSchema.ts), every row by its owner (the Firebase uid). SQLite through the SqlDb interface:
 * expo-sqlite in the app, sql.js in tests and in the server's contract tests.
 *
 * Every rule comes from the engine: how an end reads (levelOutcome), whether it counts as played
 * (countsAsPlayed, which reads quitCountsAsPlayed), the best of two (mergeBest, isBetterMetric), what is open
 * (isLevelOpen, with the gates that opened once) and the gates (gateState). This file only stores.
 *
 * A rebuilt level (1.0.3: every level at rev 2) [D73]: its stars stay (never lower, by id, whatever its kind
 * is now), and its best measure ("השיא שלי") starts over with the first attempt at the new rev (mergeBest
 * with the rev of the row, best_rev, and the attempt's). Until then bestMetricAt hides the old rev's. Its
 * attempts are numbered at the new rev from 1 again (attemptOf takes the rev): the first attempt at a rebuilt
 * level is its stored board (spec §5.3.10, D63), and the admin counts it as a first try.
 *
 * The sync (levelsSync.ts) reads the rows the server does not have yet (`dirty`), marks what it took
 * (`markSynced`, only rows unchanged since they were sent) and merges the server's answer (`mergeFromServer`:
 * the max of each, never lower).
 *
 * Every call runs after the previous one has finished (one queue of its own, apart from the practices'), so a
 * read sees every write before it; expo-sqlite's transactions are not exclusive, which the queue makes safe.
 */

/**
 * The level an attempt was at: what levelOutcome and the attempt's row need of it. A boss's `boss` (and a
 * race's `targets`) give the outcome the engine's verdict, bossBeaten [D72]; without them it is null.
 */
export type FinishedLevel = Pick<AppLevel, 'id' | 'rev' | 'kind' | 'chapter' | 'stars' | 'bot'> & {
  boss?: boolean;
  targets?: AppLevel['targets'];
};

/** An attempt that ended (any end: a quit with the X too), as a host gave it. */
export interface LevelFinish {
  owner: string;
  /** The level as stored (its stars rule is the same on a replay's equivalent board, D63). */
  level: FinishedLevel;
  /**
   * The end: the game engine's result (a digit kind), the tap engine's levelOver (a tap kind) or the puzzle's
   * levelOver (1.0.3).
   */
  end: LevelEndOf;
  /** The player on this phone: whose mistakes a digit level's result counts. */
  playerId?: string;
  /** This attempt's number, the one its board was played with (attemptOf at its start); default attemptOf. */
  attempt?: number;
  /**
   * My mistakes; by default a digit level's ranking row, a tap level's time penalties, or a puzzle's wrong
   * swaps (neither box landed at its home) [D70c].
   */
  mistakes?: number;
  /** Started by "לשלב הבא", straight from a result (the quick entry). */
  quick?: boolean;
  startedAt: number;
  endedAt: number;
  engineVersion?: string;
}

export interface RecordedAttempt {
  attempt: number;
  outcome: LevelOutcome;
  /** It counts as played (countsAsPlayed): the plays went up, and the next level is open. */
  played: boolean;
  mistakes: number;
  /** The best stars before it, and after it (never lower). */
  prevBest: Stars;
  best: Stars;
  /** best − prevBest. */
  newStars: number;
  /** The best measure after it. */
  bestMetric: number | null;
  /**
   * The gate at the end of the level's chapter after this attempt (it opens chapter + 1), as gateState gives
   * it; null in the last chapter, which has none.
   */
  gate: GateState | null;
  /** That gate was open already before this attempt. */
  gateWasOpen: boolean;
  /** This attempt opened it (+50 XP on the phone's estimate, "פרק חדש נפתח"). */
  gateOpened: boolean;
}

/** A level's stored best, as the engine reads progress (LevelRecord) and a little more. */
export interface LevelProgressRecord extends LevelRecord {
  /** The best measure (LEVEL_METRIC), or null before any attempt that had one. */
  metric: number | null;
  /** The level's rev when its best was made; null for a row restored from the server. */
  rev: number | null;
  firstPlayedAt: number | null;
}

/** By level id (a level never played is missing): the engine's LevelRecords. */
export type LevelsProgress = Record<string, LevelProgressRecord>;

/** For the "משחק חדש" row and my card: "שלבים: 87 · ★ 214". */
export interface LevelsSummary {
  /** Levels played at least once. */
  played: number;
  /** All my best stars. */
  stars: number;
  /** The level to go on with (its number): the first open one never played, else the last open one. */
  current: number;
}

/** A row of level_attempts. */
export interface LevelAttemptRecord {
  levelId: string;
  rev: number;
  attempt: number;
  chapter: number;
  kind: LevelKind;
  stars: Stars;
  prevBest: Stars;
  metric: number | null;
  mistakes: number;
  reason: LevelEndReason;
  quick: boolean;
  botLevel: number | null;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  engineVersion: string;
}

export interface LevelsRepo {
  /**
   * One attempt, in one transaction: its row, and the level's best (plays + 1 only when it counts as
   * played). Throws for an id that is not a level's.
   */
  recordAttempt(finish: LevelFinish): Promise<RecordedAttempt>;
  /**
   * The number of the next attempt at a level at `rev` (its rev now): the attempts recorded at that rev, or the
   * plays not accounted for by another rev's attempts (a row restored from the server), the larger, + 1. A
   * rebuilt level (a new rev) starts again at 1 [D73, D63].
   */
  attemptOf(owner: string, levelId: string, rev: number): Promise<number>;
  progress(owner: string): Promise<LevelsProgress>;
  /** The chapters a gate opened once (2 and up), for isLevelOpen. */
  openedGates(owner: string): Promise<number[]>;
  summary(owner: string): Promise<LevelsSummary>;
  /** The rows the server does not have as they are (nor refused), in level order. */
  dirty(owner: string): Promise<ServerLevelBest[]>;
  /** The server took these: only the rows unchanged since (a row played meanwhile stays dirty). */
  markSynced(owner: string, sent: readonly ServerLevelBest[]): Promise<number>;
  /** The server refused these alone (400): not sent again until they change. */
  markRejected(owner: string, refused: readonly ServerLevelBest[]): Promise<number>;
  /**
   * Everything the server has (GET's or PUT's answer): each level takes the max of both, a level missing here
   * is added, and a row the server lacks is to be sent again. The chapters open after it are kept as opened
   * gates (seen elsewhere: no celebration). Returns how many rows changed.
   */
  mergeFromServer(owner: string, levels: readonly ServerLevelBest[], at: number): Promise<number>;
  /** Keeps a gate as opened: true the first time, false after. */
  openGate(owner: string, chapter: number, at: number): Promise<boolean>;
  /** Opened gates whose "פרק חדש נפתח" was not shown yet, in chapter order. */
  gatesToCelebrate(owner: string): Promise<number[]>;
  markCelebrated(owner: string, chapter: number): Promise<void>;
  /** The recorded attempts, oldest first (one level's, or all). */
  attempts(owner: string, levelId?: string): Promise<LevelAttemptRecord[]>;
}

export interface LevelsRepoOptions {
  migrations?: readonly Migration[];
  /** The engine's LEVEL_RULES; tests change one (quitCountsAsPlayed, gateStars). */
  rules?: LevelRules;
}

interface ProgressRow {
  level_id: string;
  best_stars: number;
  plays: number;
  best_metric: number | null;
  best_rev: number | null;
  first_played_at: number | null;
  last_played_at: number | null;
}

interface AttemptRow {
  level_id: string;
  rev: number;
  attempt: number;
  chapter: number;
  kind: string;
  stars: number;
  prev_best: number;
  metric: number | null;
  mistakes: number;
  reason: string;
  quick: number;
  bot_level: number | null;
  started_at: number;
  ended_at: number;
  duration_ms: number;
  engine_version: string;
}

const PROGRESS_COLUMNS =
  'level_id, best_stars, plays, best_metric, best_rev, first_played_at, last_played_at';

const starsOf = (n: number): Stars => Math.max(0, Math.min(3, Math.floor(n))) as Stars;

function toRecord(r: ProgressRow): LevelProgressRecord {
  return {
    stars: starsOf(r.best_stars),
    plays: r.plays,
    ...(r.last_played_at === null ? null : { lastPlayedAt: r.last_played_at }),
    metric: r.best_metric,
    rev: r.best_rev,
    firstPlayedAt: r.first_played_at,
  };
}

const toAttempt = (r: AttemptRow): LevelAttemptRecord => ({
  levelId: r.level_id,
  rev: r.rev,
  attempt: r.attempt,
  chapter: r.chapter,
  kind: r.kind as LevelKind,
  stars: starsOf(r.stars),
  prevBest: starsOf(r.prev_best),
  metric: r.metric,
  mistakes: r.mistakes,
  reason: r.reason as LevelEndReason,
  quick: r.quick === 1,
  botLevel: r.bot_level,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  durationMs: r.duration_ms,
  engineVersion: r.engine_version,
});

const isGameResult = (end: LevelEndOf): end is GameResult => 'ranking' in end;
const isPuzzleOver = (end: LevelEndOf): end is PuzzleLevelOver => 'swaps' in end;

/**
 * My mistakes in an end: the session's count, or else a digit level's ranking row, a puzzle's wrong swaps
 * [D70c], a tap level's penalties.
 */
export function mistakesOf(finish: Pick<LevelFinish, 'end' | 'playerId' | 'mistakes'>): number {
  if (finish.mistakes !== undefined) return Math.max(0, Math.round(finish.mistakes));
  const { end } = finish;
  if (isGameResult(end)) return end.ranking.find((r) => r.playerId === finish.playerId)?.mistakes ?? 0;
  if (isPuzzleOver(end)) return Math.max(0, Math.round(end.mistakes));
  return Math.max(0, Math.round(end.penaltyMs / LEVEL_PENALTY_MS));
}

/**
 * The best measure to show for a level now at `rev` ("השיא שלי"): the stored one, unless it was made on
 * another rev of the level [D73]. A rebuilt level (a new board, maybe a new kind) starts its best over, so the
 * old rev's measure means nothing there. A row without a rev (restored from the server) has no measure anyway.
 */
export function bestMetricAt(
  record: Pick<LevelProgressRecord, 'metric' | 'rev'> | null | undefined,
  rev: number,
): number | null {
  if (!record || record.metric === null) return null;
  return record.rev === null || record.rev === rev ? record.metric : null;
}

/** A level from the server as this app stores it: a level id, 0–3 stars, whole plays; else null. */
function cleanServerLevel(level: ServerLevelBest): ServerLevelBest | null {
  if (!isLevelId(level.id) || !Number.isFinite(level.stars) || !Number.isFinite(level.plays)) return null;
  return { id: level.id, stars: starsOf(level.stars), plays: Math.max(0, Math.floor(level.plays)) };
}

// ---------------------------------------------------------------------------------------------------------

export async function openLevelsRepo(
  db: SqlDb,
  { migrations = LEVELS_MIGRATIONS, rules = LEVEL_RULES }: LevelsRepoOptions = {},
): Promise<LevelsRepo> {
  await migrateLevels(db, migrations);
  return new SqlLevelsRepo(db, rules);
}

class SqlLevelsRepo implements LevelsRepo {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: SqlDb,
    private readonly rules: LevelRules,
  ) {}

  /** One call at a time, in call order; a failed call doesn't stop the ones after it. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  recordAttempt(finish: LevelFinish): Promise<RecordedAttempt> {
    const { owner, level } = finish;
    if (!isLevelId(level.id)) return Promise.reject(new RangeError(`Not a level: ${level.id}`));
    return this.serial(async () => {
      let recorded: RecordedAttempt | null = null;
      await this.db.withTransactionAsync(async () => {
        const records = await this.records(owner);
        const opened = await this.gates(owner);
        const row = records[level.id];
        const attempt = finish.attempt ?? (await this.nextAttempt(owner, level.id, level.rev, row));
        const outcome = levelOutcome(level, finish.end);
        const played = countsAsPlayed(outcome.reason, this.rules);
        const mistakes = mistakesOf(finish);
        // [D73] The row's rev (best_rev) and the attempt's: across a new rev the stars stay, the measure starts
        // over. A row restored from the server has no rev: merged as one rev (it has no measure anyway).
        const prev: LevelBest | null = row
          ? { stars: row.stars, metric: row.metric, ...(row.rev === null ? null : { rev: row.rev }) }
          : null;
        const best: LevelBest = played
          ? mergeBest(level.kind, prev, { stars: outcome.stars, metric: outcome.metric, rev: level.rev })
          : (prev ?? { stars: 0 as Stars, metric: null });
        const prevBest = prev?.stars ?? 0;
        const chapter = chapterOf(level.id, this.rules);
        const lastChapter = chapter >= this.rules.chapterCount;
        const gateBefore = lastChapter ? null : gateState(chapter, records, opened, this.rules);

        if (played) {
          // The rev of the best: the attempt's when it made the best (or opened a new rev), else the row's.
          const bestRev = !row
            ? level.rev
            : row.rev !== null && row.rev !== level.rev
              ? (best.rev ?? level.rev)
              : best.stars > row.stars ||
                  (outcome.metric !== null &&
                    (row.metric === null || isBetterMetric(level.kind, outcome.metric, row.metric)))
                ? level.rev
                : row.rev;
          await this.db.runAsync(
            'INSERT INTO level_progress (owner, level_id, best_stars, plays, best_metric, best_rev, ' +
              'first_played_at, last_played_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?) ' +
              'ON CONFLICT (owner, level_id) DO UPDATE SET best_stars = excluded.best_stars, ' +
              'plays = level_progress.plays + 1, best_metric = excluded.best_metric, ' +
              'best_rev = excluded.best_rev, ' +
              'first_played_at = COALESCE(level_progress.first_played_at, excluded.first_played_at), ' +
              'last_played_at = excluded.last_played_at, rejected = 0',
            [owner, level.id, best.stars, best.metric, bestRev, finish.startedAt, finish.endedAt],
          );
          records[level.id] = {
            ...(row ?? { firstPlayedAt: finish.startedAt }),
            rev: bestRev,
            stars: best.stars,
            plays: (row?.plays ?? 0) + 1,
            lastPlayedAt: finish.endedAt,
            metric: best.metric,
          };
        }
        await this.db.runAsync(
          'INSERT INTO level_attempts (owner, level_id, rev, attempt, chapter, kind, stars, prev_best, metric, ' +
            'mistakes, reason, quick, bot_level, started_at, ended_at, duration_ms, engine_version) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            owner,
            level.id,
            level.rev,
            attempt,
            chapter,
            level.kind,
            outcome.stars,
            prevBest,
            outcome.metric,
            mistakes,
            outcome.reason,
            finish.quick ? 1 : 0,
            level.bot?.level ?? null,
            finish.startedAt,
            finish.endedAt,
            Math.max(0, Math.round(outcome.elapsedMs)),
            finish.engineVersion ?? ENGINE_VERSION,
          ],
        );
        const gate = lastChapter ? null : gateState(chapter, records, opened, this.rules);
        const gateWasOpen = gateBefore?.open ?? false;
        recorded = {
          attempt,
          outcome,
          played,
          mistakes,
          prevBest,
          best: best.stars,
          newStars: best.stars - prevBest,
          bestMetric: best.metric,
          gate,
          gateWasOpen,
          gateOpened: !gateWasOpen && (gate?.open ?? false),
        };
      });
      return recorded!;
    });
  }

  attemptOf(owner: string, levelId: string, rev: number): Promise<number> {
    return this.serial(async () => {
      const row = await this.db.getFirstAsync<{ plays: number }>(
        'SELECT plays FROM level_progress WHERE owner = ? AND level_id = ?',
        [owner, levelId],
      );
      return this.nextAttempt(owner, levelId, rev, row ?? undefined);
    });
  }

  progress(owner: string): Promise<LevelsProgress> {
    return this.serial(() => this.records(owner));
  }

  openedGates(owner: string): Promise<number[]> {
    return this.serial(() => this.gates(owner));
  }

  summary(owner: string): Promise<LevelsSummary> {
    return this.serial(async () => {
      const records = await this.records(owner);
      const opened = await this.gates(owner);
      const last = maxLevel(this.rules);
      let played = 0;
      let stars = 0;
      for (const [id, r] of Object.entries(records)) {
        const n = levelNumber(id);
        if (n === null || n > last) continue;
        if (r.plays > 0) played++;
        stars += r.stars;
      }
      let current = 0;
      let lastOpen = 1;
      for (let n = 1; n <= last && current === 0; n++) {
        if (!isLevelOpen(n, records, opened, this.rules)) continue;
        lastOpen = n;
        if ((records[levelIdOf(n)]?.plays ?? 0) === 0) current = n;
      }
      return { played, stars, current: current || lastOpen };
    });
  }

  dirty(owner: string): Promise<ServerLevelBest[]> {
    return this.serial(async () => {
      const rows = await this.db.getAllAsync<{ level_id: string; best_stars: number; plays: number }>(
        'SELECT level_id, best_stars, plays FROM level_progress WHERE owner = ? AND rejected = 0 ' +
          'AND (best_stars <> synced_stars OR plays <> synced_plays) AND (best_stars > 0 OR plays > 0)',
        [owner],
      );
      return rows
        .filter((r) => isLevelId(r.level_id))
        .map((r) => ({ id: r.level_id, stars: starsOf(r.best_stars), plays: r.plays }))
        .sort((a, b) => levelNumber(a.id)! - levelNumber(b.id)!);
    });
  }

  markSynced(owner: string, sent: readonly ServerLevelBest[]): Promise<number> {
    return this.whereUnchanged(
      owner,
      sent,
      'UPDATE level_progress SET synced_stars = ?, synced_plays = ?',
      (l) => [l.stars, l.plays],
    );
  }

  markRejected(owner: string, refused: readonly ServerLevelBest[]): Promise<number> {
    return this.whereUnchanged(owner, refused, 'UPDATE level_progress SET rejected = 1', () => []);
  }

  mergeFromServer(owner: string, levels: readonly ServerLevelBest[], at: number): Promise<number> {
    const server = new Map<string, ServerLevelBest>();
    for (const level of levels) {
      const clean = cleanServerLevel(level);
      if (!clean) continue;
      const seen = server.get(clean.id);
      server.set(clean.id, {
        id: clean.id,
        stars: Math.max(seen?.stars ?? 0, clean.stars) as Stars,
        plays: Math.max(seen?.plays ?? 0, clean.plays),
      });
    }
    return this.serial(async () => {
      let changed = 0;
      await this.db.withTransactionAsync(async () => {
        const rows = await this.db.getAllAsync<{
          level_id: string;
          best_stars: number;
          plays: number;
          rejected: number;
        }>('SELECT level_id, best_stars, plays, rejected FROM level_progress WHERE owner = ?', [owner]);
        const local = new Map(rows.map((r) => [r.level_id, r]));
        for (const s of server.values()) {
          const mine = local.get(s.id);
          if (!mine) {
            await this.db.runAsync(
              'INSERT INTO level_progress (owner, level_id, best_stars, plays, synced_stars, synced_plays) ' +
                'VALUES (?, ?, ?, ?, ?, ?)',
              [owner, s.id, s.stars, s.plays, s.stars, s.plays],
            );
            changed++;
            continue;
          }
          const stars = Math.max(mine.best_stars, s.stars);
          const plays = Math.max(mine.plays, s.plays);
          const raised = stars !== mine.best_stars || plays !== mine.plays;
          if (raised) changed++;
          await this.db.runAsync(
            'UPDATE level_progress SET best_stars = ?, plays = ?, synced_stars = ?, synced_plays = ?' +
              (raised ? ', rejected = 0' : '') +
              ' WHERE owner = ? AND level_id = ?',
            [stars, plays, s.stars, s.plays, owner, s.id],
          );
        }
        // What the server lacks goes again (a row it never stored, or lost); a refused row stays refused.
        for (const mine of rows)
          if (!server.has(mine.level_id) && mine.rejected === 0)
            await this.db.runAsync(
              'UPDATE level_progress SET synced_stars = -1, synced_plays = 0 WHERE owner = ? AND level_id = ? ' +
                'AND (synced_stars <> -1 OR synced_plays <> 0)',
              [owner, mine.level_id],
            );
        // The chapters open now stay open (a gate seen on the other phone: celebrated there).
        const records = await this.records(owner);
        const opened = await this.gates(owner);
        for (const chapter of openedChaptersOf(records, opened, this.rules))
          if (!opened.includes(chapter))
            await this.db.runAsync(
              'INSERT OR IGNORE INTO level_gates (owner, chapter, opened_at, celebrated) VALUES (?, ?, ?, 1)',
              [owner, chapter, at],
            );
      });
      return changed;
    });
  }

  openGate(owner: string, chapter: number, at: number): Promise<boolean> {
    return this.serial(async () => {
      const { changes } = await this.db.runAsync(
        'INSERT OR IGNORE INTO level_gates (owner, chapter, opened_at, celebrated) VALUES (?, ?, ?, 0)',
        [owner, chapter, at],
      );
      return changes > 0;
    });
  }

  gatesToCelebrate(owner: string): Promise<number[]> {
    return this.serial(async () =>
      (
        await this.db.getAllAsync<{ chapter: number }>(
          'SELECT chapter FROM level_gates WHERE owner = ? AND celebrated = 0 ORDER BY chapter',
          [owner],
        )
      ).map((r) => r.chapter),
    );
  }

  markCelebrated(owner: string, chapter: number): Promise<void> {
    return this.serial(async () => {
      await this.db.runAsync('UPDATE level_gates SET celebrated = 1 WHERE owner = ? AND chapter = ?', [
        owner,
        chapter,
      ]);
    });
  }

  attempts(owner: string, levelId?: string): Promise<LevelAttemptRecord[]> {
    return this.serial(async () =>
      (
        await this.db.getAllAsync<AttemptRow>(
          'SELECT level_id, rev, attempt, chapter, kind, stars, prev_best, metric, mistakes, reason, quick, ' +
            'bot_level, started_at, ended_at, duration_ms, engine_version FROM level_attempts WHERE owner = ?' +
            (levelId === undefined ? '' : ' AND level_id = ?') +
            ' ORDER BY id',
          levelId === undefined ? [owner] : [owner, levelId],
        )
      ).map(toAttempt),
    );
  }

  // ---- not queued: for use inside a queued call ---------------------------------------------------------

  private async records(owner: string): Promise<LevelsProgress> {
    const rows = await this.db.getAllAsync<ProgressRow>(
      `SELECT ${PROGRESS_COLUMNS} FROM level_progress WHERE owner = ?`,
      [owner],
    );
    const out: LevelsProgress = {};
    for (const r of rows) out[r.level_id] = toRecord(r);
    return out;
  }

  private async gates(owner: string): Promise<number[]> {
    return (
      await this.db.getAllAsync<{ chapter: number }>(
        'SELECT chapter FROM level_gates WHERE owner = ? ORDER BY chapter',
        [owner],
      )
    ).map((r) => r.chapter);
  }

  /**
   * [D73, D63] The next attempt's number at `rev`: the attempts recorded at this rev, or the row's plays less
   * the attempts recorded at other revs (so a row restored from the server, with plays and no attempts here,
   * still counts them), the larger, + 1. `plays` is the level's, over every rev, so it never counts alone: a
   * player with 3 plays at rev 1 starts rev 2 at 1, then 2.
   */
  private async nextAttempt(
    owner: string,
    levelId: string,
    rev: number,
    row: Pick<LevelRecord, 'plays'> | undefined,
  ): Promise<number> {
    const counted = await this.db.getFirstAsync<{ atRev: number | null; otherRevs: number | null }>(
      'SELECT SUM(CASE WHEN rev = ? THEN 1 ELSE 0 END) AS atRev, ' +
        'SUM(CASE WHEN rev = ? THEN 0 ELSE 1 END) AS otherRevs ' +
        'FROM level_attempts WHERE owner = ? AND level_id = ?',
      [rev, rev, owner, levelId],
    );
    const atRev = counted?.atRev ?? 0;
    const otherRevs = counted?.otherRevs ?? 0;
    return Math.max(atRev, (row?.plays ?? 0) - otherRevs) + 1;
  }

  /** `sql` on each row still as it was sent (same stars, same plays), in one transaction. */
  private whereUnchanged(
    owner: string,
    levels: readonly ServerLevelBest[],
    sql: string,
    values: (level: ServerLevelBest) => SqlValue[],
  ): Promise<number> {
    if (levels.length === 0) return this.serial(async () => 0);
    return this.serial(async () => {
      let changed = 0;
      await this.db.withTransactionAsync(async () => {
        for (const level of levels) {
          const { changes } = await this.db.runAsync(
            `${sql} WHERE owner = ? AND level_id = ? AND best_stars = ? AND plays = ?`,
            [...values(level), owner, level.id, level.stars, level.plays],
          );
          changed += changes;
        }
      });
      return changed;
    });
  }
}
