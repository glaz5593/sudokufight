import { type SQL, sql, type SQLWrapper } from 'drizzle-orm';

/**
 * SQL pieces the admin queries share. Every value goes in as a parameter, never spliced into the text.
 *
 * Time:
 * - A "day" is a calendar day in the admin time zone (ADMIN_TZ): `(t at time zone tz)::date`. Sessions run
 *   in UTC (src/db), so 23:30 UTC on the 8th is the 9th in Jerusalem.
 * - A window of `days` runs from local midnight `days − 1` days before today up to now.
 * - When something happened in the app is `least(t_client, t_server)`: the phone's clock, but never later
 *   than the moment the server got it (a phone set to next week doesn't count as active next week). Since that
 *   is never after t_server, `t_server >= start` is a safe extra filter that can use the t_server index.
 */

export interface StatsWindow {
  /** IANA time zone of the days. */
  tz: string;
  /** Epoch ms. */
  now: number;
  /** Days in the window, today included. */
  days: number;
}

/** Epoch ms of a timestamptz, as a float8 (a JS number on both drivers). */
export const epochMs = (expr: SQLWrapper): SQL<number> =>
  sql<number>`(extract(epoch from ${expr}) * 1000)::float8`;

export const timestampOf = (ms: number): SQL => sql`${new Date(ms).toISOString()}::timestamptz`;

/** One row: `today` (a date in tz) and `start` (the window's first local midnight, a timestamptz). */
export function boundsSql({ tz, now, days }: StatsWindow): SQL {
  return sql`
    select today, (today - ${days - 1}::int)::timestamp at time zone ${tz}::text as start
    from (select (${timestampOf(now)} at time zone ${tz}::text)::date as today) as b`;
}

/**
 * Counts per day over the window, zero-filled and oldest first. `source` selects one column `day` (a date in
 * tz), one row per thing counted; it may read the window's start as `(select start from bounds)`.
 */
export function perDaySql(window: StatsWindow, source: SQL): SQL {
  return sql`
    with bounds as (${boundsSql(window)}),
    days as (select b.today - g as day from bounds as b, generate_series(0, ${window.days - 1}::int) as g),
    src as (${source})
    select to_char(d.day, 'YYYY-MM-DD') as day, count(src.day)::int as count
    from days as d left join src on src.day = d.day
    group by d.day
    order by d.day`;
}

/** `(t at time zone tz)::date` */
export const localDay = (expr: SQL | SQLWrapper, tz: string): SQL =>
  sql`(${expr} at time zone ${tz}::text)::date`;

/** The epoch ms of a value that may be null, as the drivers give it (number, numeric string or null). */
export function msOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.getTime();
  return Number(v);
}

export function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}
