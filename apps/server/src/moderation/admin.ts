import {
  ADMIN_REPORTS_PER_PLAYER,
  type AdminAuditAction,
  type AdminAuditEntry,
  type AdminModerationResult,
  type AdminPage,
  type AdminReport,
  type AdminReportedPlayer,
  type AdminReportFilter,
  normalizeAvatarId,
  REPORT_REASONS,
  type ReportReason,
  type ReportStatus,
} from '@sudoku-fight/protocol';
import { desc, eq, sql } from 'drizzle-orm';

import { NAME_INDEX, uniqueViolation } from '../accounts/store';
import type { BlockedWords } from '../accounts/blockedWords';
import { checkName } from '../accounts/names';
import type { AdminIdentity } from '../admin/session';
import { getUserRow } from '../admin/users';
import { type Db, queryRows } from '../db';
import { adminAudit, type AdminAuditRow, type PlayerReport, playerReports, users } from '../db/schema';
import { renameLoggedNames } from '../persistence/records';
import { retireName } from './store';

/**
 * The admin site's moderation (spec §3.5, §27.3; routes in ./adminRoutes, the contract in protocol admin.ts):
 * the reports grouped by player, closing a report, resetting a name, suspending and lifting a suspension.
 * Every action that changes something writes one admin_audit row, in the same transaction as the change.
 */

/** Who did it, as admin_audit and resolved_by keep it: the Google address, or `password`. */
export const adminName = (who: AdminIdentity): string => (who.method === 'google' ? who.email : 'password');

export interface ModerationTools {
  /** The display-name word filter (accounts/blockedWords): a temporary name must pass it too. */
  blockedWords: BlockedWords;
  /** An integer in [0, n): the temporary name's digits. */
  random: (n: number) => number;
}

// ---- the audit log ------------------------------------------------------------------------------------------

type AuditDetails = AdminAuditEntry['details'];

export function toAuditEntry(row: AdminAuditRow): AdminAuditEntry {
  return {
    id: String(row.id),
    adminEmail: row.adminEmail,
    action: row.action,
    targetUserId: row.targetUserId,
    details: row.details,
    createdAt: row.createdAt.getTime(),
  };
}

async function writeAudit(
  db: Db,
  admin: string,
  action: AdminAuditAction,
  targetUserId: string,
  details: AuditDetails,
  now: number,
): Promise<AdminAuditEntry> {
  const [row] = await db
    .insert(adminAudit)
    .values({ adminEmail: admin, action, targetUserId, details, createdAt: new Date(now) })
    .returning();
  if (row === undefined) throw new Error('insert into admin_audit returned nothing');
  return toAuditEntry(row);
}

/** GET /admin/api/audit: newest first. */
export async function listAudit(
  db: Db,
  q: { page: number; pageSize: number },
): Promise<AdminPage<AdminAuditEntry>> {
  const [rows, counted] = await Promise.all([
    db
      .select()
      .from(adminAudit)
      .orderBy(desc(adminAudit.createdAt), desc(adminAudit.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: sql<number>`count(*)::int`.mapWith(Number) }).from(adminAudit),
  ]);
  return { items: rows.map(toAuditEntry), page: q.page, pageSize: q.pageSize, total: counted[0]?.n ?? 0 };
}

// ---- reports ------------------------------------------------------------------------------------------------

const statusMatches = (filter: AdminReportFilter) =>
  filter === 'all' ? sql`true` : sql`pr.status = ${filter}`;

interface ReportRow extends Record<string, unknown> {
  id: string;
  reported_id: string;
  reason: ReportReason;
  status: ReportStatus;
  game_id: string | null;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
  reporter_id: string;
  reporter_name: string;
  reporter_deleted: boolean;
}

function toAdminReport(r: ReportRow): AdminReport {
  return {
    id: r.id,
    playerId: r.reported_id,
    reason: r.reason,
    status: r.status,
    gameId: r.game_id,
    createdAt: Number(r.created_at),
    resolvedAt: r.resolved_at === null ? null : Number(r.resolved_at),
    resolvedBy: r.resolved_by,
    reporter: { id: r.reporter_id, displayName: r.reporter_deleted ? null : r.reporter_name },
  };
}

const reportColumns = sql`pr.id, pr.reported_id, pr.reason, pr.status, pr.game_id,
  (extract(epoch from pr.created_at) * 1000)::float8 as created_at,
  (extract(epoch from pr.resolved_at) * 1000)::float8 as resolved_at,
  pr.resolved_by, pr.reporter_id, ru.display_name as reporter_name,
  (ru.deleted_at is not null) as reporter_deleted`;

/**
 * GET /admin/api/reports: one item per reported player with reports that match the filter: the most different
 * reporters first (one account's many reports count once: up to three open at a time, one per reason), then the
 * most reports, then the newest; with the counts by reason, the player's open reports and the oldest of them,
 * and the newest ADMIN_REPORTS_PER_PLAYER of the matching reports with their reporters.
 */
