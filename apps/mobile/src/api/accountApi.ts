import {
  ACCOUNT_ERROR_CODES,
  ACCOUNT_PATHS,
  type AccountError,
  type AccountErrorCode,
  type CreateUserRequest,
  type Me,
  type NameAvailability,
  type UpdateMeRequest,
} from '@sudoku-fight/protocol';

import { isMe } from './me';

/**
 * The account routes of the game server (spec §18 "HTTP API", work plan stage 8; the contract is
 * @sudoku-fight/protocol's account.ts). Every call carries the sign-in's ID token; a 401 refreshes the token
 * and tries once more. Failures come out as AccountApiError: the server's own code, or one of the app's
 * (no connection, a timeout, signed out, an answer it could not read).
 *
 * Pure: fetch, the token and the timers come in, so tests drive it.
 */

export type AccountApiErrorCode =
  | AccountErrorCode
  /** No answer: no network, the server is down, DNS… */
  | 'network'
  /** No answer within requestTimeoutMs. */
  | 'timeout'
  /** The call needs a sign-in and there is none. */
  | 'signedOut'
  /** An answer this app can't read (a proxy's HTML page, a newer server…). */
  | 'unexpected';

export class AccountApiError extends Error {
  constructor(
    readonly code: AccountApiErrorCode,
    readonly status: number | null = null,
    readonly body: AccountError | null = null,
    /** 429: how long the server asked us to wait. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(body?.message ?? code);
    this.name = 'AccountApiError';
  }
}

export const isAccountApiError = (e: unknown): e is AccountApiError => e instanceof AccountApiError;

/** Errors that mean "the server could not be reached or could not answer now": try again later. */
export const OFFLINE_CODES: readonly AccountApiErrorCode[] = [
  'network',
  'timeout',
  'unavailable',
  'disabled',
  'internal',
  'tooManyRequests',
  'unexpected',
];
export const isOfflineError = (e: unknown): boolean => isAccountApiError(e) && OFFLINE_CODES.includes(e.code);

export interface FetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface FetchInit {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export type AccountFetch = (url: string, init: FetchInit) => Promise<FetchResponse>;

export interface AccountApiDeps {
  /** The server's HTTP origin, no trailing slash (config/server.ts httpBaseUrl()). */
  baseUrl: string;
  /** The sign-in's ID token, refreshed when `forceRefresh`; null when nobody is signed in. */
  getToken: (forceRefresh: boolean) => Promise<string | null>;
  fetch: AccountFetch;
  timeoutMs: number;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface AccountApi {
  /** GET /v1/names/available. With a sign-in, its own current name counts as available. */
  nameAvailable(name: string, signal?: AbortSignal): Promise<NameAvailability>;
  /** POST /v1/users: the registration's profile (spec §3.2). */
  createUser(body: CreateUserRequest): Promise<Me>;
  /** GET /v1/me. */
  getMe(): Promise<Me>;
  /** PATCH /v1/me: avatar and country any time [D21], the name once in 30 days [D20]. */
  updateMe(patch: UpdateMeRequest): Promise<Me>;
  /**
   * DELETE /v1/me. A 404 (already deleted) counts as done. The server wants a recent sign-in (the token's
   * auth_time): call it right after re-authenticating and getIdToken(true). A sign-in that is too old fails
   * with 'reauthRequired' at once (no token refresh: it would keep the old sign-in time).
   */
  deleteMe(): Promise<void>;
}

const KNOWN_CODES = new Set<string>(ACCOUNT_ERROR_CODES);

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function errorBodyOf(value: unknown): AccountError | null {
  if (typeof value !== 'object' || value === null) return null;
  const error = (value as { error?: unknown }).error;
  return typeof error === 'string' && KNOWN_CODES.has(error) ? (value as AccountError) : null;
}

function retryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

/** The status alone, when the body says nothing the app knows. */
function codeOfStatus(status: number): AccountApiErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'notFound';
  if (status === 413) return 'tooLarge';
  if (status === 429) return 'tooManyRequests';
  if (status === 503) return 'unavailable';
  if (status >= 500) return 'internal';
  if (status >= 400) return 'badRequest';
  return 'unexpected';
}

function isNameAvailability(v: unknown): v is NameAvailability {
  return typeof v === 'object' && v !== null && typeof (v as NameAvailability).available === 'boolean';
}

export function createAccountApi(deps: AccountApiDeps): AccountApi {
  const set = deps.setTimeout ?? ((cb, ms) => setTimeout(cb, ms));
  const clear = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  async function send(
    method: FetchInit['method'],
    path: string,
    opts: { body?: unknown; auth: 'required' | 'optional'; signal?: AbortSignal },
  ): Promise<{ status: number; data: unknown }> {
    const attempt = async (forceRefresh: boolean) => {
      const token = await deps.getToken(forceRefresh).catch(() => null);
      if (!token && opts.auth === 'required') throw new AccountApiError('signedOut');
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

      const controller = new AbortController();
      const outer = opts.signal;
      // The caller gave up while the token was read (a newer name to check): no request at all.
      if (outer?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const onAbort = () => controller.abort();
      outer?.addEventListener('abort', onAbort);
      let timedOut = false;
      const timer = set(() => {
        timedOut = true;
        controller.abort();
      }, deps.timeoutMs);
      try {
        const response = await deps.fetch(`${deps.baseUrl}${path}`, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: controller.signal,
        });
        const data = parseJson(await response.text());
        return { response, data, hadToken: token !== null };
      } catch (error) {
        if (outer?.aborted) throw error;
        throw new AccountApiError(timedOut ? 'timeout' : 'network');
      } finally {
        clear(timer);
        outer?.removeEventListener('abort', onAbort);
      }
    };

    let result = await attempt(false);
    // An expired or revoked token: a fresh one, once (protocol: "refresh the token and try once more").
    // Not for reauthRequired: a refreshed token keeps the old sign-in time, only re-authenticating helps.
    const reauth = errorBodyOf(result.data)?.error === 'reauthRequired';
    if (result.response.status === 401 && result.hadToken && !reauth) result = await attempt(true);
    const { response, data } = result;
    if (response.status >= 200 && response.status < 300) return { status: response.status, data };
    const body = errorBodyOf(data);
    throw new AccountApiError(
      body?.error ?? codeOfStatus(response.status),
      response.status,
      body,
      retryAfter(response.headers.get('Retry-After')),
    );
  }

  const asMe = (data: unknown): Me => {
    if (!isMe(data)) throw new AccountApiError('unexpected');
    return data;
  };

  return {
    async nameAvailable(name, signal) {
      const { data } = await send('GET', `${ACCOUNT_PATHS.namesAvailable}?name=${encodeURIComponent(name)}`, {
        auth: 'optional',
        signal,
      });
      if (!isNameAvailability(data)) throw new AccountApiError('unexpected');
      return data;
    },
    async createUser(body) {
      return asMe((await send('POST', ACCOUNT_PATHS.users, { body, auth: 'required' })).data);
    },
    async getMe() {
      return asMe((await send('GET', ACCOUNT_PATHS.me, { auth: 'required' })).data);
    },
    async updateMe(patch) {
      return asMe((await send('PATCH', ACCOUNT_PATHS.me, { body: patch, auth: 'required' })).data);
    },
    async deleteMe() {
      try {
        await send('DELETE', ACCOUNT_PATHS.me, { auth: 'required' });
      } catch (error) {
        if (isAccountApiError(error) && error.code === 'notRegistered') return;
        throw error;
      }
    },
  };
}
