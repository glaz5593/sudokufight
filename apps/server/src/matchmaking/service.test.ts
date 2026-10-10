import { ManualClock, ManualScheduler } from '@sudoku-fight/engine';
import type { MatchmakingServerMessage, MatchSeatReservation } from '@sudoku-fight/protocol';

import { quietLog } from '../testing';
import type { OpponentRecord } from './matcher';
import type { RankedMatchLink, RankedRoomHooks } from './ranked';
import {
  DEFAULT_MATCHMAKING,
  type MatchGames,
  type MatchmakingConfig,
  MatchmakingRefusal,
  MatchmakingService,
  type MatchSession,
  type OpenMatch,
  type StoredPlayer,
} from './service';

/**
 * Matchmaking's flow (spec §10, D32, D37) with a manual clock and timers, a store in memory and stand-in game
 * rooms that claim their match the way the game room does.
 */

const T0 = Date.UTC(2026, 9, 9, 12);
const S = 1000;

type Message = MatchmakingServerMessage;
type Of<T extends Message['type']> = Extract<Message, { type: T }>;

class FakeSession implements MatchSession {
  readonly sent: Message[] = [];
  closed = false;
  constructor(
    readonly id: string,
    private readonly onClose: (id: string) => void,
  ) {}
  send(message: Message): void {
    this.sent.push(message);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose(this.id); // Colyseus calls the room's onLeave
  }
  of<T extends Message['type']>(type: T): Of<T>[] {
    return this.sent.filter((m): m is Of<T> => m.type === type);
  }
  last<T extends Message['type']>(type: T): Of<T> {
    const found = this.of(type).at(-1);
    if (!found) throw new Error(`${this.id}: no ${type}`);
    return found;
  }
  get types(): Message['type'][] {
    return this.sent.map((m) => m.type);
  }
}

interface Room {
  match: OpenMatch;
  link: RankedMatchLink;
  calls: string[];
}

interface SetupOptions {
  players?: Record<string, Partial<StoredPlayer>>;
  history?: Record<string, OpponentRecord[]>;
  ratingOption?: 'A' | 'B';
  failOpen?: boolean;
  config?: Partial<MatchmakingConfig>;
  /** The clock moves this much each time the service reads it (a busy server: no two reads alike). */
  tickOnRead?: number;
}

function setup({
  players = {},
  history = {},
  ratingOption = 'B',
  failOpen = false,
  config = {},
  tickOnRead = 0,
}: SetupOptions = {}) {
  const clock = new ManualClock(T0);
  const scheduler = new ManualScheduler(clock);
  const asked: [string, string][] = [];
  const rooms: Room[] = [];
  let ids = 0;
  const games: MatchGames = {
    open(match) {
      if (failOpen) return Promise.reject(new Error('no room for you'));
      // What GameRoom.onCreate does: claim the match, with hooks that record what matchmaking says.
      const calls: string[] = [];
      const hooks: RankedRoomHooks = {
        onCountdown: (startsAt) => calls.push(`countdown@${startsAt - T0}`),
        onGo: () => calls.push('go'),
        onCancel: () => calls.push('cancel'),
      };
      const link = service.claim(match.id, hooks);
      if (!link) return Promise.reject(new Error('claim refused'));
      rooms.push({ match, link, calls });
      const roomId = `ROOM${rooms.length}`;
      const reservations = new Map<string, MatchSeatReservation>(
        match.players.map((p) => [p.userId, { name: 'game', roomId, sessionId: `seat-${p.userId}` }]),
      );
      return Promise.resolve({ roomId, reservations });
    },
  };
  const service: MatchmakingService = new MatchmakingService({
    store: {
      player(userId, key) {
        asked.push([userId, key]);
        const p = players[userId] ?? (userId.startsWith('ghost') ? undefined : {});
        return Promise.resolve(
          p && {
            name: userId,
            avatarId: 'av07',
            country: 'IL',
            rating: 1200,
            games: 0,
            provisional: true,
            ...p,
          },
        );
      },
      opponents: (userId) => Promise.resolve(history[userId] ?? []),
    },
    games,
    ratingOption,
    now: () => {
      const t = clock.now();
      if (tickOnRead) clock.advance(tickOnRead);
      return t;
    },
    scheduler,
    newId: () => `match-${++ids}`,
    log: quietLog(),
    config: { ...DEFAULT_MATCHMAKING, ...config },
  });
  const sessions = new Map<string, FakeSession>();
  /** A player joins the queue on a connection of their own. */
  const join = async (userId: string, queueKey: unknown = 'fast-2p') => {
    const session = new FakeSession(`s-${userId}-${sessions.size}`, (id) => service.left(id));
    sessions.set(userId, session);
    await service.enqueue(session, { userId, name: userId }, queueKey);
    return session;
  };
  /** Moves time on and lets the rooms' promises settle. */
  const advance = async (ms: number) => {
    scheduler.advance(ms);
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  };
  return { clock, scheduler, service, rooms, asked, join, advance };
}

