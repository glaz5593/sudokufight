import { randomUUID } from 'node:crypto';

import { INITIAL_RATING, type RatingOption } from '@sudoku-fight/engine';
import {
  type AvatarId,
  type CountryCode,
  isCountryCode,
  type Me,
  normalizeAvatarId,
  normalizeForCompare,
  RENAME_COOLDOWN_MS,
  type RatingEntry,
  ratingKeysFor,
} from '@sudoku-fight/protocol';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';

import type { VerifiedToken } from '../auth/firebaseToken';
import type { Db } from '../db';
import { displayNameKey, installs, ratings, type User, users } from '../db/schema';
import { forgetModeration, keepSuspension, takeSuspension } from '../moderation/store';
import { anonymizeLoggedNames } from '../persistence/records';
import { forgetLevels } from '../progress/levels';

/**
 * The accounts in the database (spec §19): users and their ratings.
 *
 * Unique names are the database's job: the partial unique index users_display_name_key_uq (the normalized
 * name, among accounts not deleted) and the unique firebase_uid. Writes don't look first and then insert
 * (two registrations at once would both pass the look); they insert, and a unique violation becomes `taken`
 * or `alreadyRegistered`.
 */

export const NAME_INDEX = 'users_display_name_key_uq';
export const UID_INDEX = 'users_firebase_uid_unique';

/** The constraint a unique violation (SQLSTATE 23505) broke, from the driver's error or one it caused. */
export function uniqueViolation(err: unknown): string | null {
  for (let e = err, depth = 0; typeof e === 'object' && e !== null && depth < 5; depth++) {
    const { code, constraint, constraint_name: constraintName, cause } = e as Record<string, unknown>;
    if (code === '23505') {
      const name = constraint ?? constraintName;
      return typeof name === 'string' ? name : '';
    }
    e = cause;
  }
  return null;
}

/**
 * When the next rename is allowed (D20), or null when it is allowed now. After an admin reset the name
 * (`nameResetRequired`, spec §3.5) the next rename is free.
 */
export function nextRenameAt(changedAt: Date | null, now: number, nameResetRequired = false): number | null {
  if (changedAt === null || nameResetRequired) return null;
  const next = changedAt.getTime() + RENAME_COOLDOWN_MS;
  return next > now ? next : null;
}

/** The live account of a sign-in (deleted ones have no uid any more), or undefined. */
export async function findLiveUser(db: Db, uid: string): Promise<User | undefined> {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.firebaseUid, uid), isNull(users.deletedAt)));
  return row;
}

