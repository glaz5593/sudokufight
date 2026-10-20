import { type GameType, isGameType, type PlayerId } from '@sudoku-fight/engine';

import { type AvatarId, type CountryCode, isAvatarId, isCountryCode, NO_AVATAR_ID } from './account';
import type { AdminDayCount } from './admin';
import type { MatchSeatReservation } from './matchmaking';
import { PLAYER_ID_PATTERN } from './moderation';

/**
 * Playing with friends (1.0.4; docs/handoff/2026-10-19/friends-room.md, D80–D89): a private waiting room with
 * a 6-digit code and a link, up to 4 players, started by its host, never rated [D81a].
 *
 * The code is not the room's id (the security fix of §5): the Colyseus room of a friends room has a long random
 * id, and the code is only a key in the server's table (apps/server/src/friends/service.ts, FriendRooms). Every
 * way in goes through our own HTTP routes, with an account, rate limits and the block checks, and ends in a seat
 * reservation, as for a ranked match: `client.consumeSeatReservation(ticket.reservation)`. A client never
 * creates the room (`client.create(FRIENDS_ROOM_NAME)` is refused `badOptions`) and never joins it by id.
 *
 * Who is calling: `Authorization: Bearer <Firebase ID token>` (or `dev:<uid>` outside production), as for the
 * account routes (./account.ts). Bodies are JSON; times are epoch ms. Answers are personal: `no-store`.
 *
 * Routes:
 *   POST /v1/rooms        FriendRoomCreateRequest → 201 FriendRoomTicket (the caller is the host)
 *        409 tooManyRooms (`code`: the caller hosts that open lobby already; send again with `replace: true`
 *        after "לסגור את החדר הקודם?") · 403 suspended · 429 tooManyRequests (`retryAfterSec`) · 503 unavailable
 *        (no free code, or the room could not open)
 *   POST /v1/rooms/join   FriendRoomJoinRequest   → 200 FriendRoomTicket
 *        404 notFound (no open room has the code, or someone in it blocked the caller: the same answer [D85c]) ·
 *        403 cantJoin (the caller blocked someone in the room) | kicked (the host removed the caller from this
 *        room) | suspended · 409 roomFull | gameStarted (the caller is not one of its players; a player of the
 *        game gets a ticket back to it) · 410 roomClosed · 429 tooManyRequests (`retryAfterSec`)
 *        The same account again (another device, or the app was closed) gets its own seat back; the host stays
 *        the host, and the earlier connection gets `roomClosed` `otherDevice`.
 *   GET  /r/:code                         → 200 HTML, public: the page of a link opened in a browser. The same
 *        page for every well-formed code: it never says whether the room exists or who is in it.
 *   GET  /.well-known/assetlinks.json     → 200 JSON (Android App Links) · 404 when the server has no keys set
 *   GET  /.well-known/apple-app-site-association → 200 JSON (iOS) · 404 without IOS_APP_ID
 * Every /v1/rooms route may answer: 400 badRequest (`field`) · 401 unauthorized (refresh the token, try once
 * more) · 404 notRegistered (the sign-in has no account) · 413 tooLarge · 429 tooManyRequests · 500 internal ·
 * 503 disabled (no Firebase project on this server) | unavailable. Every error answer of these routes carries
 * `rooms: true` (FriendsError), so the app tells a room that is not there from a server without the routes (an
 * older server's 404 `notFound`): friendsErrorOf().
 *
 * In the room (a Colyseus room named FRIENDS_ROOM_NAME), before the game:
 * - `lobby` (index.ts) to everyone on every change: the seats in the order they came, each with avatar, flag,
 *   rating and `away`; `hostId`, `minPlayers`, `maxPlayers`; `code` is the 6-digit code, `gameType` the host's
 *   current choice and `playerCount` the room's seats (FRIENDS_MAX_PLAYERS).
 * - The host's commands (FriendsLobbyCommand: `start`, `setGameType`, `kick`), sent as
 *   `room.send(command.type, command)`. From anyone else, or refused, they come back as `lobbyRefused` to the
 *   sender only. `start` with enough connected players starts the 3… 2… 1… (`countdown`, then `snapshot` at GO),
 *   exactly as a ranked match's room.
 * - Leaving on purpose (`room.leave()`, consented) frees the seat at once. A lost connection (the app in the
 *   background, or closed) holds the seat, shown `away` [D84a], until the server's hold runs out; the app comes
 *   back with its reconnection token, or without one through POST /v1/rooms/join.
 * - `roomClosed` tells a connection why it is out (FriendsRoomClosedReason), just before the server closes it.
 * From GO on it is the ranked game room's game (same rules, interferences, reactions, grace), with no rating.
 */

