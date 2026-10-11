import {
  type GameType,
  INITIAL_RATING,
  INTERFERENCE_KINDS,
  type InterferenceKind,
  isGameType,
  levelFor,
} from '@sudoku-fight/engine';
import {
  FAVORITE_INTERFERENCE_GAMES,
  type FavoriteInterference,
  PLAYER_CARD_RECENT,
  type PlayerCard,
  type PlayerStats,
  type RatingSummary,
  type RecentResult,
} from '@sudoku-fight/protocol';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { type Db, queryRows } from '../db';
import { achievements, ratings, userAchievements, users } from '../db/schema';
import { publicPlayers } from './players';
import { keysOf, type ProgressSettings } from './settings';
import { outcomeOf, xpOf } from './xp';

/**
 * A player card (spec §14.3; protocol PlayerCard): public data only, for any live account (a deleted one is
 * not found).
 *
 * - Ratings: every key of the server's option (3 under B, 9 under A); a key without a row shows the start
 *   [D23]. Each with its peak, and its trend: the rating after each of the last TREND_GAMES games that moved
 *   it, oldest first (game_players.rating_after).
 * - Stats and recent results: the player's finished ranked games (a game cut short by a restart has no place
 *   and does not count). A win, a tie and a loss as in ./xp (outcomeOf): win % = wins / games; the current
 *   and best streaks are runs of wins [D28] (a tie or a loss ends one); the best move is the highest
 *   best_move_points (stored from stage 12 on; equal points: the earlier game); mistakes are averaged over the
 *   games.
 * - Achievements: earned ones, newest first (none until the list is approved: docs/ACHIEVEMENTS-PROPOSAL.md).
 * - "במשחק מאז": users.created_at.
 * - The favourite interference: counted from the stored events of the player's last
 *   FAVORITE_INTERFERENCE_GAMES ended ranked games (game_events of type 'interference' with the player as
 *   fromId; a game cut short by a restart counts what was sent before it). The query walks the player's own
 *   games (game_players_user_idx) and each game's events by its primary key, so its cost is bounded by the
 *   window, with no new column to keep. Most sent first; equal counts: the one sent last.
 */

/** Rating points on a trend line, per key. */
export const TREND_GAMES = 20;

export interface CardResult {
  gameId: string;
  gameType: GameType;
  players: number;
  place: number;
  shared: boolean;
  score: number;
  mistakes: number | null;
  bestMove: number | null;
  ratingBefore: number | null;
  ratingAfter: number | null;
  endedAt: number;
}

/** The stats of a player's results (newest first). */
export function statsOf(results: readonly CardResult[]): PlayerStats {
  const outcomes = results.map((r) => outcomeOf(r.place, r.shared));
  const wins = outcomes.filter((o) => o === 'win').length;
  const losses = outcomes.filter((o) => o === 'loss').length;

  let streak = 0;
  while (streak < outcomes.length && outcomes[streak] === 'win') streak++;
  let bestStreak = 0;
  let run = 0;
  for (const o of outcomes) {
    run = o === 'win' ? run + 1 : 0;
    bestStreak = Math.max(bestStreak, run);
  }

  let bestMove: PlayerStats['bestMove'] = null;
  // Newest first: `>=` lets an older game with the same points take it (the record was set there).
  for (const r of results)
    if (r.bestMove !== null && (bestMove === null || r.bestMove >= bestMove.points))
      bestMove = { points: r.bestMove, gameId: r.gameId };

  const mistakes = results.flatMap((r) => (r.mistakes === null ? [] : [r.mistakes]));
  return {
    games: results.length,
    wins,
    losses,
    winRate: results.length > 0 ? wins / results.length : null,
    streak,
    bestStreak,
    bestMove,
    avgMistakes: mistakes.length > 0 ? mistakes.reduce((a, b) => a + b, 0) / mistakes.length : null,
  };
}

export function recentOf(results: readonly CardResult[], limit = PLAYER_CARD_RECENT): RecentResult[] {
  return results.slice(0, limit).map((r) => ({
    gameId: r.gameId,
    gameType: r.gameType,
    players: r.players,
    place: r.place,
    outcome: outcomeOf(r.place, r.shared),
    score: r.score,
    ratingDelta: r.ratingBefore !== null && r.ratingAfter !== null ? r.ratingAfter - r.ratingBefore : null,
    endedAt: r.endedAt,
  }));
}

type ResultRow = Omit<CardResult, 'gameType'> & { gameType: string; score: number | null };

/** A player's finished ranked games, newest first. */
async function resultsOf(db: Db, userId: string): Promise<CardResult[]> {
  const rows = await queryRows<ResultRow & Record<string, unknown>>(
    db,
    sql`select gp.game_id as "gameId", g.game_type as "gameType", g.player_count::int as players,
          gp.place::int as place, gp.final_score as score, gp.mistakes, gp.best_move_points as "bestMove",
          gp.rating_before as "ratingBefore", gp.rating_after as "ratingAfter",
          (extract(epoch from g.ended_at) * 1000)::float8 as "endedAt",
          exists (select 1 from game_players o
                  where o.game_id = gp.game_id and o.seat <> gp.seat and o.place = gp.place) as shared
        from game_players gp join games g on g.id = gp.game_id
        where gp.user_id = ${userId} and g.mode = 'ranked' and g.ended_at is not null and gp.place is not null
        order by g.ended_at desc, g.id desc`,
  );
  return rows.map((r) => ({
    ...r,
    gameType: isGameType(r.gameType) ? r.gameType : 'normal',
    score: r.score ?? 0,
    endedAt: Math.round(Number(r.endedAt)),
  }));
}

