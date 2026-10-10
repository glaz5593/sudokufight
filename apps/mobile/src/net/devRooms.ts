import type { DevRoomOptions } from './onlineClient';
import { RemoteGameHost, type RemoteHostDeps } from './remoteGameHost';

/**
 * Private rooms by code (stage 7: outside production only; matchmaking comes in stage 9). Each call makes a
 * RemoteGameHost and joins: create resolves with the room's code to share, join with the host. A refusal
 * rejects with an OnlineError: 'badCode' (not a code), 'notFound', 'roomFull', a GameRoomError such as
 * 'gameStarted' or 'unauthenticated', or 'network'. Pure: the deps carry the client, clock and timers.
 */

export interface DevRoom {
  host: RemoteGameHost;
  /** The code to share (6 characters, protocol ROOM_CODE_ALPHABET). */
  code: string;
}

export interface DevRooms {
  createDevRoom(options?: DevRoomOptions): Promise<DevRoom>;
  joinDevRoom(code: string): Promise<RemoteGameHost>;
}

export function devRooms(deps: RemoteHostDeps): DevRooms {
  return {
    async createDevRoom(options = {}) {
      const host = new RemoteGameHost(deps);
      const code = await host.create(options);
      return { host, code };
    },
    async joinDevRoom(code) {
      const host = new RemoteGameHost(deps);
      await host.join(code);
      return host;
    },
  };
}
