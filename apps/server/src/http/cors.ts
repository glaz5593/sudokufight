import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Cross-origin access (CORS): open for the game API, closed for the admin site and /v1.
 *
 * Colyseus 0.18 answers every OPTIONS request itself, before Express sees it, with 204 and "any origin, with
 * credentials" (it echoes the request's Origin), and puts the same headers on every other response. The app's
 * matchmaking (/matchmake/…) and /health keep that. Under these prefixes no web page of another origin has
 * business calling:
 * - /admin: the admin site and its API, same-origin only (the session cookie is SameSite=Strict as well).
 * - /v1: the app's HTTP API (POST /v1/events, the account routes). The app is not a browser, so it never
 *   sends a preflight.
 *
 * There, a preflight (OPTIONS) gets 204 without any Access-Control-* header (guard.ts calls answerPreflight
 * before Colyseus can), so a browser does not send the request that would follow; and configureHttp strips
 * Colyseus's headers from every other response there. Matched without case, as Express routes are.
 */

export const SAME_ORIGIN_PREFIXES = ['/admin', '/v1'] as const;

/** The methods named in the answer to an OPTIONS request under SAME_ORIGIN_PREFIXES. */
export const SAME_ORIGIN_ALLOW = 'GET, HEAD, POST, PATCH, DELETE, OPTIONS';

/** The path of a request target: origin-form (/a/b?x) or absolute-form (http://host/a/b), lower case. */
function pathnameOf(url: string): string {
  const path = url.startsWith('/') ? url : (URL.parse(url)?.pathname ?? url);
  return (path.split(/[?#]/, 1)[0] ?? '').toLowerCase();
}

/** True for /admin, /admin/…, /v1 and /v1/… (not /administrator or /v10). */
export function isSameOriginOnly(url: string | undefined): boolean {
  const path = pathnameOf(url ?? '/');
  return SAME_ORIGIN_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Answers an OPTIONS request under SAME_ORIGIN_PREFIXES, without CORS headers. True when it answered. */
export function answerPreflight(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'OPTIONS' || !isSameOriginOnly(req.url)) return false;
  res.writeHead(204, { Allow: SAME_ORIGIN_ALLOW });
  res.end();
  return true;
}
