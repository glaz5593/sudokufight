import {
  type FriendRoomCreateRequest,
  type FriendRoomJoinRequest,
  type FriendRoomTicket,
  type FriendsAppError,
  type FriendsError,
  type FriendsErrorCode,
  friendsErrorOf,
  type FriendsField,
  FRIENDS_PATHS,
  isFriendRoomTicket,
  isFriendsErrorCode,
  normalizeFriendCode,
} from '@sudoku-fight/protocol';

import type { AccountFetch } from './accountApi';

/**
 * The friends rooms' HTTP routes on the game server (1.0.4; the contract is @sudoku-fight/protocol's
 * friends.ts): POST /v1/rooms opens a room with the caller as its host, POST /v1/rooms/join takes a seat in one
 * by its code. Both answer with a ticket, whose seat reservation enters the room at once
 * (`client.consumeSeatReservation`, as a ranked match's). Every call carries the sign-in's ID token; a 401
 * refreshes it and tries once more.
 *
 * Failures come out as RoomsApiError, with exactly the codes a friends screen explains: the server's own
 * (FRIENDS_ERROR_CODES) and the app's `network` (no answer, or none in time) and `notAvailable` (a server
 * without these routes: its 404 has no `rooms: true`, protocol friendsErrorOf). Nobody signed in is
 * `unauthorized`, an answer this app can't read is `internal`.
 *
 * Pure: fetch, the token and the timers come in, so tests drive it.
 */

export type RoomsApiErrorCode = FriendsErrorCode | FriendsAppError;

export class RoomsApiError extends Error {
  constructor(
    readonly code: RoomsApiErrorCode,
    readonly status: number | null = null,
    readonly body: FriendsError | null = null,
    /** 429: how long the server asked us to wait (the body's retryAfterSec, or Retry-After). */
    readonly retryAfterMs: number | null = null,
  ) {
    super(body?.message ?? code);
    this.name = 'RoomsApiError';
  }

  /** badRequest: the field at fault. */
  get field(): FriendsField | null {
    return this.body?.field ?? null;
  }

  /** tooManyRooms: the code of the open lobby the caller hosts already ("לסגור את החדר הקודם?"). */
  get openCode(): string | null {
    return this.body?.code ?? null;
  }
}

export const isRoomsApiError = (e: unknown): e is RoomsApiError => e instanceof RoomsApiError;

export interface RoomsApiDeps {
  /** The server's HTTP origin, no trailing slash (config/server.ts httpBaseUrl()). */
  baseUrl: string;
  /** The sign-in's ID token, refreshed when `forceRefresh`; null when nobody is signed in. */
  getToken: (forceRefresh: boolean) => Promise<string | null>;
  fetch: AccountFetch;
  timeoutMs: number;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface RoomsApi {
  /** POST /v1/rooms: a new room, the caller its host. */
  create(request: FriendRoomCreateRequest): Promise<FriendRoomTicket>;
  /**
   * POST /v1/rooms/join: a seat in the room with this code (as typed: it is normalised first, and a code that
   * can't be one is `badRequest` without a call). The same account again gets its own seat back.
   */
  join(request: FriendRoomJoinRequest): Promise<FriendRoomTicket>;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The body of an error answer, when it is one this app knows (a FriendsError). */
function errorBodyOf(value: unknown): FriendsError | null {
  return isObj(value) && isFriendsErrorCode(value.error) ? (value as unknown as FriendsError) : null;
}

/** Retry-After in delta-seconds (what our server sends), as ms; null when missing or unreadable. */
function retryAfterHeader(header: string | null): number | null {
  const value = header?.trim();
  if (!value || !/^\d+$/.test(value)) return null;
  return Number(value) * 1000;
}

/** How long a 429 asks to wait: the body's retryAfterSec first, then the header. */
function retryAfterOf(body: FriendsError | null, header: string | null): number | null {
  const sec = body?.retryAfterSec;
  if (typeof sec === 'number' && Number.isFinite(sec) && sec > 0) return Math.ceil(sec) * 1000;
  return retryAfterHeader(header);
}

export function createRoomsApi(deps: RoomsApiDeps): RoomsApi {
  const set = deps.setTimeout ?? ((cb, ms) => setTimeout(cb, ms));
  const clear = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  async function post(path: string, body: object): Promise<unknown> {
    const attempt = async (forceRefresh: boolean) => {
      const token = await deps.getToken(forceRefresh).catch(() => null);
      if (!token) throw new RoomsApiError('unauthorized');
      const controller = new AbortController();
      const timer = set(() => controller.abort(), deps.timeoutMs);
      try {
        const response = await deps.fetch(`${deps.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        return {
          status: response.status,
          retryAfter: response.headers.get('Retry-After'),
          data: parseJson(await response.text()),
        };
      } catch {
        // No answer, or none in time: both are "no connection" to the player.
        throw new RoomsApiError('network');
      } finally {
        clear(timer);
      }
    };
    let result = await attempt(false);
    // An expired or revoked token: a fresh one, once.
    if (result.status === 401) result = await attempt(true);
    if (result.status >= 200 && result.status < 300) return result.data;
    const error = errorBodyOf(result.data);
    throw new RoomsApiError(
      friendsErrorOf(result.status, result.data),
      result.status,
      error,
      result.status === 429 ? retryAfterOf(error, result.retryAfter) : null,
    );
  }

  const ticketOf = (data: unknown): FriendRoomTicket => {
    if (!isFriendRoomTicket(data)) throw new RoomsApiError('internal');
    return data;
  };

  return {
    async create(request) {
      return ticketOf(await post(FRIENDS_PATHS.rooms, request));
    },
    async join(request) {
      const code = normalizeFriendCode(request.code);
      if (code === null) {
        throw new RoomsApiError('badRequest', null, { error: 'badRequest', rooms: true, field: 'code' });
      }
      return ticketOf(await post(FRIENDS_PATHS.join, { ...request, code }));
    },
  };
}
