import { createHash } from 'node:crypto';

import {
  DISMISSED_REPORT_COOLDOWN_DAYS,
  MAX_BLOCKS,
  normalizeForCompare,
  REPORTS_PER_HOUR,
  type ReportReason,
} from '@sudoku-fight/protocol';
import { and, asc, count, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { VerifiedToken } from '../auth/firebaseToken';
import type { Db } from '../db';
import {
  adminAudit,
  gamePlayers,
  type PlayerReport,
  playerReports,
  retiredNames,
  suspendedSignIns,
  userBlocks,
  users,
} from '../db/schema';
import type { BlockPair, RoomBlocks, BlockWatch } from './watch';

/**
 * Reports and blocks in the database (spec §3.5; the tables: db/schema.ts player_reports, user_blocks,
 * admin_audit). The routes are ./router (the app) and ./admin (the admin site).
 */

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
/**
 * The server itself, as admin_audit and resolved_by name it: it closes the open reports about an account that
 * is deleted, and carries a suspension to a new account of the same sign-in.
 */
export const SYSTEM_RESOLVER = 'system';

/** The unique violation's code (SQLSTATE 23505), from the driver's error or one it caused. */
function isUniqueViolation(err: unknown): boolean {
  for (let e = err, depth = 0; typeof e === 'object' && e !== null && depth < 5; depth++) {
    if ((e as { code?: unknown }).code === '23505') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** A live account by its users.id: undefined when there is none or it is deleted. */
export async function liveUserById(
  db: Db,
  id: string,
): Promise<{ id: string; suspendedAt: Date | null } | undefined> {
  const [row] = await db
    .select({ id: users.id, suspendedAt: users.suspendedAt })
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)));
  return row;
}

// ---- reports ------------------------------------------------------------------------------------------------

export interface NewReport {
  reporterId: string;
  reportedId: string;
  reason: ReportReason;
  /** As the app sent it; kept only when both players sat in that game. */
  gameId: string | null;
}

export type ReportResult =
  | { ok: true; report: PlayerReport }
  | { ok: false; error: 'duplicate'; reportId: string }
  | { ok: false; error: 'rateLimited'; retryAt: number };

/**
 * The serialization lock on the actor's users row, for a count or a quota checked before an insert. FOR NO KEY
 * UPDATE, not FOR UPDATE: the insert's foreign key check takes FOR KEY SHARE on the *other* player's row, which
 * FOR UPDATE blocks. With FOR UPDATE, two players blocking or reporting each other at the same moment would
 * each hold their own row and wait for the other's: a deadlock, one of them a 500. FOR NO KEY UPDATE still
 * serializes two requests of the same actor (it conflicts with itself), and lets the key checks through.
 */
export async function lockActor(db: Db, userId: string): Promise<void> {
  await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('no key update');
}

/** The open report of this reporter on this player for this reason, if any. */
async function openReportId(db: Db, r: NewReport): Promise<string | undefined> {
  const [row] = await db
    .select({ id: playerReports.id })
    .from(playerReports)
    .where(
      and(
        eq(playerReports.reporterId, r.reporterId),
        eq(playerReports.reportedId, r.reportedId),
        eq(playerReports.reason, r.reason),
        eq(playerReports.status, 'open'),
      ),
    )
    .limit(1);
  return row?.id;
}

/** `gameId` when it names a game both players sat in (a ranked game on this server), else null. */
async function sharedGame(db: Db, gameId: string | null, a: string, b: string): Promise<string | null> {
  if (gameId === null) return null;
  const other = alias(gamePlayers, 'other');
  const [row] = await db
    .select({ gameId: gamePlayers.gameId })
    .from(gamePlayers)
    .innerJoin(other, and(eq(other.gameId, gamePlayers.gameId), eq(other.userId, b)))
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, a)))
    .limit(1);
  return row?.gameId ?? null;
}

/**
 * The same report (reporter, player, reason) dismissed by an admin within DISMISSED_REPORT_COOLDOWN_DAYS, if
 * any: sending it again at once would only put the player back in the queue (a report war).
 */
async function recentlyDismissedId(db: Db, r: NewReport, now: number): Promise<string | undefined> {
  const [row] = await db
    .select({ id: playerReports.id })
    .from(playerReports)
    .where(
      and(
        eq(playerReports.reporterId, r.reporterId),
        eq(playerReports.reportedId, r.reportedId),
        eq(playerReports.reason, r.reason),
        eq(playerReports.status, 'dismissed'),
        gt(playerReports.resolvedAt, new Date(now - DISMISSED_REPORT_COOLDOWN_DAYS * DAY_MS)),
      ),
    )
    .orderBy(desc(playerReports.resolvedAt))
    .limit(1);
  return row?.id;
}

/**
 * Stores a report (the caller checked both accounts). In order: the same report open already, or dismissed in
 * the last DISMISSED_REPORT_COOLDOWN_DAYS → `duplicate` with that report (nothing stored); REPORTS_PER_HOUR
 * stored in the last hour → `rateLimited`, with when the oldest of them is an hour old; else a new open report.
 * The reporter's users row is locked meanwhile (lockActor), so two reports at once can't both pass the count;
 * the partial unique index catches two of the same at once.
 */
