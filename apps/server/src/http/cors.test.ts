import { createServer, type IncomingMessage, request } from 'node:http';
import type { AddressInfo } from 'node:net';

import { isSameOriginOnly, SAME_ORIGIN_ALLOW } from './cors';
import { guardHttpServer } from './guard';

describe('isSameOriginOnly', () => {
  it('is true under /admin and /v1, in any case, with or without a query', () => {
    for (const url of [
      '/admin',
      '/admin/',
      '/admin/api/login',
      '/admin/users/3?x=1',
      '/admin?x',
      '/ADMIN/api/login',
      '/v1',
      '/v1/events',
      '/V1/events#x',
      'http://localhost:2567/admin/api/session', // absolute-form request target
    ]) {
      expect([url, isSameOriginOnly(url)]).toEqual([url, true]);
    }
  });

  it('is false for the game API and for look-alike paths', () => {
    for (const url of [
      '/',
      '/health',
      '/matchmake/joinOrCreate/echo',
      '/administrator',
      '/v10/events',
      '/api/admin',
      'http://localhost:2567/matchmake/joinOrCreate/echo',
      undefined,
    ]) {
      expect([url, isSameOriginOnly(url)]).toEqual([url, false]);
    }
  });
});

describe('SAME_ORIGIN_ALLOW', () => {
  it('names every method the /v1 routes take, PUT too (PUT /v1/me/levels, 1.0.2)', () => {
    expect(SAME_ORIGIN_ALLOW.split(', ')).toEqual([
      'GET',
      'HEAD',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ]);
  });
});

describe('preflights through the guard', () => {
  /** A server with a listener that grants CORS to every OPTIONS, as Colyseus's does. */
  async function start() {
    const seen: string[] = [];
    const server = guardHttpServer(createServer());
    server.on('request', (req: IncomingMessage, res) => {
      seen.push(`${req.method} ${req.url}`);
      res.writeHead(204, {
        'Access-Control-Allow-Origin': String(req.headers.origin ?? '*'),
        'Access-Control-Allow-Credentials': 'true',
      });
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const send = (method: string, path: string) =>
      new Promise<{ status: number; headers: Record<string, unknown> }>((resolve, reject) => {
        const headers = { origin: 'https://evil.example', 'access-control-request-method': 'POST' };
        const r = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
        });
        r.on('error', reject);
        r.end();
      });
    const close = async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    };
    return { seen, send, close };
  }

  it('answers OPTIONS under /admin and /v1 itself, without any Access-Control-* header', async () => {
    const { seen, send, close } = await start();
    try {
      for (const path of ['/admin/api/login', '/admin/', '/v1/events', '/v1/me/levels']) {
        const res = await send('OPTIONS', path);
        expect({ path, status: res.status, allow: res.headers.allow }).toEqual({
          path,
          status: 204,
          allow: SAME_ORIGIN_ALLOW,
        });
        expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
      }
      expect(seen).toEqual([]);
    } finally {
      await close();
    }
  });

  it('leaves every other request to the listeners: OPTIONS elsewhere, and other methods under /admin', async () => {
    const { seen, send, close } = await start();
    try {
      const matchmake = await send('OPTIONS', '/matchmake/joinOrCreate/echo');
      expect(matchmake.headers['access-control-allow-origin']).toBe('https://evil.example');
      await send('POST', '/admin/api/login');
      expect(seen).toEqual(['OPTIONS /matchmake/joinOrCreate/echo', 'POST /admin/api/login']);
    } finally {
      await close();
    }
  });
});
