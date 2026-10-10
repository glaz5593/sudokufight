import { type GameRoomError, gameRoomErrorOf } from '@sudoku-fight/protocol';

/**
 * Why going online failed, as the app acts on it (spec §16.3: "connection error: there is a network, but the
 * game server did not answer"). The server's own refusals come as GameRoomError (protocol, room.ts: the message
 * starts with it); Colyseus's refusals and network failures are recognised by their code and message.
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
  | 'unknown';

export class OnlineError extends Error {
  readonly code: OnlineErrorCode;
  /** The SDK's own code (an HTTP status, a close code, an errno), for the small support code; null without. */
  readonly status: number | string | null;

  constructor(code: OnlineErrorCode, message: string, status: number | string | null = null) {
    super(message);
    this.name = 'OnlineError';
    this.code = code;
    this.status = status;
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