describe('searching', () => {
  it('sends `searching` on joining, then each time the range widens', async () => {
    const { join, advance } = setup();
    const ana = await join('ana');
    expect(ana.sent).toEqual([
      {
        type: 'searching',
        queueKey: 'fast-2p',
        rating: 1200,
        elapsedMs: 0,
        range: 50,
        extended: false,
        timeoutAt: T0 + 60 * S,
        serverTime: T0,
      },
    ]);
    await advance(4500);
    expect(ana.sent).toHaveLength(1);
    await advance(500);
    expect(ana.last('searching')).toMatchObject({ elapsedMs: 5000, range: 75 });
    await advance(45 * S);
    expect(ana.of('searching').map((m) => m.range)).toEqual([
      50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300,
    ]);
  });

  it('each `searching` is one instant: a new search at 0, its timeout whole, though the clock moves meanwhile', async () => {
    const { join, advance, service } = setup({ tickOnRead: 1 });
    const ana = await join('ana');
    const first = ana.last('searching');
    expect(first.elapsedMs).toBe(0);
    expect(first.timeoutAt - first.serverTime).toBe(60 * S);
    await advance(61 * S);
    expect(ana.of('timeout')).toHaveLength(1);
    service.keepSearching(ana.id);
    const more = ana.last('searching');
    expect(more.extended).toBe(true);
    expect(more.timeoutAt - more.serverTime).toBe(DEFAULT_MATCHMAKING.extendedTimeoutMs);
  });

  it("matches on the queue's rating key: B `fast`, A `fast-2p`", async () => {
    const b = setup();
    await b.join('ana');
    const a = setup({ ratingOption: 'A' });
    await a.join('ana');
    expect(b.asked).toEqual([['ana', 'fast']]);
    expect(a.asked).toEqual([['ana', 'fast-2p']]);
  });

  it('refuses a bad queue, a closed one, a second search and a player without an account', async () => {
    // A server may close queues (all are open by default since stage 10).
    const { join } = setup({ config: { openPlayerCounts: [2] } });
    const refusal = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: unknown) => (e instanceof MatchmakingRefusal ? e.error : e),
      );
    expect(await refusal(join('ana', 'fast-5p'))).toBe('badQueue');
    expect(await refusal(join('ana', null))).toBe('badQueue');
    expect(await refusal(join('ana', 'normal-3p'))).toBe('queueClosed');
    expect(await refusal(join('ghost1'))).toBe('unauthenticated');
    await join('ana');
    expect(await refusal(join('ana', 'hard-2p'))).toBe('alreadyQueued');
  });

  it('`cancel` ends the search: `cancelled`, the connection closes, the player may search again', async () => {
    const { join, service } = setup();
    const ana = await join('ana');
    service.cancel(ana.id);
    expect(ana.types).toEqual(['searching', 'cancelled']);
    expect(ana.closed).toBe(true);
    expect(service.queued('fast-2p')).toEqual([]);
    await join('ana');
    expect(service.queued('fast-2p').map((t) => t.userId)).toEqual(['ana']);
  });

  it('leaving the room while searching cancels the search', async () => {
    const { join, service } = setup();
    const ana = await join('ana');
    service.left(ana.id);
    expect(service.queued('fast-2p')).toEqual([]);
  });
});