export async function createReport(db: Db, input: NewReport, now: number): Promise<ReportResult> {
  try {
    return await db.transaction(async (tx): Promise<ReportResult> => {
      await lockActor(tx, input.reporterId);
      const same = (await openReportId(tx, input)) ?? (await recentlyDismissedId(tx, input, now));
      if (same !== undefined) return { ok: false, error: 'duplicate', reportId: same };
      const recent = await tx
        .select({ createdAt: playerReports.createdAt })
        .from(playerReports)
        .where(
          and(
            eq(playerReports.reporterId, input.reporterId),
            gt(playerReports.createdAt, new Date(now - HOUR_MS)),
          ),
        )
        .orderBy(asc(playerReports.createdAt));
      if (recent.length >= REPORTS_PER_HOUR) {
        // Below the limit again once all but REPORTS_PER_HOUR − 1 of them are more than an hour old.
        const oldest = recent[recent.length - REPORTS_PER_HOUR]!.createdAt.getTime();
        return { ok: false, error: 'rateLimited', retryAt: oldest + HOUR_MS };
      }
      const [report] = await tx
        .insert(playerReports)
        .values({
          reporterId: input.reporterId,
          reportedId: input.reportedId,
          reason: input.reason,
          gameId: await sharedGame(tx, input.gameId, input.reporterId, input.reportedId),
          status: 'open',
          createdAt: new Date(now),
        })
        .returning();
      if (report === undefined) throw new Error('insert into player_reports returned nothing');
      return { ok: true, report };
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // The same report from two requests at once: the other one stored it.
    const open = await openReportId(db, input);
    if (open === undefined) throw err;
    return { ok: false, error: 'duplicate', reportId: open };
  }
}

// ---- blocks -------------------------------------------------------------------------------------------------

/** Whom `blockerId` blocked, newest first. */
export async function listBlocks(
  db: Db,
  blockerId: string,
): Promise<{ blockedId: string; createdAt: Date }[]> {
  return db
    .select({ blockedId: userBlocks.blockedId, createdAt: userBlocks.createdAt })
    .from(userBlocks)
    .where(eq(userBlocks.blockerId, blockerId))
    .orderBy(desc(userBlocks.createdAt), asc(userBlocks.blockedId));
}

export type BlockResult =
  { ok: true; created: boolean; blockedAt: Date } | { ok: false; error: 'limitReached' };

/**
 * Blocks `blockedId` for `blockerId`: a new block (`created`), or the one there already (its time). At most
 * MAX_BLOCKS per blocker (the blocker's row is locked while counting, lockActor, so two at once can't pass it).
 */
export async function addBlock(
  db: Db,
  blockerId: string,
  blockedId: string,
  now: number,
): Promise<BlockResult> {
  return db.transaction(async (tx): Promise<BlockResult> => {
    await lockActor(tx, blockerId);
    const [existing] = await tx
      .select({ createdAt: userBlocks.createdAt })
      .from(userBlocks)
      .where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)));
    if (existing !== undefined) return { ok: true, created: false, blockedAt: existing.createdAt };
    const [counted] = await tx
      .select({ n: count() })
      .from(userBlocks)
      .where(eq(userBlocks.blockerId, blockerId));
    if ((counted?.n ?? 0) >= MAX_BLOCKS) return { ok: false, error: 'limitReached' };
    const blockedAt = new Date(now);
    await tx.insert(userBlocks).values({ blockerId, blockedId, createdAt: blockedAt });
    return { ok: true, created: true, blockedAt };
  });
}

/** Lifts a block; true when there was one. */
export async function removeBlock(db: Db, blockerId: string, blockedId: string): Promise<boolean> {
  const rows = await db
    .delete(userBlocks)
    .where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)))
    .returning({ blockedId: userBlocks.blockedId });
  return rows.length > 0;
}

/** Everyone `userId` blocked or was blocked by (matchmaking: never in one game). */
export async function blockedEitherWay(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ blockerId: userBlocks.blockerId, blockedId: userBlocks.blockedId })
    .from(userBlocks)
    .where(or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)));
  return [...new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)))];
}

/** The blocks among these players (a game room's: whose reactions to mute for whom). */
export async function blocksAmong(db: Db, userIds: readonly string[]): Promise<BlockPair[]> {
  const ids = [...new Set(userIds)];
  if (ids.length < 2) return [];
  return db
    .select({ blockerId: userBlocks.blockerId, blockedId: userBlocks.blockedId })
    .from(userBlocks)
    .where(and(inArray(userBlocks.blockerId, ids), inArray(userBlocks.blockedId, ids)));
}

/** A game room's view of the blocks: the stored ones among its players, and the watch for changes. */
export function roomBlocks(db: Db | (() => Db), watch: BlockWatch): RoomBlocks {
  const database = typeof db === 'function' ? db : () => db;
  return {
    among: (userIds) => blocksAmong(database(), userIds),
    subscribe: (listener) => watch.subscribe(listener),
  };
}

