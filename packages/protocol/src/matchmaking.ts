import { GAME_TYPES, type GameType, isGameType, type PlayerId } from '@sudoku-fight/engine';

import type { AvatarId, CountryCode, NO_AVATAR_ID } from './account';

/**
 * Matchmaking for ranked games (stage 9, spec §10, original §7–§8): the queues, the range, the timings and
 * the messages, shared by the server and the app.
 *
 * The flow, on one connection to the `matchmaking` room (`client.joinOrCreate(MATCHMAKING_ROOM_NAME,
 * { queueKey })`, with the account's ID token as `client.auth.token`: registered players only):
 * 1. `searching`: on joining, and again whenever the range widens (every 5 s). The app ticks the clock itself
 *    in between (elapsedMs at serverTime).
 * 2. `found`: the opponents' public profiles and this player's seat reservation in the ranked game room. The
 *    app joins it at once (`client.consumeSeatReservation(reservation)`) and keeps this connection open: no
 *    cancelling after "found" [D32].
 * 3. `ready`: who is connected to the game room so far. D37: a player is ready as soon as they connect.
 * 4. `countdown`: everyone is in; GO at `startsAt` (3… 2… 1… GO!). From here the game is on: leaving is
 *    abandonment [D32]. At GO the game room sends the snapshot, so the board appears to everyone at once.
 * 5. `started`: the game started; the server closes this connection.
 *
 * Other ends:
 * - `timeout`: nobody found in MATCH_TIMEOUT_MS. The app offers "keep searching (no range limit)", "play a
 *   bot meanwhile" and "home". Keep searching = send `keepSearching` within KEEP_SEARCHING_WINDOW_MS: the
 *   search goes on with the range's cap removed (the range keeps widening), for another MATCH_TIMEOUT_MS.
 * - `cancel` (client) → `cancelled`, and the server closes the connection. Leaving the room while searching
 *   cancels too. After "found" both are ignored: the match goes on without this connection.
 * - `matchCancelled`: the match fell through before GO (a player did not connect to the game room within
 *   READY_TIMEOUT_MS, or the room could not open). The players who were there go back to the head of the
 *   queue with their search time (`requeued: true`, a `searching` follows); a player who did not show up is
 *   not requeued, and the server closes the connection.
 */

/** The room's name in Colyseus: `client.joinOrCreate(MATCHMAKING_ROOM_NAME, { queueKey })`. */
export const MATCHMAKING_ROOM_NAME = 'matchmaking';

// ---------------------------------------------------------------------------------------------------------
// Queues (spec §10: one per game type and number of players)

export const QUEUE_PLAYER_COUNTS = [2, 3, 4] as const;
export type QueuePlayerCount = (typeof QUEUE_PLAYER_COUNTS)[number];

/** `fast-2p` … `hard-4p`. */
export type QueueKey = `${GameType}-${QueuePlayerCount}p`;

export function queueKey(gameType: GameType, players: QueuePlayerCount): QueueKey {
  return `${gameType}-${players}p`;
}

export const QUEUE_KEYS: readonly QueueKey[] = GAME_TYPES.flatMap((type) =>
  QUEUE_PLAYER_COUNTS.map((n) => queueKey(type, n)),
);

export interface QueueSpec {
  gameType: GameType;
  players: QueuePlayerCount;
}

/** The game type and number of players of a queue key, or null when `key` is not one. */
export function parseQueueKey(key: unknown): QueueSpec | null {
  if (typeof key !== 'string') return null;
  const m = /^([a-z]+)-([234])p$/.exec(key);
  if (!m || !isGameType(m[1])) return null;
  return { gameType: m[1], players: Number(m[2]) as QueuePlayerCount };
}

export const isQueueKey = (v: unknown): v is QueueKey => parseQueueKey(v) !== null;

/** The queues open now: 2 players. 3–4 players come with stage 10 (the server refuses them: `queueClosed`). */
export const OPEN_QUEUE_PLAYER_COUNTS: readonly QueuePlayerCount[] = [2];

// ---------------------------------------------------------------------------------------------------------
// The rating range [D6] and the timings

/**
 * The search's rating range [D6]: ±initial at first, `step` wider every `stepMs`, up to ±cap (reached after
 * (cap − initial) / step × stepMs = 50 s). Two players match only when each is within the other's range.
 */
export interface MatchRangeRules {
  initial: number;
  step: number;
  stepMs: number;
  cap: number;
}

export const MATCH_RANGE: MatchRangeRules = { initial: 50, step: 25, stepMs: 5000, cap: 300 };

/**
 * The half-width of the range after `elapsedMs` of searching: the player matches ratings within
 * rating ± matchRange(…). `extended`: the player chose "keep searching" after a timeout, and the cap is gone
 * (spec §10): the range goes on widening at the same pace.
 */
export function matchRange(
  elapsedMs: number,
  extended = false,
  rules: MatchRangeRules = MATCH_RANGE,
): number {
  const steps = Math.floor(Math.max(0, elapsedMs) / rules.stepMs);
  const grown = rules.initial + rules.step * steps;
  return extended ? grown : Math.min(rules.cap, grown);
}

/** No match after this long → `timeout` (spec §10: 60 s). */
export const MATCH_TIMEOUT_MS = 60_000;
/** After `timeout`, how long the server waits for `keepSearching` before it closes the connection. */
export const KEEP_SEARCHING_WINDOW_MS = 60_000;
/** After "found", every player must connect to the game room within this (spec §10, D37: 10 s). */
export const READY_TIMEOUT_MS = 10_000;
/** 3… 2… 1…: one step a second, then GO at `startsAt` (spec §10). */
export const COUNTDOWN_STEPS = [3, 2, 1] as const;
export const COUNTDOWN_STEP_MS = 1000;
export const COUNTDOWN_MS = COUNTDOWN_STEPS.length * COUNTDOWN_STEP_MS;

