import type { GameType } from '@sudoku-fight/engine';
import {
  COUNTDOWN_MS,
  FRIENDS_MAX_PLAYERS,
  FRIENDS_MIN_PLAYERS,
  type GameRoomRuleOverrides,
} from '@sudoku-fight/protocol';

import type { RateLimitRule } from '../http/rateLimiter';

/**
 * The rules of the friends rooms (1.0.4; docs/handoff/2026-10-19/friends-room.md §4, §5): every number is a
 * setting (FRIENDS_RULES), so a decision can change without touching the code. The service
 * (./service.ts), the pure lobby (./lobby.ts), the code table (./codes.ts) and the room
 * (rooms/FriendsRoom.ts) all read them from here.
 *
 * The decisions as built (plan.md §5, Moshe 2026-10-20: "לך עם ברירות המחדל"):
 * - D81a: no rating; XP as in a ranked game, inside the practice day's cap (persistence, games.mode 'friends').
 * - D81b: the players become each other's recent opponents (opponent_history).
 * - D82: the host picks the game type in the room until the start; a new room starts with the type asked for.
 * - D83: `start` counts the connected seats only; an away seat needs the host's yes (`withoutAway`).
 * - D84a: no time limit. An away seat is held `lobbyAwayHoldMs` (6 h, a safety net); `lobbyMaxMs` null.
 * - D84b: the host passes to the earliest of the others when the host leaves or the host's seat lapses.
 * - D85a: the host may kick a guest before the start; a kicked account can't come back to that room.
 * - D85b: an unverified email may join (the email check of D22 is the ranked queue's only).
 * - D85c: a block either way keeps two accounts apart: the blocked one is told "notFound", like a wrong code.
 * - D86: 6 digits, unique among the open rooms, not reused for `codeCooldownMs` after a room closes; the rate
 *   limits on create and join are the HTTP routes' (friends/router.ts, config.friends.limits).
 */

export interface FriendsRules {
  /** `start` needs this many connected seats (FRIENDS_MIN_PLAYERS). */
  minPlayers: number;
  /** Seats in a room, held (away) and reserved ones included (FRIENDS_MAX_PLAYERS). */
  maxPlayers: number;
  /** [D84a] How long the seat of an app that lost its connection is held in the lobby: 6 h. */
  lobbyAwayHoldMs: number;
  /** [D84a] The longest a room may wait in its lobby; null: no limit (the default, as Moshe asked). */
  lobbyMaxMs: number | null;
  /** [D86] A closed room's code is not handed out again for this long (an old link must not reach strangers). */
  codeCooldownMs: number;
  /** [D86] How many codes there are: 10^6 (000000–999999). Tests use a few. */
  codeSpace: number;
  /** A ticket's seat reservation: the app enters the room within this, or the seat is let go. */
  seatReservationMs: number;
  /** 3… 2… 1… GO (the ranked match's countdown). */
  countdownMs: number;
  /**
   * The host's lobby commands (`start`, `setGameType`, `kick`) per player. (The limits of create and join
   * [D86] are the HTTP routes', friends/router.ts: config.friends.limits, FRIENDS_*.)
   */
  commandLimit: RateLimitRule;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export const FRIENDS_RULES: Readonly<FriendsRules> = {
  minPlayers: FRIENDS_MIN_PLAYERS,
  maxPlayers: FRIENDS_MAX_PLAYERS,
  lobbyAwayHoldMs: 6 * HOUR_MS,
  lobbyMaxMs: null,
  codeCooldownMs: 30 * MINUTE_MS,
  codeSpace: 1_000_000,
  seatReservationMs: 30_000,
  countdownMs: COUNTDOWN_MS,
  commandLimit: { limit: 10, windowMs: 10_000 },
};

/** Node's timers take at most this many ms (about 24.8 days); a longer one fires at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;

const positiveInt = (v: number) => Number.isInteger(v) && v > 0;
const goodLimit = (r: RateLimitRule) => positiveInt(r.limit) && r.windowMs > 0 && Number.isFinite(r.windowMs);

/**
 * FRIENDS_RULES with `overrides` (the server's settings, tests). Throws RangeError for a value the rooms can't
 * run with, so a bad setting stops the server at boot rather than a room later.
 */
export function friendsRules(overrides: Partial<FriendsRules> = {}): FriendsRules {
  const r: FriendsRules = { ...FRIENDS_RULES, ...stripUndefined(overrides) };
  const bad = (what: string) => new RangeError(`friends rooms: bad ${what}`);
  if (!positiveInt(r.minPlayers) || r.minPlayers < 2) throw bad(`minPlayers ${r.minPlayers}`);
  if (!positiveInt(r.maxPlayers) || r.maxPlayers < r.minPlayers || r.maxPlayers > FRIENDS_MAX_PLAYERS)
    throw bad(`maxPlayers ${r.maxPlayers}`);
  if (!positiveInt(r.lobbyAwayHoldMs) || r.lobbyAwayHoldMs > MAX_TIMER_MS)
    throw bad(`lobbyAwayHoldMs ${r.lobbyAwayHoldMs}`);
  if (r.lobbyMaxMs !== null && (!positiveInt(r.lobbyMaxMs) || r.lobbyMaxMs > MAX_TIMER_MS))
    throw bad(`lobbyMaxMs ${r.lobbyMaxMs}`);
  if (!Number.isInteger(r.codeCooldownMs) || r.codeCooldownMs < 0)
    throw bad(`codeCooldownMs ${r.codeCooldownMs}`);
  if (!positiveInt(r.codeSpace) || r.codeSpace > 1_000_000) throw bad(`codeSpace ${r.codeSpace}`);
  if (!positiveInt(r.seatReservationMs)) throw bad(`seatReservationMs ${r.seatReservationMs}`);
  if (!Number.isInteger(r.countdownMs) || r.countdownMs < 0) throw bad(`countdownMs ${r.countdownMs}`);
  if (!goodLimit(r.commandLimit))
    throw bad(`commandLimit ${r.commandLimit.limit} per ${r.commandLimit.windowMs} ms`);
  return r;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * The create option of a friends room's Colyseus room: `{ friends: <claim id> }`. The service opens the room
 * on the server (matchMaker.createRoom), never a client; the room's onCreate claims its setup by this id, which
 * is single use and known only to the server (as a ranked room claims its match: matchmaking/ranked.ts).
 */
export const FRIENDS_CLAIM_OPTION = 'friends';

/** The claim id of a create's options, or null when they are not a friends room's. */
export function friendsClaimIdOf(options: unknown): string | null {
  if (typeof options !== 'object' || options === null) return null;
  const id = (options as Record<string, unknown>)[FRIENDS_CLAIM_OPTION];
  return typeof id === 'string' && id !== '' ? id : null;
}

/** What a friends room is opened with (the service's side of the claim). */
export interface FriendsRoomSetup {
  /** The 6-digit code: the room's key in the service, shown in `lobby`; never its Colyseus id. */
  code: string;
  /** The first game type [D82]; the host may change it in the room. */
  gameType: GameType;
  /** The account that opened it: the first host. */
  hostId: string;
  rules: FriendsRules;
  /**
   * Rule overrides for the game (tests and development, e.g. a short grace; none in production). The
   * interference kinds come from the seats' apps at the start [D47].
   */
  gameRules: GameRoomRuleOverrides;
}