/** The Colyseus room's name. Clients never create it: the server opens it for a POST /v1/rooms. */
export const FRIENDS_ROOM_NAME = 'friends';

/** 6 digits, 000000–999999 [D86]; shown as "123 456" (formatFriendCode), always left to right. */
export const FRIEND_CODE_LENGTH = 6;
export const FRIEND_CODE_PATTERN = /^[0-9]{6}$/;

/** A game starts with 2–4 players: whoever is connected at "התחל". */
export const FRIENDS_MIN_PLAYERS = 2;
export const FRIENDS_MAX_PLAYERS = 4;

/** The game type of a new room when the request names none [D82]: "רגיל". */
export const FRIENDS_DEFAULT_GAME_TYPE: GameType = 'normal';

// ---------------------------------------------------------------------------------------------------------
// The code

/**
 * Bidi controls (LRM, RLM, ALM, the embeddings and the isolates LRI…PDI): a code copied out of Hebrew text may
 * carry them, and they mean nothing in it.
 */
const BIDI_CONTROLS = /[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g;
/** What may stand between the digits of a typed or pasted code: spaces (NBSP too), dashes and dots. */
const CODE_SEPARATORS = /[\s\-\u2010-\u2015.]/g;

/** Arabic-Indic, Eastern Arabic-Indic and full-width digits, as ASCII (some keyboards type them). */
function asciiDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06f0-\u06f9\uff10-\uff19]/g, (ch) => {
    const c = ch.charCodeAt(0);
    const zero = c >= 0xff10 ? 0xff10 : c >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(c - zero);
  });
}

const cleanText = (text: string): string => asciiDigits(text.replace(BIDI_CONTROLS, ''));

/**
 * A code as typed (spaces, dashes or dots around or between the digits; any digits a keyboard makes) in its
 * canonical form, 6 ASCII digits, or null when it can't be a code.
 */
export function normalizeFriendCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 64) return null;
  const code = cleanText(input).replace(CODE_SEPARATORS, '');
  return FRIEND_CODE_PATTERN.test(code) ? code : null;
}

export const isFriendCode = (v: unknown): v is string => typeof v === 'string' && FRIEND_CODE_PATTERN.test(v);

/** "123 456": the code as the screens show it (in Hebrew text, wrap it in LRI…PDI). */
export function formatFriendCode(code: string): string {
  const c = normalizeFriendCode(code);
  return c === null ? code : `${c.slice(0, 3)} ${c.slice(3)}`;
}

/** The app's own link scheme (app.json `scheme`). */
export const FRIENDS_APP_SCHEME = 'sudokufight';

/** The path of a room's link on the server: `/r/123456`. */
export const roomLinkPath = (code: string): string => `/r/${code}`;

/**
 * A room's link (D87): `https://<server>/r/123456`. `server` is the app's server: a host name
 * ("sudoku-fight-staging.fly.dev", https assumed) or an origin ("http://192.168.1.20:2567"); a default port
 * (443, 80) and trailing slashes are dropped. Throws on a code that is not one (a bug, not an input).
 */
export function roomLink(server: string, code: string): string {
  const c = normalizeFriendCode(code);
  if (c === null) throw new RangeError(`not a room code: ${code}`);
  let origin = server.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(origin)) origin = `https://${origin}`;
  origin = origin.replace(/^(https:\/\/[^/]+):443$/i, '$1').replace(/^(http:\/\/[^/]+):80$/i, '$1');
  return `${origin}${roomLinkPath(c)}`;
}

/** The app's own link to a room, `sudokufight://room/123456`: "פתח באפליקציה" on the page, and a fallback. */
export function roomAppLink(code: string): string {
  const c = normalizeFriendCode(code);
  if (c === null) throw new RangeError(`not a room code: ${code}`);
  return `${FRIENDS_APP_SCHEME}://room/${c}`;
}

