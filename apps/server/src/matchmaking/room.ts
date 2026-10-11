import {
  type AuthContext,
  type Client,
  CloseCode,
  ErrorCode,
  Room,
  type RoomException,
  type RoomMethodName,
  ServerError,
} from '@colyseus/core';
import type { MatchmakingError, MatchmakingServerMessage } from '@sudoku-fight/protocol';

import { IdentityError, type IdentityVerifier, isIdentity } from '../auth';
import { reportError } from '../monitoring/report';
import { type GameRoomLog, logRoomException } from '../rooms/GameRoom';
import { MatchmakingRefusal, type MatchmakingService, type MatchSession } from './service';

/**
 * The `matchmaking` room (stage 9, spec §10): the players' connection to matchmaking. All the logic is in
 * the MatchmakingService, one per process, shared by every matchmaking room (Colyseus opens another room
 * when one is full; the queues are the service's, not a room's).
 *
 * `client.joinOrCreate('matchmaking', { queueKey })` with the account's ID token as `client.auth.token`:
 * the static onAuth checks the token (registered players only), onJoin puts the player in the queue.
 * Messages: `cancel`, `keepSearching`, `ping` (protocol: MatchmakingClientMessage). Leaving the room while
 * searching cancels the search; after "found" it changes nothing [D32].
 */

export interface MatchmakingRoomDeps {
  service: MatchmakingService;
  identity: IdentityVerifier;
  log: GameRoomLog;
  /** Connections per room (Colyseus opens another room beyond it). */
  maxClients: number;
  /** All messages together; above it Colyseus disconnects the client. */
  maxMessagesPerSecond: number;
}

export const MATCHMAKING_ROOM_DEFAULTS = { maxClients: 500, maxMessagesPerSecond: 10 } as const;

const refuse = (code: number, error: MatchmakingError, text: string) =>
  new ServerError(code, `${error}: ${text}`);

export function createMatchmakingRoom(deps: MatchmakingRoomDeps) {
  return class BoundMatchmakingRoom extends MatchmakingRoom {
    protected override readonly deps = deps;

    static override async onAuth(token: string | undefined, options: unknown, context: AuthContext) {
      try {
        return await deps.identity.verify({ token: token || undefined, options, ip: context.ip });
      } catch (error) {
        if (error instanceof IdentityError) {
          // A registered player who has to verify the email first (D22): the app sends them to do it.
          const refusal = error.code === 'emailNotVerified' ? 'emailNotVerified' : 'unauthenticated';
          throw refuse(ErrorCode.AUTH_FAILED, refusal, error.message);
        }
        // Not a refusal: the check itself failed (the database, Google's keys). Colyseus tells the client.
        reportError(error, { area: 'rooms', message: '[matchmaking] onAuth failed' });
        throw error;
      }
    }
  };
}

export abstract class MatchmakingRoom extends Room {
  protected abstract readonly deps: MatchmakingRoomDeps;

  override onCreate(): void {
    this.maxClients = this.deps.maxClients;
    this.maxMessagesPerSecond = this.deps.maxMessagesPerSecond;
    this.onMessage('cancel', (client: Client) => this.deps.service.cancel(client.sessionId));
    this.onMessage('keepSearching', (client: Client) => this.deps.service.keepSearching(client.sessionId));
    this.onMessage('ping', (client: Client, message: unknown) => {
      const t = (message as { t?: unknown } | null)?.t;
      if (typeof t !== 'number' || !Number.isFinite(t)) return;
      this.sendTo(client, { type: 'pong', t, serverTime: this.deps.service.now() });
    });
    // Anything else is dropped.
    this.onMessage('*', () => undefined);
  }

  override async onJoin(client: Client, options: unknown): Promise<void> {
    const identity: unknown = client.auth;
    if (!isIdentity(identity)) throw refuse(ErrorCode.AUTH_FAILED, 'unauthenticated', 'no identity');
    const queueKey = (typeof options === 'object' && options !== null ? options : {}) as {
      queueKey?: unknown;
    };
    const session: MatchSession = {
      id: client.sessionId,
      send: (message) => this.sendTo(client, message),
      close: () => client.leave(CloseCode.CONSENTED),
    };
    try {
      await this.deps.service.enqueue(session, identity, queueKey.queueKey);
    } catch (error) {
      if (error instanceof MatchmakingRefusal) {
        const code = error.error === 'unauthenticated' ? ErrorCode.AUTH_FAILED : ErrorCode.APPLICATION_ERROR;
        throw refuse(code, error.error, error.message);
      }
      this.deps.log.error(`[matchmaking] ${identity.userId} could not join`, error);
      throw error;
    }
  }

  override onLeave(client: Client): void {
    this.deps.service.left(client.sessionId);
  }

  /**
   * A hook or a message handler threw (stage 14): logged and reported, refusals aside. onJoin logs its own
   * failures (with who could not join) before Colyseus hands them here too.
   */
  override onUncaughtException(exception: RoomException, method: RoomMethodName): void {
    if (method === 'onJoin') return;
    logRoomException(this.deps.log, '[matchmaking]', exception, method);
  }

  private sendTo(client: Client, message: MatchmakingServerMessage): void {
    client.send(message.type, message);
  }
}
