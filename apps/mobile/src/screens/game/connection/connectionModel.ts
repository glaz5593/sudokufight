import {
  defaultRules,
  type GameType,
  type GameView,
  type PlayerId,
  type PlayerView,
} from '@sudoku-fight/engine';
import type { GameRoomError, LobbyPlayer } from '@sudoku-fight/protocol';

import { colorIndexFor } from '../../../components/player/cardModel';
import { secondsOf } from '../../../components/player/format';

/**
 * Which connection state the game screen shows (work plan stage 7; spec §16.2, §16.3, §18; the designs
 * Loading, Opponent-Reconnecting, Self-Reconnecting, Opponent-Left and Connection-Error), as a pure function
 * of the game's view, this phone's connection and the time:
 *
 *   connectionModel(view, status, now) → none | connecting | lobby | selfOffline | selfReconnecting
 *                                        | opponentReconnecting | opponentLeft | error
 *
 * - `view` is the GameView the host gives the screen (null before the first snapshot).
 * - `status` is what the RemoteGameHost knows of its socket (ConnectionStatus below); the integrator maps the
 *   host's own state onto it.
 * - `now` is the SERVER's time (the host's clock after the ping/pong sync), like every deadline in the view
 *   (graceEndsAt, expiresAt): the countdowns here are `deadline − now`.
 *
 * Nothing here decides anything about the game: the freeze is the engine's 'paused' status, the abandonment
 * and the win are the engine's statuses and result. It only picks what to draw, in this order:
 * 1. The game is over: "the opponent left" (2 players, won by abandonment, spec §16.2) or nothing (results).
 * 2. A connection error (§16.3).
 * 3. Before the game: connecting, or a dev room's lobby.
 * 4. My own connection is lost or coming back: inside its soft phase [D42] only a mark (selfOffline: the board
 *    keeps playing, the host queues the digits) when the host plays on here; else, and after it,
 *    Self-Reconnecting, as my view can't be trusted. A game frozen for an opponent keeps its freeze screen (5.)
 *    during my soft phase.
 * 5. The engine froze the game for a disconnected opponent (2 players, Opponent-Reconnecting).
 * 6. Just back: a short "everything is synced" banner that no longer blocks play.
 * An opponent in the soft phase gives no model: the game runs, and only their card shows it (cardModel's
 * 'unstable' presence).
 */

// ---------------------------------------------------------------------------------------------------------
// Input: the connection as the host reports it

/** The steps of the Loading design: the server, the room, then the first snapshot. */
export type ConnectingStep = 'server' | 'room' | 'sync';
export const CONNECTING_STEPS: readonly ConnectingStep[] = ['server', 'room', 'sync'];

/** A dev room before the game, as the server's `lobby` message describes it. */
export interface LobbyInfo {
  code: string;
  gameType: GameType;
  playerCount: number;
  /** In seat order. */
  players: readonly LobbyPlayer[];
  /** This phone's player. */
  playerId: PlayerId;
}

/**
 * Why there is no game connection (spec §16.3):
 * - `offline`: the phone has no network ("אין אינטרנט").
 * - `unreachable`: there is a network, but the game server did not answer ("שגיאת חיבור").
 * - `refused`: the server answered no (see RoomRefusal).
 * - `lost`: the game's connection dropped and could not come back.
 */
export type ConnectionFailure = 'offline' | 'unreachable' | 'refused' | 'lost';

/**
 * Why the server refused a create or a join: the protocol's GameRoomError (gameRoomErrorOf(message)), or
 * Colyseus's own refusals of an unknown code ('room "…" not found' → notFound) and of a full room
 * ('room "…" is locked' → full).
 */
export type RoomRefusal = GameRoomError | 'notFound' | 'full';

