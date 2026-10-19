import {
  chapterOf,
  isBossLevel,
  LEVEL_KINDS,
  LEVEL_RULES,
  type LevelKind,
  levelIdOf,
  maxLevel,
} from '@sudoku-fight/engine';
import type {
  AdminGateStat,
  AdminLevels,
  AdminLevelStat,
  AdminUserLevels,
  TelemetryEventName,
} from '@sudoku-fight/protocol';
import { sql } from 'drizzle-orm';

import { type Db, queryRows } from '../db';
import { GATE_STUCK_ATTEMPTS, GATE_STUCK_SHARE, LEVEL_TOO_HARD_SHARE } from './constants';
import { boundsSql, numOrNull, type StatsWindow } from './sql';

/**
 * GET /admin/api/levels (plan §5.5, the "שלבים" page): how each level of staged practice plays, and where
 * players stop at a gate, to tune the levels after the launch. A player is an install (the events' unit).
 *
 * Levels, over the window's events (see ./sql) of three names: level_start, level_end and level_quit.
 * - An event counts only with `level` a whole number of a level there is (1 … maxLevel); a play (level_end)
 *   only with `stars` 0–3 too. A prop of the wrong type is as if missing (jsonb_typeof guards), never an error:
 *   the server checks the props since 1.0.2, but the table may hold anything older or hand-written.
 * - starts: level_start; plays: level_end (every end, the X too); players: distinct installs with a play.
 * - stars: the plays by stars. medianMs: the median durationMs of the plays but the quits (reason 'quit').
 * - replayRate: plays with attempt ≥ 2, out of the plays whose attempt is a whole number ≥ 1.
 * - midQuitRate: level_quit (left without an end), out of the starts, at most 1 (a start can fall just before
 *   the window). quitRate: plays with reason 'quit', out of the plays.
 * - firstTryZeroRate: plays with attempt 1 and 0 stars, out of the plays with attempt 1.
 * - kind: the most frequent valid `kind` of the level's starts and plays.
 *
 * Gates, over every chapter_gate event (all time: getting stuck builds up), per install and `chapter` (the
 * chapter behind the gate, 2 … chapterCount) with a boolean `open`:
 * - reached: installs with an attempt; opened: with an attempt that opened it; stuck: reached − opened.
 * - stuckAfter3: installs with at least GATE_STUCK_ATTEMPTS closed attempts and none that opened it (one who
 *   opens it on the fourth is not stuck); stuckAfter3Rate = stuckAfter3 / reached.
 *
 * Every level and every gate is in the answer, those without events with zeros and null rates.
 */

const LEVEL_EVENTS: readonly TelemetryEventName[] = ['level_start', 'level_end', 'level_quit'];