/** Every key's trend: rating_after of its last TREND_GAMES rated games, oldest first. */
async function trendsOf(db: Db, userId: string, keys: readonly string[]): Promise<Map<string, number[]>> {
  const rows = await queryRows<{ key: string; rating: number }>(
    db,
    sql`select key, rating from (
          select gp.rating_key as key, gp.rating_after as rating, g.ended_at, g.id,
                 row_number() over (partition by gp.rating_key order by g.ended_at desc, g.id desc) as n
          from game_players gp join games g on g.id = gp.game_id
          where gp.user_id = ${userId} and gp.rating_key in (${sql.join(
            keys.map((k) => sql`${k}`),
            sql`, `,
          )})
            and gp.rating_after is not null and g.ended_at is not null
        ) t
        where n <= ${TREND_GAMES}
        order by key, ended_at asc, id asc`,
  );
  const trends = new Map<string, number[]>();
  for (const r of rows) trends.set(r.key, [...(trends.get(r.key) ?? []), Number(r.rating)]);
  return trends;
}

async function ratingsOf(db: Db, userId: string, keys: readonly string[]): Promise<RatingSummary[]> {
  const [rows, trends] = await Promise.all([
    db
      .select()
      .from(ratings)
      .where(and(eq(ratings.userId, userId), inArray(ratings.ratingKey, [...keys]))),
    trendsOf(db, userId, keys),
  ]);
  const byKey = new Map(rows.map((r) => [r.ratingKey, r]));
  return keys.map((key) => {
    const r = byKey.get(key);
    const trend = trends.get(key) ?? [];
    return r === undefined
      ? { key, rating: INITIAL_RATING, peak: INITIAL_RATING, games: 0, provisional: true, trend }
      : { key, rating: r.rating, peak: r.peak, games: r.games, provisional: r.provisional, trend };
  });
}

async function achievementsOf(db: Db, userId: string): Promise<PlayerCard['achievements']> {
  const rows = await db
    .select({ key: achievements.key, earnedAt: userAchievements.earnedAt })
    .from(userAchievements)
    .innerJoin(achievements, eq(achievements.id, userAchievements.achievementId))
    .where(eq(userAchievements.userId, userId))
    .orderBy(desc(userAchievements.earnedAt), achievements.key);
  return rows.map((r) => ({ key: r.key, earnedAt: r.earnedAt.getTime() }));
}

const isInterferenceKind = (v: unknown): v is InterferenceKind =>
  (INTERFERENCE_KINDS as readonly unknown[]).includes(v);

/** The interference the player sent most in their last FAVORITE_INTERFERENCE_GAMES ranked games; null: none. */
export async function favoriteInterferenceOf(db: Db, userId: string): Promise<FavoriteInterference | null> {
  const rows = await queryRows<{ kind: string | null; count: number }>(
    db,
    sql`with recent as (
          select g.id from game_players gp join games g on g.id = gp.game_id
          where gp.user_id = ${userId} and g.mode = 'ranked' and g.ended_at is not null
          order by g.ended_at desc, g.id desc
          limit ${FAVORITE_INTERFERENCE_GAMES}
        )
        select e.payload->>'kind' as kind, count(*)::int as count
        from recent r join game_events e on e.game_id = r.id
        where e.type = 'interference' and e.payload->>'fromId' = ${userId}
        group by 1
        order by count(*) desc, max(e.t_ms) desc, 1`,
  );
  const top = rows.find((r) => isInterferenceKind(r.kind));
  return top && isInterferenceKind(top.kind) ? { kind: top.kind, count: Number(top.count) } : null;
}

async function joinedAtOf(db: Db, userId: string): Promise<number | null> {
  const [row] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
  return row ? row.createdAt.getTime() : null;
}

/** GET /v1/players/:id; null for no such live account. */
export async function readPlayerCard(
  db: Db,
  userId: string,
  settings: ProgressSettings,
): Promise<PlayerCard | null> {
  const player = (await publicPlayers(db, [userId], settings)).get(userId);
  if (player === undefined) return null;
  const keys = keysOf(settings);
  const [xpTotals, ratingList, results, earned, joinedAt, favoriteInterference] = await Promise.all([
    xpOf(db, [userId]),
    ratingsOf(db, userId, keys),
    resultsOf(db, userId),
    achievementsOf(db, userId),
    joinedAtOf(db, userId),
    favoriteInterferenceOf(db, userId),
  ]);
  const xp = xpTotals.get(userId) ?? 0;
  return {
    ...player,
    joinedAt,
    level: levelFor(xp, settings.rules).level,
    xp,
    ratings: ratingList,
    stats: statsOf(results),
    favoriteInterference,
    recent: recentOf(results),
    achievements: earned,
  };
}
