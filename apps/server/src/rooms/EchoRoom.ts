import { type Client, Room } from '@colyseus/core';

/**
 * Stage 0: a room that answers ping with pong (spec §18: `ping {t}` → `pong {t, serverTime}`), so the app can
 * show the round-trip time and prove the whole path works. The game room comes in stage 7.
 */
export class EchoRoom extends Room {
  override maxClients = 8;

  override messages = {
    ping: (client: Client, message: { t?: unknown }) => {
      const t = typeof message?.t === 'number' ? message.t : 0;
      client.send('pong', { t, serverTime: Date.now() });
    },
  };
}
