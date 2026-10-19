import { type LevelRecords, levelNumber, levelsXpEarned, maxLevel, type Stars } from '@sudoku-fight/engine';
import type { LevelBest, MyLevels } from '@sudoku-fight/protocol';
import { eq, sql } from 'drizzle-orm';

import type { Db } from '../db';
import { levelXpDays, userLevels, xp } from '../db/schema';
import { practiceXpUsedOn } from './practice';
import type { ProgressSettings } from './settings';
import { addXp } from './xp';

/**
 * Staged practice's progress on the server (spec §5.3.7, §15; 1.0.2) [D55, D57]: GET and PUT /v1/me/levels
 * (the contract: packages/protocol/src/progress.ts).
 *
 * - The phone sends each level's best (stars, plays); the server keeps the max ever sent per level, the stars
 *   and the plays apart (user_levels). A lower resend changes nothing, and two phones merge into the best of
 *   both. An id above maxLevel(LEVEL_RULES) (a newer app's) is skipped and answered in `unknown`.
 * - Level XP is counted here, from the stored bests: the engine's levelsXpEarned (10 per best star, 50 per open
 *   gate) less all that was paid (level_xp_days). So a resend, or the same star from another phone, pays
 *   nothing, and an XP the phone shows is only its estimate.
 * - The daily cap is practice's (PRACTICE_XP_DAILY_CAP), per UTC day of the server's clock: what practice
 *   results ended that day earned, and what levels were paid that day, together (practiceXpUsedOn). With
 *   levelXpCarryOver (the default) what does not fit is owed (`owedXp`) and paid by a PUT of a later day, an
 *   empty one too; without it, a PUT pays only what it earned itself, as far as the day has room, and the rest
 *   is lost, as practice XP is.
 *
 * One transaction per PUT, which first locks the player's xp row, as practice does: two PUTs of one player,
 * or a PUT and a practice batch, run one after the other, so neither a star nor the cap is counted twice.
 */

const DAY_MS = 24 * 3600 * 1000;

/** The UTC day of an instant, as days since 1970-01-01: level_xp_days.day. */
export const utcDayOf = (t: number): number => Math.floor(t / DAY_MS);

type LevelSettings = Pick<
  ProgressSettings,
  'rules' | 'levelRules' | 'practiceXpDailyCap' | 'levelXpCarryOver'
>;

/** What a PUT did: the merged levels, what it paid, and the ids it skipped. */
export interface LevelsMerge extends MyLevels {
  xp: number;
  unknown: string[];
}

/** A level id's number; an id that is not one (no row has such) sorts last. */
const numberOf = (id: string): number => levelNumber(id) ?? Number.POSITIVE_INFINITY;
const byNumber = (a: LevelBest, b: LevelBest) => numberOf(a.id) - numberOf(b.id);

/**
 * A PUT's levels as the server takes them (ids already checked to be level ids): an id sent twice as its max
 * (stars and plays apart); ids above maxLevel apart (`unknown`, once each, in order); and none with nothing in
 * it (0 stars, 0 plays: no row to keep).
 */
export function sortLevels(
  levels: readonly LevelBest[],
  settings: Pick<ProgressSettings, 'levelRules'>,
): { known: LevelBest[]; unknown: string[] } {
  const last = maxLevel(settings.levelRules);
  const known = new Map<string, LevelBest>();
  const unknown = new Set<string>();
  for (const level of levels) {
    if (numberOf(level.id) > last) {
      unknown.add(level.id);
      continue;
    }
    const seen = known.get(level.id);
    known.set(level.id, {
      id: level.id,
      stars: Math.max(seen?.stars ?? 0, level.stars) as Stars,
      plays: Math.max(seen?.plays ?? 0, level.plays),
    });
  }
  return {
    known: [...known.values()].filter((l) => l.stars > 0 || l.plays > 0).sort(byNumber),
    unknown: [...unknown].sort((a, b) => numberOf(a) - numberOf(b)),
  };
}

/** A player's stored bests, of the levels this server knows, in level order. */
async function storedLevels(db: Db, userId: string, settings: LevelSettings): Promise<LevelBest[]> {
  const rows = await db
    .select({ id: userLevels.levelId, stars: userLevels.bestStars, plays: userLevels.plays })
    .from(userLevels)
    .where(eq(userLevels.userId, userId));
  const last = maxLevel(settings.levelRules);
  return rows
    .filter((r) => numberOf(r.id) <= last)
    .map((r) => ({ id: r.id, stars: r.stars as Stars, plays: r.plays }))
    .sort(byNumber);
}

