import { ADMIN_API_PREFIX } from '@sudoku-fight/protocol';

import { TEST_ADMIN_PASSWORD } from './config';

/** What a test reads from an answer: the status, the JSON body (or null) and the headers. */
export interface ApiAnswer<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

async function answer<T>(res: Response): Promise<ApiAnswer<T>> {
  const text = await res.text();
  let body: unknown = null;
  if (text !== '' && (res.headers.get('content-type') ?? '').includes('json')) body = JSON.parse(text);
  return { status: res.status, body: body as T, headers: res.headers };
}

/** POST /admin/api/login with this body (a password string, or anything else as JSON). */
export async function adminLogin(url: string, body: unknown = { password: TEST_ADMIN_PASSWORD }) {
  const res = await fetch(`${url}${ADMIN_API_PREFIX}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  return { ...(await answer(res)), cookie, setCookie: res.headers.get('set-cookie') };
}

/** An admin API client for tests: signs in once, then GETs with the session cookie. */
export interface AdminClient {
  cookie: string;
  get<T = unknown>(path: string, query?: Record<string, string | number>): Promise<ApiAnswer<T>>;
}

export async function signedInAdmin(url: string): Promise<AdminClient> {
  const login = await adminLogin(url);
  if (login.status !== 204) throw new Error(`admin login failed: ${login.status}`);
  return {
    cookie: login.cookie,
    get: async <T>(path: string, query: Record<string, string | number> = {}) => {
      const qs = new URLSearchParams(
        Object.entries(query).map(([k, v]): [string, string] => [k, String(v)]),
      ).toString();
      const res = await fetch(`${url}${ADMIN_API_PREFIX}${path}${qs ? `?${qs}` : ''}`, {
        headers: { cookie: login.cookie },
      });
      return answer<T>(res);
    },
  };
}

/** GET a URL with optional headers, read like an API answer. */
export async function getUrl<T = unknown>(url: string, headers: Record<string, string> = {}) {
  return answer<T>(await fetch(url, { headers }));
}