describe('timeout (spec §10)', () => {
  it('after 60 s: `timeout`; "keep searching" goes on with no cap on the range', async () => {
    const { join, advance, service } = setup();
    const ana = await join('ana');
    await advance(59_500);
    expect(ana.of('timeout')).toEqual([]);
    await advance(500);
    expect(ana.last('timeout')).toEqual({
      type: 'timeout',
      queueKey: 'fast-2p',
      elapsedMs: 60 * S,
      range: 300,
      extended: false,
      keepSearchingUntil: T0 + 120 * S,
    });
    expect(ana.closed).toBe(false);
    expect(service.queued('fast-2p')).toEqual([]);

    service.keepSearching(ana.id);
    expect(ana.last('searching')).toMatchObject({
      elapsedMs: 60 * S,
      range: 350,
      extended: true,
      timeoutAt: T0 + 120 * S,
    });
    await advance(5 * S);
    expect(ana.last('searching').range).toBe(375);
    // A player 400 away who also kept searching: both reach ±400 at 70 s.
    const ben = await join('ben');
    expect(ben.last('searching').range).toBe(50);
  });

  it('two extended searches far apart meet once both ranges cover the gap', async () => {
    const { join, advance, service } = setup({ players: { ben: { rating: 1600 } } });
    const ana = await join('ana');
    const ben = await join('ben');
    await advance(60 * S);
    service.keepSearching(ana.id);
    service.keepSearching(ben.id);
    await advance(9500);
    expect(ana.of('found')).toEqual([]);
    await advance(500); // 70 s: ±400
    expect(ana.last('found').players.map((p) => p.id)).toEqual(['ana', 'ben']);
  });

  it('without an answer, the connection closes after the keep-searching window', async () => {
    const { join, advance } = setup();
    const ana = await join('ana');
    await advance(60 * S);
    expect(ana.closed).toBe(false);
    await advance(60 * S);
    expect(ana.closed).toBe(true);
  });
});