/** The end of a path segment: nothing more, or `/`, `?`, `#`. */
const SEGMENT_END = '(?=$|[/?#])';
const HTTP_LINK = new RegExp(`^https?://([^/?#\\s]+)/r/([0-9]{6})${SEGMENT_END}`, 'i');
const APP_LINK = new RegExp(`^${FRIENDS_APP_SCHEME}://(?:/)?room/([0-9]{6})${SEGMENT_END}`, 'i');
const PATH_LINK = new RegExp(`^/(?:r|room)/([0-9]{6})${SEGMENT_END}`);

/**
 * The code of a room link the app was opened with, or null when `url` is not one:
 * `https://<host>/r/123456` (or http), `sudokufight://room/123456`, or a bare path `/r/123456`, `/room/123456`.
 * With `expectedHost`, an http(s) link must be on that host (any port; case does not matter): a link to a
 * room on another server is not ours. The code must be 6 digits exactly.
 */
export function friendCodeFromLink(url: string, expectedHost?: string): string | null {
  const text = url.trim();
  const http = HTTP_LINK.exec(text);
  if (http) {
    const host = http[1]!
      .replace(/^[^@]*@/, '')
      .replace(/:\d+$/, '')
      .toLowerCase();
    if (expectedHost !== undefined && host !== expectedHost.trim().toLowerCase()) return null;
    return http[2]!;
  }
  return APP_LINK.exec(text)?.[1] ?? PATH_LINK.exec(text)?.[1] ?? null;
}

/** Characters that may join two groups of digits into one number ("123456.78", "12:345678", "1/234567"). */
const NUMBER_GLUE = /[.,:/]/;
/** Between the two halves of "123 456": spaces and dashes only, 1–3 of them. */
const HALVES_GAP = /^[\s\-\u2010-\u2015]{1,3}$/;
const LINK_IN_TEXT = new RegExp(
  `(?:https?://[^/?#\\s]+/r/|${FRIENDS_APP_SCHEME}://(?:/)?room/)([0-9]{6})(?![0-9])`,
  'i',
);

interface DigitRun {
  start: number;
  end: number;
  digits: string;
}

/**
 * The code in a whole pasted message (§3.3: "בוא לשחק איתי… קוד החדר: 123456 https://…/r/123456"), or null:
 * 1. text that is a code and nothing else ("123456", "123 456", "1 2 3 4 5 6");
 * 2. else the code of the first room link in it (https or sudokufight://);
 * 3. else the first number of exactly 6 digits that is not glued to more digits ("123456.78", "12:345678"),
 *    or two groups of 3 split by 1–3 spaces or dashes ("123 456") that are not part of a longer spaced number
 *    ("123 456 789", "054-123-456"). A phone number, a time or a date has no such number.
 */
