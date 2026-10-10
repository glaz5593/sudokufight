import type {
  AdminCheatFlag,
  AdminPage,
  AdminRating,
  AdminUserDetail,
  AdminUserGame,
  AdminUserRow,
} from '@sudoku-fight/protocol';
import { asc, desc, eq, ilike, or, type SQL, sql } from 'drizzle-orm';

import { type Db, queryRows } from '../db';
import { cheatFlags, gamePlayers, games, ratings, users } from '../db/schema';
import { RECENT_GAMES_LIMIT } from './constants';
import { installsOfUser } from './installs';
import { likePattern, type PageQuery } from './params';
import { epochMs, msOrNull, numOrNull } from './sql';

/**
 * GET /admin/api/users and /users/:id (spec §27.3): accounts with their ratings, games and installs, and in
 * the detail the anomaly flags of their ranked games (spec §21).
 * Deleted accounts stay listed (deletedAt set): their games still point at them.
 */

const lastSeenSql = sql<
  number | null
>`(select ${epochMs(sql`max(i.last_seen)`)} from installs as i where i.user_id = users.id)`;

const userRow = {
  id: users.id,
  displayName: users.displayName,
  email: users.email,
  country: users.country,
  avatarId: users.avatarId,
  createdAt: users.createdAt,
  deletedAt: users.deletedAt,
  lastSeen: lastSeenSql,
  games: sql<number>`(select count(*)::int from game_players as gp where gp.user_id = users.id)`.mapWith(
    Number,
  ),
  // real, not cast: a float8 cast would turn 1287.3 into 1287.300048828125.
  bestRating: sql<number | null>`(select max(r.rating) from ratings as r where r.user_id = users.id)`,
};

function toUserRow(r: {
  id: string;
  displayName: string;
  email: string | null;
  country: string | null;
  avatarId: string | null;
  createdAt: Date;
  deletedAt: Date | null;
  lastSeen: unknown;
  games: number;
  bestRating: unknown;
}): AdminUserRow {
  return {
    ...r,
    createdAt: r.createdAt.getTime(),
    deletedAt: r.deletedAt?.getTime() ?? null,
    lastSeen: msOrNull(r.lastSeen),
    bestRating: numOrNull(r.bestRating),
  };
}

const selectUsers = (db: Db) => db.select(userRow).from(users);

/** Matches the user id, Firebase uid, display name, email and country. */
function searchUsers(search: string | undefined): SQL | undefined {
  if (search === undefined) return undefined;
  const p = likePattern(search);
  return or(
    ilike(users.id, p),
    ilike(users.firebaseUid, p),
    ilike(users.displayName, p),
    ilike(users.email, p),
    ilike(users.country, p),
  );
}

/** Newest activity first; users never seen on an install last, newest account first. */
export async function listUsers(db: Db, q: PageQuery): Promise<AdminPage<AdminUserRow>> {
  const where = searchUsers(q.search);
  const [rows, counted] = await Promise.all([
    selectUsers(db)
      .where(where)
      .orderBy(sql`${lastSeenSql} desc nulls last`, desc(users.createdAt), asc(users.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db
      .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
      .from(users)
      .where(where),
  ]);
  return { items: rows.map(toUserRow), page: q.page, pageSize: q.pageSize, total: counted[0]?.n ?? 0 };
}

export async function getUser(db: Db, id: string): Promise<AdminUserDetail | null> {
  const [row] = await selectUsers(db).where(eq(users.id, id));
  if (row === undefined) return null;
  const [ratingRows, stats, recentGames, installRows, flags] = await Promise.all([
    db.select().from(ratings).where(eq(ratings.userId, id)).orderBy(asc(ratings.ratingKey)),
    statsOf(db, id),
    gamesOf(db, id),
    installsOfUser(db, id),
    flagsOf(db, id),
  ]);
  const userRatings: AdminRating[] = ratingRows.map((r) => ({
    key: r.ratingKey,
    rating: r.rating,
    games: r.games,
    provisional: r.provisional,
    peak: r.peak,
  }));
  return {
    ...toUserRow(row),
    ratings: userRatings,
    stats,
    recentGames,
    installs: installRows,
    cheatFlags: flags,
  };
}

async function flagsOf(db: Db, userId: string): Promise<AdminCheatFlag[]> {
  const rows = await db
    .select({
      gameId: cheatFlags.gameId,
      reason: cheatFlags.reason,
      value: cheatFlags.value,
      createdAt: cheatFlags.createdAt,
    })
    .from(cheatFlags)
    .where(eq(cheatFlags.userId, userId))
    .orderBy(desc(cheatFlags.createdAt), desc(cheatFlags.id))
    .limit(RECENT_GAMES_LIMIT);
  return rows.map((f) => ({ ...f, createdAt: f.createdAt.getTime() }));
}

/**
 * Over every game the user sat in: a win is place 1 (a shared first place too), a loss any later place.
 * Games without a place yet (still running) count in `games` only. winRate = wins / (wins + losses).
 */
async function statsOf(db: Db, userId: string): Promise<AdminUserDetail['stats']> {
  const [s] = await queryRows<{
    games: number;
    wins: number;
    losses: number;
    avgMistakes: number | null;
    avgScore: number | null;
  }>(
    db,
    sql`select
          count(*)::int as games,
          (count(*) filter (where place = 1))::int as wins,
          (count(*) filter (where place > 1))::int as losses,
          avg(mistakes)::float8 as "avgMistakes",
          avg(final_score)::float8 as "avgScore"
        from game_players
        where user_id = ${userId}`,
  );
  const games = s?.games ?? 0;
  const wins = s?.wins ?? 0;
  const losses = s?.losses ?? 0;
  return {
    games,
    wins,
    losses,
    winRate: wins + losses > 0 ? wins / (wins + losses) : null,
    avgMistakes: numOrNull(s?.avgMistakes),
    avgScore: numOrNull(s?.avgScore),
  };
}

async function gamesOf(db: Db, userId: string): Promise<AdminUserGame[]> {
  const rows = await db
    .select({
      gameId: games.id,
      mode: games.mode,
      gameType: games.gameType,
      playerCount: games.playerCount,
      startedAt: games.startedAt,
      endedAt: games.endedAt,
      place: gamePlayers.place,
      finalScore: gamePlayers.finalScore,
      mistakes: gamePlayers.mistakes,
      status: gamePlayers.status,
      ratingKey: gamePlayers.ratingKey,
      ratingBefore: gamePlayers.ratingBefore,
      ratingAfter: gamePlayers.ratingAfter,
    })
    .from(gamePlayers)
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .where(eq(gamePlayers.userId, userId))
    .orderBy(desc(games.startedAt), asc(games.id))
    .limit(RECENT_GAMES_LIMIT);
  return rows.map((g) => ({ ...g, startedAt: g.startedAt.getTime(), endedAt: g.endedAt?.getTime() ?? null }));
}
