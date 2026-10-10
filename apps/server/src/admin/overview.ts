import type { AdminDayCount, AdminOverview } from '@sudoku-fight/protocol';
import { type SQL, sql } from 'drizzle-orm';

import { type Db, queryRows } from '../db';
import { localDay, perDaySql, type StatsWindow, timestampOf } from './sql';

/**
 * GET /admin/api/overview (spec §27.3 "סקירה").
 *
 * - totals: everything so far (not only the window). `users` leaves out deleted accounts. `games` are the
 *   games on the server (all ranked for now); `practiceGames` are the game_end events the apps reported with
 *   mode solo or bot.
 * - per day, over the window: new installs (first_seen), active installs (sent an event that day), ranked
 *   games (started_at) and practice games (game_end), each zero-filled.
 * - activeToday / activeThisWeek: installs seen in the last 24 hours / 7 days before now (rolling).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const PRACTICE_END = sql`name = 'game_end' and props->>'mode' in ('solo', 'bot')`;
const SEEN_AT = sql`least(t_client, t_server)`;
const IN_WINDOW = sql`t_server >= (select start from bounds) and ${SEEN_AT} >= (select start from bounds)`;

export async function getOverview(db: Db, window: StatsWindow): Promise<AdminOverview> {
  const { tz, now } = window;
  const perDay = async (source: SQL): Promise<AdminDayCount[]> =>
    queryRows<{ day: string; count: number }>(db, perDaySql(window, source));

  const [totals] = await queryRows<AdminOverview['totals'] & { activeToday: number; activeThisWeek: number }>(
    db,
    sql`select
      (select count(*)::int from installs) as installs,
      (select count(*)::int from users where deleted_at is null) as users,
      (select count(*)::int from games) as games,
      (select count(*)::int from app_events where ${PRACTICE_END}) as "practiceGames",
      (select count(*)::int from app_events) as events,
      (select count(*)::int from installs where last_seen > ${timestampOf(now - DAY_MS)}) as "activeToday",
      (select count(*)::int from installs where last_seen > ${timestampOf(now - 7 * DAY_MS)}) as "activeThisWeek"`,
  );
  const [installsPerDay, activePerDay, gamesPerDay, practicePerDay] = await Promise.all([
    perDay(sql`select ${localDay(sql`first_seen`, tz)} as day from installs
               where first_seen >= (select start from bounds)`),
    perDay(
      sql`select distinct install_id, ${localDay(SEEN_AT, tz)} as day from app_events where ${IN_WINDOW}`,
    ),
    perDay(sql`select ${localDay(sql`started_at`, tz)} as day from games
               where started_at >= (select start from bounds)`),
    perDay(
      sql`select ${localDay(SEEN_AT, tz)} as day from app_events where ${PRACTICE_END} and ${IN_WINDOW}`,
    ),
  ]);
  if (totals === undefined) throw new Error('overview: no totals row');
  const { activeToday, activeThisWeek, ...rest } = totals;
  return {
    days: window.days,
    totals: {
      installs: rest.installs,
      users: rest.users,
      games: rest.games,
      practiceGames: rest.practiceGames,
      events: rest.events,
    },
    installsPerDay,
    activePerDay,
    activeToday,
    activeThisWeek,
    gamesPerDay,
    practicePerDay,
  };
}