// ---------------------------------------------------------------------------------------------------------
// Messages

/** The options of `client.joinOrCreate(MATCHMAKING_ROOM_NAME, options)`. Who it is comes from the token. */
export interface MatchmakingJoinOptions {
  queueKey: QueueKey;
}

/** Client → server, sent as `room.send(message.type, message)`. */
export type MatchmakingClientMessage =
  /** Stop searching (ignored after "found"). */
  | { type: 'cancel' }
  /** After `timeout`: search on, with no cap on the range. */
  | { type: 'keepSearching' }
  /** Clock sync for the countdown, like the game room's. */
  | { type: 'ping'; t: number };

export const MATCHMAKING_CLIENT_MESSAGE_TYPES = [
  'cancel',
  'keepSearching',
  'ping',
] as const satisfies readonly MatchmakingClientMessage['type'][];

/** A player as the "found" screen shows them (VS: avatar, name, flag, rating; spec §10, original §8). */
export interface MatchPlayer {
  id: PlayerId;
  name: string;
  avatarId: AvatarId | typeof NO_AVATAR_ID;
  country: CountryCode | null;
  /** In the queue's rating key (RATING_OPTION: `normal` or `normal-2p`). */
  rating: number;
  /** Still in the first 10 games of that key (spec §11.2). */
  provisional: boolean;
}

/** Colyseus's seat reservation, as `client.consumeSeatReservation()` takes it. */
export interface MatchSeatReservation {
  name: string;
  sessionId: string;
  roomId: string;
  processId?: string;
  publicAddress?: string;
  devMode?: boolean;
}

export type MatchCancelReason =
  /** A player did not connect to the game room within READY_TIMEOUT_MS (`missing` says who). */
  | 'noShow'
  /** The server could not open the game room. */
  | 'error';

/** Server → client, sent as `client.send(message.type, message)`. Times are the server's epoch ms. */
export type MatchmakingServerMessage =
  | {
      type: 'searching';
      queueKey: QueueKey;
      /** This player's rating in the queue's key. */
      rating: number;
      /** Searching time at `serverTime` (the time in a failed ready check does not count). */
      elapsedMs: number;
      /** Half-width of the range: ratings within rating ± range. */
      range: number;
      /** "Keep searching": no cap on the range. */
      extended: boolean;
      /** When the search ends with `timeout` if nobody is found. */
      timeoutAt: number;
      serverTime: number;
      /** Back at the head of the queue after a match fell through. */
      requeued?: boolean;
    }
  | {
      type: 'found';
      matchId: string;
      queueKey: QueueKey;
      /** The receiving player. */
      playerId: PlayerId;
      /** Everyone in the match, this player included, in seat order. */
      players: MatchPlayer[];
      /** Some of these players met before in this game type (false: "you haven't played each other lately"). */
      rematch: boolean;
      /** Join the game room with it at once. */
      reservation: MatchSeatReservation;
      /** Everyone must be connected to the game room by then. */
      readyBy: number;
      serverTime: number;
    }
  /** Who is connected to the game room so far (D37: connected = ready). */
  | { type: 'ready'; matchId: string; ready: PlayerId[] }
  /** Everyone is in: 3… 2… 1… and GO at `startsAt`. */
  | { type: 'countdown'; matchId: string; startsAt: number; serverTime: number }
  /** GO: the game runs in room `roomId`. The server closes this connection. */
  | { type: 'started'; matchId: string; roomId: string }
  | {
      type: 'matchCancelled';
      matchId: string;
      reason: MatchCancelReason;
      /** Who did not connect in time. */
      missing: PlayerId[];
      /** True: back at the head of the queue (a `searching` follows). False: this player was missing. */
      requeued: boolean;
    }
  /** Nobody found in time. Answer `keepSearching` by `keepSearchingUntil`, or leave. */
  | {
      type: 'timeout';
      queueKey: QueueKey;
      elapsedMs: number;
      range: number;
      extended: boolean;
      keepSearchingUntil: number;
    }
  /** The search was cancelled at the player's request; the server closes the connection. */
  | { type: 'cancelled' }
  | { type: 'pong'; t: number; serverTime: number };

export type MatchmakingServerMessageType = MatchmakingServerMessage['type'];

export const MATCHMAKING_SERVER_MESSAGE_TYPES = [
  'searching',
  'found',
  'ready',
  'countdown',
  'started',
  'matchCancelled',
  'timeout',
  'cancelled',
  'pong',
] as const satisfies readonly MatchmakingServerMessageType[];

// ---------------------------------------------------------------------------------------------------------
// Refusals

/**
 * Why the server refused to let a player into the queue. The error's message starts with it: `"<error>:
 * <text>"`, like the game room's refusals.
 */
export const MATCHMAKING_ERRORS = [
  /** No token, a bad one, or no account (ranked games are for registered players only). */
  'unauthenticated',
  /** The join options name no queue (`queueKey`). */
  'badQueue',
  /** That queue is not open yet (3–4 players: stage 10). */
  'queueClosed',
  /** This account is searching already (another device), or its match has not started yet. */
  'alreadyQueued',
] as const;
export type MatchmakingError = (typeof MATCHMAKING_ERRORS)[number];

/** The MatchmakingError at the start of a refusal's message, or null. */
export function matchmakingErrorOf(message: string): MatchmakingError | null {
  const head = message.split(':', 1)[0]!.trim();
  return (MATCHMAKING_ERRORS as readonly string[]).includes(head) ? (head as MatchmakingError) : null;
}
