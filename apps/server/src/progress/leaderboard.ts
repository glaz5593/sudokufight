import { ratingKey } from '@sudoku-fight/engine';
import {
  LEADERBOARD_PAGE_SIZE,
  type Leaderboard,
  type LeaderboardEntry,
  type LeaderboardTab,
  type PublicPlayer,
} from '@sudoku-fight/protocol';
import { type SQL, sql } from 'drizzle-orm';

import { type Db, queryRows } from '../db';
import { encodeLeaderboardCursor, type LeaderboardCursor } from './cursor';
import { publicPlayers } from './players';
import { keysOf, type ProgressSettings } from './settings';

/**
 * The leaderboards (spec §14.2; protocol progress.ts), straight from `ratings`.
 *
 * - A board ranks live accounts (deleted ones never show) with at least one rated game in it: a game-type
 *   tab one rating key (option B: 'normal'; option A: 'normal-2p' for ?players=2, the default, 3 or 4); the
 *   'general' tab each player's highest rating among the keys of the server's option where they have a rated
 *   game [§11.3, D9] (equal ratings: the key with more games, then the first key by name).
 * - Order: rating, best first; equal ratings by user id. Ranks are "1224": equal ratings share a rank, and the
 *   next one counts everyone above (1 + the number of players rated higher).
 * - Pages of LEADERBOARD_PAGE_SIZE, by keyset on (rating, user id) after the cursor (./cursor). The ranks of a
 *   page come from two counts at its first rating, read through the leaderboard indexes
 *   (ratings_board_idx, ratings_general_idx: rated games only, rating descending, then user id).
 * - My row (pinned at the bottom) is my place in the same board, wherever it is, with my exact rank.
 * - The friends tab [D27, V1]: my recent opponents (opponent_history: the last time we met, newest first),
 *   live accounts only, each with their 'general' row; and the invite link (INVITE_URL, null when unset).
 */

/** Recent opponents on the friends tab. */
export const RECENT_OPPONENTS = 20;

export type LeaderboardPlayers = 2 | 3 | 4;

export interface LeaderboardQuery {
  tab: LeaderboardTab;
  /** ?players: only game-type tabs under option A read it (default 2). */
  players: LeaderboardPlayers | null;
  cursor: LeaderboardCursor | null;
}

/** Which rows a board ranks. */
type Board = { kind: 'key'; key: string } | { kind: 'general'; keys: string[] };

interface BoardRow {
  userId: string;
  rating: number;
  games: number;
  provisional: boolean;
}

const inList = (values: readonly string[]): SQL =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/** Is `b` a better row of the same user than `r` (higher rating; then more games; then the first key)? */
const betterRow = sql`(b.rating > r.rating or (b.rating = r.rating and (b.games > r.games or (b.games = r.games and b.rating_key < r.rating_key))))`;

/**
 * The rated rows of live users in the board's keys (for 'general', a user may have several). Deleted accounts
 * are left out against their own small index (users_deleted_idx), not by joining every user.
 */
function ratedRows(board: Board): SQL {
  const keys =
    board.kind === 'key' ? sql`r.rating_key = ${board.key}` : sql`r.rating_key in (${inList(board.keys)})`;
  return sql`from ratings r
    where ${keys} and r.games > 0
      and not exists (select 1 from users d where d.id = r.user_id and d.deleted_at is not null)`;
}

/** The rows of a board: one per live user with a rated game in it (for 'general', their best key). */
function boardRows(board: Board): SQL {
  if (board.kind === 'key') return ratedRows(board);
  return sql`${ratedRows(board)}
      and not exists (select 1 from ratings b
        where b.user_id = r.user_id and b.rating_key in (${inList(board.keys)}) and b.games > 0 and ${betterRow})`;
}

/**
 * Keyset: the rows after the cursor in (rating desc, user id asc) order. The plain `rating <=` is the same
 * condition's index bound: with it the scan starts at the cursor instead of filtering every row above it.
 */
const afterCursor = (c: LeaderboardCursor | null): SQL =>
  c === null
    ? sql``
    : sql` and r.rating <= ${c.rating}::real
        and (r.rating < ${c.rating}::real or (r.rating = ${c.rating}::real and r.user_id > ${c.userId}))`;

