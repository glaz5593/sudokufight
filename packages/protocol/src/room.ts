import type { GameType, PlayerId, Rules } from '@sudoku-fight/engine';

import type { AvatarId, CountryCode, NO_AVATAR_ID } from './account';

/**
 * The game room on the server (stage 7, spec §17, §18): its name, how to create one and how to join it.
 *
 * Private rooms (stage 7, outside production only): a room has a 6-character code, and the code is the room's
 * id, so joining by code is `client.joinById(code, joinOptions)`.
 * Ranked match rooms (stage 9): matchmaking opens them on the server and gives each matched player a seat
 * reservation (`client.consumeSeatReservation()`, protocol matchmaking.ts); nobody else gets in. Their game
 * starts after a countdown (GameRoomCountdown).
 */

/** The room's name in Colyseus: `client.create(GAME_ROOM_NAME, options)`. */
export const GAME_ROOM_NAME = 'game';

/** No 0/O or 1/I/L: a code read aloud or typed from a screenshot can't be misread. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

/**
 * A code as typed (any case, spaces and dashes around or between the characters) in its canonical form, or
 * null when it can't be a room code. Clients normalise before joinById: room ids are case-sensitive.
 */
export function normalizeRoomCode(input: string): string | null {
  const code = input.replace(/[\s-]/g, '').toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/**
 * Who is joining, outside production until accounts arrive (stage 8). In production every join is refused
 * until the server verifies a Firebase ID token (sent as the SDK's auth token, `client.auth.token`).
 */
export interface DevJoinOptions {
  /** 1–64 characters: letters, digits, `_` and `-`. Becomes the player's id in the game. */
  devUserId: string;
  /** The display name: 3–16 characters, Hebrew or English letters, digits, `_` and `.` (spec §3.1). */
  name: string;
  /**
   * The interference kinds this app can show [D47], as in MatchmakingJoinOptions: the room's game allows only
   * the kinds every seat declared (roomInterferenceKinds), unless `rules.interferenceKinds` of the create
   * options set them. Absent: LEGACY_INTERFERENCE_KINDS.
   */
  interferenceKinds?: string[];
}

/**
 * Rules a dev or test room may change (e.g. a short grace period for tests, or softGraceMs 0 for a drop that is
 * hard at once [D42]); refused in production. `interferenceKinds` sets the room's kinds outright, in place of
 * the intersection of what the seats declared [D47] (unknown kinds are refused as badOptions).
 */
export type GameRoomRuleOverrides = Partial<
  Pick<
    Rules,
    | 'graceMs'
    | 'softGraceMs'
    | 'thinkTimeMs'
    | 'turnPickMs'
    | 'turnModel'
    | 'interferences'
    | 'interferenceKinds'
    | 'interferenceMs'
    | 'interferenceImmunityMs'
    | 'relockCooldownMs'
    | 'reactionCooldownMs'
  >
>;

/** `client.create(GAME_ROOM_NAME, options)`: the creator joins the room it creates. */
export interface GameRoomCreateOptions extends DevJoinOptions {
  /** Stage 7 has private rooms only. */
  private: true;
  /** A code of your own (dev and tests); generated when absent. Refused when a room already has it. */
  code?: string;
  /** Default 'fast'. */
  gameType?: GameType;
  /** 2–4 (default 2). The game starts as soon as this many players are in (D37: ready on connect). */
  playerCount?: number;
  rules?: GameRoomRuleOverrides;
  /**
   * Stage 9, development and tests: the game counts as a ranked game (default false). The puzzle comes from
   * the server's ranked pool without repeats, the players' ratings move, and the game is stored (games,
   * game_players, game_events). Every player must join signed in with an account (a token); otherwise the
   * game can't start and the room closes.
   */
  rated?: boolean;
}

/** `client.joinById(code, options)`. */
export type GameRoomJoinOptions = DevJoinOptions;

/**
 * Why the server refused to create or join a room. The error's message starts with it: `"<error>: <text>"`
 * (the SDK's MatchMakeError/ServerError carries the message). Colyseus's own refusals have no such prefix:
 * an unknown code ('room "…" not found') or a full room ('room "…" is locked'), both with code 522.
 */
export const GAME_ROOM_ERRORS = [
  /** The create options are wrong, or private rooms are off (production). */
  'badOptions',
  /** A room already has the code asked for. */
  'codeTaken',
  /** No identity, a bad one, or none accepted here (production before stage 8). */
  'unauthenticated',
  /**
   * The account is suspended by an admin (spec §3.5): no ranked games until it is lifted. A match found just
   * before the suspension, or a game rejoined after it, is refused with this; reload the profile (Me.suspended).
   */
  'suspended',
  /** This player is already in the room (another device or tab). */
  'alreadyInRoom',
  /** The game started without this player. */
  'gameStarted',
  /**
   * A friends room (1.0.4, friends.ts): the host removed this player from it [D85a], between the ticket and the
   * join. No way back into this room.
   */
  'kicked',
  /** A friends room: it closed between the ticket and the join ("החדר נסגר"). */
  'roomClosed',
] as const;
export type GameRoomError = (typeof GAME_ROOM_ERRORS)[number];

/** The GameRoomError at the start of a refusal's message, or null. */
export function gameRoomErrorOf(message: string): GameRoomError | null {
  const head = message.split(':', 1)[0]!.trim();
  return (GAME_ROOM_ERRORS as readonly string[]).includes(head) ? (head as GameRoomError) : null;
}

/**
 * A seat in a room whose game has not started yet. A dev room sends the id and the name only; a friends room
 * (1.0.4, friends.ts) adds the rest, which an older app ignores.
 */
export interface LobbyPlayer {
  id: PlayerId;
  name: string;
  /** Friends rooms: the player's avatar (NO_AVATAR_ID: none). */
  avatarId?: AvatarId | typeof NO_AVATAR_ID;
  /** Friends rooms: the flag; null without one. */
  country?: CountryCode | null;
  /** Friends rooms: the player's general rating, shown small; null before any rated game. */
  rating?: number | null;
  /**
   * Friends rooms [D84a]: this player's app is not connected now (in the background, or closed), and the seat
   * is held for them: "לא בחדר כרגע", and `start` counts only the others. Absent or false: connected.
   */
  away?: boolean;
}

/**
 * A ranked match's room (stage 9, spec §10): every matched player is connected (D37: ready on connect), so
 * 3… 2… 1… and GO at `startsAt` (server time: show `startsAt − serverTime` from now, or sync with ping/pong).
 * From now the seats are fixed, and leaving is abandonment [D32]. At GO the game starts: the `snapshot`
 * follows (a rated game's setup takes a database round trip), so the board appears to everyone at once.
 *
 * The game room sends it to everyone in the room when the countdown starts, and again to a player who comes
 * back during it, so the Match-Countdown screen runs off the game room alone, even if the matchmaking
 * connection is gone (it sends its own `countdown` too: protocol matchmaking.ts). Private rooms have none:
 * their game starts as soon as the last seat is taken. A friends room (friends.ts) sends it when its host
 * starts the game; from then on its seats are fixed as in a ranked match.
 */
export interface GameRoomCountdown {
  type: 'countdown';
  /** GO, in server time (epoch ms). */
  startsAt: number;
  /** The server's clock when it sent this. */
  serverTime: number;
}
