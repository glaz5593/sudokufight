import {
  blockPath,
  type BlockedPlayer,
  type BlockList,
  type BlockRequest,
  isReportReason,
  MAX_BLOCKS,
  MODERATION_ERROR_CODES,
  MODERATION_PATHS,
  type ModerationError,
  type ModerationErrorCode,
  PLAYER_ID_PATTERN,
  REPORT_RESPONSE_HOURS,
  type ReportReceipt,
  type ReportRequest,
} from '@sudoku-fight/protocol';

import type { AccountFetch, FetchInit } from './accountApi';
import { readPublicPlayer } from './progressGuards';

/**
 * "דווח על שחקן" and "חסום שחקן" on the game server (spec §3.5; the contract is @sudoku-fight/protocol's
 * moderation.ts): POST /v1/reports, and GET / POST / DELETE of my blocks. Every call carries the sign-in's ID
 * token; a 401 refreshes it and tries once more. Failures come out as ModerationApiError: the server's code (with
 * its body: `retryAt`, `max`, `field`), or the app's own (no connection, a timeout, signed out, an answer it could
 * not read).
 *
 * A report the server already holds open (409 `duplicate`) is not a failure here: report() resolves with
 * `duplicate: true`, and the app thanks the player the same way (the contract says so).
 *
 * Pure: fetch, the token and the timers come in, so tests drive it.
 */

export type ModerationApiErrorCode =
  | ModerationErrorCode
  /** No answer: no network, the server is down, DNS… */
  | 'network'
  /** No answer within the time limit. */
  | 'timeout'
  /** Nobody is signed in. */
  | 'signedOut'
  /** An answer this app can't read. */
  | 'unexpected';

