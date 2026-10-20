import {
  ADMIN_STEALTH_PATH,
  ADMIN_STEALTH_SWITCH_PATH,
  type AdminDayCount,
  type AdminReturnCount,
  type AdminStealthOverview,
  type AdminStealthSwitch,
  type AdminStealthSwitchResult,
  type AdminWaitStat,
  STEALTH_CLOSE_CALL_SECONDS,
  STEALTH_RETURN_MINUTES,
} from '@sudoku-fight/protocol';
import { sql } from 'drizzle-orm';
import { json, type Request, Router } from 'express';
import { z } from 'zod';

import { type Db, queryRows } from '../db';
import { sendError } from '../http/errors';
import { adminName, recordStealthSwitch } from '../moderation/admin';
import type { StealthSwitch, StealthSwitchState } from '../stealth/switch';
import type { AdminIdentity } from './session';
import { boundsSql, localDay, perDaySql, type StatsWindow, timestampOf } from './sql';

/**
 * The stealth bot on the admin site (stealth-bot.md §8) [D90]: its switch, and its numbers for the overview.
 *
 * The switch (GET /admin/api/stealth, POST /admin/api/stealth/switch): turned here through the server's
 * switch (src/stealth/switch.ts StealthSwitch: kept in server_settings, read by matchmaking on every round),
 * so turning it needs no restart. Off stops new stealth bots at once; the games already running end as usual.
 * STEALTH_BOT_ENABLED (StealthSwitch.available) is the master switch above it: false, the bot does not exist on
 * this server, the site shows no switch, and turning it answers 409 `stealthDisabled`. Turning it is an admin
 * action like the moderation ones (moderation/adminRoutes.ts): a JSON body (`{"on": true}`), a Google session
 * where Google sign-in is offered (403 `googleRequired`), and an admin_audit row (`stealthSwitch`, `{ on }`)
 * when it changed. A server without the switch (an older wiring, a test) answers as if STEALTH_BOT_ENABLED
 * were off.
 *
 * The words differ on the two sides: the site's `enabled` is STEALTH_BOT_ENABLED (the switch's `available`),
 * and its `on` the admin switch (the switch's `enabled`, `on` there too).
 */

/** What the admin site reads and turns of the server's switch (src/stealth/switch.ts). */
export type StealthSwitchControl = Pick<StealthSwitch, 'available' | 'state' | 'set'>;

const OFF: AdminStealthSwitch = { enabled: false, on: false, changedAt: null, changedBy: null };

/** GET /admin/api/stealth. */
export async function getStealthSwitch(
  control: StealthSwitchControl | undefined,
): Promise<AdminStealthSwitch> {
  if (control === undefined || !control.available) return OFF;
  return toSwitch(await control.state());
}

function toSwitch(state: StealthSwitchState): AdminStealthSwitch {
  if (!state.available) return OFF;
  return { enabled: true, on: state.on, changedAt: state.updatedAt, changedBy: state.updatedBy };
}

export interface StealthAdminDeps {
  db: Db;
  now: () => number;
  /** The server's switch; absent, the stealth bot does not exist here (as STEALTH_BOT_ENABLED false). */
  control: StealthSwitchControl | undefined;
  /** The signed-in admin of the request (the session check ran before). */
  adminOf: (req: Request) => AdminIdentity | null;
  /** The server offers Google sign-in: turning the switch wants a Google session. */
  googleRequired: boolean;
}

const switchBody = z.strictObject({ on: z.boolean() });

/** GET /stealth and POST /stealth/switch, mounted by admin/router.ts behind its session check. */
export function stealthAdminRoutes({ db, now, control, adminOf, googleRequired }: StealthAdminDeps): Router {
  const router = Router();

  router.get(ADMIN_STEALTH_PATH, async (_req, res) => {
    res.json(await getStealthSwitch(control));
  });

  router.post(ADMIN_STEALTH_SWITCH_PATH, json({ limit: 1024 }), async (req, res) => {
    const parsed = switchBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        res,
        400,
        'badRequest',
        'send Content-Type: application/json and a body of {"on": true|false}',
      );
    }
    const who = adminOf(req);
    if (who === null) return sendError(res, 401, 'unauthorized');
    if (googleRequired && who.method !== 'google') {
      return sendError(
        res,
        403,
        'googleRequired',
        'admin actions need a Google sign-in (the audit log names the admin)',
      );
    }
    if (control === undefined || !control.available) {
      return sendError(
        res,
        409,
        'stealthDisabled',
        'STEALTH_BOT_ENABLED is off on this server: there is no switch',
      );
    }
    const { on } = parsed.data;
    const admin = adminName(who);
    const before = await control.state();
    const after = await control.set(on, admin);
    // Written after the switch (its own store): a switch turned and not logged beats a log of a turn that failed.
    const audit = before.on === on ? null : await recordStealthSwitch(db, admin, on, now());
    res.json({ switch: toSwitch(after), audit } satisfies AdminStealthSwitchResult);
  });

  return router;
}