/** The game connection, as the screen needs it. Times are in the server's clock. */
export type ConnectionStatus =
  /** Creating or joining the room, before the lobby or the first snapshot. */
  | { kind: 'connecting'; step?: ConnectingStep }
  /** In a dev room, waiting for the other players. */
  | { kind: 'lobby'; lobby: LobbyInfo }
  /**
   * Connected and in sync. `resyncedAt`: when a reconnection's snapshot arrived, for the short "back in the
   * game" banner (SYNCED_HOLD_MS).
   */
  | { kind: 'online'; resyncedAt?: number | null }
  /**
   * The socket dropped and the host is trying to come back (`attempt` from 1). `lostAt`: when it noticed.
   * `softEndsAt`: until then the soft phase runs [D42] (the game goes on, the player plays on, nothing about
   * the connection is shown); null when the game has none. `playable`: whether the host plays on here meanwhile
   * (false: the game was not running when the connection went, or its rules have no play offline: 'turns', no
   * offline moves); absent counts as true. `graceEndsAt`: when the server will call it abandonment, if the
   * host knows better than lostAt + the soft phase + the grace.
   */
  | {
      kind: 'reconnecting';
      attempt: number;
      lostAt: number;
      softEndsAt?: number | null;
      playable?: boolean;
      graceEndsAt?: number | null;
    }
  /** The socket is back; the fresh snapshot is on its way. */
  | {
      kind: 'resyncing';
      lostAt?: number | null;
      softEndsAt?: number | null;
      playable?: boolean;
      graceEndsAt?: number | null;
    }
  /**
   * No connection (spec §16.3). `code` is the small support code on the error screen (e.g.
   * "ERR_SOCKET_TIMEOUT", "4002", "gameStarted"). `attempts` counts the tries so far; `retrying` while
   * "נסה שוב" runs.
   */
  | {
      kind: 'failed';
      failure: ConnectionFailure;
      code: string;
      attempts?: number;
      retrying?: boolean;
      refusal?: RoomRefusal | null;
    };

export interface ConnectionModelOptions {
  /**
   * The game's grace period (rules.graceMs, from the host's state): the full length of the countdowns.
   * Default: the engine's rules for the view's mode and game type (15 s, D4).
   */
  graceMs?: number;
  /**
   * The game's soft phase (rules.softGraceMs) [D42]: a lost connection's grace starts after it, so the
   * countdowns run to lostAt + soft phase + grace, and "the opponent left" says both. Default 0 (none known).
   */
  softGraceMs?: number;
  /**
   * The other players whose absence began hard, with no soft phase (a deliberate leave, a seat empty at GO):
   * their "the opponent left" says the grace alone (RemoteGameHost's OnlineInfo.hardLeavers) [D42].
   */
  hardLeavers?: readonly PlayerId[];
  /** How long the "everything is synced" banner stays after a reconnection. */
  syncedHoldMs?: number;
}

// ---------------------------------------------------------------------------------------------------------
// Output: what to show

/** The success toast's hold (components.md §15.1: 2.5 s): "חזרת למשחק · הכל סונכרן". */
export const SYNCED_HOLD_MS = 2500;
/** The grace when nothing says otherwise (spec §16.2, D4). */
export const DEFAULT_GRACE_MS = 15_000;

/** What a reconnection's snapshot brings back (spec §16.2): the board, the score, the turn or the locks, the timers. */
export type SyncItem = 'board' | 'score' | 'locks' | 'turn' | 'timers';

export interface ConnectingModel {
  kind: 'connecting';
  step: ConnectingStep;
}

export interface LobbySeat {
  /** 0-based seat. */
  seat: number;
  /** The seat's colour on this phone: me 0 (P1), the others by seat order. */
  colorIndex: number;
  /** Null: still empty. */
  player: { id: PlayerId; name: string; isMe: boolean } | null;
}

export interface LobbyModel {
  kind: 'lobby';
  code: string;
  gameType: GameType;
  playerCount: number;
  seats: LobbySeat[];
  /** Seats still empty; 0 means the game starts any moment. */
  waitingFor: number;
}

/**
 * Self-Reconnecting: `lost` (the board is locked, the host is retrying), `syncing` (back, the snapshot is on
 * its way: still locked) and `synced` (a banner only, play goes on).
 */
export type SelfPhase = 'lost' | 'syncing' | 'synced';