export class ModerationApiError extends Error {
  constructor(
    readonly code: ModerationApiErrorCode,
    readonly status: number | null = null,
    readonly body: ModerationError | null = null,
    /** 429: how long the server asked us to wait. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(body?.message ?? code);
    this.name = 'ModerationApiError';
  }
}

export const isModerationApiError = (e: unknown): e is ModerationApiError => e instanceof ModerationApiError;

/** "The server could not be reached or could not answer now": try again later. */
export const MODERATION_OFFLINE_CODES: readonly ModerationApiErrorCode[] = [
  'network',
  'timeout',
  'unavailable',
  'disabled',
  'internal',
  'unexpected',
];

export const isModerationOffline = (e: unknown): boolean =>
  isModerationApiError(e) && MODERATION_OFFLINE_CODES.includes(e.code);

export interface ModerationApiDeps {
  /** The server's HTTP origin, no trailing slash (config/server.ts httpBaseUrl()). */
  baseUrl: string;
  /** The sign-in's ID token, refreshed when `forceRefresh`; null when nobody is signed in. */
  getToken: (forceRefresh: boolean) => Promise<string | null>;
  fetch: AccountFetch;
  timeoutMs: number;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/** What a report came to: stored now, or the same one was open already (both get the thank-you). */
export interface ReportOutcome {
  /** The report's id (the open one, for a duplicate). */
  id: string;
  duplicate: boolean;
  /** The hours of the thank-you message (REPORT_RESPONSE_HOURS unless the server says otherwise). */
  respondWithinHours: number;
}

export interface ModerationApi {
  /** POST /v1/reports. */
  report(request: ReportRequest): Promise<ReportOutcome>;
  /** GET /v1/me/blocks: newest first. */
  blocks(): Promise<BlockList>;
  /** POST /v1/me/blocks: the blocked player's card (also when they were blocked already). */
  block(playerId: string): Promise<BlockedPlayer>;
  /** DELETE /v1/me/blocks/:playerId (also when they were not blocked). */
  unblock(playerId: string): Promise<void>;
}

const KNOWN = new Set<string>(MODERATION_ERROR_CODES);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function errorBodyOf(value: unknown): ModerationError | null {
  if (!isObj(value)) return null;
  return typeof value.error === 'string' && KNOWN.has(value.error)
    ? (value as unknown as ModerationError)
    : null;
}

/** The status alone, when the body says nothing the app knows. */
function codeOfStatus(status: number): ModerationApiErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'notFound';
  if (status === 413) return 'tooLarge';
  if (status === 429) return 'tooManyRequests';
  if (status === 503) return 'unavailable';
  if (status >= 500) return 'internal';
  if (status >= 400) return 'badRequest';
  return 'unexpected';
}

/** Retry-After in delta-seconds (what our server sends), as ms; null when missing or unreadable. */
function retryAfter(header: string | null): number | null {
  const value = header?.trim();
  if (!value || !/^\d+$/.test(value)) return null;
  return Number(value) * 1000;
}

export function readBlockedPlayer(v: unknown): BlockedPlayer | null {
  if (!isObj(v) || !isNum(v.blockedAt)) return null;
  const player = readPublicPlayer(v);
  return player ? { ...player, blockedAt: v.blockedAt } : null;
}

export function readBlockList(v: unknown): BlockList | null {
  if (!isObj(v) || !Array.isArray(v.blocks)) return null;
  const blocks: BlockedPlayer[] = [];
  for (const item of v.blocks) {
    const player = readBlockedPlayer(item);
    // A row this app can't read (a newer server) is left out rather than losing the whole list.
    if (player) blocks.push(player);
  }
  return { blocks, max: isNum(v.max) && v.max > 0 ? v.max : MAX_BLOCKS };
}

export function readReportReceipt(v: unknown): ReportReceipt | null {
  if (!isObj(v) || typeof v.id !== 'string' || v.id === '' || !isReportReason(v.reason)) return null;
  return {
    id: v.id,
    playerId: typeof v.playerId === 'string' ? v.playerId : '',
    reason: v.reason,
    status: 'open',
    gameId: typeof v.gameId === 'string' ? v.gameId : null,
    createdAt: isNum(v.createdAt) ? v.createdAt : 0,
    respondWithinHours:
      isNum(v.respondWithinHours) && v.respondWithinHours > 0 ? v.respondWithinHours : REPORT_RESPONSE_HOURS,
  };
}

/** A player id the server would take (PLAYER_ID_PATTERN): anything else is refused here, without a call. */
export const isPlayerId = (id: string): boolean => PLAYER_ID_PATTERN.test(id);

export function createModerationApi(deps: ModerationApiDeps): ModerationApi {
  const set = deps.setTimeout ?? ((cb, ms) => setTimeout(cb, ms));
  const clear = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  async function send(
    method: FetchInit['method'],
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown }> {
    const attempt = async (forceRefresh: boolean) => {
      const token = await deps.getToken(forceRefresh).catch(() => null);
      if (!token) throw new ModerationApiError('signedOut');
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
      try {
        const response = await deps.fetch(`${deps.baseUrl}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        return {
          status: response.status,
          retryAfter: response.headers.get('Retry-After'),
          data: parseJson(await response.text()),
        };
      } catch {
        throw new ModerationApiError(timedOut ? 'timeout' : 'network');
      } finally {
        clear(timer);
      }
    };
    let result = await attempt(false);
    // An expired or revoked token: a fresh one, once.
    if (result.status === 401) result = await attempt(true);
    if (result.status >= 200 && result.status < 300) return { status: result.status, data: result.data };
    const error = errorBodyOf(result.data);
    throw new ModerationApiError(
      error?.error ?? codeOfStatus(result.status),
      result.status,
      error,
      retryAfter(result.retryAfter),
    );
  }

  const checkId = (playerId: string) => {
    if (!isPlayerId(playerId)) {
      throw new ModerationApiError('badRequest', null, { error: 'badRequest', field: 'playerId' });
    }
  };

  return {
    async report(request) {
      checkId(request.playerId);
      try {
        const { data } = await send('POST', MODERATION_PATHS.reports, request);
        const receipt = readReportReceipt(data);
        if (!receipt) throw new ModerationApiError('unexpected');
        return { id: receipt.id, duplicate: false, respondWithinHours: receipt.respondWithinHours };
      } catch (error) {
        // The same report is open already: nothing new stored, and the same thank-you (protocol moderation.ts).
        if (isModerationApiError(error) && error.code === 'duplicate') {
          return {
            id: error.body?.reportId ?? '',
            duplicate: true,
            respondWithinHours: REPORT_RESPONSE_HOURS,
          };
        }
        throw error;
      }
    },
    async blocks() {
      const list = readBlockList((await send('GET', MODERATION_PATHS.blocks)).data);
      if (!list) throw new ModerationApiError('unexpected');
      return list;
    },
    async block(playerId) {
      checkId(playerId);
      const request: BlockRequest = { playerId };
      const player = readBlockedPlayer((await send('POST', MODERATION_PATHS.blocks, request)).data);
      if (!player) throw new ModerationApiError('unexpected');
      return player;
    },
    async unblock(playerId) {
      checkId(playerId);
      await send('DELETE', blockPath(playerId));
    },
  };
}
