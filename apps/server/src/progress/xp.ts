import {
  DEFAULT_PROGRESS_RULES,
  type GameResult,
  levelFor,
  type PlayerId,
  playerLeague,
  type ProgressRules,
  type RatingForLeague,
  xpForGame,
} from '@sudoku-fight/engine';
import type { MyProgress, RecentOutcome } from '@sudoku-fight/protocol';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Db } from '../db';
import { ratings, xp } from '../db/schema';
import { keysOf, type ProgressSettings } from './settings';

/**
 * XP, levels and leagues on the server (spec §11.3, §15) [D38]: the engine's rules (xpForGame, levelFor,
 * playerLeague) applied to the database.
 *
 * What a result is, everywhere the server says it (the player card, its stats and streaks):
 * - a win: first place alone (the engine's place 1 with nobody else at 1);
 * - a tie: first place shared (D16: equal score and mistakes; Elo counts it half a win between them);
 * - a loss: any later place (surrender and abandonment included, spec §6.7 [D32]). The leave guards of §11.2
 *   are about the rating only: XP, wins and losses still go by place, even in a game whose rating they held.
 * XP goes by §15's own words: "מקום 1 במשחק מדורג" earns 50, so a shared first place earns 50 too (it is
 * place 1, and the app's "how to earn XP" says so); every later place earns the 20 of "any other result".
 * Against a bot §15 says "ניצחון", so a tie there earns 20 (./practice).
 */

export function outcomeOf(place: number, shared: boolean): RecentOutcome {
  if (place !== 1) return 'loss';
  return shared ? 'tie' : 'win';
}

export interface XpGain {
  playerId: PlayerId;
  xp: number;
}

/**
 * The XP of every seat of a finished ranked game (§15): 50 for place 1 (shared or not), 20 for any other
 * place, plus a point per correct move (the engine's stats; its ranking's count when a seat has no stats row).
 */
export function rankedXpGains(result: GameResult, rules: ProgressRules = DEFAULT_PROGRESS_RULES): XpGain[] {
  return result.ranking.map((entry) => {
    const correct = result.stats.find((s) => s.playerId === entry.playerId)?.correct ?? entry.correct;
    return {
      playerId: entry.playerId,
      xp: xpForGame({ mode: 'ranked', won: entry.place === 1, correct }, rules),
    };
  });
}

/** By user id: the one order every writer takes players' xp rows in, so two transactions never deadlock. */
const byUserId = (a: { userId: string }, b: { userId: string }) =>
  a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;

/**
 * Locks users' xp rows for the rest of the transaction, making the missing ones (0 XP, level 1): what a
 * daily-cap check holds while it reads what was used and writes what it gives (practice and the levels lock
 * one player's row; the end of a friends game, every account's in it). Rows are taken in user id order, as
 * addXp writes them, so two games ending at once with the same players wait for each other instead of
 * deadlocking.
 */
export async function lockXpRows(db: Db, userIds: readonly string[]): Promise<void> {
  const ids = [...new Set(userIds)].sort();
  if (ids.length === 0) return;
  await db
    .insert(xp)
    .values(ids.map((userId) => ({ userId })))
    .onConflictDoNothing();
  await db
    .select({ userId: xp.userId })
    .from(xp)
    .where(inArray(xp.userId, ids))
    .orderBy(xp.userId)
    .for('update');
}

/**
 * Adds XP to users (one row each in `xp`, made on the first gain) and keeps the stored level equal to
 * levelFor(xp). Call it inside the transaction that records what earned the XP: that transaction's own
 * "already recorded" check is what keeps a retry from adding it twice. Rows are written in user id order
 * (lockXpRows).
 */
export async function addXp(
  db: Db,
  gains: readonly { userId: string; xp: number }[],
  rules: ProgressRules = DEFAULT_PROGRESS_RULES,
): Promise<void> {
  for (const { userId, xp: gained } of [...gains].sort(byUserId)) {
    if (gained <= 0) continue;
    const [row] = await db
      .insert(xp)
      .values({ userId, xp: gained, level: levelFor(gained, rules).level })
      .onConflictDoUpdate({ target: xp.userId, set: { xp: sql`${xp.xp} + excluded.xp` } })
      .returning({ xp: xp.xp, level: xp.level });
    if (row === undefined) throw new Error(`xp row of ${userId} not written`);
    const level = levelFor(row.xp, rules).level;
    if (level !== row.level) await db.update(xp).set({ level }).where(eq(xp.userId, userId));
  }
}

/** Users' total XP (0 for one without a row). */
export async function xpOf(db: Db, userIds: readonly string[]): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  if (userIds.length === 0) return found;
  const rows = await db
    .select({ userId: xp.userId, xp: xp.xp })
    .from(xp)
    .where(inArray(xp.userId, [...userIds]));
  for (const r of rows) found.set(r.userId, r.xp);
  return found;
}

export interface LeagueOf {
  league: MyProgress['league'];
  /** The rating it comes from [D9]; null while every key is provisional. */
  leagueRating: number | null;
}

/** §11.3 [D9]: from the highest rating among the keys past their provisional games; none before that. */
export function leagueOf(rows: readonly RatingForLeague[], rules: ProgressRules): LeagueOf {
  const league = playerLeague(rows, rules);
  if (league === null) return { league: null, leagueRating: null };
  const settled = rows.filter((r) => r.games >= rules.provisionalGames).map((r) => r.rating);
  return { league, leagueRating: Math.max(...settled) };
}

/** Users' rating rows in the keys of the server's option: what their leagues come from. */
export async function leagueRowsOf(
  db: Db,
  userIds: readonly string[],
  settings: Pick<ProgressSettings, 'ratingOption'>,
): Promise<Map<string, RatingForLeague[]>> {
  const found = new Map<string, RatingForLeague[]>();
  if (userIds.length === 0) return found;
  const rows = await db
    .select({ userId: ratings.userId, rating: ratings.rating, games: ratings.games })
    .from(ratings)
    .where(and(inArray(ratings.userId, [...userIds]), inArray(ratings.ratingKey, keysOf(settings))));
  for (const r of rows) {
    const list = found.get(r.userId) ?? [];
    list.push({ rating: r.rating, games: r.games });
    found.set(r.userId, list);
  }
  return found;
}

/** GET /v1/me/progress: XP, level and league. */
export async function readMyProgress(
  db: Db,
  userId: string,
  settings: ProgressSettings,
): Promise<MyProgress> {
  const [total, leagueRows] = await Promise.all([xpOf(db, [userId]), leagueRowsOf(db, [userId], settings)]);
  const xpTotal = total.get(userId) ?? 0;
  const level = levelFor(xpTotal, settings.rules);
  return {
    xp: xpTotal,
    level: level.level,
    xpIntoLevel: level.xpIntoLevel,
    xpForNext: level.xpForNext,
    ...leagueOf(leagueRows.get(userId) ?? [], settings.rules),
  };
}