export interface SelfReconnectingModel {
  kind: 'selfReconnecting';
  phase: SelfPhase;
  /** The host's attempt while lost (1, 2, …); null when it does not count them. */
  attempt: number | null;
  /** Whole seconds before the server calls it abandonment; null when unknown or no longer counting. */
  secondsLeft: number | null;
  /** The same in ms, for the draining bar. */
  remainingMs: number | null;
  graceMs: number;
  syncItems: SyncItem[];
}

/**
 * My connection is lost, inside its soft phase [D42] (Moshe: "לסמן על המשתמש שהוא בלי תקשורת ולהמשיך את המשחק
 * כרגיל"): no overlay and no banner, the board keeps taking taps (the host plays them here and queues the
 * digits); only my card's mark and one announcement for screen readers. At `softEndsAt` the Self-Reconnecting
 * screen of the hard phase takes over.
 */
export interface SelfOfflineModel {
  kind: 'selfOffline';
  softEndsAt: number;
  /** Whole seconds until the soft phase ends. */
  secondsLeft: number;
}

export interface OpponentReconnectingModel {
  kind: 'opponentReconnecting';
  playerId: PlayerId;
  name: string | null;
  /** The opponent's colour on this phone (P2 in a 2-player game). */
  colorIndex: number;
  secondsLeft: number;
  remainingMs: number;
  graceMs: number;
  /** The grace ran out; the server's abandonment is on its way. */
  expired: boolean;
}

export interface OpponentLeftModel {
  kind: 'opponentLeft';
  playerId: PlayerId;
  name: string | null;
  colorIndex: number;
  me: { id: PlayerId; name: string | null; score: number };
  opponentScore: number;
  /** My rating change, when the game was rated. */
  ratingDelta: number | null;
  /**
   * Why that change is 0 (guard (b) of spec §11.2): the opponent left before my first move, or was ahead of
   * me when leaving. Null otherwise, and for a result stored without ratingPairs.
   */
  ratingGuard: 'opponentLeftBeforeMyMove' | 'opponentLeftAhead' | null;
  gameType: GameType;
  /** The grace that ran out, in seconds ("15 שניות בלי חיבור"). */
  graceSeconds: number;
}

export interface ConnectionErrorModel {
  kind: 'error';
  failure: ConnectionFailure;
  code: string;
  attempts: number;
  retrying: boolean;
  refusal: RoomRefusal | null;
}

export type ConnectionModel =
  | { kind: 'none' }
  | ConnectingModel
  | LobbyModel
  | SelfOfflineModel
  | SelfReconnectingModel
  | OpponentReconnectingModel
  | OpponentLeftModel
  | ConnectionErrorModel;

export type ConnectionModelKind = ConnectionModel['kind'];

const NONE: ConnectionModel = { kind: 'none' };

// ---------------------------------------------------------------------------------------------------------

