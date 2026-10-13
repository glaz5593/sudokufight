/* Test-only: the matchmaking room and the network, faked, for MatchmakingClient's tests and the match screens. */
import type { ManualClock, ManualScheduler, PlayerId } from '@sudoku-fight/engine';
import {
  MATCH_RANGE,
  MATCH_TIMEOUT_MS,
  type MatchmakingClientMessage,
  type MatchmakingServerMessage,
  type MatchPlayer,
  type MatchSeatReservation,
  type QueueKey,
} from '@sudoku-fight/protocol';

import type { MatchmakingConnector, MatchmakingRoomLike } from '../matchmaking';
import type { OnlineInfo } from '../remoteGameHost';
import { CODE, ME, OPP, sdkError } from './fakeServer';

type Handler = (message: MatchmakingServerMessage) => void;

/** One connection to the matchmaking room, as the SDK's Room would be. */
export class FakeMatchmakingRoom implements MatchmakingRoomLike {
  /** Everything the client sent. */
  readonly sent: MatchmakingClientMessage[] = [];
  /** null while open; whether the leave was consented once closed. */
  left: boolean | null = null;
  private readonly handlers = new Map<string, Handler>();
  private readonly leaveHandlers: ((code: number) => void)[] = [];

  constructor(readonly queueKey: QueueKey) {}

  get open(): boolean {
    return this.left === null;
  }

  onMessage(type: MatchmakingServerMessage['type'], callback: Handler): void {
    this.handlers.set(type, callback);
  }

  onLeave(callback: (code: number) => void): void {
    this.leaveHandlers.push(callback);
  }

  send(type: MatchmakingClientMessage['type'], message: MatchmakingClientMessage): void {
    if (!this.open) return;
    if (type !== message.type) throw new Error(`type ${type} ≠ message.type ${message.type}`);
    this.sent.push(message);
  }

  leave(consented: boolean): Promise<number> {
    this.shut(consented ? 4000 : 1005, consented);
    return Promise.resolve(4000);
  }

  /** A message from the server, now. */
  deliver(message: MatchmakingServerMessage): void {
    if (this.open) this.handlers.get(message.type)?.(message);
  }

  /** The server closes the connection (4000), or the network drops it (1006). */
  cut(code = 1006): void {
    this.shut(code, false);
  }

  private shut(code: number, consented: boolean): void {
    if (!this.open) return;
    this.left = consented;
    for (const h of this.leaveHandlers) h(code);
  }
}

export const MATCH_ID = 'match-1';

/** The players of a 2-player match: me (seat 0, Moshe) and NinaVolt. */
export const MATCH_PLAYERS: MatchPlayer[] = [
  { id: ME, name: 'Moshe', avatarId: 'lava-lamp', country: 'IL', rating: 1287, provisional: false },
  { id: OPP, name: 'NinaVolt', avatarId: 'maya', country: 'DE', rating: 1305, provisional: true },
];

export const RESERVATION: MatchSeatReservation = { name: 'game', roomId: CODE, sessionId: 'seat-1' };

/**
 * The matchmaking service around one MatchmakingClient: the queue's connection, the server's clock `skewMs`
 * off the phone's, and its messages. The clock and the timers are a FakeTable's (or any), so a match's room
 * and the queue share one time.
 */
export class FakeMatchmaking implements MatchmakingConnector {
  readonly rooms: FakeMatchmakingRoom[] = [];
  readonly joins: QueueKey[] = [];
  /** Server clock minus phone clock. */
  skewMs = 0;
  /** The next join is refused with this. */
  refuse: Error | null = null;
  /** No network: every join fails at once. */
  offline = false;
  /** Joins never answer. */
  hang = false;
  rating = 1287;

  constructor(
    readonly clock: ManualClock,
    readonly scheduler: ManualScheduler,
  ) {}

  serverNow(): number {
    return this.clock.now() + this.skewMs;
  }

  /** The connection in use (the last one made). */
  get room(): FakeMatchmakingRoom {
    const room = this.rooms[this.rooms.length - 1];
    if (!room) throw new Error('No matchmaking connection yet');
    return room;
  }

  join(queueKey: QueueKey): Promise<MatchmakingRoomLike> {
    this.joins.push(queueKey);
    if (this.hang) return new Promise(() => undefined);
    if (this.offline) return Promise.reject(new TypeError('Network request failed'));
    if (this.refuse) {
      const error = this.refuse;
      this.refuse = null;
      return Promise.reject(error);
    }
    const room = new FakeMatchmakingRoom(queueKey);
    this.rooms.push(room);
    return Promise.resolve(room);
  }

