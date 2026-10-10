import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { Client } from '@colyseus/sdk';
import { ENGINE_VERSION } from '@sudoku-fight/engine';
import { PROTOCOL_VERSION, TELEMETRY_PATH, type TelemetryBatch } from '@sudoku-fight/protocol';

import { createAppServer, DEFAULT_PORT, health } from './app';
import { testConfig } from './testing/config';

describe('game server', () => {
  // Opens its own in-memory PGlite from the settings, as in development, and closes it on shutdown.
  const server = createAppServer({ gracefullyShutdown: false, config: testConfig() });
  let port = 0;

  beforeAll(async () => {
    await server.listen(0); // a free port picked by the OS
    port = (server.transport.server!.address() as AddressInfo).port;
  }, 30_000);

  afterAll(async () => {
    await server.gracefullyShutdown(false); // false: do not exit the process
    // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
    await new Promise((r) => setTimeout(r, 1100));
  });

  it('listens on 2567 by default', () => {
    expect(DEFAULT_PORT).toBe(2567);
  });

  it('answers GET /health with the engine and protocol versions it was built with', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { connection: 'close' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, engine: ENGINE_VERSION, protocol: PROTOCOL_VERSION });
    expect(health().engine).toBe(ENGINE_VERSION);
  });

  it('the echo room answers ping with pong, carrying the client time and the server time', async () => {
    const client = new Client({ hostname: '127.0.0.1', port, secure: false });
    const room = await client.joinOrCreate('echo');
    const before = Date.now();
    const pong = new Promise<{ t: number; serverTime: number }>((resolve) =>
      room.onMessage('pong', (m: { t: number; serverTime: number }) => resolve(m)),
    );
    room.send('ping', { t: 12345 });
    const m = await pong;
    expect(m.t).toBe(12345);
    expect(m.serverTime).toBeGreaterThanOrEqual(before - 1000);
    await room.leave();
  });

  it('serves the Express routes on the same port: POST /v1/events stores a batch', async () => {
    const batch: TelemetryBatch = {
      installId: randomUUID(),
      platform: 'ios',
      appVersion: '0.1.0',
      events: [{ id: randomUUID(), name: 'app_open', props: {}, t: Date.now() }],
    };
    const res = await fetch(`http://127.0.0.1:${port}${TELEMETRY_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify(batch),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 1, duplicates: 0 });
  });

  it("drops Colyseus's open CORS headers under /admin, and only there", async () => {
    const headers = { origin: 'https://elsewhere.example', connection: 'close' };
    const admin = await fetch(`http://127.0.0.1:${port}/admin/api/session`, { headers });
    expect(admin.headers.get('access-control-allow-origin')).toBeNull();
    expect(admin.headers.get('access-control-allow-credentials')).toBeNull();
    const healthRes = await fetch(`http://127.0.0.1:${port}/health`, { headers });
    expect(healthRes.headers.get('access-control-allow-origin')).toBe('https://elsewhere.example');
  });
});
