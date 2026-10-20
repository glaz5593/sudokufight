import type {
  AdminGameDetail,
  AdminGameEvent,
  AdminGamePlayer,
  AdminGameRow,
  AdminPage,
} from '@sudoku-fight/protocol';
import { and, asc, desc, eq, ilike, inArray, or, type SQL, sql } from 'drizzle-orm';

import type { Db } from '../db';
import { type Game, gameEvents, gamePlayers, games, users } from '../db/schema';
import { type GamesQuery, likePattern } from './params';

/**
 * GET /admin/api/games and /games/:id (spec §27.3 "משחקים"): the games on the server, newest first, with
 * their players (score, place, rating change) and, in the detail, the rules and the event log in seq order.
 *
 * The stealth bot (stealth-bot.md §8) [D90]: a game against one is `stealth` (games.stealth), and the seat of
 * its persona is `persona` (users.kind): the tag and the filter of the games page, for the admins only. The
 * filter `stealth` takes only those games (true) or only the others (false).
 */

/** Matches the game id, the puzzle id, and the players' user ids and display names. */
function searchGames(search: string | undefined): SQL | undefined {
  if (search === undefined) return undefined;
  const p = likePattern(search);
  return or(
    ilike(games.id, p),
    ilike(games.puzzleId, p),
    sql`exists (
      select 1 from game_players as gp left join users as u on u.id = gp.user_id
      where gp.game_id = games.id and (gp.user_id ilike ${p} or u.display_name ilike ${p}))`,
  );
}

export async function listGames(db: Db, q: GamesQuery): Promise<AdminPage<AdminGameRow>> {
  const where = and(
    q.mode === undefined ? undefined : eq(games.mode, q.mode),
    q.stealth === undefined ? undefined : eq(games.stealth, q.stealth),
    searchGames(q.search),
  );
  const [rows, counted] = await Promise.all([
    db
      .select()
      .from(games)
      .where(where)
      .orderBy(desc(games.startedAt), asc(games.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db
      .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
      .from(games)
      .where(where),
  ]);
  const players = await playersOf(
    db,
    rows.map((g) => g.id),
  );
  return {
    items: rows.map((g) => toGameRow(g, players.get(g.id) ?? [])),
    page: q.page,
    pageSize: q.pageSize,
    total: counted[0]?.n ?? 0,
  };
}

export async function getGame(db: Db, id: string): Promise<AdminGameDetail | null> {
  const [game] = await db.select().from(games).where(eq(games.id, id));
  if (game === undefined) return null;
  const [players, events] = await Promise.all([playersOf(db, [id]), eventsOf(db, id)]);
  return { ...toGameRow(game, players.get(id) ?? []), rules: game.rules, events };
}

function toGameRow(g: Game, players: AdminGamePlayer[]): AdminGameRow {
  return {
    id: g.id,
    mode: g.mode,
    gameType: g.gameType,
    playerCount: g.playerCount,
    puzzleId: g.puzzleId,
    startedAt: g.startedAt.getTime(),
    endedAt: g.endedAt?.getTime() ?? null,
    endReason: g.endReason,
    stealth: g.stealth,
    players,
  };
}

/** The players of these games, by game id, in seat order. */
async function playersOf(db: Db, gameIds: string[]): Promise<Map<string, AdminGamePlayer[]>> {
  const byGame = new Map<string, AdminGamePlayer[]>();
  if (gameIds.length === 0) return byGame;
  const rows = await db
    .select({
      gameId: gamePlayers.gameId,
      userId: gamePlayers.userId,
      displayName: users.displayName,
      seat: gamePlayers.seat,
      finalScore: gamePlayers.finalScore,
      mistakes: gamePlayers.mistakes,
      place: gamePlayers.place,
      status: gamePlayers.status,
      ratingKey: gamePlayers.ratingKey,
      ratingBefore: gamePlayers.ratingBefore,
      ratingAfter: gamePlayers.ratingAfter,
      // A seat without an account (a practice bot) is no persona.
      persona: sql<boolean>`coalesce(${users.kind} = 'persona', false)`.mapWith(Boolean),
    })
    .from(gamePlayers)
    .leftJoin(users, eq(users.id, gamePlayers.userId))
    .where(inArray(gamePlayers.gameId, gameIds))
    .orderBy(asc(gamePlayers.gameId), asc(gamePlayers.seat));
  for (const { gameId, ...player } of rows) {
    const list = byGame.get(gameId) ?? [];
    list.push(player);
    byGame.set(gameId, list);
  }
  return byGame;
}

async function eventsOf(db: Db, gameId: string): Promise<AdminGameEvent[]> {
  return db
    .select({ seq: gameEvents.seq, tMs: gameEvents.tMs, type: gameEvents.type, payload: gameEvents.payload })
    .from(gameEvents)
    .where(eq(gameEvents.gameId, gameId))
    .orderBy(asc(gameEvents.seq));
}
