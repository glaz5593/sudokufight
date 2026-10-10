import { matchMaker } from '@colyseus/core';
import { GAME_ROOM_NAME } from '@sudoku-fight/protocol';

import { RANKED_MATCH_OPTION } from './ranked';
import type { MatchGames, OpenedMatch } from './service';

/**
 * Opens a match's ranked game room with Colyseus's matchmaker: the room is created on the server (its
 * onCreate claims the match: ranked.ts), then a seat is reserved for each player with their identity as the
 * seat's auth, so the room knows them without another token check, and nobody else gets in. Each player gets
 * their reservation in `found` and joins with `client.consumeSeatReservation()`.
 */
export function colyseusMatchGames(roomName = GAME_ROOM_NAME): MatchGames {
  return {
    async open(match): Promise<OpenedMatch> {
      const room = await matchMaker.createRoom(roomName, { [RANKED_MATCH_OPTION]: match.id });
      const reservations = new Map<string, Awaited<ReturnType<typeof matchMaker.reserveSeatFor>>>();
      for (const player of match.players) {
        const identity = { userId: player.userId, name: player.name };
        reservations.set(player.userId, await matchMaker.reserveSeatFor(room, {}, identity));
      }
      return { roomId: room.roomId, reservations };
    },
  };
}
