import type {
  Clock,
  GameMode,
  GameState,
  GameType,
  GameView,
  HostUpdate,
  PlayerId,
} from '@sudoku-fight/engine';

import type { OnlineError } from '../net/errors';
import type { DevRoomOptions } from '../net/onlineClient';
import type { OnlineInfo, RemoteGameHost } from '../net/remoteGameHost';
import { gameEndProps, gameStartProps } from './analyticsProps';

/**
 * A game on the server (work plan stage 7, spec §16–§18), with the surface the game screen uses for a practice
 * session (session.ts): `host` (the GameHost interface: here a RemoteGameHost), `clock` (the SERVER's clock,
 * synced by ping/pong, which every deadline of the view is in), getView, subscribe, close, and endPractice,
 * which in a ranked game is the surrender (spec §6.6: after the player confirmed).
 *
 * Unlike a practice nothing is saved on the phone: the server keeps the ranked game (spec §16.2; stage 9
 * stores it). Analytics (spec §22): game_start when this session sees the game begin (its first snapshot is
 * the game as created, before the start: a rejoin mid-game is not a new start) and game_end when it sees
 * the end; `reconnect` and `latency_sample` come from the host itself.
 *
 * Before the game there is no view: `online` (the host's OnlineInfo) says what to show instead (connecting,
 * the lobby, a refusal). Pure: no React Native; the host comes in ready made (net/device.ts on the phone, a
 * fake server in tests).
 */

/** How the session gets into its room: a new private room (dev, stage 7), or one by its code. */
export type OnlineRequest = { kind: 'create'; options: DevRoomOptions } | { kind: 'join'; code: string };

/** The connection, as the game screen follows it. */
export interface SessionConnection {
  readonly info: OnlineInfo;
  subscribe(listener: (info: OnlineInfo) => void): () => void;
  /** The game's grace period (its rules; a dev room may shorten it); null before the game. */
  readonly graceMs: number | null;
}

export type OnlineTrack = (name: 'game_start' | 'game_end', props: Record<string, string | number>) => void;

export interface OnlineSessionDeps {
  host: RemoteGameHost;
  request: OnlineRequest;
  track?: OnlineTrack;
  /** Where a failed create or join is reported (the host's `online` shows it too). */
  onError?: (error: OnlineError) => void;
}

let sessions = 0;

export class OnlineSession {
  readonly kind = 'online' as const;
  readonly mode: GameMode = 'ranked';
  /** Unique per session (a retry is a new session): React keys. */
  readonly key: string;
  readonly host: RemoteGameHost;
  readonly request: OnlineRequest;
  /** The server's clock: what the view's deadlines (expiresAt, graceEndsAt) are in. */
  readonly clock: Clock;
  readonly connection: SessionConnection;
  /** Settles once the room is joined or refused (never rejects: the refusal is in `online`). */
  readonly ready: Promise<void>;

  private started = false;
  private ended = false;
  private closed = false;
  private readonly unsubscribe: () => void;
  private readonly track: OnlineTrack | undefined;

  constructor({ host, request, track, onError }: OnlineSessionDeps) {
    this.key = `online-${++sessions}`;
    this.host = host;
    this.request = request;
    this.clock = host.clock;
    this.track = track;
    const self = this;
    this.connection = {
      get info() {
        return self.host.online;
      },
      subscribe: (listener) => self.host.subscribeOnline(listener),
      get graceMs() {
        return self.graceMs;
      },
    };
    // Before any screen: the start and the end are counted however the screens come and go.
    this.unsubscribe = host.subscribe((update) => this.onUpdate(update));
    const open = request.kind === 'create' ? host.create(request.options) : host.join(request.code);
    this.ready = open.then(
      () => undefined,
      (error: OnlineError) => {
        onError?.(error);
      },
    );
  }

  /** The game's id once the server sent it; before that, this session's own key. */
  get id(): string {
    return this.host.game?.config.id ?? this.key;
  }

  /** This player, as the server named it ('' until the lobby or the snapshot). */
  get playerId(): PlayerId {
    return this.host.playerId;
  }

  get online(): OnlineInfo {
    return this.host.online;
  }

  /** The game's type: the server's word once the game (or the lobby) came, else what was asked for. */
  get gameType(): GameType {
    return (
      this.host.game?.config.gameType ??
      this.host.online.lobby?.gameType ??
      (this.request.kind === 'create' ? this.request.options.gameType : undefined) ??
      'fast'
    );
  }

  /** A game is here: getView() works. */
  get hasGame(): boolean {
    return this.host.game !== null;
  }

  /** The game's grace period (rules.graceMs, a dev room may shorten it); null before the game. */
  get graceMs(): number | null {
    return this.host.game?.config.rules.graceMs ?? null;
  }

  getView(): GameView {
    return this.host.getView();
  }

  subscribe(onUpdate: (update: HostUpdate) => void): () => void {
    return this.host.subscribe(onUpdate);
  }

  subscribeOnline(listener: (info: OnlineInfo) => void): () => void {
    return this.host.subscribeOnline(listener);
  }

  /** Ranked (spec §6.6): the surrender, once the player confirmed; with 2 players an immediate loss. */
  endPractice(): void {
    this.surrender();
  }

  surrender(): void {
    if (this.closed || this.host.game?.status === 'over') return;
    this.host.surrender();
  }

  /** Leaves the room (during a game the server's grace runs, then abandonment [D32]) and stops every timer. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.host.close();
  }

  // -----------------------------------------------------------------------------------------------------

  private onUpdate(update: HostUpdate): void {
    if (update.kind !== 'events') return;
    const state = this.host.game;
    if (!state) return;
    // The first snapshot is the game as created ('waiting'): this session sees it begin.
    if (!this.started && update.events.length === 0 && state.status === 'waiting') {
      this.started = true;
      this.send('game_start', gameStartProps(state.config.mode, state.config.gameType, players(state)));
    }
    if (!this.ended && state.status === 'over' && state.result) {
      this.ended = true;
      this.send('game_end', gameEndProps(state.config.mode, state.result, this.playerId));
    }
  }

  private send(name: 'game_start' | 'game_end', props: Record<string, string | number>): void {
    try {
      this.track?.(name, props);
    } catch {
      // Analytics never breaks a game.
    }
  }
}

const players = (state: GameState): number => state.config.players.length;

/** Whether a session in the store is an online one. */
export const isOnlineSession = (session: unknown): session is OnlineSession =>
  session instanceof OnlineSession;