export async function listReportedPlayers(
  db: Db,
  q: { status: AdminReportFilter; page: number; pageSize: number },
): Promise<AdminPage<AdminReportedPlayer>> {
  const match = statusMatches(q.status);
  const counts = REPORT_REASONS.map(
    (reason) => sql`count(*) filter (where pr.reason = ${reason})::int as ${sql.identifier(reason)}`,
  );
  const groups = await queryRows<
    { reported_id: string; total: number; reporters: number; last: number } & Record<ReportReason, number>
  >(
    db,
    sql`select pr.reported_id, count(*)::int as total, count(distinct pr.reporter_id)::int as reporters,
          ${sql.join(counts, sql`, `)},
          (extract(epoch from max(pr.created_at)) * 1000)::float8 as last
        from player_reports as pr
        where ${match}
        group by pr.reported_id
        order by reporters desc, total desc, last desc, pr.reported_id
        limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`,
  );
  const [counted] = await queryRows<{ n: number }>(
    db,
    sql`select count(distinct pr.reported_id)::int as n from player_reports as pr where ${match}`,
  );
  const total = counted?.n ?? 0;
  if (groups.length === 0) return { items: [], page: q.page, pageSize: q.pageSize, total };

  const ids = groups.map((g) => g.reported_id);
  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  const [players, reports] = await Promise.all([
    queryRows<{
      id: string;
      display_name: string;
      avatar_id: string | null;
      country: string | null;
      deleted_at: number | null;
      suspended_at: number | null;
      name_reset_required: boolean;
      open: number;
      oldest_open: number | null;
    }>(
      db,
      sql`select u.id, u.display_name, u.avatar_id, u.country,
            (extract(epoch from u.deleted_at) * 1000)::float8 as deleted_at,
            (extract(epoch from u.suspended_at) * 1000)::float8 as suspended_at,
            u.name_reset_required,
            (select count(*)::int from player_reports as o
              where o.reported_id = u.id and o.status = 'open') as open,
            (select (extract(epoch from min(o.created_at)) * 1000)::float8 from player_reports as o
              where o.reported_id = u.id and o.status = 'open') as oldest_open
          from users as u where u.id in (${idList})`,
    ),
    queryRows<ReportRow>(
      db,
      sql`select * from (
            select ${reportColumns},
              row_number() over (partition by pr.reported_id order by pr.created_at desc, pr.id) as n
            from player_reports as pr
            join users as ru on ru.id = pr.reporter_id
            where ${match} and pr.reported_id in (${idList})
          ) as r
          where r.n <= ${ADMIN_REPORTS_PER_PLAYER}
          order by r.created_at desc, r.id`,
    ),
  ]);
  const byId = new Map(players.map((p) => [p.id, p]));
  const reportsOf = new Map<string, AdminReport[]>();
  for (const r of reports) {
    const list = reportsOf.get(r.reported_id) ?? [];
    list.push(toAdminReport(r));
    reportsOf.set(r.reported_id, list);
  }
  const items = groups.map((g): AdminReportedPlayer => {
    const p = byId.get(g.reported_id);
    const deleted = p?.deleted_at ?? null;
    return {
      player: {
        id: g.reported_id,
        displayName: p === undefined || deleted !== null ? null : p.display_name,
        avatarId: p === undefined || p.avatar_id === null ? null : normalizeAvatarId(p.avatar_id),
        country: p?.country ?? null,
        deletedAt: deleted === null ? null : Number(deleted),
        suspendedAt: p === undefined || p.suspended_at === null ? null : Number(p.suspended_at),
        nameResetRequired: p?.name_reset_required ?? false,
      },
      counts: {
        offensiveName: g.offensiveName,
        cheating: g.cheating,
        other: g.other,
        total: g.total,
        reporters: g.reporters,
      },
      open: p?.open ?? 0,
      oldestOpenAt: p === undefined || p.oldest_open === null ? null : Number(p.oldest_open),
      lastReportedAt: Number(g.last),
      reports: reportsOf.get(g.reported_id) ?? [],
    };
  });
  return { items, page: q.page, pageSize: q.pageSize, total };
}

/** One report as the admin site shows it, or null. */
export async function getReport(db: Db, id: string): Promise<AdminReport | null> {
  const [row] = await queryRows<ReportRow>(
    db,
    sql`select ${reportColumns} from player_reports as pr join users as ru on ru.id = pr.reporter_id
        where pr.id = ${id}`,
  );
  return row === undefined ? null : toAdminReport(row);
}

export type CloseResult = { ok: true; report: AdminReport } | { ok: false; error: 'notFound' | 'notOpen' };

