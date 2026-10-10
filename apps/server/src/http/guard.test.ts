import { createServer, type IncomingMessage, request } from 'node:http';
import type { AddressInfo } from 'node:net';

import { guardHttpServer, screenRequest } from './guard';

const req = (headers: Record<string, string>, url = '/health') =>
  ({ headers: { ...headers }, url }) as unknown as IncomingMessage;

describe('screenRequest', () => {
  it('keeps a good Host: a name, an IPv4 or [IPv6] address, with or without a port', () => {
    for (const host of [
      'localhost',
      'localhost:2567',
      'sudoku-fight.fly.dev',
      '10.0.2.2:2567',
      '[::1]:2567',
    ]) {
      expect(screenRequest(req({ host }))).toBe(true);
    }
    expect(screenRequest(req({}))).toBe(true); // HTTP/1.0 without a Host
  });

  it('refuses a Host Colyseus would choke on', () => {
    const bad = ['a b', 'a@b', 'user:pw@localhost', '[', '[:::]', 'localhost:99999', '999.1.1.1', 'a/b', ''];
    for (const host of bad) expect([host, screenRequest(req({ host }))]).toEqual([host, false]);
  });

  it('cuts X-Forwarded-Proto to its first value, and drops one that is not http or https', () => {
    const chain = req({ host: 'localhost', 'x-forwarded-proto': 'HTTPS, http' });
    expect(screenRequest(chain)).toBe(true);
    expect(chain.headers['x-forwarded-proto']).toBe('https');

    const junk = req({ host: 'localhost', 'x-forwarded-proto': 'a b' });
    expect(screenRequest(junk)).toBe(true);
    expect(junk.headers['x-forwarded-proto']).toBeUndefined();
  });
});

describe('guardHttpServer', () => {
  it('answers 400 before any listener sees a bad request, and lets the others through', async () => {
    const seen: string[] = [];
    const server = guardHttpServer(createServer());
    // Like Colyseus's listener: builds a URL from the headers, and would throw on a bad one.
    server.on('request', (r: IncomingMessage, res) => {
      const proto = String(r.headers['x-forwarded-proto'] ?? 'http');
      seen.push(new URL(`${proto}://${r.headers.host}${r.url}`).href);
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const send = (headers: Record<string, string>) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const r = request({ host: '127.0.0.1', port, path: '/health', headers, setHost: false }, (res) => {
          let body = '';
          res.on('data', (d: Buffer) => (body += d.toString()));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        });
        r.on('error', reject);
        r.end();
      });

    try {
      expect(await send({ host: 'a b' })).toEqual({
        status: 400,
        body: '{"error":"badRequest","message":"invalid Host header"}',
      });
      expect(await send({ host: 'localhost:1', 'x-forwarded-proto': 'https, http' })).toEqual({
        status: 200,
        body: 'ok',
      });
      expect(seen).toEqual(['https://localhost:1/health']);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
