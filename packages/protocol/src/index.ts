import type {
  CellIndex,
  ClientAction,
  Digit,
  GameEvent,
  GameState,
  GameType,
  GameView,
  HostUpdate,
  InterferenceKind,
  LocalGameHost,
  PlayerId,
  RejectReason,
} from '@sudoku-fight/engine';

import type { GameRoomCountdown, LobbyPlayer } from './room';

/**
 * The contract between the screens and a game, and between the app and the server (spec §17.2, §18).
 *
 * - GameHost: the only thing a game screen talks to. LocalGameHost (in the engine) runs the game on the
 *   phone; RemoteGameHost (stage 7) talks to the server. Same interface, so screens can't tell them apart.
 * - ClientMessage / ServerMessage: what travels over the WebSocket. The server is authoritative: clients
 *   send actions, the server answers with the engine's events (deltas). A full snapshot goes out only on join
 *   and reconnect, and never carries the solution of a running game (spec §21).
 */

/**
 * Changes that only add (a new event, a new optional field, a new client message) keep the version: an older
 * app ignores what it does not know, and a newer app checks the rules before it uses something new. So the
 * soft phase of [D42] (the `playerConnectionLost` event, PlayerState.softEndsAt / offlineWindow, the optional
 * `offline` of placedCorrect / placedWrong, the `offlineMove` message) is version 1: an app plays offline only
 * when the snapshot's rules.softGraceMs > 0, so it never sends `offlineMove` to a server without it.
 * The interference kinds an app declares on joining [D47] (`interferenceKinds`, interferenceKinds.ts) only add
 * too: an older server ignores them and keeps its rooms to the kinds it has, which the snapshot's
 * rules.interferenceKinds tells the app.
 */
export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------------------------------------
// GameHost

/**
 * Online, the host may let the player go on while his connection is lost (the soft phase [D42], spec §16.2):
 * a select takes the cell on the phone, a digit is queued and drawn as waiting, and the moves go to the server
 * as `offlineMove` on the return; one that lost its cell comes back as a refusal of an `offlineMove`.
 */
export interface GameHost {
  /** The player on this device. */
  readonly playerId: PlayerId;
  /** The current picture of the game for this player (no solution while it runs). */
  getView(): GameView;
  /** Every update: new events with the view after them, or a refusal of this player's action. */
  subscribe(onEvent: (update: HostUpdate) => void): () => void;
  select(cell: CellIndex): void;
  release(): void;
  place(cell: CellIndex, digit: Digit): void;
  interfere(targetId: PlayerId, kind: InterferenceKind): void;
  react(emoji: string): void;
  surrender(): void;
  /** Stops timers and updates. */
  close(): void;
}

// LocalGameHost must keep satisfying GameHost; this line fails to compile the day it doesn't.
export const asGameHost = (host: LocalGameHost): GameHost => host;

// ---------------------------------------------------------------------------------------------------------
// Messages (spec §18)

/**
 * Client → server, sent as `room.send(message.type, message)`. `clientSeq` is a positive integer that grows
 * with every action (gaps are fine), so the server can drop duplicates (spec §21).
 *
 * `offlineMove` {cell, digit, thinkMs} [D42]: a digit the player entered while his connection was lost, sent
 * in the order made right after the return (the snapshot, then playerReconnected opens a window of
 * rules.offlineMovesWindowMs for rules.offlineMovesMax moves). Applied: cellLocked if needed, then
 * placedCorrect / placedWrong with `offline: true`. Lost (the cell is no longer free for him): `rejected` with
 * the engine's reason, to the sender only, and no penalty. Only to a server whose rules have softGraceMs > 0.
 */
export type ClientMessage = ({ clientSeq: number } & ClientAction) | { type: 'ping'; t: number };

/**
 * Server → client, sent as `client.send(message.type, message)`. Events are the engine's own (seq increases
 * by one, t is the server time).
 */
export type ServerMessage =
  /** Before the game: who is in the room so far. Sent to everyone on every join and leave. */
  | {
      type: 'lobby';
      code: string;
      gameType: GameType;
      playerCount: number;
      players: LobbyPlayer[];
      /** The receiving player. */
      playerId: PlayerId;
    }
  /** A ranked match's room: everyone is in, 3… 2… 1… GO at startsAt; the snapshot follows at GO. */
  | GameRoomCountdown
  /**
   * When the game is created (all seats taken), on reconnect and on rejoin: the game as the client may hold
   * it, publicState() (no solution while it runs). The client keeps it current with the engine's evolve()
   * over the events that follow (seq above state.seq), and draws it with toView(state, playerId, now).
   */
  | {
      type: 'snapshot';
      protocol: typeof PROTOCOL_VERSION;
      state: GameState;
      playerId: PlayerId;
      /**
       * The last clientSeq the server took from this player (0 before any); its next action must be above it,
       * or it is dropped as a duplicate (spec §21). A reconnection keeps the count (an action resent after a
       * drop is still recognised); a rejoin by code starts it over. A client that lost its own count (the app
       * restarted, then reconnected with a saved token) carries on from here. The server always sends it.
       */
      lastClientSeq?: number;
    }
  /**
   * The engine's events. A `reaction` from a player the receiver blocked arrives with `emoji`
   * MUTED_REACTION_EMOJI (moderation.ts): show nothing for it.
   */
  | { type: 'events'; events: GameEvent[] }
  | { type: 'rejected'; clientSeq: number; reason: RejectReason }
  /** After gameOver: the solution, for the replay (spec §21). */
  | { type: 'solution'; solution: string }
  | { type: 'pong'; t: number; serverTime: number };

export type ServerMessageType = ServerMessage['type'];

export const SERVER_MESSAGE_TYPES = [
  'lobby',
  'countdown',
  'snapshot',
  'events',
  'rejected',
  'solution',
  'pong',
] as const satisfies readonly ServerMessageType[];

export const CLIENT_MESSAGE_TYPES = [
  'select',
  'release',
  'place',
  'interfere',
  'react',
  'surrender',
  'offlineMove',
  'ping',
] as const satisfies readonly ClientMessage['type'][];

// The event and state types of spec §18 are the engine's; re-exported so app and server import one place.
export type {
  ClientAction,
  GameEvent,
  GameEventType,
  GameState,
  GameView,
  HostUpdate,
  LockTimer,
  PlayerView,
  RejectReason,
} from '@sudoku-fight/engine';

export type ClientMessageType = ClientMessage['type'];

export * from './room';
export * from './telemetry';
export * from './admin';
export * from './account';
export * from './matchmaking';
export * from './interferenceKinds';
export * from './history';
export * from './progress';
export * from './moderation';
