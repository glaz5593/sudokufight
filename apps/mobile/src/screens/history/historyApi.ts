import {
  HISTORY_ERROR_CODES,
  HISTORY_PATHS,
  type HistoryErrorCode,
  type HistoryPage,
  isHistoryPage,
  isReplayAnswer,
  type ReplayAnswer,
  replayPath,
} from '@sudoku-fight/protocol';

import type { AccountFetch, FetchInit } from '../../api/accountApi';

/**
 * The history routes of the game server (spec §14.1, §13; the contract: @sudoku-fight/protocol history.ts):
 * the signed-in player's ranked games, a page at a time, and a game's full log for the replay. Every call
 * carries the sign-in's ID token; a 401 refreshes it and tries once more. Failures come out as
 * HistoryApiError: the server's code, or the app's own (no connection, a timeout, signed out, an answer it
 * could not read). Pure: fetch, the token and the timers come in, so tests drive it.
 */

export type HistoryApiErrorCode = HistoryErrorCode | 'network' | 'timeout' | 'signedOut' | 'unexpected';

export class HistoryApiError extends Error {
  constructor(
    readonly code: HistoryApiErrorCode,
    readonly status: number | null = null,
  ) {
    super(code);
    this.name = 'HistoryApiError';
  }
}

export const isHistoryApiError = (e: unknown): e is HistoryApiError => e instanceof HistoryApiError;

/** "The server could not be reached or could not answer now": the screens say "offline", and keep going. */
export const HISTORY_OFFLINE_CODES: readonly HistoryApiErrorCode[] = [
  'network',
  'timeout',
  'unavailable',
  'disabled',
  'internal',
  'tooManyRequests',
];

export interface HistoryApiDeps {
  /** The server's HTTP origin, no trailing slash (config/server.ts httpBaseUrl()). */
  baseUrl: string;
  /** The sign-in's ID token, refreshed when `forceRefresh`; null when nobody is signed in. */
  getToken: (forceRefresh: boolean) => Promise<string | null>;
  fetch: AccountFetch;
  timeoutMs: number;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface HistoryApi {
  /** GET /v1/me/games: a page of my ranked games, newest first; `cursor` from the page before. */
  myGames(cursor: string | null): Promise<HistoryPage>;
  /** GET /v1/games/:id/replay: a game I played, with its whole log. */
  replay(gameId: string): Promise<ReplayAnswer>;
}

const KNOWN = new Set<string>(HISTORY_ERROR_CODES);

function codeOf(status: number, body: unknown): HistoryApiErrorCode {
  const error = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  if (typeof error === 'string' && KNOWN.has(error)) return error as HistoryErrorCode;
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'notFound';
  if (status === 409) return 'notFinished';
  if (status === 429) return 'tooManyRequests';
  if (status === 503) return 'unavailable';
  if (status >= 500) return 'internal';
  if (status >= 400) return 'badRequest';
  return 'unexpected';
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function createHistoryApi(deps: HistoryApiDeps): HistoryApi {
  const set = deps.setTimeout ?? ((cb, ms) => setTimeout(cb, ms));
  const clear = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  async function get(path: string): Promise<unknown> {
    const attempt = async (forceRefresh: boolean) => {
      const token = await deps.getToken(forceRefresh).catch(() => null);
      if (!token) throw new HistoryApiError('signedOut');
      const controller = new AbortController();
      let timedOut = false;
      const timer = set(() => {
        timedOut = true;
        controller.abort();
      }, deps.timeoutMs);
      const init: FetchInit = {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        signal: controller.signal,
      };
      try {
        const response = await deps.fetch(`${deps.baseUrl}${path}`, init);
        return { status: response.status, data: parseJson(await response.text()) };
      } catch {
        throw new HistoryApiError(timedOut ? 'timeout' : 'network');
      } finally {
        clear(timer);
      }
    };
    let result = await attempt(false);
    // An expired or revoked token: a fresh one, once.
    if (result.status === 401) result = await attempt(true);
    if (result.status >= 200 && result.status < 300) return result.data;
    throw new HistoryApiError(codeOf(result.status, result.data), result.status);
  }

  return {
    async myGames(cursor) {
      const path =
        cursor === null
          ? HISTORY_PATHS.myGames
          : `${HISTORY_PATHS.myGames}?cursor=${encodeURIComponent(cursor)}`;
      const data = await get(path);
      if (!isHistoryPage(data)) throw new HistoryApiError('unexpected');
      return data;
    },
    async replay(gameId) {
      const data = await get(replayPath(gameId));
      if (!isReplayAnswer(data)) throw new HistoryApiError('unexpected');
      return data;
    },
  };
}