// ---- account deletion ---------------------------------------------------------------------------------------

/**
 * What moderation keeps about an account that is being deleted (accounts/store.ts deleteUser, in its
 * transaction): its blocks go, both ways; the open reports about it are dismissed by `system`; the reports it
 * sent stay (the reporter is the anonymous row now); the admins' audit entries about it stay, without the names
 * in their details.
 */
export async function forgetModeration(db: Db, userId: string, now: number): Promise<void> {
  await db.delete(userBlocks).where(or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)));
  await db
    .update(playerReports)
    .set({ status: 'dismissed', resolvedAt: new Date(now), resolvedBy: SYSTEM_RESOLVER })
    .where(and(eq(playerReports.reportedId, userId), eq(playerReports.status, 'open')));
  await db
    .update(adminAudit)
    .set({ details: sql`${adminAudit.details} - 'fromName' - 'toName'` })
    .where(eq(adminAudit.targetUserId, userId));
}

// ---- names reset away ---------------------------------------------------------------------------------------

/** Retires a name an admin reset away (in resetName's transaction): nobody may take it again. */
export async function retireName(db: Db, name: string, now: number): Promise<void> {
  await db
    .insert(retiredNames)
    .values({ nameKey: normalizeForCompare(name), createdAt: new Date(now) })
    .onConflictDoNothing();
}

/** An admin reset this name away (any case, Hebrew final letters as regular ones): it is `blocked`. */
export async function isRetiredName(db: Db, name: string): Promise<boolean> {
  const [row] = await db
    .select({ key: retiredNames.nameKey })
    .from(retiredNames)
    .where(eq(retiredNames.nameKey, normalizeForCompare(name)))
    .limit(1);
  return row !== undefined;
}

// ---- a suspension outlives the account's deletion -----------------------------------------------------------

/** Domain separation for the fingerprints: the same uid or address hashed elsewhere never matches these. */
const FINGERPRINT_DOMAIN = 'sudoku-fight suspended sign-in v1';

const fingerprint = (kind: 'uid' | 'email', value: string): string =>
  createHash('sha256').update(`${FINGERPRINT_DOMAIN}\n${kind}:${value}`).digest('hex');

/** An address as compared: trimmed, lower case. */
const emailKey = (email: string): string => email.trim().toLowerCase();

/**
 * The fingerprints of a sign-in: its uid's, and its address's. `verifiedOnly`: the address only when the token
 * says it is verified (what is kept: an unverified address may be someone else's); a new account is matched by
 * its address either way (only the address's owner can have verified it before).
 */
export function signInFingerprints(token: VerifiedToken, verifiedOnly: boolean): string[] {
  const prints = [fingerprint('uid', token.uid)];
  const email = token.email === null ? '' : emailKey(token.email);
  if (email !== '' && (token.emailVerified || !verifiedOnly)) prints.push(fingerprint('email', email));
  return prints;
}

/**
 * A suspended account is being deleted (accounts/store.ts deleteUser, in its transaction): its sign-in's
 * fingerprints are kept, so a new account with the same sign-in starts suspended (takeSuspension). Without
 * this, deleting the account and registering again with the same Google sign-in would lift any suspension
 * (Firebase gives the new sign-in a new uid: the verified address is what matches then).
 */
export async function keepSuspension(
  db: Db,
  userId: string,
  suspendedAt: Date,
  token: VerifiedToken,
  now: number,
): Promise<void> {
  const createdAt = new Date(now);
  await db
    .insert(suspendedSignIns)
    .values(
      signInFingerprints(token, true).map((print) => ({
        fingerprint: print,
        userId,
        suspendedAt,
        createdAt,
      })),
    )
    .onConflictDoUpdate({ target: suspendedSignIns.fingerprint, set: { userId, suspendedAt, createdAt } });
}

/**
 * A new account was just made for this sign-in (accounts/store.ts createUser, in its transaction): when the
 * sign-in matches a deleted suspended account, the new one is suspended at once, with an audit entry by
 * `system` naming the deleted account (`previousUserId`) for the admins; that account's fingerprints go (the
 * new account carries the suspension now; deleting it while suspended keeps them again). Returns when the
 * new account was suspended, or null when nothing matched.
 */
export async function takeSuspension(
  db: Db,
  newUserId: string,
  token: VerifiedToken,
  now: number,
): Promise<Date | null> {
  const [match] = await db
    .select({ userId: suspendedSignIns.userId })
    .from(suspendedSignIns)
    .where(inArray(suspendedSignIns.fingerprint, signInFingerprints(token, false)))
    .orderBy(desc(suspendedSignIns.createdAt))
    .limit(1);
  if (match === undefined) return null;
  const at = new Date(now);
  await db.delete(suspendedSignIns).where(eq(suspendedSignIns.userId, match.userId));
  await db.update(users).set({ suspendedAt: at }).where(eq(users.id, newUserId));
  await db.insert(adminAudit).values({
    adminEmail: SYSTEM_RESOLVER,
    action: 'suspend',
    targetUserId: newUserId,
    details: { previousUserId: match.userId },
    createdAt: at,
  });
  return at;
}
