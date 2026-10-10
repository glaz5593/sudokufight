import type { AdminEventRow, AdminInstallDetail, AdminInstallRow, AdminPage } from '@sudoku-fight/protocol';
import { asc, desc, eq, ilike, or, type SQL, sql } from 'drizzle-orm';

import { type Db, queryRows } from '../db';
import { appEvents, installs, users } from '../db/schema';
import { RECENT_EVENTS_LIMIT, RECENT_SESSIONS_LIMIT, SESSION_GAP_MINUTES } from './constants';
import { likePattern, type PageQuery } from './params';

/**
 * GET /admin/api/installs and /installs/:id (spec §27.3 "משתמשים והתקנות"): every install with "last seen",
 * newest activity first. There is no uninstall event (spec §27.1): an old last_seen is how one sees who left.
 */

const installRow = {
  id: installs.id,
  platform: installs.platform,
  appVersion: installs.appVersion,
  firstSeen: installs.firstSeen,
  lastSeen: installs.lastSeen,
  userId: installs.userId,
  userName: users.displayName,
  events: sql<number>`(select count(*)::int from app_events as e where e.install_id = installs.id)`.mapWith(
    Number,
  ),
};

function toInstallRow(r: {
  id: string;
  platform: string;
  appVersion: string;
  firstSeen: Date;
  lastSeen: Date;
  userId: string | null;
  userName: string | null;
  events: number;
}): AdminInstallRow {
  return { ...r, firstSeen: r.firstSeen.getTime(), lastSeen: r.lastSeen.getTime() };
}

function selectInstalls(db: Db) {
  return db.select(installRow).from(installs).leftJoin(users, eq(users.id, installs.userId));
}

/** Matches the install id, platform, app version, and the linked user's id, name and email. */
function searchInstalls(search: string | undefined): SQL | undefined {
  if (search === undefined) return undefined;
  const p = likePattern(search);
  return or(
    ilike(installs.id, p),
    ilike(installs.platform, p),
    ilike(installs.appVersion, p),
    ilike(installs.userId, p),
    ilike(users.displayName, p),
    ilike(users.email, p),
  );
}

export async function listInstalls(db: Db, q: PageQuery): Promise<AdminPage<AdminInstallRow>> {
  const where = searchInstalls(q.search);
  const [rows, counted] = await Promise.all([
    selectInstalls(db)
      .where(where)
      .orderBy(desc(installs.lastSeen), asc(installs.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db
      .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
      .from(installs)
      .leftJoin(users, eq(users.id, installs.userId))
      .where(where),
  ]);
  return { items: rows.map(toInstallRow), page: q.page, pageSize: q.pageSize, total: counted[0]?.n ?? 0 };
}

/** A user's installs, newest activity first. */
export async function installsOfUser(db: Db, userId: string): Promise<AdminInstallRow[]> {
  const rows = await selectInstalls(db)
    .where(eq(installs.userId, userId))
    .orderBy(desc(installs.lastSeen), asc(installs.id));
  return rows.map(toInstallRow);
}

export async function getInstall(db: Db, id: string): Promise<AdminInstallDetail | null> {
  const [row] = await selectInstalls(db).where(eq(installs.id, id));
  if (row === undefined) return null;
  const [recentEvents, sessions] = await Promise.all([eventsOf(db, id), sessionsOf(db, id)]);
  return { ...toInstallRow(row), recentEvents, sessions };
}

async function eventsOf(db: Db, installId: string): Promise<AdminEventRow[]> {
  const rows = await db
    .select()
    .from(appEvents)
    .where(eq(appEvents.installId, installId))
    .orderBy(desc(appEvents.tClient), desc(appEvents.id))
    .limit(RECENT_EVENTS_LIMIT);
  return rows.map((e) => ({
    id: e.id,
    name: e.name,
    props: e.props,
    tClient: e.tClient.getTime(),
    tServer: e.tServer.getTime(),
  }));
}

/**
 * The install's sessions, newest first: a new one starts after SESSION_GAP_MINUTES without events (by the
 * phone's clock, which orders one phone's events well). `screens` are its screen_view screens in order.
 */
export async function sessionsOf(db: Db, installId: string): Promise<AdminInstallDetail['sessions']> {
  const rows = await queryRows<{ startedAt: number; endedAt: number; screens: string[] }>(
    db,
    sql`
      with marked as (
        select id, name, props, t_client,
          case when t_client - lag(t_client) over w <= ${SESSION_GAP_MINUTES}::int * interval '1 minute'
               then 0 else 1 end as starts
        from app_events
        where install_id = ${installId}
        window w as (order by t_client, id)
      ),
      numbered as (
        select *, sum(starts) over (order by t_client, id rows unbounded preceding) as session from marked
      )
      select
        (extract(epoch from min(t_client)) * 1000)::float8 as "startedAt",
        (extract(epoch from max(t_client)) * 1000)::float8 as "endedAt",
        coalesce(
          json_agg(props->>'screen' order by t_client, id)
            filter (where name = 'screen_view' and jsonb_typeof(props->'screen') = 'string'),
          '[]'::json
        ) as screens
      from numbered
      group by session
      order by session desc
      limit ${RECENT_SESSIONS_LIMIT}::int`,
  );
  return rows.map((r) => ({
    startedAt: Number(r.startedAt),
    endedAt: Number(r.endedAt),
    screens: r.screens,
  }));
}