const list = (values: readonly string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

interface LevelRow extends Record<string, unknown> {
  level: number;
  starts: number;
  midQuits: number;
  plays: number;
  players: number;
  s0: number;
  s1: number;
  s2: number;
  s3: number;
  medianMs: number | null;
  withAttempt: number;
  replays: number;
  quits: number;
  firstTries: number;
  firstTryZeros: number;
  kind: string | null;
}

interface GateRow extends Record<string, unknown> {
  chapter: number;
  reached: number;
  opened: number;
  stuckAfter: number;
}

const rate = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

export async function getLevels(db: Db, window: StatsWindow): Promise<AdminLevels> {
  const last = maxLevel(LEVEL_RULES);
  const [levelRows, gateRows] = await Promise.all([
    queryRows<LevelRow>(
      db,
      sql`
        with bounds as (${boundsSql(window)}),
        ev as (
          select install_id, name,
            case when jsonb_typeof(props->'level') = 'number' then (props->>'level')::numeric end as level,
            case when jsonb_typeof(props->'kind') = 'string' then props->>'kind' end as kind,
            case when jsonb_typeof(props->'stars') = 'number' then (props->>'stars')::numeric end as stars,
            case when jsonb_typeof(props->'attempt') = 'number' then (props->>'attempt')::numeric end as attempt,
            case when jsonb_typeof(props->'durationMs') = 'number'
                 then (props->>'durationMs')::numeric end as duration,
            case when jsonb_typeof(props->'reason') = 'string' then props->>'reason' end as reason
          from app_events
          where name in (${list(LEVEL_EVENTS)})
            and t_server >= (select start from bounds)
            and least(t_client, t_server) >= (select start from bounds)
        ),
        valid as (
          select install_id, name, level::int as level, reason,
            case when kind in (${list(LEVEL_KINDS)}) then kind end as kind,
            case when stars in (0, 1, 2, 3) then stars::int end as stars,
            case when attempt >= 1 and attempt = trunc(attempt) then attempt end as attempt,
            case when duration >= 0 then duration::float8 end as duration
          from ev
          where level between 1 and ${last}::int and level = trunc(level)
        ),
        marked as (select *, (name = 'level_end' and stars is not null) as is_play from valid)
        select level,
          count(*) filter (where name = 'level_start')::int as starts,
          count(*) filter (where name = 'level_quit')::int as "midQuits",
          count(*) filter (where is_play)::int as plays,
          count(distinct install_id) filter (where is_play)::int as players,
          count(*) filter (where is_play and stars = 0)::int as s0,
          count(*) filter (where is_play and stars = 1)::int as s1,
          count(*) filter (where is_play and stars = 2)::int as s2,
          count(*) filter (where is_play and stars = 3)::int as s3,
          (percentile_cont(0.5) within group (order by duration)
            filter (where is_play and reason is distinct from 'quit' and duration is not null))::float8
            as "medianMs",
          count(*) filter (where is_play and attempt is not null)::int as "withAttempt",
          count(*) filter (where is_play and attempt >= 2)::int as replays,
          count(*) filter (where is_play and reason = 'quit')::int as quits,
          count(*) filter (where is_play and attempt = 1)::int as "firstTries",
          count(*) filter (where is_play and attempt = 1 and stars = 0)::int as "firstTryZeros",
          mode() within group (order by kind) filter (where kind is not null) as kind
        from marked
        group by level
        order by level`,
    ),
    queryRows<GateRow>(
      db,
      sql`
        with ev as (
          select install_id,
            case when jsonb_typeof(props->'chapter') = 'number'
                 then (props->>'chapter')::numeric end as chapter,
            case when jsonb_typeof(props->'open') = 'boolean' then (props->>'open')::boolean end as open
          from app_events
          where name = 'chapter_gate'
        ),
        per_player as (
          select chapter::int as chapter, install_id,
            bool_or(open) as opened,
            count(*) filter (where not open)::int as closed
          from ev
          where open is not null
            and chapter between 2 and ${LEVEL_RULES.chapterCount}::int and chapter = trunc(chapter)
          group by 1, 2
        )
        select chapter,
          count(*)::int as reached,
          count(*) filter (where opened)::int as opened,
          count(*) filter (where not opened and closed >= ${GATE_STUCK_ATTEMPTS}::int)::int as "stuckAfter"
        from per_player
        group by chapter
        order by chapter`,
    ),
  ]);

  const byLevel = new Map(levelRows.map((r) => [Number(r.level), r]));
  const levels: AdminLevelStat[] = [];
  for (let n = 1; n <= last; n++) {
    const r = byLevel.get(n);
    const starts = r?.starts ?? 0;
    const plays = r?.plays ?? 0;
    const firstTries = r?.firstTries ?? 0;
    levels.push({
      levelId: levelIdOf(n),
      chapter: chapterOf(n),
      boss: isBossLevel(n),
      kind: (r?.kind ?? null) as LevelKind | null,
      starts,
      plays,
      players: r?.players ?? 0,
      stars: [r?.s0 ?? 0, r?.s1 ?? 0, r?.s2 ?? 0, r?.s3 ?? 0],
      medianMs: numOrNull(r?.medianMs),
      replayRate: rate(r?.replays ?? 0, r?.withAttempt ?? 0),
      midQuitRate: starts > 0 ? Math.min(1, (r?.midQuits ?? 0) / starts) : null,
      quitRate: rate(r?.quits ?? 0, plays),
      firstTries,
      firstTryZeroRate: rate(r?.firstTryZeros ?? 0, firstTries),
    });
  }

  const byChapter = new Map(gateRows.map((r) => [Number(r.chapter), r]));
  const gates: AdminGateStat[] = [];
  for (let chapter = 2; chapter <= LEVEL_RULES.chapterCount; chapter++) {
    const r = byChapter.get(chapter);
    const reached = r?.reached ?? 0;
    const opened = r?.opened ?? 0;
    const stuckAfter3 = r?.stuckAfter ?? 0;
    gates.push({
      chapter,
      reached,
      opened,
      stuck: reached - opened,
      stuckAfter3,
      stuckAfter3Rate: rate(stuckAfter3, reached),
    });
  }

  return {
    days: window.days,
    tooHardShare: LEVEL_TOO_HARD_SHARE,
    stuckShare: GATE_STUCK_SHARE,
    stuckAttempts: GATE_STUCK_ATTEMPTS,
    levels,
    gates,
  };
}

/**
 * A user's staged-practice progress as the account synced it (user_levels): the levels played and their best
 * stars, summed; null when it synced none.
 */
export async function levelsOfUser(db: Db, userId: string): Promise<AdminUserLevels | null> {
  const [row] = await queryRows<{ rows: number; played: number; stars: number }>(
    db,
    sql`select count(*)::int as rows,
          (count(*) filter (where plays > 0))::int as played,
          coalesce(sum(best_stars), 0)::int as stars
        from user_levels
        where user_id = ${userId}`,
  );
  return row === undefined || row.rows === 0 ? null : { played: row.played, stars: row.stars };
}