export function extractFriendCode(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const whole = normalizeFriendCode(text);
  if (whole !== null) return whole;
  const clean = cleanText(text.slice(0, 4096));
  const link = LINK_IN_TEXT.exec(clean);
  if (link) return link[1]!;

  const runs: DigitRun[] = [];
  for (const m of clean.matchAll(/[0-9]+/g))
    runs.push({ start: m.index, end: m.index + m[0].length, digits: m[0] });
  const gluedLeft = (r: DigitRun) =>
    r.start >= 2 && NUMBER_GLUE.test(clean[r.start - 1]!) && /[0-9]/.test(clean[r.start - 2]!);
  const gluedRight = (r: DigitRun) =>
    NUMBER_GLUE.test(clean[r.end] ?? '') && /[0-9]/.test(clean[r.end + 1] ?? '');
  const spaced = (a: DigitRun | undefined, b: DigitRun | undefined) =>
    a !== undefined && b !== undefined && HALVES_GAP.test(clean.slice(a.end, b.start));

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    if (run.digits.length === 6 && !gluedLeft(run) && !gluedRight(run)) return run.digits;
    const next = runs[i + 1];
    if (
      next !== undefined &&
      run.digits.length === 3 &&
      next.digits.length === 3 &&
      spaced(run, next) &&
      !gluedLeft(run) &&
      !gluedRight(next) &&
      !spaced(runs[i - 1], run) &&
      !spaced(next, runs[i + 2])
    )
      return run.digits + next.digits;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// HTTP: requests and answers

export const FRIENDS_PATHS = {
  /** POST: open a room; the caller is its host. */
  rooms: '/v1/rooms',
  /** POST: take a seat in a room by its code. */
  join: '/v1/rooms/join',
  /** GET, public: a room link opened in a browser (the route pattern; roomLinkPath() builds one). */
  link: '/r/:code',
  /** GET, public: Android App Links (ANDROID_APP_LINK_SHA256). */
  assetLinks: '/.well-known/assetlinks.json',
  /** GET, public: iOS universal links (IOS_APP_ID). */
  appleAppSiteAssociation: '/.well-known/apple-app-site-association',
} as const;

/** POST /v1/rooms. Who the host is comes from the token. */
export interface FriendRoomCreateRequest {
  /** The room's first game type (the host may change it in the room until the start) [D82]. Default 'normal'. */
  gameType?: GameType;
  /**
   * The interference kinds this app can show [D47], as in MatchmakingJoinOptions: the game allows only the kinds
   * every seat declared. Absent: LEGACY_INTERFERENCE_KINDS.
   */
  interferenceKinds?: string[];
  /** Close the open lobby this account hosts (the answer to a 409 tooManyRooms), then open the new one. */
  replace?: boolean;
}

/** POST /v1/rooms/join. */
export interface FriendRoomJoinRequest {
  /** 6 digits (normalizeFriendCode first: the server takes the canonical form only). */
  code: string;
  /** As in FriendRoomCreateRequest. */
  interferenceKinds?: string[];
}

export const FRIEND_ROOM_STATES = ['lobby', 'playing'] as const;
/** `lobby`: waiting for "התחל"; `playing`: its game runs (the countdown included) or just ended. */
export type FriendRoomState = (typeof FRIEND_ROOM_STATES)[number];

/** The host, as an invitation shows them. */
export interface FriendRoomHost {
  name: string;
  avatarId: AvatarId | typeof NO_AVATAR_ID;
  country: CountryCode | null;
}

/** A room as its code finds it. */
export interface FriendRoomSummary {
  code: string;
  gameType: GameType;
  /** Seats taken: connected, or held for a player who is away. */
  players: number;
  /** FRIENDS_MAX_PLAYERS. */
  maxPlayers: number;
  state: FriendRoomState;
  host: FriendRoomHost;
}

/** 201 from POST /v1/rooms, 200 from POST /v1/rooms/join. */
export interface FriendRoomTicket {
  /** Join the room with it at once (`client.consumeSeatReservation(reservation)`): single use, short lived. */
  reservation: MatchSeatReservation;
  room: FriendRoomSummary;
}

export const FRIENDS_ERROR_CODES = [
  /** 400: malformed body (a code that is not 6 digits, an unknown game type…); `field` says which. */
  'badRequest',
  /** 401: no token, or a bad or expired one. Refresh the ID token and try once more. */
  'unauthorized',
  /** 403: the account is suspended (spec §3.5). */
  'suspended',
  /** 403: the host removed this player from this room [D85a]; no way back into it. */
  'kicked',
  /** 403: the caller blocked a player who is in the room [D85c] ("חסמת שחקן שנמצא בחדר הזה"). */
  'cantJoin',
  /** 404: this sign-in has no account. */
  'notRegistered',
  /**
   * 404: no open room has this code, or a player in it blocked the caller (the same answer, so nobody learns
   * they were blocked [D85c]).
   */
  'notFound',
  /** 409: FRIENDS_MAX_PLAYERS seats are taken. */
  'roomFull',
  /** 409: the room's game started, and the caller is not one of its players. */
  'gameStarted',
  /** 409: the caller hosts an open lobby already; `code` is it. Send again with `replace: true` to close it. */
  'tooManyRooms',
  /** 410: the room closed (everyone left, its seats lapsed, or the server restarted) a short while ago. */
  'roomClosed',
  /** 413: the body is too big. */
  'tooLarge',
  /** 429: too many rooms or tries; wait `retryAfterSec` (also Retry-After) seconds. */
  'tooManyRequests',
  /** 500. */
  'internal',
  /** 503: accounts are off on this server. */
  'disabled',
  /** 503: tokens can't be checked right now, no free code, or the room could not open. Try again later. */
  'unavailable',
] as const;
export type FriendsErrorCode = (typeof FRIENDS_ERROR_CODES)[number];

export const isFriendsErrorCode = (v: unknown): v is FriendsErrorCode =>
  FRIENDS_ERROR_CODES.includes(v as FriendsErrorCode);

/** The HTTP status of each answer code. */
export const FRIENDS_ERROR_STATUS: Readonly<Record<FriendsErrorCode, number>> = {
  badRequest: 400,
  unauthorized: 401,
  suspended: 403,
  kicked: 403,
  cantJoin: 403,
  notRegistered: 404,
  notFound: 404,
  roomFull: 409,
  gameStarted: 409,
  tooManyRooms: 409,
  roomClosed: 410,
  tooLarge: 413,
  tooManyRequests: 429,
  internal: 500,
  disabled: 503,
  unavailable: 503,
};

export type FriendsField = 'code' | 'gameType' | 'interferenceKinds' | 'replace' | 'body';

export interface FriendsError {
  error: FriendsErrorCode;
  /** Always there on an error answer of the /v1/rooms routes: see friendsErrorOf(). */
  rooms: true;
  message?: string;
  /** badRequest: the field at fault. */
  field?: FriendsField;
  /** tooManyRequests: whole seconds to wait (at least 1; also the Retry-After header). */
  retryAfterSec?: number;
  /** tooManyRooms: the code of the open lobby the caller hosts. */
  code?: string;
}

/**
 * What only the app can tell (§3.6), next to the server's codes: `network` (no answer at all) and
 * `notAvailable` (a server without the /v1/rooms routes: "האפשרות הזו עוד לא זמינה").
 */
export const FRIENDS_APP_ERRORS = ['network', 'notAvailable'] as const;
export type FriendsAppError = (typeof FRIENDS_APP_ERRORS)[number];

/**
 * The code of an error answer (status and JSON body) of a /v1/rooms route. A 404 `notFound` without
 * `rooms: true` is a server that has no such route (older than 1.0.4): `notAvailable`. A body without a code
 * this file knows (a proxy's page, the guard's answer) goes by its status.
 */
export function friendsErrorOf(status: number, body: unknown): FriendsErrorCode | 'notAvailable' {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  const error = record?.error;
  if (isFriendsErrorCode(error) && (error !== 'notFound' || record?.rooms === true)) return error;
  if (status === 404 || status === 405 || status === 501) return 'notAvailable';
  if (status === 400) return 'badRequest';
  if (status === 401) return 'unauthorized';
  if (status === 413) return 'tooLarge';
  if (status === 429) return 'tooManyRequests';
  if (status === 502 || status === 503 || status === 504) return 'unavailable';
  return 'internal';
}

// ---------------------------------------------------------------------------------------------------------
// Checks for the app (an answer it can't read is refused, never half used)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function isReservation(v: unknown): v is MatchSeatReservation {
  return (
    isRecord(v) &&
    typeof v.name === 'string' &&
    typeof v.sessionId === 'string' &&
    typeof v.roomId === 'string' &&
    v.sessionId !== '' &&
    v.roomId !== ''
  );
}

