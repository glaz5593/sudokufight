import {
  type FriendsAppError,
  type FriendsErrorCode,
  type GameRoomError,
  gameRoomErrorOf,
} from '@sudoku-fight/protocol';

/**
 * Why going online failed, as the app acts on it (spec §16.3: "connection error: there is a network, but the
 * game server did not answer"). The server's own refusals come as GameRoomError (protocol, room.ts: the message
 * starts with it); Colyseus's refusals and network failures are recognised by their code and message.
 *
 * A friends room (1.0.4, protocol friends.ts) is entered through our HTTP routes (POST /v1/rooms/join, also to
 * come back without a reconnection token): their refusals become OnlineErrors with onlineErrorOfFriends(), and
 * keep the route's own code in `friends` for the friends screens' texts.
 */
export type OnlineErrorCode =
  | GameRoomError
  /** What was typed can't be a room code (normalizeRoomCode said no). */
  | 'badCode'
  /** No room has this code. */
  | 'notFound'
  /** The room is full. */
  | 'roomFull'
  /** Reconnecting: the room is no more (the game ended and it closed, or the server restarted). */
  | 'roomGone'
  /** Reconnecting: the server holds no seat for this token (not yet noticed the drop, or the grace is over). */
  | 'tokenExpired'
  /** No answer: no network, the server is down, or it took too long. Worth another try. */
  | 'network'
  /** The server speaks another protocol version: the app needs an update. */
  | 'protocol'
  /** A friends room: the caller blocked a player who is in it [D85c] ("חסמת שחקן שנמצא בחדר הזה"). */
  | 'cantJoin'
  /** A friends room: too many tries; `retryAfterMs` says how long to wait. */
  | 'tooManyRequests'
  /** A friends room: the server has no /v1/rooms routes (older than 1.0.4). */
  | 'notAvailable'
  | 'unknown';

/**
 * What a friends screen explains (friends.json): a code of the /v1/rooms routes, or the app's own `network` and
 * `notAvailable` (protocol FRIENDS_APP_ERRORS).
 */
export type FriendsProblem = FriendsErrorCode | FriendsAppError;

export interface OnlineErrorDetails {
  /** 429: how long the server asked to wait (ms). */
  retryAfterMs?: number | null;
  /** A friends room's refusal, as its route said it (see FriendsProblem). */
  friends?: FriendsProblem | null;
}

export class OnlineError extends Error {
  readonly code: OnlineErrorCode;
  /** The SDK's own code (an HTTP status, a close code, an errno), for the small support code; null without. */
  readonly status: number | string | null;
  /** tooManyRequests: how long the server asked to wait (ms); null otherwise. */
  readonly retryAfterMs: number | null;
  /** A refusal of the friends rooms' HTTP routes, as they said it; null for anything else. */
  readonly friends: FriendsProblem | null;

  constructor(
    code: OnlineErrorCode,
    message: string,
    status: number | string | null = null,
    details: OnlineErrorDetails = {},
  ) {
    super(message);
    this.name = 'OnlineError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = details.retryAfterMs ?? null;
    this.friends = details.friends ?? null;
  }

  /** For the error screen (spec §16.3): e.g. "notFound-522". Never carries a token. */
  get supportCode(): string {
    return this.status === null ? this.code : `${this.code}-${this.status}`;
  }
}

/** Errors that another try may get past. */
export const isRetryable = (code: OnlineErrorCode): boolean => code === 'network';

const statusOf = (error: unknown): number | string | null => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'number' || (typeof code === 'string' && code !== '') ? code : null;
};

/** Colyseus's matchmaking codes (MATCHMAKE_NO_HANDLER … APPLICATION_ERROR): the server answered. */
const isMatchmakeCode = (status: number | string | null) =>
  typeof status === 'number' && status >= 520 && status <= 526;

/** Any failure of the SDK (MatchMakeError, ServerError, a network TypeError, AbortError …) as an OnlineError. */
export function onlineErrorOf(error: unknown): OnlineError {
  if (error instanceof OnlineError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const status = statusOf(error);
  const room = gameRoomErrorOf(message);
  if (room) return new OnlineError(room, message, status);
  if (/reconnection token invalid or expired/i.test(message))
    return new OnlineError('tokenExpired', message, status);
  if (/has been disposed/i.test(message)) return new OnlineError('roomGone', message, status);
  if (/\bnot found\b/i.test(message)) return new OnlineError('notFound', message, status);
  if (/\bis locked\b/i.test(message)) return new OnlineError('roomFull', message, status);
  if (isMatchmakeCode(status)) return new OnlineError('unknown', message, status);
  // No status (a fetch that failed), an errno ('ECONNREFUSED'), a socket close code, a proxy's 5xx, a timeout.
  const network =
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TypeError')) ||
    status === null ||
    typeof status === 'string' ||
    (status >= 1000 && status < 1100) ||
    status >= 500 ||
    /network|fetch failed|timed? ?out|ECONN|socket/i.test(message);
  return new OnlineError(network ? 'network' : 'unknown', message, status);
}

/** The OnlineErrorCode of each friends route refusal (FriendsProblem), as the host acts on it. */
const FRIENDS_ONLINE_CODES: Readonly<Record<FriendsProblem, OnlineErrorCode>> = {
  notFound: 'notFound',
  roomFull: 'roomFull',
  gameStarted: 'gameStarted',
  roomClosed: 'roomClosed',
  kicked: 'kicked',
  suspended: 'suspended',
  cantJoin: 'cantJoin',
  tooManyRequests: 'tooManyRequests',
  notAvailable: 'notAvailable',
  unauthorized: 'unauthenticated',
  notRegistered: 'unauthenticated',
  network: 'network',
  unavailable: 'network',
  internal: 'network',
  disabled: 'network',
  badRequest: 'unknown',
  tooLarge: 'unknown',
  tooManyRooms: 'unknown',
};

/**
 * A refusal of the friends rooms' HTTP routes (POST /v1/rooms, /v1/rooms/join) as an OnlineError: the code the
 * host acts on (a refusal that a later try can't change ends the way back), with the route's own code kept in
 * `friends`. A server that could not answer now (5xx) counts as `network`: worth another try.
 */
export function onlineErrorOfFriends(
  problem: FriendsProblem,
  status: number | null = null,
  retryAfterMs: number | null = null,
): OnlineError {
  return new OnlineError(FRIENDS_ONLINE_CODES[problem], `friends: ${problem}`, status, {
    retryAfterMs,
    friends: problem,
  });
}

/**
 * What a friends screen says about an OnlineError: the route's own code when it came from one, else the code a
 * friends room's refusal or lost connection maps to (the room's own refusals, `gameStarted: …`, `kicked: …`).
 */
export function friendsProblemOf(error: OnlineError): FriendsProblem {
  if (error.friends) return error.friends;
  switch (error.code) {
    case 'notFound':
    case 'badCode':
    case 'roomGone':
      return 'notFound';
    case 'roomFull':
    case 'gameStarted':
    case 'kicked':
    case 'roomClosed':
    case 'suspended':
    case 'cantJoin':
    case 'tooManyRequests':
    case 'notAvailable':
    case 'network':
      return error.code;
    case 'unauthenticated':
      return 'unauthorized';
    default:
      return 'internal';
  }
}