/** All the level XP a player was ever paid. */
async function paidXpOf(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ xp: sql<number>`coalesce(sum(${levelXpDays.xp}), 0)::int`.mapWith(Number) })
    .from(levelXpDays)
    .where(eq(levelXpDays.userId, userId));
  return row?.xp ?? 0;
}

/** What the levels are worth by now (the engine's count; the server knows no opened chapters but its rows). */
function earnedOf(levels: readonly LevelBest[], settings: LevelSettings): number {
  const records: LevelRecords = Object.fromEntries(
    levels.map((l) => [l.id, { stars: l.stars, plays: l.plays }]),
  );
  return levelsXpEarned(records, [], settings.levelRules, settings.rules);
}

/** The XP still to be paid on a later day: none without the carry-over. */
const owedOf = (earned: number, paid: number, settings: LevelSettings): number =>
  settings.levelXpCarryOver ? Math.max(0, earned - paid) : 0;

/** GET /v1/me/levels: the stored bests and the XP still owed. Reads only: nothing is paid here. */
export async function readMyLevels(db: Db, userId: string, settings: LevelSettings): Promise<MyLevels> {
  const levels = await storedLevels(db, userId, settings);
  const paid = await paidXpOf(db, userId);
  return {
    levels,
    maxLevel: maxLevel(settings.levelRules),
    owedXp: owedOf(earnedOf(levels, settings), paid, settings),
  };
}

/**
 * PUT /v1/me/levels: keeps the max of every level sent, then pays what the levels are owed, as far as today's
 * cap has room. `levels` are checked bodies (the router's schema); `now` is the server's clock.
 */
export async function mergeMyLevels(
  db: Db,
  userId: string,
  levels: readonly LevelBest[],
  now: number,
  settings: LevelSettings,
): Promise<LevelsMerge> {
  const { known, unknown } = sortLevels(levels, settings);
  return db.transaction(async (tx) => {
    // The lock: the player's xp row, made if it is not there yet (practice takes the same one).
    await tx.insert(xp).values({ userId }).onConflictDoNothing();
    await tx.select({ userId: xp.userId }).from(xp).where(eq(xp.userId, userId)).for('update');

    const before = await storedLevels(tx, userId, settings);
    const stored = new Map(before.map((l) => [l.id, l]));
    const better = known.filter((l) => {
      const was = stored.get(l.id);
      return was === undefined || l.stars > was.stars || l.plays > was.plays;
    });
    if (better.length > 0)
      await tx
        .insert(userLevels)
        .values(
          better.map((l) => ({
            userId,
            levelId: l.id,
            bestStars: l.stars,
            plays: l.plays,
            updatedAt: new Date(now),
          })),
        )
        .onConflictDoUpdate({
          target: [userLevels.userId, userLevels.levelId],
          set: {
            bestStars: sql`greatest(${userLevels.bestStars}, excluded.best_stars)`,
            plays: sql`greatest(${userLevels.plays}, excluded.plays)`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    for (const l of better) {
      const was = stored.get(l.id);
      stored.set(l.id, {
        id: l.id,
        stars: Math.max(was?.stars ?? 0, l.stars) as Stars,
        plays: Math.max(was?.plays ?? 0, l.plays),
      });
    }
    const after = [...stored.values()].sort(byNumber);

    const earned = earnedOf(after, settings);
    const paid = await paidXpOf(tx, userId);
    // Due now: all that is unpaid (the carry-over), or only what this PUT itself earned.
    const unpaid = Math.max(0, earned - paid);
    const due = settings.levelXpCarryOver
      ? unpaid
      : Math.min(unpaid, Math.max(0, earned - earnedOf(before, settings)));
    const day = utcDayOf(now);
    const room =
      due === 0 ? 0 : Math.max(0, settings.practiceXpDailyCap - (await practiceXpUsedOn(tx, userId, day)));
    const given = Math.min(due, room);
    if (given > 0) {
      await tx
        .insert(levelXpDays)
        .values({ userId, day, xp: given })
        .onConflictDoUpdate({
          target: [levelXpDays.userId, levelXpDays.day],
          set: { xp: sql`${levelXpDays.xp} + excluded.xp` },
        });
      await addXp(tx, [{ userId, xp: given }], settings.rules);
    }
    return {
      levels: after,
      maxLevel: maxLevel(settings.levelRules),
      owedXp: owedOf(earned, paid + given, settings),
      xp: given,
      unknown,
    };
  });
}

/** Account deletion (accounts/store.ts deleteUser): the player's levels and level XP days go; the XP stays. */
export async function forgetLevels(db: Db, userId: string): Promise<void> {
  await db.delete(userLevels).where(eq(userLevels.userId, userId));
  await db.delete(levelXpDays).where(eq(levelXpDays.userId, userId));
}
