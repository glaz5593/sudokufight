import { xpForGame, type XpGame } from '@sudoku-fight/engine';
import type { PracticeResult } from '@sudoku-fight/protocol';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';

import type { Db } from '../db';
import { practiceResults, xp } from '../db/schema';
import type { ProgressSettings } from './settings';
import { addXp } from './xp';

/**
 * Practice XP [D41] (spec §15): practice games (solo, against a bot) are played on the phone, which queues
 * their results while offline and sends them when it can (POST /v1/me/practice-results). The server can't
 * check them, only bound them:
 *
 * - Each result is stored once per account (practice_results, PK user + the phone's id): a resend, or the same
 *   id twice in one batch, is a duplicate and earns nothing.
 * - Plausible only: ended at most PRACTICE_CLOCK_SKEW_MS after the server's now (the phone's clock may run a
 *   little ahead), and at most PRACTICE_MAX_AGE_MS ago. Anything else is `rejected`: not stored, no XP. (The
 *   body's own rules, e.g. correct ≤ 81, are checked before: a malformed batch is a 400.)
 * - XP by the engine's xpForGame: solo 10; bot 50 for a win, 20 otherwise, plus a point per correct move.
 * - The daily cap (PRACTICE_XP_DAILY_CAP): practice earns at most that much per UTC day of the games' ends. A
 *   result past it is still stored (so it stays a duplicate when sent again) with the XP that fit, maybe 0.
 *   Results of a batch are counted in the order they ended (then by id), so the same batch always earns the
 *   same.
 *
 * One transaction per batch, which first locks the player's xp row: two batches of one player at once run
 * one after the other, so neither the duplicate check nor the cap can be passed twice.
 */

const DAY_MS = 24 * 3600 * 1000;

export interface PracticeTally {
  accepted: number;
  duplicates: number;
  rejected: number;
  /** XP the batch earned. */
  xp: number;
}

/** The XP of one practice result, before the cap. */
export function practiceXp(result: PracticeResult, settings: Pick<ProgressSettings, 'rules'>): number {
  const game: XpGame =
    result.mode === 'solo'
      ? { mode: 'solo' }
      : { mode: 'bot', won: result.outcome === 'win', correct: result.correct };
  return xpForGame(game, settings.rules);
}

export async function recordPracticeResults(
  db: Db,
  userId: string,
  results: readonly PracticeResult[],
  now: number,
  settings: ProgressSettings,
): Promise<PracticeTally> {
  return db.transaction(async (tx) => {
    // The lock: the player's xp row, made if it is not there yet.
    await tx.insert(xp).values({ userId }).onConflictDoNothing();
    await tx.select({ userId: xp.userId }).from(xp).where(eq(xp.userId, userId)).for('update');

    const ids = [...new Set(results.map((r) => r.id))];
    const stored =
      ids.length === 0
        ? []
        : await tx
            .select({ id: practiceResults.id })
            .from(practiceResults)
            .where(and(eq(practiceResults.userId, userId), inArray(practiceResults.id, ids)));
    const seen = new Set(stored.map((r) => r.id));

    const usedByDay = new Map<number, number>();
    const usedOn = async (day: number): Promise<number> => {
      const known = usedByDay.get(day);
      if (known !== undefined) return known;
      const [row] = await tx
        .select({ xp: sql<number>`coalesce(sum(${practiceResults.xp}), 0)::int`.mapWith(Number) })
        .from(practiceResults)
        .where(
          and(
            eq(practiceResults.userId, userId),
            gte(practiceResults.endedAt, new Date(day * DAY_MS)),
            lt(practiceResults.endedAt, new Date((day + 1) * DAY_MS)),
          ),
        );
      const used = row?.xp ?? 0;
      usedByDay.set(day, used);
      return used;
    };

    const tally: PracticeTally = { accepted: 0, duplicates: 0, rejected: 0, xp: 0 };
    const rows: (typeof practiceResults.$inferInsert)[] = [];
    const ordered = [...results].sort(
      (a, b) => a.endedAt - b.endedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    for (const result of ordered) {
      if (seen.has(result.id)) {
        tally.duplicates++;
        continue;
      }
      seen.add(result.id);
      if (
        result.endedAt > now + settings.practiceClockSkewMs ||
        result.endedAt < now - settings.practiceMaxAgeMs
      ) {
        tally.rejected++;
        continue;
      }
      const day = Math.floor(result.endedAt / DAY_MS);
      const used = await usedOn(day);
      const earned = Math.min(practiceXp(result, settings), Math.max(0, settings.practiceXpDailyCap - used));
      usedByDay.set(day, used + earned);
      rows.push({
        userId,
        id: result.id,
        mode: result.mode,
        gameType: result.gameType,
        outcome: result.outcome,
        correct: result.correct,
        endedAt: new Date(result.endedAt),
        xp: earned,
        receivedAt: new Date(now),
      });
      tally.accepted++;
      tally.xp += earned;
    }
    if (rows.length > 0) await tx.insert(practiceResults).values(rows);
    await addXp(tx, [{ userId, xp: tally.xp }], settings.rules);
    return tally;
  });
}
