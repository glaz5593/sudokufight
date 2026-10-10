import { GAME_ROOM_ERRORS, type GameRoomError } from '@sudoku-fight/protocol';

import type { OnlineErrorCode } from '../../../net/errors';
import type { OnlineInfo } from '../../../net/remoteGameHost';
import type { ConnectionStatus, RoomRefusal } from '../connection/connectionModel';

/**
 * What the connection UI shows (connection/connectionModel's ConnectionStatus) for what RemoteGameHost knows
 * of its socket (OnlineInfo). Pure, and nothing decided here: the host says where it stands, the model picks
 * the screen. Times stay in the server's clock (the host's `lostAt`, `resyncedAt`).
 *
 * - connecting (the SDK's create or join) → connecting, step 'server'; in the room but before its first word
 *   → step 'room'; the lobby → the lobby; the game → online (with the last return, for the "synced" banner).
 * - reconnecting → reconnecting with its attempt, or resyncing once a room took the player back.
 * - closed: after the game, or left on purpose → online (the model shows the result, or nothing); a refusal or
 *   a connection that could not come back → failed, with the small support code (spec §16.3). No network and
 *   no answer look the same from here (the app has no network-state module), so both are 'unreachable'.
 */
export function connectionStatusOf(info: OnlineInfo): ConnectionStatus {
  switch (info.status) {
    case 'connecting':
      return { kind: 'connecting', step: 'server' };

    case 'lobby':
      if (info.hasGame) return { kind: 'online', resyncedAt: info.resyncedAt };
      if (!info.lobby || info.playerId === null) return { kind: 'connecting', step: 'room' };
      return { kind: 'lobby', lobby: { ...info.lobby, playerId: info.playerId } };

    case 'live':
      return info.hasGame
        ? { kind: 'online', resyncedAt: info.resyncedAt }
        : { kind: 'connecting', step: 'sync' };

    case 'reconnecting': {
      const r = info.reconnect;
      if (!r) return { kind: 'reconnecting', attempt: 1, lostAt: 0 };
      if (r.resyncing) return { kind: 'resyncing', lostAt: r.lostAt };
      return { kind: 'reconnecting', attempt: Math.max(1, r.attempt), lostAt: r.lostAt };
    }

    case 'closed':
      return closedStatus(info);
  }
}

function closedStatus(info: OnlineInfo): ConnectionStatus {
  const code = info.error?.supportCode ?? info.closeReason ?? 'unknown';
  switch (info.closeReason) {
    case null:
    case 'left':
    case 'gameOver':
      return { kind: 'online', resyncedAt: info.resyncedAt };
    case 'refused': {
      const errorCode = info.error?.code ?? 'unknown';
      if (errorCode === 'network') return { kind: 'failed', failure: 'unreachable', code };
      return { kind: 'failed', failure: 'refused', code, refusal: refusalOf(errorCode) };
    }
    case 'protocol':
      return { kind: 'failed', failure: 'refused', code };
    case 'lostConnection':
    case 'serverClosed':
      return { kind: 'failed', failure: 'lost', code };
  }
}

/** The refusal a screen can explain (connection.error.refusal.*), or null for a general one. */
export function refusalOf(code: OnlineErrorCode): RoomRefusal | null {
  switch (code) {
    case 'notFound':
    case 'badCode':
    case 'roomGone':
      return 'notFound';
    case 'roomFull':
      return 'full';
    default:
      return isGameRoomError(code) ? code : null;
  }
}

const isGameRoomError = (code: string): code is GameRoomError =>
  (GAME_ROOM_ERRORS as readonly string[]).includes(code);