export function isFriendRoomSummary(v: unknown): v is FriendRoomSummary {
  if (!isRecord(v) || !isRecord(v.host)) return false;
  const { host } = v;
  return (
    isFriendCode(v.code) &&
    isGameType(v.gameType) &&
    isCount(v.players) &&
    isCount(v.maxPlayers) &&
    v.players <= v.maxPlayers &&
    FRIEND_ROOM_STATES.includes(v.state as FriendRoomState) &&
    typeof host.name === 'string' &&
    (host.avatarId === NO_AVATAR_ID || isAvatarId(host.avatarId)) &&
    (host.country === null || isCountryCode(host.country))
  );
}

export function isFriendRoomTicket(v: unknown): v is FriendRoomTicket {
  return isRecord(v) && isReservation(v.reservation) && isFriendRoomSummary(v.room);
}

// ---------------------------------------------------------------------------------------------------------
// In the room: the host's commands, and the server's two messages of its own

/**
 * Client → server, the host only, before the game (`room.send(command.type, command)`):
 * - `start`: 3… 2… 1… with whoever is connected. `withoutAway` [D83] lists the away players the host agreed to
 *   start without ("Avi לא בחדר כרגע. להתחיל בלי Avi?"); a seat away now and not on it refuses `playersAway`.
 * - `setGameType`: the room's game type [D82]; everyone gets a fresh `lobby`.
 * - `kick`: remove a guest [D85a] (not the host); they get `roomClosed` `kicked` and can't come back.
 */
export type FriendsLobbyCommand =
  | { type: 'start'; withoutAway?: PlayerId[] }
  | { type: 'setGameType'; gameType: GameType }
  | { type: 'kick'; playerId: PlayerId };

