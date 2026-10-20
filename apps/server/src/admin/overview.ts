import type { AdminDayCount, AdminOverview } from '@sudoku-fight/protocol';
import { type SQL, sql } from 'drizzle-orm';

import { type Db, queryRows } from '../db';
import { localDay, perDaySql, type StatsWindow, timestampOf } from './sql';
import { getStealthOverview } from './stealth';

/**
 * GET /admin/api/overview (spec §27.3 "סקירה").
 *
 * - totals: everything so far (not only the window). `users` leaves out deleted accounts and the stealth
 *   bot's personas (users.kind 'persona', stealth-bot.md §8): it counts people. `games` are the
 *   ranked games on the server (games.mode 'ranked': not the games in friends rooms, 1.0.4, which GET /rooms
 *   counts per day); `practiceGames` are the game_end events the apps reported with mode solo or bot.
 * - per day, over the window: new installs (first_seen), active installs (sent an event that day), ranked
 *   games (started_at) and practice games (game_end), each zero-filled.
 * - activeToday / activeThisWeek: installs seen in the last 24 hours / 7 days before now (rolling). A persona
 *   has no install and sends nothing, so these and the per-day counts are people's already.
 * - stealth: the stealth bot over the window (./stealth getStealthOverview). The ranked games above include
 *   the ones against it: they are ranked games, rated like any other [D92].
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const PRACTICE_END = sql`name = 'game_end' and props->>'mode' in ('solo', 'bot')`;
const RANKED_GAME = sql`mode = 'ranked'`;
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
      (select count(*)::int from users where deleted_at is null and kind = 'person') as users,
      (select count(*)::int from games where ${RANKED_GAME}) as games,
      (select count(*)::int from app_events where ${PRACTICE_END}) as "practiceGames",
      (select count(*)::int from app_events) as events,
      (select count(*)::int from installs where last_seen > ${timestampOf(now - DAY_MS)}) as "activeToday",
      (select count(*)::int from installs where last_seen > ${timestampOf(now - 7 * DAY_MS)}) as "activeThisWeek"`,
  );
  const [installsPerDay, activePerDay, gamesPerDay, practicePerDay, stealth] = await Promise.all([
    perDay(sql`select ${localDay(sql`first_seen`, tz)} as day from installs
               where first_seen >= (select start from bounds)`),
    perDay(
      sql`select distinct install_id, ${localDay(SEEN_AT, tz)} as day from app_events where ${IN_WINDOW}`,
    ),
    perDay(sql`select ${localDay(sql`started_at`, tz)} as day from games
               where ${RANKED_GAME} and started_at >= (select start from bounds)`),
    perDay(
      sql`select ${localDay(SEEN_AT, tz)} as day from app_events where ${PRACTICE_END} and ${IN_WINDOW}`,
    ),
    getStealthOverview(db, window),
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
    stealth,
  };
}