// ---- the overview's numbers -----------------------------------------------------------------------------------

/** How long before a game's start a person's "found" counts as the wait of that game. */
const WAIT_LOOKBACK = sql`interval '2 minutes'`;
const RETURN_WITHIN = sql`${STEALTH_RETURN_MINUTES}::int * interval '1 minute'`;
const CLOSE_CALL_WITHIN = sql`${STEALTH_CLOSE_CALL_SECONDS}::int * interval '1 second'`;
const PERSONA = sql`'persona'`;

/**
 * The stealth bot over the window (protocol AdminStealthOverview), for GET /admin/api/overview:
 * - personas: all the personas made so far (not deleted).
 * - rankedGames / stealthGames / stealthPerDay: the ranked games that started in the window, and those of
 *   them against a stealth bot (games.stealth).
 * - wins / losses / winRate: the people's places in the stealth games that ended in the window (a seat of an
 *   account of kind 'person'; place 1 a win, a later place a loss, no place yet neither).
 * - wait: per game and person, the `sec` of the person's latest matchmaking_wait 'found' (from any install of
 *   theirs, or sent signed in as them) in the 2 minutes before the game started, by the phone's clock (never
 *   later than the server got it); split by games against a stealth bot and between people.
 * - reports / blocks: reports about personas and blocks of personas made in the window.
 * - returned: the people's seats in ranked games that ended in the window, at least STEALTH_RETURN_MINUTES
 *   before now (not cut short by a restart), and of them the ones whose player started another game on the
 *   server (ranked or with friends) within those minutes of the end; split the same way.
 * - closeCalls (stealth-bot.md §3.5, "the bot takes games from people"): the stealth games that started in the
 *   window at most STEALTH_CLOSE_CALL_SECONDS after the start of another stealth game of the same game type and
 *   player count, whose person was someone else (that one may have started just before the window).
 */
