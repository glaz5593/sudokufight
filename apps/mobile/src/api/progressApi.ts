import {
  type Leaderboard,
  type LeaderboardTab,
  MAX_PRACTICE_RESULTS,
  type MyProgress,
  type PlayerCard,
  playerPath,
  PROGRESS_ERROR_CODES,
  PROGRESS_PATHS,
  type PracticeResult,
  type PracticeResultsRequest,
  type PracticeResultsResponse,
  type ProgressErrorCode,
} from '@sudoku-fight/protocol';

import type { AccountFetch, FetchInit } from './accountApi';
import {
  readLeaderboard,
  readMyProgress,
  readPlayerCard,
  readPracticeResultsResponse,
} from './progressGuards';

/**
 * The progress routes of the game server (spec §11.3, §14.2, §14.3, §15; work plan stage 12; the contract is
 * @sudoku-fight/protocol's progress.ts): the leaderboards, a player's card, my XP, level and league, and the
 * practice results the phone queued [D41]. Every call carries the sign-in's ID token; a 401 refreshes it and
 * tries once more. Failures come out as ProgressApiError: the server's code, or the app's own (no connection,
 * a timeout, signed out, an answer it could not read).
 *
 * Pure: fetch, the token and the timers come in, so tests drive it.
 */

/** The `error` codes the progress routes answer with, and a player card's path: the protocol's. */
export { playerPath, PROGRESS_ERROR_CODES, type ProgressErrorCode };

export type ProgressApiErrorCode =
  | ProgressErrorCode
  /** No answer: no network, the server is down, DNS… */
  | 'network'
  /** No answer within the time limit. */
  | 'timeout'
  /** Nobody is signed in. */
  | 'signedOut'
  /** An answer this app can't read. */
  | 'unexpected';

export class ProgressApiError extends Error {
  constructor(
    readonly code: ProgressApiErrorCode,
    readonly status: number | null = null,
    /** 429: how long the server asked us to wait. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(code);
    this.name = 'ProgressApiError';
  }
}

export const isProgressApiError = (e: unknown): e is ProgressApiError => e instanceof ProgressApiError;

/** "The server could not be reached or could not answer now": the screens say "offline", and keep going. */
export const PROGRESS_OFFLINE_CODES: readonly ProgressApiErrorCode[] = [
  'network',
  'timeout',
  'unavailable',
  'disabled',
  'internal',
  'tooManyRequests',
  'unexpected',
];

export const isProgressOffline = (e: unknown): boolean =>
  isProgressApiError(e) && PROGRESS_OFFLINE_CODES.includes(e.code);

export interface ProgressApiDeps {
  /** The server's HTTP origin, no trailing slash (config/server.ts httpBaseUrl()). */
  baseUrl: string;
  /** The sign-in's ID token, refreshed when `forceRefresh`; null when nobody is signed in. */
  getToken: (forceRefresh: boolean) => Promise<string | null>;
  fetch: AccountFetch;
  timeoutMs: number;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface LeaderboardQuery {
  tab: LeaderboardTab;
  /** Option A only (spec §11.1): the table size of a game-type tab; left out, the server picks. */
  players?: 2 | 3 | 4 | null;
  /** The page after the one that gave this cursor; left out: the first page. */
  cursor?: string | null;
}

export interface ProgressApi {
  /** GET /v1/leaderboard: a page of a tab, my pinned row, and (friends) the recent opponents [D27]. */
  leaderboard(query: LeaderboardQuery): Promise<Leaderboard>;
  /** GET /v1/players/:id: a player's card (spec §14.3). 404 → 'notFound'. */
  player(id: string): Promise<PlayerCard>;
  /** GET /v1/me/progress: my XP, level and league. */
  myProgress(): Promise<MyProgress>;
  /** POST /v1/me/practice-results: practice XP queued on the phone [D41], at most MAX_PRACTICE_RESULTS. */
  sendPracticeResults(results: readonly PracticeResult[]): Promise<PracticeResultsResponse>;
}

const KNOWN = new Set<string>(PROGRESS_ERROR_CODES);

function codeOf(status: number, body: unknown): ProgressApiErrorCode {
  const error = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  if (typeof error === 'string' && KNOWN.has(error)) return error as ProgressErrorCode;
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'notFound';
  if (status === 413) return 'tooLarge';
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

/** Retry-After in delta-seconds (what our server sends), as ms; null when missing or unreadable. */
function retryAfter(header: string | null): number | null {
  const value = header?.trim();
  if (!value || !/^\d+$/.test(value)) return null;
  return Number(value) * 1000;
}

/** The query of a leaderboard page, in a fixed order. */
export function leaderboardPath({ tab, players, cursor }: LeaderboardQuery): string {
  const params = [`tab=${encodeURIComponent(tab)}`];
  if (players !== undefined && players !== null) params.push(`players=${players}`);
  if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`);
  return `${PROGRESS_PATHS.leaderboard}?${params.join('&')}`;
}

export function createProgressApi(deps: ProgressApiDeps): ProgressApi {
  const set = deps.setTimeout ?? ((cb, ms) => setTimeout(cb, ms));
  const clear = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  async function send(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const attempt = async (forceRefresh: boolean) => {
      const token = await deps.getToken(forceRefresh).catch(() => null);
      if (!token) throw new ProgressApiError('signedOut');
      const controller = new AbortController();
      let timedOut = false;
      const timer = set(() => {
        timedOut = true;
        controller.abort();
      }, deps.timeoutMs);
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const init: FetchInit = {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      };
      try {
        const response = await deps.fetch(`${deps.baseUrl}${path}`, init);
        return {
          status: response.status,
          retryAfter: response.headers.get('Retry-After'),
          data: parseJson(await response.text()),
        };
      } catch {
        throw new ProgressApiError(timedOut ? 'timeout' : 'network');
      } finally {
        clear(timer);
      }
    };
    let result = await attempt(false);
    // An expired or revoked token: a fresh one, once.
    if (result.status === 401) result = await attempt(true);
    if (result.status >= 200 && result.status < 300) return result.data;
    throw new ProgressApiError(
      codeOf(result.status, result.data),
      result.status,
      retryAfter(result.retryAfter),
    );
  }

  function read<T>(data: unknown, reader: (v: unknown) => T | null): T {
    const value = reader(data);
    if (value === null) throw new ProgressApiError('unexpected');
    return value;
  }

  return {
    async leaderboard(query) {
      return read(await send('GET', leaderboardPath(query)), readLeaderboard);
    },
    async player(id) {
      if (!id) throw new ProgressApiError('notFound');
      return read(await send('GET', playerPath(id)), readPlayerCard);
    },
    async myProgress() {
      return read(await send('GET', PROGRESS_PATHS.myProgress), readMyProgress);
    },
    async sendPracticeResults(results) {
      if (results.length === 0 || results.length > MAX_PRACTICE_RESULTS)
        throw new ProgressApiError('badRequest');
      const request: PracticeResultsRequest = { results: [...results] };
      return read(await send('POST', PROGRESS_PATHS.practiceResults, request), readPracticeResultsResponse);
    },
  };
}