/** Resolves or dismisses an open report, with its audit entry. */
export async function closeReport(
  db: Db,
  id: string,
  status: 'resolved' | 'dismissed',
  admin: string,
  now: number,
): Promise<CloseResult> {
  const closed = await db.transaction(async (tx): Promise<CloseResult | PlayerReport> => {
    const [row] = await tx.select().from(playerReports).where(eq(playerReports.id, id)).for('update');
    if (row === undefined) return { ok: false, error: 'notFound' };
    if (row.status !== 'open') return { ok: false, error: 'notOpen' };
    await tx
      .update(playerReports)
      .set({ status, resolvedAt: new Date(now), resolvedBy: admin })
      .where(eq(playerReports.id, id));
    const action: AdminAuditAction = status === 'resolved' ? 'resolveReport' : 'dismissReport';
    await writeAudit(tx, admin, action, row.reportedId, { reportId: row.id, reason: row.reason }, now);
    return row;
  });
  if ('ok' in closed) return closed;
  const report = await getReport(db, id);
  if (report === null) throw new Error(`report ${id} is gone`);
  return { ok: true, report };
}

// ---- accounts -----------------------------------------------------------------------------------------------

export type AccountActionResult =
  { ok: true; result: AdminModerationResult } | { ok: false; error: 'notFound' | 'accountDeleted' };

/** The temporary names of a reset: "שחקן" and five digits (3–16 characters, NAME_RULES). */
export const TEMPORARY_NAME_PREFIX = 'שחקן';
export const temporaryName = (random: (n: number) => number): string =>
  `${TEMPORARY_NAME_PREFIX}${10_000 + random(90_000)}`;
/** Draws before giving up (a name taken, or one whose digits read as a blocked word, e.g. 7175 → "tits"). */
export const TEMPORARY_NAME_TRIES = 20;

async function finish(db: Db, userId: string, audit: AdminAuditEntry | null): Promise<AccountActionResult> {
  const user = await getUserRow(db, userId);
  if (user === null) return { ok: false, error: 'notFound' };
  return { ok: true, result: { user, audit } };
}

/**
 * Resets an offensive display name (spec §3.5): a temporary unique name that passes the word filter, and
 * `name_reset_required`, so the app asks for a new name and that rename is free of the 30-day rule. The
 * account's games get the temporary name in their logs (persistence renameLoggedNames: the old name leaves
 * its opponents' replays). The old name is retired (moderation/store.ts retireName): nobody may take it again,
 * this player included, so the free rename can't bring it straight back. The audit entry keeps both names.
 */
export async function resetName(
  db: Db,
  userId: string,
  admin: string,
  now: number,
  tools: ModerationTools,
): Promise<AccountActionResult> {
  for (let attempt = 0; attempt < TEMPORARY_NAME_TRIES; attempt++) {
    const name = temporaryName(tools.random);
    if (!checkName(name, tools.blockedWords).ok) continue;
    try {
      const done = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ displayName: users.displayName, deletedAt: users.deletedAt })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');
        if (row === undefined) return 'notFound' as const;
        if (row.deletedAt !== null) return 'accountDeleted' as const;
        await tx
          .update(users)
          .set({ displayName: name, nameResetRequired: true })
          .where(eq(users.id, userId));
        await retireName(tx, row.displayName, now);
        await renameLoggedNames(tx, userId);
        return writeAudit(tx, admin, 'resetName', userId, { fromName: row.displayName, toName: name }, now);
      });
      if (typeof done === 'string') return { ok: false, error: done };
      return finish(db, userId, done);
    } catch (err) {
      // Someone has this name: draw another.
      if (uniqueViolation(err) !== NAME_INDEX) throw err;
    }
  }
  throw new Error(`no free temporary name after ${TEMPORARY_NAME_TRIES} draws`);
}

/**
 * Suspends the account (no ranked games, no account changes) or lifts the suspension. Suspending a suspended
 * account, or lifting one that isn't, changes nothing and writes no audit entry. A deleted account can't be
 * suspended (`accountDeleted`); lifting is allowed on any (deletion clears it anyway).
 */
export async function setSuspended(
  db: Db,
  userId: string,
  suspend: boolean,
  admin: string,
  now: number,
): Promise<AccountActionResult> {
  const done = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ suspendedAt: users.suspendedAt, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (row === undefined) return 'notFound' as const;
    if (suspend && row.deletedAt !== null) return 'accountDeleted' as const;
    if ((row.suspendedAt !== null) === suspend) return null;
    await tx
      .update(users)
      .set({ suspendedAt: suspend ? new Date(now) : null })
      .where(eq(users.id, userId));
    return writeAudit(tx, admin, suspend ? 'suspend' : 'unsuspend', userId, {}, now);
  });
  if (typeof done === 'string') return { ok: false, error: done };
  return finish(db, userId, done);
}