describe('a match', () => {
  async function found() {
    const t = setup({
      players: {
        ana: { rating: 1210, country: 'IL' },
        ben: { rating: 1190, avatarId: 'av12', country: 'DE' },
      },
    });
    const ana = await t.join('ana');
    t.clock.advance(2 * S);
    const ben = await t.join('ben');
    await t.advance(500);
    return { ...t, ana, ben, room: t.rooms[0]! };
  }

  it('`found` gives each player the profiles and a seat in the same game room', async () => {
    const { ana, ben, room, service } = await found();
    const a = ana.last('found');
    const b = ben.last('found');
    expect(a).toMatchObject({
      matchId: 'match-1',
      queueKey: 'fast-2p',
      playerId: 'ana',
      rematch: false,
      readyBy: T0 + 12_500,
      serverTime: T0 + 2500,
    });
    expect(a.players).toEqual([
      { id: 'ana', name: 'ana', avatarId: 'av07', country: 'IL', rating: 1210, provisional: true },
      { id: 'ben', name: 'ben', avatarId: 'av12', country: 'DE', rating: 1190, provisional: true },
    ]);
    expect(b.players).toEqual(a.players);
    expect(b.playerId).toBe('ben');
    expect(a.reservation.roomId).toBe('ROOM1');
    expect(b.reservation.roomId).toBe('ROOM1');
    expect(a.reservation.sessionId).not.toBe(b.reservation.sessionId);
    expect(room.link.setup).toMatchObject({
      matchId: 'match-1',
      gameType: 'fast',
      playerCount: 2,
      ratingKey: 'fast',
      players: [
        { userId: 'ana', name: 'ana', rating: 1210, games: 0 },
        { userId: 'ben', name: 'ben', rating: 1190, games: 0 },
      ],
    });
    expect(service.queued('fast-2p')).toEqual([]);
    expect(service.pendingMatches).toBe(1);
  });

  it('everyone connected (D37): `ready`, the countdown, then GO and `started`; the connections close', async () => {
    const { ana, ben, room, advance, service, join } = await found();
    room.link.join('ana');
    expect(ana.last('ready').ready).toEqual(['ana']);
    expect(ben.last('ready').ready).toEqual(['ana']);
    room.link.join('ben');
    expect(ana.last('ready').ready).toEqual(['ana', 'ben']);
    expect(ana.last('countdown')).toEqual({
      type: 'countdown',
      matchId: 'match-1',
      startsAt: T0 + 2500 + 3000,
      serverTime: T0 + 2500,
    });
    expect(room.calls).toEqual(['countdown@5500']);
    await advance(2999);
    expect(room.calls).not.toContain('go');
    await advance(1);
    expect(room.calls).toEqual(['countdown@5500', 'go']);
    for (const s of [ana, ben]) {
      expect(s.last('started')).toEqual({ type: 'started', matchId: 'match-1', roomId: 'ROOM1' });
      expect(s.closed).toBe(true);
    }
    expect(service.pendingMatches).toBe(0);
    // One ranked game at a time: no search while it runs.
    expect(service.isPlaying('ana')).toBe(true);
    await expect(join('ana')).rejects.toMatchObject({ error: 'alreadyQueued' });
    // The room reports the game over (its result stored): free to search again.
    room.link.over();
    expect(service.isPlaying('ana')).toBe(false);
    await join('ana');
    expect(service.queued('fast-2p').map((t) => t.userId)).toEqual(['ana']);
  });

  it('a game whose room closes (it never ended: a shutdown, a failed start) frees its players too', async () => {
    const { room, advance, service, join } = await found();
    room.link.join('ana');
    room.link.join('ben');
    await advance(3000);
    expect(service.isPlaying('ben')).toBe(true);
    room.link.closed();
    expect(service.isPlaying('ana')).toBe(false);
    expect(service.isPlaying('ben')).toBe(false);
    await join('ben');
    expect(room.calls).toEqual(['countdown@5500', 'go']); // nothing more: the match was not called off
  });

  it('no cancelling after "found" [D32]; leaving matchmaking then does not stop the match', async () => {
    const { ana, ben, room, advance, service } = await found();
    service.cancel(ana.id);
    expect(ana.of('cancelled')).toEqual([]);
    service.left(ana.id); // the app closed this connection, and joins the game room
    room.link.join('ana');
    room.link.join('ben');
    await advance(3000);
    expect(room.calls).toEqual(['countdown@5500', 'go']);
    expect(ben.last('started').roomId).toBe('ROOM1');
  });

  it('a player who leaves the game room before everyone is in is not ready any more', async () => {
    const { ana, room } = await found();
    room.link.join('ana');
    room.link.leave('ana');
    expect(ana.last('ready').ready).toEqual([]);
    room.link.join('ana');
    expect(ana.last('ready').ready).toEqual(['ana']);
  });

  it('marks a rematch on `found`', async () => {
    const t = setup({
      history: {
        ana: [{ opponentId: 'ben', playedAt: T0 - 1000 }],
        ben: [{ opponentId: 'ana', playedAt: T0 - 1000 }],
      },
    });
    const ana = await t.join('ana');
    await t.join('ben');
    await t.advance(500);
    expect(ana.last('found').rematch).toBe(true);
  });
});