  // -- the server's side ---------------------------------------------------------------------------------

  searching({
    elapsedMs = 0,
    extended = false,
    requeued,
    range = extended
      ? MATCH_RANGE.initial + MATCH_RANGE.step * Math.floor(elapsedMs / MATCH_RANGE.stepMs)
      : Math.min(
          MATCH_RANGE.cap,
          MATCH_RANGE.initial + MATCH_RANGE.step * Math.floor(elapsedMs / MATCH_RANGE.stepMs),
        ),
    timeoutInMs = MATCH_TIMEOUT_MS - elapsedMs,
  }: {
    elapsedMs?: number;
    extended?: boolean;
    requeued?: boolean;
    range?: number;
    timeoutInMs?: number;
  } = {}): void {
    const now = this.serverNow();
    this.room.deliver({
      type: 'searching',
      queueKey: this.room.queueKey,
      rating: this.rating,
      elapsedMs,
      range,
      extended,
      timeoutAt: now + timeoutInMs,
      serverTime: now,
      ...(requeued ? { requeued } : {}),
    });
  }

  timeout({
    elapsedMs = MATCH_TIMEOUT_MS,
    range = MATCH_RANGE.cap,
    extended = false,
    windowMs = 60_000,
  } = {}): void {
    this.room.deliver({
      type: 'timeout',
      queueKey: this.room.queueKey,
      elapsedMs,
      range,
      extended,
      keepSearchingUntil: this.serverNow() + windowMs,
    });
  }

  found({
    matchId = MATCH_ID,
    players = MATCH_PLAYERS,
    rematch = false,
    reservation = RESERVATION,
    readyInMs = 10_000,
  }: {
    matchId?: string;
    players?: MatchPlayer[];
    rematch?: boolean;
    reservation?: MatchSeatReservation;
    readyInMs?: number;
  } = {}): void {
    const now = this.serverNow();
    this.room.deliver({
      type: 'found',
      matchId,
      queueKey: this.room.queueKey,
      playerId: ME,
      players,
      rematch,
      reservation,
      readyBy: now + readyInMs,
      serverTime: now,
    });
  }

  ready(ready: PlayerId[], matchId = MATCH_ID): void {
    this.room.deliver({ type: 'ready', matchId, ready });
  }

  /** 3… 2… 1…: GO in `goInMs`; returns GO in server time. */
  countdown(goInMs = 3000, matchId = MATCH_ID): number {
    const now = this.serverNow();
    this.room.deliver({ type: 'countdown', matchId, startsAt: now + goInMs, serverTime: now });
    return now + goInMs;
  }

  started(matchId = MATCH_ID): void {
    this.room.deliver({ type: 'started', matchId, roomId: CODE });
    this.room.cut(4000);
  }

  matchCancelled({ requeued = true, missing = [OPP], matchId = MATCH_ID } = {}): void {
    this.room.deliver({ type: 'matchCancelled', matchId, reason: 'noShow', missing, requeued });
    if (!requeued) this.room.cut(4000);
  }

  /** A refusal as the SDK throws it. */
  static refusal(error: string, code = 4215): Error {
    return sdkError(`${error}: refused`, code);
  }
}

/** A match's room for tests that need no real one: its OnlineInfo is set by hand. */
export class FakeMatchHost {
  online: OnlineInfo = {
    status: 'connecting',
    closeReason: null,
    error: null,
    code: null,
    playerId: null,
    lobby: null,
    reconnect: null,
    pendingCell: null,
    hasGame: false,
    resyncedAt: null,
    startsAt: null,
  };
  readonly sync = { synced: false };
  offsetMs = 0;
  private readonly listeners = new Set<(info: OnlineInfo) => void>();

  constructor(private readonly now: () => number) {}

  subscribeOnline(listener: (info: OnlineInfo) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  serverNow(): number {
    return this.now() + this.offsetMs;
  }

  set(patch: Partial<OnlineInfo>): void {
    this.online = { ...this.online, ...patch };
    for (const l of [...this.listeners]) l(this.online);
  }
}

/** A match entry over a FakeMatchHost. */
export class FakeMatchEntry {
  closed = false;
  readonly host: FakeMatchHost;

  constructor(
    now: () => number,
    readonly reservation: MatchSeatReservation,
  ) {
    this.host = new FakeMatchHost(now);
  }

  close(): void {
    this.closed = true;
  }
}