/** Someone other than `exceptUserId` has a name that compares equal to `name`. */
export async function isNameTaken(db: Db, name: string, exceptUserId?: string): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        sql`${displayNameKey(users.displayName)} = ${normalizeForCompare(name)}`,
        isNull(users.deletedAt),
        exceptUserId === undefined ? undefined : ne(users.id, exceptUserId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** The ratings of the server's RATING_OPTION; a key without a row yet shows the starting values [D23]. */
async function ratingsOf(db: Db, userId: string, option: RatingOption): Promise<RatingEntry[]> {
  const rows = await db.select().from(ratings).where(eq(ratings.userId, userId));
  const byKey = new Map(rows.map((r) => [r.ratingKey, r]));
  return ratingKeysFor(option).map((key) => {
    const r = byKey.get(key);
    return r === undefined
      ? { key, rating: INITIAL_RATING, games: 0, provisional: true, peak: INITIAL_RATING }
      : { key, rating: r.rating, games: r.games, provisional: r.provisional, peak: r.peak };
  });
}

export async function toMe(
  db: Db,
  user: User,
  token: VerifiedToken,
  option: RatingOption,
  now: number,
): Promise<Me> {
  return {
    id: user.id,
    displayName: user.displayName,
    // An old pack's id (a row older than migration 0004, say from a backup) as its replacement.
    avatarId: normalizeAvatarId(user.avatarId),
    country: isCountryCode(user.country) ? user.country : null,
    email: token.email ?? user.email,
    emailVerified: token.emailVerified,
    createdAt: user.createdAt.getTime(),
    displayNameChangedAt: user.displayNameChangedAt?.getTime() ?? null,
    nextRenameAt: nextRenameAt(user.displayNameChangedAt, now, user.nameResetRequired),
    ratings: await ratingsOf(db, user.id, option),
    nameResetRequired: user.nameResetRequired,
    suspended: user.suspendedAt !== null,
  };
}

export interface NewUser {
  displayName: string;
  avatarId: AvatarId;
  country: CountryCode;
}

export type CreateResult = { ok: true; user: User } | { ok: false; error: 'alreadyRegistered' | 'taken' };

/**
 * A users row for this sign-in, and its ratings at 1200, provisional, for every key of `option` [D7, D23]. A
 * sign-in of a suspended account that was deleted starts suspended (spec §3.5, moderation/store.ts
 * takeSuspension): deleting the account is no way out of a suspension.
 */
export async function createUser(
  db: Db,
  token: VerifiedToken,
  input: NewUser,
  option: RatingOption,
  now: number,
): Promise<CreateResult> {
  const at = new Date(now);
  try {
    const user = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          id: randomUUID(),
          firebaseUid: token.uid,
          displayName: input.displayName,
          avatarId: input.avatarId,
          country: input.country,
          email: token.email,
          createdAt: at,
        })
        .returning();
      if (row === undefined) throw new Error('insert into users returned nothing');
      const suspendedAt = await takeSuspension(tx, row.id, token, now);
      await tx.insert(ratings).values(
        ratingKeysFor(option).map((ratingKey) => ({
          userId: row.id,
          ratingKey,
          rating: INITIAL_RATING,
          games: 0,
          provisional: true,
          peak: INITIAL_RATING,
          updatedAt: at,
        })),
      );
      return suspendedAt === null ? row : { ...row, suspendedAt };
    });
    return { ok: true, user };
  } catch (err) {
    const constraint = uniqueViolation(err);
    if (constraint === UID_INDEX) return { ok: false, error: 'alreadyRegistered' };
    if (constraint === NAME_INDEX) return { ok: false, error: 'taken' };
    throw err;
  }
}

export interface UserChanges {
  displayName?: string;
  avatarId?: AvatarId;
  country?: CountryCode;
}

export type UpdateResult =
  | { ok: true; user: User }
  | { ok: false; error: 'notRegistered' | 'taken' | 'suspended' }
  | { ok: false; error: 'renameTooSoon'; nextRenameAt: number };

/**
 * Changes the live account of `token`: avatar and country any time (D21), the name once in 30 days (D20;
 * the same name again is no change), or at once after an admin reset it (spec §3.5: that rename clears
 * `nameResetRequired`, and the 30 days count from it). The email follows the sign-in's. The row is locked while
 * it is read and written, so two renames at once can't both pass the 30-day check. A suspended account
 * changes nothing (`suspended`; the router answers 403).
 */
export async function updateUser(
  db: Db,
  token: VerifiedToken,
  changes: UserChanges,
  now: number,
): Promise<UpdateResult> {
  try {
    return await db.transaction(async (tx): Promise<UpdateResult> => {
      const [row] = await tx
        .select()
        .from(users)
        .where(and(eq(users.firebaseUid, token.uid), isNull(users.deletedAt)))
        .for('update');
      if (row === undefined) return { ok: false, error: 'notRegistered' };
      if (row.suspendedAt !== null) return { ok: false, error: 'suspended' };

      const set: Partial<typeof users.$inferInsert> = {};
      if (changes.displayName !== undefined && changes.displayName !== row.displayName) {
        const next = nextRenameAt(row.displayNameChangedAt, now, row.nameResetRequired);
        if (next !== null) return { ok: false, error: 'renameTooSoon', nextRenameAt: next };
        set.displayName = changes.displayName;
        set.displayNameChangedAt = new Date(now);
        set.nameResetRequired = false;
      }
      if (changes.avatarId !== undefined && changes.avatarId !== row.avatarId)
        set.avatarId = changes.avatarId;
      if (changes.country !== undefined && changes.country !== row.country) set.country = changes.country;
      if (token.email !== null && token.email !== row.email) set.email = token.email;
      if (Object.keys(set).length === 0) return { ok: true, user: row };

      const [updated] = await tx.update(users).set(set).where(eq(users.id, row.id)).returning();
      return { ok: true, user: updated ?? { ...row, ...set } };
    });
  } catch (err) {
    if (uniqueViolation(err) === NAME_INDEX) return { ok: false, error: 'taken' };
    throw err;
  }
}

