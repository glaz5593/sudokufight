import type {
  AdminDayCount,
  AdminFriendRoomCounts,
  AdminFriendRoomRow,
  AdminFriendRooms,
} from '@sudoku-fight/protocol';
import { sql } from 'drizzle-orm';

import { type Db, queryRows } from '../db';
import { FRIENDS_GAME_MODE } from '../db/schema';
import type { FriendRooms } from '../friends/service';
import { localDay, perDaySql, type StatsWindow } from './sql';

/**
 * GET /admin/api/rooms?days=30 (1.0.4; friends-room.md §7.5, spec §27.3 "חדרים"): the friends rooms open right
 * now, as the server's FriendRooms holds them in memory (one machine, fly.toml), and the games played in
 * friends rooms per day (games.mode 'friends', by started_at, in the admin time zone, zero-filled).
 *
 * - No code ever: an admin sees a room (its Colyseus id, state, type, seats, host, age), not the key into it.
 *   Each row is copied field by field, so nothing else the service may hold rides along.
 * - Newest first (openedAt, then the room id).
 * - A server without the service (no database, or the friends rooms off): no open rooms, nothing to count;
 *   the games per day still come from the database.
 */

/** What this page reads of the service. */
export type FriendRoomsView = Pick<FriendRooms, 'openRooms' | 'counts'>;

const NONE: AdminFriendRoomCounts = { lobby: 0, playing: 0 };

function rowOf(r: AdminFriendRoomRow): AdminFriendRoomRow {
  return {
    roomId: r.roomId,
    state: r.state,
    gameType: r.gameType,
    players: r.players,
    maxPlayers: r.maxPlayers,
    hostId: r.hostId,
    hostName: r.hostName,
    openedAt: r.openedAt,
    startedAt: r.startedAt,
  };
}

export async function getFriendRooms(
  db: Db,
  rooms: FriendRoomsView | undefined,
  window: StatsWindow,
): Promise<AdminFriendRooms> {
  const gamesPerDay: AdminDayCount[] = await queryRows<{ day: string; count: number }>(
    db,
    perDaySql(
      window,
      sql`select ${localDay(sql`started_at`, window.tz)} as day from games
          where mode = ${FRIENDS_GAME_MODE} and started_at >= (select start from bounds)`,
    ),
  );
  const open = (rooms?.openRooms() ?? [])
    .map(rowOf)
    .sort((a, b) => b.openedAt - a.openedAt || (a.roomId < b.roomId ? -1 : a.roomId > b.roomId ? 1 : 0));
  const counts = rooms?.counts() ?? NONE;
  return {
    counts: { lobby: counts.lobby, playing: counts.playing },
    rooms: open,
    days: window.days,
    gamesPerDay,
  };
}