export function connectionModel(
  view: GameView | null,
  status: ConnectionStatus,
  now: number,
  options: ConnectionModelOptions = {},
): ConnectionModel {
  const graceMs =
    options.graceMs ?? (view ? defaultRules(view.mode, view.gameType).graceMs : DEFAULT_GRACE_MS);
  const softGraceMs = options.softGraceMs ?? 0;
  const syncedHoldMs = options.syncedHoldMs ?? SYNCED_HOLD_MS;

  // 1. Over: the result is known whatever the socket does now. The time the opponent had: the soft phase and
  // the grace after a drop, the grace alone after a leave that was hard at once [D42].
  if (view?.status === 'over') {
    const hard = new Set(options.hardLeavers ?? []);
    return opponentLeftOf(view, (id) => (hard.has(id) ? graceMs : softGraceMs + graceMs)) ?? NONE;
  }

  // 2. No connection.
  if (status.kind === 'failed') {
    return {
      kind: 'error',
      failure: status.failure,
      code: status.code,
      attempts: Math.max(1, status.attempts ?? 1),
      retrying: status.retrying ?? false,
      refusal: status.refusal ?? null,
    };
  }

  // 3. No game yet.
  if (!view) {
    switch (status.kind) {
      case 'lobby':
        return lobbyOf(status.lobby);
      case 'connecting':
        return { kind: 'connecting', step: status.step ?? 'server' };
      case 'reconnecting':
        // A drop in the lobby frees the seat: the host joins again.
        return { kind: 'connecting', step: 'server' };
      default:
        // Connected, the snapshot is on its way.
        return { kind: 'connecting', step: 'sync' };
    }
  }

  const me = view.players.find((p) => p.id === view.me) ?? null;
  const syncItems: SyncItem[] = [
    'board',
    'score',
    view.rules.turnModel === 'turns' ? 'turn' : 'locks',
    'timers',
  ];
  const self = (
    phase: SelfPhase,
    attempt: number | null,
    graceEndsAt: number | null,
  ): SelfReconnectingModel => {
    // Out of the game (3–4 players), the grace means nothing to me any more.
    const counting = graceEndsAt !== null && me?.status === 'active';
    const remainingMs = counting ? Math.max(0, graceEndsAt - now) : null;
    return {
      kind: 'selfReconnecting',
      phase,
      attempt,
      secondsLeft: remainingMs === null ? null : secondsOf(remainingMs),
      remainingMs,
      graceMs,
      syncItems,
    };
  };

  // 4. My connection. Inside its soft phase [D42] the game goes on and nothing is shown but the mark, when the
  // host plays on here. When it does not (a game frozen for an opponent, 'turns', no offline moves), nothing
  // can be played meanwhile: a frozen game keeps its freeze screen (5.), any other locks as before.
  const lostLink = status.kind === 'reconnecting' || status.kind === 'resyncing';
  const softEndsAt = lostLink ? (status.softEndsAt ?? null) : null;
  const inSoftPhase = softEndsAt !== null && now < softEndsAt && me?.status === 'active';
  const playsOn = lostLink && status.playable !== false;
  if (inSoftPhase && playsOn)
    return { kind: 'selfOffline', softEndsAt, secondsLeft: secondsOf(softEndsAt - now) };
  const frozenForOpponent = inSoftPhase && view.status === 'paused' && awayOpponent(view) !== null;
  if (!frozenForOpponent) {
    if (status.kind === 'reconnecting') {
      const endsAt = status.graceEndsAt ?? me?.graceEndsAt ?? status.lostAt + softGraceMs + graceMs;
      return self('lost', Math.max(1, status.attempt), endsAt);
    }
    if (status.kind === 'connecting') {
      // Joining again by code (the reconnection token was refused) while the game runs.
      return self('lost', null, me?.graceEndsAt ?? null);
    }
    if (status.kind === 'resyncing') return self('syncing', null, null);
    // The snapshot of a reconnection comes before the engine's 'reconnect': for a moment I am still away in it.
    if (me && me.status === 'active' && !me.connected) return self('syncing', null, null);
  }

  // 5. The engine froze the game for an opponent (2 players still in, spec §16.2). Out of a game of 3–4 that
  // froze for the last two (D36), nothing waits on me and nobody wins by me: no freeze screen, the cards say it.
  if (view.status === 'paused' && me?.status !== 'surrendered' && me?.status !== 'abandoned') {
    const away = awayOpponent(view);
    if (away) {
      const remainingMs = away.graceEndsAt === null ? 0 : Math.max(0, away.graceEndsAt - now);
      return {
        kind: 'opponentReconnecting',
        playerId: away.id,
        name: away.name,
        colorIndex: colorOf(view, away),
        secondsLeft: secondsOf(remainingMs),
        remainingMs,
        graceMs,
        expired: remainingMs <= 0,
      };
    }
  }

  // 6. Just back.
  if (status.kind === 'online' && status.resyncedAt != null) {
    const since = now - status.resyncedAt;
    if (since >= 0 && since < syncedHoldMs) return self('synced', null, null);
  }

  return NONE;
}

// ---------------------------------------------------------------------------------------------------------

