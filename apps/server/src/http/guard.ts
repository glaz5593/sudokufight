import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

import { answerPreflight } from './cors';

/**
 * A filter in front of every listener of the HTTP server, Colyseus's included.
 *
 * Why: Colyseus 0.18 answers its own routes (/health, /matchmake/…, and `/`) from an async 'request' listener
 * that builds a WHATWG Request out of the raw headers, `${X-Forwarded-Proto || 'http'}://${Host}${url}`, and
 * nobody catches what it throws. One request with `X-Forwarded-Proto: https, http` (a chain of proxies),
 * `Host: a b`, `Host: a@b` or `Host: [` was an unhandled rejection, and Node ended the whole process: every
 * game and every admin session with it.
 *
 * So, before any listener sees a request (or a WebSocket upgrade):
 * - X-Forwarded-Proto is cut to its first value when that is http or https, and dropped otherwise. Express
 *   reads the first value too (and only from a trusted proxy), so nothing else changes.
 * - A Host that is not a plain authority (a name or IPv4, or [IPv6], and an optional port) gets 400 here.
 *   No browser or app sends one; Express would only make a wrong req.hostname of it.
 * - An OPTIONS request under /admin or /v1 gets 204 without CORS headers (./cors), where Colyseus would grant
 *   any origin, with credentials.
 *
 * It wraps `server.emit`, because Colyseus adds its listener with prependListener() once the server listens:
 * a listener of ours could not run first, nor stop the others.
 */

/** A plain authority: letters, digits, `.`, `-`, `_`, `~`, or [IPv6]; then `:port`. No user:password@. */
const HOST = /^(?:[A-Za-z0-9._~-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

/**
 * Normalizes the headers Colyseus trusts, in place. Returns false for a request to refuse: a Host that is not
 * a plain authority, or with which the URL Colyseus builds would not parse (port 99999, [:::], 999.1.1.1…).
 * Exported for tests.
 */
export function screenRequest(req: IncomingMessage): boolean {
  const { headers } = req;
  const raw = headers['x-forwarded-proto'];
  let proto: 'http' | 'https' | undefined;
  if (raw !== undefined) {
    const first = (Array.isArray(raw) ? raw.join(',') : raw).split(',')[0]?.trim().toLowerCase();
    proto = first === 'http' || first === 'https' ? first : undefined;
    if (proto === undefined) delete headers['x-forwarded-proto'];
    else headers['x-forwarded-proto'] = proto;
  }
  const { host } = headers;
  if (host === undefined) return true; // HTTP/1.0 (Node itself refuses an HTTP/1.1 request without one)
  if (!HOST.test(host)) return false;
  // The very string Colyseus (better-call's node adapter) hands to `new Request()`.
  return URL.canParse(`${proto ?? 'http'}://${host}${req.url ?? '/'}`);
}

const BAD_REQUEST_BODY = JSON.stringify({ error: 'badRequest', message: 'invalid Host header' });

function refuseRequest(res: ServerResponse): void {
  res.writeHead(400, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(BAD_REQUEST_BODY),
    Connection: 'close',
  });
  res.end(BAD_REQUEST_BODY);
}

function refuseUpgrade(socket: Duplex): void {
  socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
}

/** Puts the filter in front of `server`'s 'request' and 'upgrade' listeners. Returns the same server. */
export function guardHttpServer<S extends Server>(server: S): S {
  const emit = server.emit.bind(server) as (event: string | symbol, ...args: unknown[]) => boolean;
  const guarded = (event: string | symbol, ...args: unknown[]): boolean => {
    if (event === 'request' || event === 'upgrade') {
      const req = args[0] as IncomingMessage;
      if (!screenRequest(req)) {
        if (event === 'request') refuseRequest(args[1] as ServerResponse);
        else refuseUpgrade(args[1] as Duplex);
        return true;
      }
      if (event === 'request' && answerPreflight(req, args[1] as ServerResponse)) return true;
    }
    return emit(event, ...args);
  };
  server.emit = guarded as S['emit'];
  return server;
}