async function pageOf(
  db: Db,
  board: Board,
  cursor: LeaderboardCursor | null,
  size: number,
): Promise<BoardRow[]> {
  return queryRows<BoardRow & Record<string, unknown>>(
    db,
    sql`select r.user_id as "userId", r.rating, r.games, r.provisional ${boardRows(board)}${afterCursor(cursor)}
        order by r.rating desc nulls last, r.user_id asc
        limit ${size}`,
  );
}

/**
 * Players on the board rated above `rating`, and at or above it. A player's best rating is above it exactly
 * when one of their rated rows is, so 'general' counts users over all their rows (no best-row search): both
 * boards read only the index range from the top down to `rating`.
 */
async function countsAt(db: Db, board: Board, rating: number): Promise<{ above: number; atOrAbove: number }> {
  const [row] = await queryRows<{ above: number; atOrAbove: number }>(
    db,
    sql`select (count(distinct r.user_id) filter (where r.rating > ${rating}::real))::int as above,
          count(distinct r.user_id)::int as "atOrAbove"
        ${ratedRows(board)} and r.rating >= ${rating}::real`,
  );
  return { above: Number(row?.above ?? 0), atOrAbove: Number(row?.atOrAbove ?? 0) };
}

/** 1 + the players on the board rated above `rating`. */
export async function rankAt(db: Db, board: Board, rating: number): Promise<number> {
  return 1 + (await countsAt(db, board, rating)).above;
}

/**
 * The ranks of a page (rows in board order). The first rating's two counts give every rank on the page:
 * a row at that rating has 1 + above; a lower one has 1 + everyone at or above the first rating (earlier
 * pages included) + the rows of this page between the two.
 */
async function ranksOf(db: Db, board: Board, rows: readonly BoardRow[]): Promise<number[]> {
  const first = rows[0];
  if (first === undefined) return [];
  const { above, atOrAbove } = await countsAt(db, board, first.rating);
  return rows.map((row, i) => {
    if (row.rating === first.rating) return 1 + above;
    const between = rows.slice(0, i).filter((r) => r.rating < first.rating && r.rating > row.rating).length;
    return 1 + atOrAbove + between;
  });
}

/** A user's row on the board, if they are on it. */
async function rowOf(db: Db, board: Board, userId: string): Promise<BoardRow | null> {
  const [row] = await queryRows<BoardRow & Record<string, unknown>>(
    db,
    sql`select r.user_id as "userId", r.rating, r.games, r.provisional ${boardRows(board)} and r.user_id = ${userId}`,
  );
  return row ?? null;
}

const entryOf = (player: PublicPlayer, row: BoardRow, rank: number): LeaderboardEntry => ({
  ...player,
  rank,
  rating: row.rating,
  provisional: row.provisional,
  games: row.games,
});

/** The board of a tab (null for 'friends'), its key and its player count. */
export function boardFor(
  tab: LeaderboardTab,
  players: LeaderboardPlayers | null,
  settings: ProgressSettings,
): { board: Board | null; key: string | null; players: LeaderboardPlayers | null } {
  if (tab === 'friends') return { board: null, key: null, players: null };
  if (tab === 'general')
    return { board: { kind: 'general', keys: keysOf(settings) }, key: null, players: null };
  const count = settings.ratingOption === 'A' ? (players ?? 2) : null;
  const key = ratingKey(tab, count ?? 2, settings.ratingOption);
  return { board: { kind: 'key', key }, key, players: count };
}

async function myEntry(
  db: Db,
  board: Board,
  me: string,
  settings: ProgressSettings,
): Promise<LeaderboardEntry | null> {
  const row = await rowOf(db, board, me);
  if (row === null) return null;
  const [player, rank] = await Promise.all([
    publicPlayers(db, [me], settings).then((m) => m.get(me)),
    rankAt(db, board, row.rating),
  ]);
  return player === undefined ? null : entryOf(player, row, rank);
}

