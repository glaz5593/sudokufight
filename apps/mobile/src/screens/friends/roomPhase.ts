import type { FriendsEntry, FriendsRoomView } from '../../net/friends';
import { countdownStep } from '../match/matchModel';
import type { FriendsRoomPhase } from './FriendsRoomScreen';
import type { FriendsFailure, FriendsLobby } from './friendsModel';

/**
 * What the friends room's route shows (pure): the room the game store holds, as net/friends.ts draws it
 * (FriendsRoomView), or the way in while there is none yet (creating, a refusal, "לסגור את החדר הקודם?").
 */

/** A way into a room the route itself is waiting on (POST /v1/rooms, /v1/rooms/join), or its refusal. */
export type FriendsEntryState =
  | { kind: 'opening'; via: 'create' | 'join' }
  | {
      kind: 'failed';
      failure: FriendsFailure;
      /** The code tried (a join's), for "לא מצאנו חדר עם הקוד 123 456". */
      code: string | null;
      retryAfterSec: number | null;
      /** What "נסה שוב" does again. */
      retry: 'create' | 'join';
      /** Back to a seat I had, and the game started while I was away [D83]: "המשחק התחיל בלעדיך". */
      startedWithout?: boolean;
    }
  | { kind: 'replace'; openCode: string };

type Refused = Extract<FriendsEntry, { problem: unknown }>;

/** Whole seconds from the server's milliseconds (at least 1), or null. */
const secondsOf = (ms: number | null): number | null =>
  ms === null ? null : Math.max(1, Math.ceil(ms / 1000));

/**
 * A refused way in, as the route keeps it: `tooManyRooms` asks "לסגור את החדר הקודם?" about the lobby I host;
 * anything else is said (§3.6). `code`: the code of a join. `resume`: the way back to a seat I had (the app was
 * closed in the room, §6.5): there `gameStarted` means the game started without me [D83].
 */
export function entryFailure(
  out: Refused,
  code: string | null = null,
  { resume = false }: { resume?: boolean } = {},
): FriendsEntryState {
  if (out.problem === 'tooManyRooms' && out.openCode) return { kind: 'replace', openCode: out.openCode };
  return {
    kind: 'failed',
    failure: out.problem,
    code,
    retryAfterSec: secondsOf(out.retryAfterMs),
    retry: code === null ? 'create' : 'join',
    ...(resume && out.problem === 'gameStarted' && { startedWithout: true }),
  };
}

/** The room's lobby as the screen's model reads it. */
export const lobbyOfView = (room: FriendsRoomView): FriendsLobby => ({
  code: room.code,
  gameType: room.gameType,
  players: room.seats,
  hostId: room.hostId,
  minPlayers: room.minPlayers,
  maxPlayers: room.maxPlayers,
});

/**
 * The screen's phase: the route's own way in first (it is the newer: a room being created replaces the one
 * held), then the room's. `now`: the server's clock, for the 3… 2… 1….
 */
export function roomScreenPhase(
  room: FriendsRoomView | null,
  entry: FriendsEntryState | null,
  now: number,
): FriendsRoomPhase {
  if (entry?.kind === 'opening') return { kind: 'opening', via: entry.via };
  if (entry?.kind === 'replace') return { kind: 'replace', openCode: entry.openCode };
  if (entry?.kind === 'failed')
    return {
      kind: 'failed',
      failure: entry.failure,
      code: entry.code,
      retryAfterSec: entry.retryAfterSec,
      ...(entry.startedWithout && { startedWithout: true }),
    };
  if (!room) return { kind: 'gone' };
  switch (room.phase) {
    case 'connecting':
      return { kind: 'opening', via: 'join' };
    case 'lobby':
    case 'reconnecting':
      return {
        kind: 'lobby',
        lobby: lobbyOfView(room),
        myId: room.meId,
        reconnecting: room.phase === 'reconnecting',
        refused: room.refused
          ? { reason: room.refused.reason, away: room.refused.away, seq: room.refused.seq }
          : null,
      };
    case 'countdown':
      return {
        kind: 'countdown',
        lobby: lobbyOfView(room),
        myId: room.meId,
        step: countdownStep(room.startsAt === null ? 0 : room.startsAt - now),
      };
    case 'game':
      return { kind: 'starting' };
    case 'closed': {
      const closed = room.closed;
      if (closed?.reason) return { kind: 'closed', reason: closed.reason };
      if (closed?.problem)
        return {
          kind: 'failed',
          failure: closed.problem,
          code: room.code,
          retryAfterSec: secondsOf(closed.retryAfterMs),
          // I had a seat (the server named me), and coming back found the game started [D83].
          ...(closed.problem === 'gameStarted' && room.meId !== null && { startedWithout: true }),
        };
      // Left on purpose, or past the game: the route moves on.
      return { kind: 'gone' };
    }
  }
}