export type FriendsLobbyCommandType = FriendsLobbyCommand['type'];

export const FRIENDS_LOBBY_COMMAND_TYPES = [
  'start',
  'setGameType',
  'kick',
] as const satisfies readonly FriendsLobbyCommandType[];

/** The command a message is, checked (the room's message handlers use it), or null. */
export function friendsLobbyCommandOf(type: unknown, message: unknown): FriendsLobbyCommand | null {
  const m = isRecord(message) ? message : {};
  switch (type) {
    case 'start': {
      const away = m.withoutAway;
      if (away === undefined) return { type };
      if (
        !Array.isArray(away) ||
        away.length > FRIENDS_MAX_PLAYERS ||
        !away.every((id) => typeof id === 'string' && PLAYER_ID_PATTERN.test(id))
      )
        return null;
      return { type, withoutAway: [...(away as string[])] };
    }
    case 'setGameType':
      return isGameType(m.gameType) ? { type, gameType: m.gameType } : null;
    case 'kick':
      return typeof m.playerId === 'string' && PLAYER_ID_PATTERN.test(m.playerId)
        ? { type, playerId: m.playerId }
        : null;
    default:
      return null;
  }
}

export const FRIENDS_LOBBY_ERRORS = [
  /** Only the host may send it. */
  'notHost',
  /** `start` with fewer than FRIENDS_MIN_PLAYERS connected. */
  'notEnoughPlayers',
  /** `start` while a seat is away and the host did not agree to start without it (`away` says who) [D83]. */
  'playersAway',
  /** The game started already. */
  'gameStarted',
  /** Malformed, an unknown game type, or a kick of the host or of nobody in the room. */
  'badCommand',
  /** Too many commands; wait a moment. */
  'tooManyRequests',
] as const;
export type FriendsLobbyError = (typeof FRIENDS_LOBBY_ERRORS)[number];

/** Server → the sender only: its command was refused. */
export interface FriendsLobbyRefused {
  type: 'lobbyRefused';
  command: FriendsLobbyCommandType;
  reason: FriendsLobbyError;
  /** playersAway: the seats away now. */
  away?: PlayerId[];
}

export const FRIENDS_ROOM_CLOSED_REASONS = [
  /** The host removed this player [D85a] ("המארח הוציא אותך מהחדר"). */
  'kicked',
  /** Out of the room for another player's sake, e.g. a block between them [D85c]: "יצאת מהחדר", nothing more. */
  'removed',
  /** The same account took this seat on another device ("החדר נפתח במכשיר אחר"). */
  'otherDevice',
  /** The server is restarting (an update): every room closes ("החדר נסגר"). */
  'serverRestart',
  /** The room closed for any other reason ("החדר נסגר"), e.g. its host opened another one. */
  'closed',
] as const;
export type FriendsRoomClosedReason = (typeof FRIENDS_ROOM_CLOSED_REASONS)[number];

/** Server → one connection, before the game: why it is out; the server closes it next. Don't reconnect. */
export interface FriendsRoomClosed {
  type: 'roomClosed';
  reason: FriendsRoomClosedReason;
}

// ---------------------------------------------------------------------------------------------------------
// The admin site (spec §27.3; friends-room.md §7.5): GET /admin/api/rooms?days=30, behind the admin sign-in

/** Under ADMIN_API_PREFIX (admin.ts). */
export const ADMIN_FRIEND_ROOMS_PATH = '/rooms';

/** An open room. No code: an admin sees the room, not the key into it. */
export interface AdminFriendRoomRow {
  /** The Colyseus room's id. */
  roomId: string;
  state: FriendRoomState;
  gameType: GameType;
  /** Seats taken (connected or away). */
  players: number;
  maxPlayers: number;
  hostId: string;
  hostName: string;
  openedAt: number;
  /** When its game started (the countdown's GO); null in the lobby. */
  startedAt: number | null;
}

export interface AdminFriendRoomCounts {
  lobby: number;
  playing: number;
}

export interface AdminFriendRooms {
  /** "חדרי חברים פתוחים: 3 (2 בהמתנה, 1 במשחק)". */
  counts: AdminFriendRoomCounts;
  /** Newest first. */
  rooms: AdminFriendRoomRow[];
  days: number;
  /** Games with friends that started that day (games.mode = 'friends'), in the admin time zone. */
  gamesPerDay: AdminDayCount[];
}