describe('the ready check (spec §10, D37)', () => {
  it('a no-show: the match is off, the room closes, the others go back to the head of the queue', async () => {
    const t = setup({ players: { dan: { rating: 1600 } } });
    const dan = await t.join('dan'); // waiting first, far away
    t.clock.advance(S);
    const ana = await t.join('ana');
    t.clock.advance(S);
    const ben = await t.join('ben');
    await t.advance(500); // ana and ben matched at T0 + 2.5 s
    const room = t.rooms[0]!;
    room.link.join('ana');
    await t.advance(9999);
    expect(ana.of('matchCancelled')).toEqual([]);
    await t.advance(1); // 10 s after "found": ben never came

    expect(ben.last('matchCancelled')).toEqual({
      type: 'matchCancelled',
      matchId: 'match-1',
      reason: 'noShow',
      missing: ['ben'],
      requeued: false,
    });
    expect(ben.closed).toBe(true);
    expect(room.calls).toEqual(['cancel']);
    expect(ana.last('matchCancelled')).toMatchObject({ requeued: true, missing: ['ben'] });
    // The time since the match (10.5 s) doesn't count as searching: ana had searched 1 s.
    expect(ana.last('searching')).toMatchObject({ requeued: true, elapsedMs: 1000, range: 50 });
    // Head of the queue, before dan who has waited longer; her original order of service kept.
    const queue = t.service.queued('fast-2p');
    expect(queue.map((x) => x.userId)).toEqual(['ana', 'dan']);
    expect(queue[0]).toMatchObject({ priority: true, enqueuedAt: T0 + S, deadline: T0 + 71_500 });
    expect(dan.of('matchCancelled')).toEqual([]);

    // The no-show may search again; ana is served first.
    const ben2 = await t.join('ben');
    await t.advance(500);
    expect(ben2.last('found').players.map((p) => p.id)).toEqual(['ana', 'ben']);
  });

  it('the game room closing before everyone is in counts as a no-show of the missing', async () => {
    const t = setup();
    const ana = await t.join('ana');
    const ben = await t.join('ben');
    await t.advance(500);
    t.rooms[0]!.link.join('ben');
    t.rooms[0]!.link.closed();
    expect(ana.last('matchCancelled')).toMatchObject({ reason: 'noShow', missing: ['ana'], requeued: false });
    expect(ben.last('matchCancelled')).toMatchObject({ requeued: true });
    expect(t.service.queued('fast-2p').map((x) => x.userId)).toEqual(['ben']);
  });

  it('a room that does not open: everyone back in the queue', async () => {
    const t = setup({ failOpen: true });
    const ana = await t.join('ana');
    const ben = await t.join('ben');
    await t.advance(500);
    expect(ana.last('matchCancelled')).toMatchObject({ reason: 'error', missing: [], requeued: true });
    expect(ben.last('matchCancelled')).toMatchObject({ reason: 'error', requeued: true });
    expect(t.service.queued('fast-2p').every((x) => x.priority)).toBe(true);
  });

  it('a match is claimed once, by its id only', async () => {
    const t = setup();
    await t.join('ana');
    await t.join('ben');
    await t.advance(500);
    const hooks = { onCountdown: () => undefined, onGo: () => undefined, onCancel: () => undefined };
    expect(t.service.claim('match-1', hooks)).toBeUndefined();
    expect(t.service.claim('nope', hooks)).toBeUndefined();
  });

  it('once the countdown runs the seats are fixed: leaving then does not stop GO [D32]', async () => {
    const t = setup();
    await t.join('ana');
    await t.join('ben');
    await t.advance(500);
    const room = t.rooms[0]!;
    room.link.join('ana');
    room.link.join('ben');
    room.link.leave('ben');
    await t.advance(3000);
    expect(room.calls).toEqual(['countdown@3500', 'go']);
  });
});

