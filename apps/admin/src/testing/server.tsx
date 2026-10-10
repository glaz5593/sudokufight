import { ADMIN_API_PREFIX } from '@sudoku-fight/protocol';
import { render } from '@testing-library/react';

import type { FetchLike, FetchResponse } from '../api';
import { App } from '../App';
import { I18nProvider } from '../i18n';
import type { Lang } from '../strings';

/**
 * A fake admin API for the site's tests: answers by "METHOD /path" (without /admin/api and the query
 * string), records every request, and answers 404 to anything it doesn't know.
 */

export interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface Request {
  method: string;
  /** The full URL the site asked for, query string included. */
  url: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string>;
  credentials: RequestCredentials | undefined;
}

export type Handler = Reply | ((req: Request) => Reply);

export interface FakeServer {
  fetch: FetchLike;
  requests: Request[];
  /** Replaces or adds a route. */
  on(route: string, handler: Handler): void;
  /** The URLs of the GET requests to a path, in order. */
  gets(path: string): string[];
}

function respond({ status = 200, body, headers = {} }: Reply): FetchResponse {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    json: () => (body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body)),
  };
}

export function fakeServer(routes: Record<string, Handler> = {}): FakeServer {
  const table = new Map(Object.entries(routes));
  const requests: Request[] = [];
  const fetch: FetchLike = (url, init) => {
    const parsed = new URL(url, 'http://localhost');
    const path = parsed.pathname.startsWith(ADMIN_API_PREFIX)
      ? parsed.pathname.slice(ADMIN_API_PREFIX.length)
      : parsed.pathname;
    const method = init.method ?? 'GET';
    const req: Request = {
      method,
      url,
      path,
      query: parsed.searchParams,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      headers: (init.headers ?? {}) as Record<string, string>,
      credentials: init.credentials,
    };
    requests.push(req);
    const handler = table.get(`${method} ${path}`);
    if (!handler) return Promise.resolve(respond({ status: 404, body: { error: 'notFound' } }));
    return Promise.resolve(respond(typeof handler === 'function' ? handler(req) : handler));
  };
  return {
    fetch,
    requests,
    on: (route, handler) => table.set(route, handler),
    gets: (path) => requests.filter((r) => r.method === 'GET' && r.path === path).map((r) => r.url),
  };
}

export const SIGNED_IN: Reply = { body: { ok: true, expiresAt: Date.now() + 3_600_000 } };
export const SIGNED_OUT: Reply = { status: 401, body: { error: 'unauthorized' } };

/** The whole site at `hash`, in English unless asked otherwise. */
export function renderSite(
  server: FakeServer,
  { hash = '#/overview', lang = 'en' }: { hash?: string; lang?: Lang } = {},
) {
  window.location.hash = hash;
  return render(
    <I18nProvider initialLang={lang}>
      <App fetch={server.fetch} />
    </I18nProvider>,
  );
}