/** Keeps the stored email equal to the sign-in's (it changes when the player changes it in Firebase). */
export async function syncEmail(db: Db, user: User, token: VerifiedToken): Promise<User> {
  if (token.email === null || token.email === user.email) return user;
  await db.update(users).set({ email: token.email }).where(eq(users.id, user.id));
  return { ...user, email: token.email };
}

/** The anonymous name of a deleted account: unique, and never a valid display name (it has a colon). */
export const deletedName = () => `deleted:${randomUUID()}`;

/**
 * Deletes the live account of `token` (spec §3.3, §23). The row stays, for the games it played in, with:
 * deleted_at set; an anonymous name, so the old one is free at once; no email, country or avatar; and the
 * Firebase uid replaced by `deleted:<id>`, which unlinks the person and lets the same sign-in register again
 * (Firebase deletes its user right after, but if that fails the player is not locked out). The installs it
 * signed in on are unlinked. Ratings and games stay, under the anonymous row, and the logs of those games
 * get the anonymous name in place of the old one (anonymizeLoggedNames; the privacy policy says the name is
 * replaced). One transaction: all of it, or nothing.
 *
 * The rest of what the server stores has no name in it: game_players, the histories, practice results,
 * cheat flags and XP hold the users.id; app_events props never carry names (the app's analytics events).
 * Staged practice's progress is deleted (1.0.2: user_levels and level_xp_days, progress/levels.ts
 * forgetLevels; the privacy policy says the server's copy goes with the account), while the XP it paid stays,
 * as all XP does. A new account of the same person has a new id, so it starts with no levels.
 *
 * Moderation (spec §3.5, moderation/store.ts forgetModeration): the account's blocks go, both ways; open
 * reports about it are dismissed by `system` (nothing left to act on), while the reports it sent stay, from
 * the anonymous row, for the admins to handle; the admins' audit entries about it stay but lose the names in
 * their details; the suspension and a pending name reset are cleared from the row, but a suspension outlives
 * the deletion as fingerprints of the sign-in (keepSuspension: a new account with it starts suspended).
 * False when there was no live account.
 */
export async function deleteUser(db: Db, token: VerifiedToken, now: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: users.id, suspendedAt: users.suspendedAt })
      .from(users)
      .where(and(eq(users.firebaseUid, token.uid), isNull(users.deletedAt)))
      .for('update');
    if (row === undefined) return false;
    if (row.suspendedAt !== null) await keepSuspension(tx, row.id, row.suspendedAt, token, now);
    await tx
      .update(users)
      .set({
        deletedAt: new Date(now),
        displayName: deletedName(),
        displayNameChangedAt: null,
        email: null,
        country: null,
        avatarId: null,
        firebaseUid: `deleted:${row.id}`,
        suspendedAt: null,
        nameResetRequired: false,
      })
      .where(eq(users.id, row.id));
    await tx.update(installs).set({ userId: null }).where(eq(installs.userId, row.id));
    await anonymizeLoggedNames(tx, { userId: row.id });
    await forgetModeration(tx, row.id, now);
    await forgetLevels(tx, row.id);
    return true;
  });
}

/** The users.id of a sign-in's live account, or null (telemetry: who sent a batch). */
export async function liveUserId(db: Db, uid: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.firebaseUid, uid), isNull(users.deletedAt)));
  return row?.id ?? null;
}