describe('3 and 4 players (stage 10, spec §10)', () => {
  it('the queues of 3 and 4 are open: nobody is refused, and a 3-player search waits', async () => {
    const t = setup();
    const ana = await t.join('ana', 'fast-3p');
    const dan = await t.join('dan', 'hard-4p');
    expect(ana.last('searching')).toMatchObject({ queueKey: 'fast-3p', range: 50 });
    expect(dan.last('searching')).toMatchObject({ queueKey: 'hard-4p' });
    expect(t.asked).toEqual([
      ['ana', 'fast'],
      ['dan', 'hard'],
    ]);
  });

  it('a match of 3 forms only when the group is full; whoever is found waits for the rest', async () => {
    const t = setup({ players: { ben: { rating: 1220, avatarId: 'av12' }, cyd: { rating: 1190 } } });
    const ana = await t.join('ana', 'fast-3p');
    t.clock.advance(S);
    const ben = await t.join('ben', 'fast-3p');
    await t.advance(5 * S);
    // Two in range of each other, no third: no match yet, both keep searching.
    expect(ana.of('found')).toEqual([]);
    expect(t.service.queued('fast-3p').map((x) => x.userId)).toEqual(['ana', 'ben']);
    const cyd = await t.join('cyd', 'fast-3p');
    await t.advance(500);
    const found = ana.last('found');
    expect(found).toMatchObject({ matchId: 'match-1', queueKey: 'fast-3p', playerId: 'ana', rematch: false });
    // Everyone, in seat order (the order of service), with their profiles; one room, a seat each.
    expect(found.players.map((p) => [p.id, p.rating, p.avatarId])).toEqual([
      ['ana', 1200, 'av07'],
      ['ben', 1220, 'av12'],
      ['cyd', 1190, 'av07'],
    ]);
    for (const s of [ben, cyd]) expect(s.last('found').players).toEqual(found.players);
    const rooms = new Set([ana, ben, cyd].map((s) => s.last('found').reservation.roomId));
    expect(rooms).toEqual(new Set(['ROOM1']));
    expect(t.rooms[0]!.link.setup).toMatchObject({
      queueKey: 'fast-3p',
      playerCount: 3,
      ratingKey: 'fast',
      players: [
        { userId: 'ana', rating: 1200 },
        { userId: 'ben', rating: 1220 },
        { userId: 'cyd', rating: 1190 },
      ],
    });
    expect(t.service.queued('fast-3p')).toEqual([]);
  });

  it('the countdown waits for all (D37): GO only once the last of the 3 is in the room', async () => {
    const t = setup();
    const sessions = [];
    for (const id of ['ana', 'ben', 'cyd']) sessions.push(await t.join(id, 'normal-3p'));
    await t.advance(500);
    const room = t.rooms[0]!;
    room.link.join('ana');
    room.link.join('ben');
    expect(sessions[0]!.last('ready').ready).toEqual(['ana', 'ben']);
    expect(room.calls).toEqual([]);
    await t.advance(5 * S);
    expect(sessions.every((s) => s.of('countdown').length === 0)).toBe(true);
    room.link.join('cyd');
    expect(room.calls).toEqual(['countdown@8500']);
    await t.advance(3000);
    expect(room.calls).toEqual(['countdown@8500', 'go']);
    for (const s of sessions) expect(s.last('started')).toMatchObject({ roomId: 'ROOM1' });
    expect(['ana', 'ben', 'cyd'].every((id) => t.service.isPlaying(id))).toBe(true);
  });

  it('a no-show in a match of 4: the three who came go back to the head of the queue, and meet a fourth', async () => {
    const t = setup();
    const four = [];
    for (const id of ['ana', 'ben', 'cyd', 'dan']) {
      four.push(await t.join(id, 'fast-4p'));
      t.clock.advance(S);
    }
    await t.advance(500);
    const room = t.rooms[0]!;
    for (const id of ['ana', 'ben', 'cyd']) room.link.join(id);
    await t.advance(10 * S);
    const [ana, , , dan] = four;
    expect(dan!.last('matchCancelled')).toMatchObject({
      reason: 'noShow',
      missing: ['dan'],
      requeued: false,
    });
    expect(dan!.closed).toBe(true);
    expect(ana!.last('matchCancelled')).toMatchObject({ missing: ['dan'], requeued: true });
    expect(room.calls).toEqual(['cancel']);
    const queue = t.service.queued('fast-4p');
    expect(queue.map((x) => x.userId)).toEqual(['ana', 'ben', 'cyd']);
    expect(queue.every((x) => x.priority)).toBe(true);

    const eve = await t.join('eve', 'fast-4p');
    await t.advance(500);
    expect(eve.last('found').players.map((p) => p.id)).toEqual(['ana', 'ben', 'cyd', 'eve']);
    expect(t.rooms[1]!.link.setup).toMatchObject({ playerCount: 4, queueKey: 'fast-4p' });
  });

  it('RATING_OPTION A: a 4-player game moves its own key (`hard-4p`)', async () => {
    const t = setup({ ratingOption: 'A' });
    for (const id of ['ana', 'ben', 'cyd', 'dan']) await t.join(id, 'hard-4p');
    await t.advance(500);
    expect(t.asked.every(([, key]) => key === 'hard-4p')).toBe(true);
    expect(t.rooms[0]!.link.setup).toMatchObject({ ratingKey: 'hard-4p', playerCount: 4 });
  });

  it('a group forms only when every pair is in range; the far one waits', async () => {
    const t = setup({ players: { far: { rating: 1500 } } });
    const far = await t.join('far', 'fast-3p');
    await t.join('ana', 'fast-3p');
    await t.join('ben', 'fast-3p');
    await t.advance(500);
    expect(far.of('found')).toEqual([]);
    expect(t.rooms).toEqual([]);
    const cyd = await t.join('cyd', 'fast-3p');
    await t.advance(500);
    expect(cyd.last('found').players.map((p) => p.id)).toEqual(['ana', 'ben', 'cyd']);
    expect(t.service.queued('fast-3p').map((x) => x.userId)).toEqual(['far']);
  });
});
