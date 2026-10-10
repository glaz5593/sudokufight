import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { Client } from '@colyseus/sdk';
import { TELEMETRY_PATH, type TelemetryBatch } from '@sudoku-fight/protocol';

import { createAppServer } from '../src/app';
import { testConfig } from '../src/testing/config';

/**
 * CORS on the real server (Colyseus in front of Express, src/http/cors): another origin gets nothing under
 * /admin and /v1, and the game API stays open to the app.
 */

const ORIGIN = 'https://elsewhere.example';

describe('cross-origin access on the real server', () => {
  const server = createAppServer({ gracefullyShutdown: false, config: testConfig() });
  let base = '';

  beforeAll(async () => {
    await server.listen(0);
    base = `http://127.0.0.1:${(server.transport.server!.address() as AddressInfo).port}`;
  }, 30_000);

  afterAll(async () => {
    await server.gracefullyShutdown(false);
    // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
    await new Promise((r) => setTimeout(r, 1100));
  });

  /** What a browser sends before a cross-origin JSON POST. */
  const preflight = (path: string) =>
    fetch(`${base}${path}`, {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
        connection: 'close',
      },
    });

  const corsHeaders = (res: Response) =>
    [...res.headers.keys()].filter((h) => h.startsWith('access-control-'));

  it('a preflight under /admin or /v1 is not granted: 204 without any Access-Control-* header', async () => {
    for (const path of ['/admin/api/login', '/admin/api/overview', '/admin/', TELEMETRY_PATH]) {
      const res = await preflight(path);
      expect({ path, status: res.status, cors: corsHeaders(res) }).toEqual({ path, status: 204, cors: [] });
    }
  });

  it("the matchmaker's preflight still grants the origin, and the app joins a room", async () => {
    const res = await preflight('/matchmake/joinOrCreate/echo');
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(
      (await fetch(`${base}/health`, { headers: { origin: ORIGIN } })).headers.get(
        'access-control-allow-origin',
      ),
    ).toBe(ORIGIN);

    const { hostname, port } = new URL(base);
    const room = await new Client({ hostname, port: Number(port), secure: false }).joinOrCreate('echo');
    await room.leave();
  });

  it('POST /v1/events still works for the app, and its answer carries no CORS headers', async () => {
    const batch: TelemetryBatch = {
      installId: randomUUID(),
      platform: 'android',
      appVersion: '0.1.0',
      events: [{ id: randomUUID(), name: 'app_open', props: {}, t: Date.now() }],
    };
    const res = await fetch(`${base}${TELEMETRY_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, connection: 'close' },
      body: JSON.stringify(batch),
    });
    expect(res.status).toBe(202);
    expect(corsHeaders(res)).toEqual([]);
  });
});
