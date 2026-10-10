import type { AdminScreens, AdminScreenStat } from '@sudoku-fight/protocol';
import { sql } from 'drizzle-orm';

import { type Db, queryRows } from '../db';
import { GONE_AFTER_DAYS, SESSION_GAP_MINUTES } from './constants';
import { boundsSql, type StatsWindow, timestampOf } from './sql';

/**
 * GET /admin/api/screens (spec §27.3 "מסכים"): how often each screen is opened, and where people stop.
 *
 * Over the events of the window (see ./sql):
 * - views: screen_view events of the screen; installs: distinct installs that opened it.
 * - sessions: per install, a new session starts after SESSION_GAP_MINUTES without any event (by the phone's
 *   clock). Only sessions that opened at least one screen count, so the exits add up to `sessions`.
 * - exits: sessions whose last screen was this one; exitRate = exits / sessions that opened it.
 * - lastScreenOfGone: installs not seen for GONE_AFTER_DAYS whose very last screen_view was this screen
 *   (and fell in the window).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getScreens(db: Db, window: StatsWindow): Promise<AdminScreens> {
  const goneBefore = timestampOf(window.now - GONE_AFTER_DAYS * DAY_MS);
  const rows = await queryRows<{
    screen: string;
    views: number;
    installs: number;
    exits: number;
    opened: number;
    gone: number;
  }>(
    db,
    sql`
      with bounds as (${boundsSql(window)}),
      ev as (
        select id, install_id, t_client,
          case when name = 'screen_view' and jsonb_typeof(props->'screen') = 'string'
               then props->>'screen' end as screen
        from app_events
        where t_server >= (select start from bounds) and least(t_client, t_server) >= (select start from bounds)
      ),
      marked as (
        select *,
          case when t_client - lag(t_client) over w <= ${SESSION_GAP_MINUTES}::int * interval '1 minute'
               then 0 else 1 end as starts
        from ev
        window w as (partition by install_id order by t_client, id)
      ),
      numbered as (
        select *,
          sum(starts) over (partition by install_id order by t_client, id rows unbounded preceding) as session
        from marked
      ),
      views as (select * from numbered where screen is not null),
      exits as (
        select distinct on (install_id, session) screen
        from views
        order by install_id, session, t_client desc, id desc
      ),
      opened as (select distinct install_id, session, screen from views),
      gone as (
        select distinct on (e.install_id) e.props->>'screen' as screen,
          least(e.t_client, e.t_server) >= (select start from bounds) as in_window
        from app_events as e join installs as i on i.id = e.install_id
        where i.last_seen < ${goneBefore}
          and e.name = 'screen_view' and jsonb_typeof(e.props->'screen') = 'string'
        order by e.install_id, e.t_client desc, e.id desc
      )
      select v.screen,
        count(*)::int as views,
        count(distinct v.install_id)::int as installs,
        (select count(*)::int from exits as x where x.screen = v.screen) as exits,
        (select count(*)::int from opened as o where o.screen = v.screen) as opened,
        (select count(*)::int from gone as g where g.screen = v.screen and g.in_window) as gone
      from views as v
      group by v.screen
      order by views desc, v.screen`,
  );
  const screens: AdminScreenStat[] = rows.map((r) => ({
    screen: r.screen,
    views: r.views,
    installs: r.installs,
    exits: r.exits,
    exitRate: r.opened > 0 ? r.exits / r.opened : 0,
    lastScreenOfGone: r.gone,
  }));
  return {
    days: window.days,
    sessionGapMinutes: SESSION_GAP_MINUTES,
    goneAfterDays: GONE_AFTER_DAYS,
    sessions: screens.reduce((sum, s) => sum + s.exits, 0),
    screens,
  };
}