export async function getStealthOverview(db: Db, window: StatsWindow): Promise<AdminStealthOverview> {
  const bounds = sql`with bounds as (${boundsSql(window)})`;
  const settled = timestampOf(window.now - STEALTH_RETURN_MINUTES * 60_000);
  const [counts, stealthPerDay, results, waits, returns, closeCalls] = await Promise.all([
    queryRows<{
      personas: number;
      rankedGames: number;
      stealthGames: number;
      reports: number;
      blocks: number;
    }>(
      db,
      sql`${bounds}
        select
          (select count(*)::int from users where kind = ${PERSONA} and deleted_at is null) as personas,
          (select count(*)::int from games
            where mode = 'ranked' and started_at >= (select start from bounds)) as "rankedGames",
          (select count(*)::int from games
            where mode = 'ranked' and stealth and started_at >= (select start from bounds)) as "stealthGames",
          (select count(*)::int from player_reports as pr join users as u on u.id = pr.reported_id
            where u.kind = ${PERSONA} and pr.created_at >= (select start from bounds)) as reports,
          (select count(*)::int from user_blocks as b join users as u on u.id = b.blocked_id
            where u.kind = ${PERSONA} and b.created_at >= (select start from bounds)) as blocks`,
    ),
    queryRows<AdminDayCount & Record<string, unknown>>(
      db,
      perDaySql(
        window,
        sql`select ${localDay(sql`started_at`, window.tz)} as day from games
            where mode = 'ranked' and stealth and started_at >= (select start from bounds)`,
      ),
    ),
    queryRows<{ wins: number; losses: number }>(
      db,
      sql`${bounds}
        select (count(*) filter (where gp.place = 1))::int as wins,
               (count(*) filter (where gp.place > 1))::int as losses
        from games as g
        join game_players as gp on gp.game_id = g.id
        join users as u on u.id = gp.user_id
        where g.mode = 'ranked' and g.stealth and u.kind = 'person'
          and g.ended_at >= (select start from bounds)`,
    ),
    queryRows<{ stealth: boolean; games: number; avg: number | null }>(
      db,
      sql`${bounds},
        seats as (
          select g.stealth, g.started_at, gp.user_id
          from games as g
          join game_players as gp on gp.game_id = g.id
          join users as u on u.id = gp.user_id
          where g.mode = 'ranked' and u.kind = 'person' and g.started_at >= (select start from bounds)
        ),
        waits as (
          select s.stealth, (
            select (e.props->>'sec')::float8
            from app_events as e
            left join installs as i on i.id = e.install_id
            where e.name = 'matchmaking_wait'
              and e.props->>'result' = 'found'
              and jsonb_typeof(e.props->'sec') = 'number'
              and (e.user_id = s.user_id or i.user_id = s.user_id)
              and e.t_server >= s.started_at - ${WAIT_LOOKBACK}
              and least(e.t_client, e.t_server) between s.started_at - ${WAIT_LOOKBACK} and s.started_at
            order by least(e.t_client, e.t_server) desc, e.id desc
            limit 1
          ) as sec
          from seats as s
        )
        select stealth, count(sec)::int as games, avg(sec)::float8 as avg
        from waits
        group by stealth`,
    ),
    queryRows<{ stealth: boolean; games: number; returned: number }>(
      db,
      sql`${bounds}
        select g.stealth, count(*)::int as games,
          (count(*) filter (where exists (
            select 1 from game_players as gp2 join games as g2 on g2.id = gp2.game_id
            where gp2.user_id = gp.user_id
              and g2.started_at > g.ended_at and g2.started_at <= g.ended_at + ${RETURN_WITHIN}
          )))::int as returned
        from games as g
        join game_players as gp on gp.game_id = g.id
        join users as u on u.id = gp.user_id
        where g.mode = 'ranked' and u.kind = 'person'
          and g.ended_at >= (select start from bounds) and g.ended_at <= ${settled}
          and g.end_reason is distinct from 'serverRestart'
        group by g.stealth`,
    ),
    queryRows<{ closeCalls: number }>(
      db,
      sql`${bounds},
        seats as (
          select g.id, g.game_type, g.player_count, g.started_at, gp.user_id
          from games as g
          join game_players as gp on gp.game_id = g.id
          join users as u on u.id = gp.user_id
          where g.mode = 'ranked' and g.stealth and u.kind = 'person'
            and g.started_at >= (select start from bounds) - ${CLOSE_CALL_WITHIN}
        )
        select count(distinct s.id)::int as "closeCalls"
        from seats as s
        where s.started_at >= (select start from bounds)
          and exists (
            select 1 from seats as o
            where o.id <> s.id and o.user_id <> s.user_id
              and o.game_type = s.game_type and o.player_count = s.player_count
              and o.started_at <= s.started_at and o.started_at >= s.started_at - ${CLOSE_CALL_WITHIN}
          )`,
    ),
  ]);
  const c = counts[0];
  if (c === undefined) throw new Error('stealth overview: no counts row');
  const wins = results[0]?.wins ?? 0;
  const losses = results[0]?.losses ?? 0;
  const waitOf = (stealth: boolean): AdminWaitStat => {
    const row = waits.find((w) => w.stealth === stealth);
    return { games: row?.games ?? 0, avgSec: row === undefined || row.avg === null ? null : Number(row.avg) };
  };
  const returnOf = (stealth: boolean): AdminReturnCount => {
    const row = returns.find((r) => r.stealth === stealth);
    return { games: row?.games ?? 0, returned: row?.returned ?? 0 };
  };
  return {
    personas: c.personas,
    rankedGames: c.rankedGames,
    stealthGames: c.stealthGames,
    stealthPerDay: stealthPerDay.map((d) => ({ day: d.day, count: d.count })),
    wins,
    losses,
    winRate: wins + losses > 0 ? wins / (wins + losses) : null,
    wait: { stealth: waitOf(true), people: waitOf(false) },
    reports: c.reports,
    blocks: c.blocks,
    returned: { stealth: returnOf(true), people: returnOf(false) },
    closeCalls: closeCalls[0]?.closeCalls ?? 0,
  };
}