/** The disconnected opponent still in the game whose grace ends first. */
function awayOpponent(view: GameView): PlayerView | null {
  const away = view.players
    .filter((p) => p.id !== view.me && p.status === 'active' && !p.connected)
    .sort((a, b) => (a.graceEndsAt ?? Infinity) - (b.graceEndsAt ?? Infinity));
  return away[0] ?? null;
}

function colorOf(view: GameView, player: PlayerView): number {
  const mySeat = view.players.find((p) => p.id === view.me)?.seat ?? null;
  return colorIndexFor(
    player.seat,
    mySeat,
    view.players.map((p) => p.seat),
  );
}

/**
 * "The opponent left" (spec §16.2): a 2-player game that ended because the other player did not come back in
 * time, so I won by abandonment. A surrender, or a game of 3–4, goes straight to the results. `graceOf`: the
 * time the opponent had to come back (after a drop the soft phase and the grace [D42], after a leave that was
 * hard at once the grace alone).
 */
function opponentLeftOf(view: GameView, graceOf: (id: PlayerId) => number): OpponentLeftModel | null {
  if (view.players.length !== 2 || view.result?.reason !== 'lastPlayerStanding') return null;
  const me = view.players.find((p) => p.id === view.me);
  const opponent = view.players.find((p) => p.id !== view.me);
  if (!me || !opponent || me.status !== 'active' || opponent.status !== 'abandoned') return null;
  const change = view.result.ratingChanges.find((c) => c.playerId === me.id);
  // My one pair: held at 0 by guard (b) of spec §11.2 when the opponent left before my first move or ahead.
  const guard = view.result.ratingPairs?.find((p) => p.playerId === me.id)?.pairs[0]?.guard;
  return {
    kind: 'opponentLeft',
    playerId: opponent.id,
    name: opponent.name,
    colorIndex: colorOf(view, opponent),
    me: { id: me.id, name: me.name, score: me.score },
    opponentScore: opponent.score,
    ratingDelta: change ? change.delta : null,
    ratingGuard: guard === 'opponentLeftBeforeMyMove' || guard === 'opponentLeftAhead' ? guard : null,
    gameType: view.gameType,
    graceSeconds: Math.round(graceOf(opponent.id) / 1000),
  };
}

/** The lobby's seats: the players who are in, in seat order, then the empty seats. */
export function lobbyOf(lobby: LobbyInfo): LobbyModel {
  const count = Math.max(lobby.playerCount, lobby.players.length);
  const mySeat = lobby.players.findIndex((p) => p.id === lobby.playerId);
  const allSeats = Array.from({ length: count }, (_, seat) => seat);
  const seats: LobbySeat[] = allSeats.map((seat) => {
    const p = lobby.players[seat];
    return {
      seat,
      colorIndex: colorIndexFor(seat, mySeat < 0 ? null : mySeat, allSeats),
      player: p ? { id: p.id, name: p.name, isMe: p.id === lobby.playerId } : null,
    };
  });
  return {
    kind: 'lobby',
    code: lobby.code,
    gameType: lobby.gameType,
    playerCount: lobby.playerCount,
    seats,
    waitingFor: Math.max(0, lobby.playerCount - lobby.players.length),
  };
}

// ---------------------------------------------------------------------------------------------------------
// What the screen does around it

/**
 * Whether the board and the keypad take no input under this model: everything but nothing at all and the
 * "synced" banner. (The screen also hides its content from screen readers while it blocks.)
 */
export function blocksInput(model: ConnectionModel): boolean {
  switch (model.kind) {
    case 'none':
    case 'selfOffline': // [D42] the player plays on
      return false;
    case 'selfReconnecting':
      return model.phase !== 'synced';
    default:
      return true;
  }
}

/**
 * Whether the screen must wait before showing the results of a finished game: "the opponent left" stays
 * until the player taps "לתוצאות" (spec §16.2).
 */
export const holdsResults = (model: ConnectionModel): boolean => model.kind === 'opponentLeft';

/** The countdown's share left, 0–1 (1 = the whole grace). */
export const graceShare = (remainingMs: number, graceMs: number): number =>
  graceMs > 0 ? Math.min(1, Math.max(0, remainingMs / graceMs)) : 0;