/**
 * The 'general' rows of `userIds`: their best rated key; one without any rated game (a game that ended
 * unrated, e.g. cut by a restart) shows their best rating with 0 games, ranked where that rating would stand.
 */
async function generalRowsOf(
  db: Db,
  userIds: readonly string[],
  keys: readonly string[],
): Promise<Map<string, BoardRow>> {
  const found = new Map<string, BoardRow>();
  if (userIds.length === 0) return found;
  const rows = await queryRows<BoardRow & Record<string, unknown>>(
    db,
    sql`select distinct on (r.user_id) r.user_id as "userId", r.rating, r.games, r.provisional
        from ratings r
        where r.user_id in (${inList(userIds)}) and r.rating_key in (${inList(keys)})
        order by r.user_id, (r.games > 0) desc, r.rating desc, r.games desc, r.rating_key`,
  );
  for (const r of rows) found.set(r.userId, r);
  return found;
}

async function friendsOf(
  db: Db,
  me: string,
  settings: ProgressSettings,
): Promise<NonNullable<Leaderboard['friends']>> {
  const opponents = await queryRows<{ userId: string }>(
    db,
    sql`select o.opponent_id as "userId"
        from opponent_history o join users u on u.id = o.opponent_id
        where o.user_id = ${me} and u.deleted_at is null and o.opponent_id <> ${me}
        group by o.opponent_id
        order by max(o.played_at) desc, o.opponent_id asc
        limit ${RECENT_OPPONENTS}`,
  );
  const ids = opponents.map((o) => o.userId);
  const keys = keysOf(settings);
  const board: Board = { kind: 'general', keys };
  const [players, rows] = await Promise.all([publicPlayers(db, ids, settings), generalRowsOf(db, ids, keys)]);
  // One rank count per distinct rating, all at once (not one round trip after another for 20 opponents).
  const ratingsToRank = [...new Set([...rows.values()].map((r) => r.rating))];
  const rankList = await Promise.all(ratingsToRank.map((rating) => rankAt(db, board, rating)));
  const rankOf = new Map(ratingsToRank.map((rating, i) => [rating, rankList[i]!]));
  const recentOpponents: LeaderboardEntry[] = [];
  for (const id of ids) {
    const player = players.get(id);
    const row = rows.get(id);
    if (player === undefined || row === undefined) continue;
    recentOpponents.push(entryOf(player, row, rankOf.get(row.rating)!));
  }
  return { recentOpponents, inviteUrl: settings.inviteUrl };
}

/** GET /v1/leaderboard for the live account `me`. */
export async function readLeaderboard(
  db: Db,
  me: string,
  query: LeaderboardQuery,
  settings: ProgressSettings,
  pageSize: number = LEADERBOARD_PAGE_SIZE,
): Promise<Leaderboard> {
  const { board, key, players } = boardFor(query.tab, query.players, settings);
  if (board === null) {
    const general: Board = { kind: 'general', keys: keysOf(settings) };
    const [friends, mine] = await Promise.all([
      friendsOf(db, me, settings),
      myEntry(db, general, me, settings),
    ]);
    return {
      tab: 'friends',
      ratingKey: null,
      players: null,
      entries: [],
      me: mine,
      nextCursor: null,
      friends,
    };
  }

  // One more than a page: whether there is a next one.
  const rows = await pageOf(db, board, query.cursor, pageSize + 1);
  const page = rows.slice(0, pageSize);
  const [ranks, hydrated, mine] = await Promise.all([
    ranksOf(db, board, page),
    publicPlayers(
      db,
      page.map((r) => r.userId),
      settings,
    ),
    myEntry(db, board, me, settings),
  ]);
  const entries = page.flatMap((row, i) => {
    const player = hydrated.get(row.userId);
    return player === undefined ? [] : [entryOf(player, row, ranks[i]!)];
  });
  const last = page[page.length - 1];
  return {
    tab: query.tab,
    ratingKey: key,
    players,
    entries,
    me: mine,
    nextCursor:
      rows.length > pageSize && last !== undefined
        ? encodeLeaderboardCursor({ rating: last.rating, userId: last.userId })
        : null,
    friends: null,
  };
}
