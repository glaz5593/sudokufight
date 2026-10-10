import {
  type EndReason,
  GAME_MODES,
  type GameEvent,
  type GameMode,
  type GameType,
  isGameType,
  type PlayerStatus,
} from '@sudoku-fight/engine';
import {
  encodeHistoryCursor,
  HISTORY_PAGE_SIZE,
  type HistoryCursor,
  type HistoryGame,
  type HistoryPage,
  type HistoryPlayer,
  isAvatarId,
  isCountryCode,
} from '@sudoku-fight/protocol';
import { and, asc, desc, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';

import type { Db } from '../db';
import { type Game, gameEvents, gamePlayers, games, users } from '../db/schema';

/**
 * The history and replay reads (spec §13, §14.1, §19; protocol history.ts), straight from games,
 * game_players, game_events and users.
 *
 * - A user's games: the finished games they have a seat in, newest first (started_at, then the id, both
 *   descending: a keyset that pages without gaps or repeats while new games arrive), with every seat's final
 *   numbers, rating change and public profile. A deleted account shows no name and no avatar.
 * - A replay: the game as above and its whole log, gameCreated with the solution included; only for a player
 *   of the game, and only once it is over (spec §21).
 */

const PLAYER_STATUSES: readonly PlayerStatus[] = ['active', 'surrendered', 'abandoned'];
const END_REASONS: readonly EndReason[] = ['boardComplete', 'lastPlayerStanding', 'practiceEnded'];

const modeOf = (mode: string): GameMode =>
  GAME_MODES.includes(mode as GameMode) ? (mode as GameMode) : 'ranked';
const typeOf = (type: string): GameType => (isGameType(type) ? type : 'normal');
const statusOf = (status: string): PlayerStatus =>
  PLAYER_STATUSES.includes(status as PlayerStatus) ? (status as PlayerStatus) : 'active';
const endReasonOf = (reason: string | null): EndReason | null =>
  END_REASONS.includes(reason as EndReason) ? (reason as EndReason) : null;

/** The seats of these games with their players' public profiles, by game id, in seat order. */
async function seatsOf(db: Db, gameIds: readonly string[]): Promise<Map<string, HistoryPlayer[]>> {
  const bySeat = new Map<string, HistoryPlayer[]>();
  if (gameIds.length === 0) return bySeat;
  const rows = await db
    .select({
      gameId: gamePlayers.gameId,
      seat: gamePlayers.seat,
      userId: gamePlayers.userId,
      displayName: users.displayName,
      avatarId: users.avatarId,
      country: users.country,
      deletedAt: users.deletedAt,
      score: gamePlayers.finalScore,
      mistakes: gamePlayers.mistakes,
      place: gamePlayers.place,
      status: gamePlayers.status,
      ratingKey: gamePlayers.ratingKey,
      ratingBefore: gamePlayers.ratingBefore,
      ratingAfter: gamePlayers.ratingAfter,
    })
    .from(gamePlayers)
    .leftJoin(users, eq(users.id, gamePlayers.userId))
    .where(inArray(gamePlayers.gameId, [...gameIds]))
    .orderBy(asc(gamePlayers.gameId), asc(gamePlayers.seat));
  for (const r of rows) {
    const live = r.userId !== null && r.deletedAt === null;
    const list = bySeat.get(r.gameId) ?? [];
    list.push({
      seat: r.seat,
      userId: r.userId,
      displayName: live ? r.displayName : null,
      avatarId: live && isAvatarId(r.avatarId) ? r.avatarId : null,
      country: live && isCountryCode(r.country) ? r.country : null,
      score: r.score,
      mistakes: r.mistakes,
      place: r.place,
      status: statusOf(r.status),
      ratingKey: r.ratingKey,
      ratingBefore: r.ratingBefore,
      ratingAfter: r.ratingAfter,
    });
    bySeat.set(r.gameId, list);
  }
  return bySeat;
}

function toHistoryGame(g: Game, seats: HistoryPlayer[], userId: string): HistoryGame | null {
  const mine = seats.find((s) => s.userId === userId);
  if (mine === undefined) return null;
  return {
    id: g.id,
    mode: modeOf(g.mode),
    gameType: typeOf(g.gameType),
    playerCount: g.playerCount,
    startedAt: g.startedAt.getTime(),
    endedAt: g.endedAt?.getTime() ?? null,
    endReason: endReasonOf(g.endReason),
    mySeat: mine.seat,
    players: seats,
  };
}

/** One page of `userId`'s finished games, after `cursor` (the first page without one). */
export async function listUserGames(
  db: Db,
  userId: string,
  cursor: HistoryCursor | null,
  pageSize: number = HISTORY_PAGE_SIZE,
): Promise<HistoryPage> {
  const after =
    cursor === null
      ? undefined
      : or(
          lt(games.startedAt, new Date(cursor.startedAt)),
          and(eq(games.startedAt, new Date(cursor.startedAt)), lt(games.id, cursor.id)),
        );
  const mine = sql`exists (select 1 from ${gamePlayers} where ${gamePlayers.gameId} = ${games.id} and ${gamePlayers.userId} = ${userId})`;
  // One more than a page: whether there is a next one.
  const rows = await db
    .select()
    .from(games)
    .where(and(isNotNull(games.endedAt), mine, after))
    .orderBy(desc(games.startedAt), desc(games.id))
    .limit(pageSize + 1);
  const page = rows.slice(0, pageSize);
  const seats = await seatsOf(
    db,
    page.map((g) => g.id),
  );
  const list = page.flatMap((g) => {
    const game = toHistoryGame(g, seats.get(g.id) ?? [], userId);
    return game === null ? [] : [game];
  });
  const last = page[page.length - 1];
  return {
    games: list,
    nextCursor:
      rows.length > pageSize && last !== undefined
        ? encodeHistoryCursor({ startedAt: last.startedAt.getTime(), id: last.id })
        : null,
  };
}

export type ReplayRead =
  | { kind: 'found'; game: HistoryGame; events: GameEvent[] }
  /** No such game, or `userId` has no seat in it: the same answer, so game ids can't be probed. */
  | { kind: 'notFound' }
  | { kind: 'notFinished' };

/** A stored event as the engine made it: the row's seq, time and type, and the rest from the payload. */
export function eventOf(row: { seq: number; tMs: number; type: string; payload: unknown }): GameEvent {
  const payload = typeof row.payload === 'object' && row.payload !== null ? row.payload : {};
  return { ...payload, type: row.type, seq: row.seq, t: row.tMs } as GameEvent;
}

/**
 * The log as another player may see it: the names in gameCreated of the accounts in `gone` (deleted since)
 * are left out, as everywhere else (spec §3.3: a deleted account's name goes with it).
 */
export function withoutNames(event: GameEvent, gone: ReadonlySet<string>): GameEvent {
  if (event.type !== 'gameCreated' || gone.size === 0) return event;
  const players = event.config.players.map((p) => {
    if (!gone.has(p.id)) return p;
    const { name: _name, ...rest } = p;
    return rest;
  });
  return { ...event, config: { ...event.config, players } };
}

export async function readReplay(db: Db, gameId: string, userId: string): Promise<ReplayRead> {
  const [row] = await db.select().from(games).where(eq(games.id, gameId));
  if (row === undefined) return { kind: 'notFound' };
  const seats = await seatsOf(db, [gameId]);
  const game = toHistoryGame(row, seats.get(gameId) ?? [], userId);
  if (game === null) return { kind: 'notFound' };
  if (row.endedAt === null) return { kind: 'notFinished' };
  const rows = await db
    .select({ seq: gameEvents.seq, tMs: gameEvents.tMs, type: gameEvents.type, payload: gameEvents.payload })
    .from(gameEvents)
    .where(eq(gameEvents.gameId, gameId))
    .orderBy(asc(gameEvents.seq));
  // A seat without a name is an account that is gone (seatsOf): its name leaves the log too.
  const gone = new Set(
    game.players.flatMap((p) => (p.userId !== null && p.displayName === null ? [p.userId] : [])),
  );
  return { kind: 'found', game, events: rows.map((r) => withoutNames(eventOf(r), gone)) };
}
