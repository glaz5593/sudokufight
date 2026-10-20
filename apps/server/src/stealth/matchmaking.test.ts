import {
  INTERFERENCE_KINDS,
  LEGACY_INTERFERENCE_KINDS,
  ManualClock,
  ManualScheduler,
  type PaceHistory,
} from '@sudoku-fight/engine';
import type { MatchmakingServerMessage, MatchPlayer, MatchSeatReservation } from '@sudoku-fight/protocol';

import { DEFAULT_STEALTH_BOT, type StealthBotSettings } from '../config';
import type { RankedMatchLink, RankedRoomHooks } from '../matchmaking/ranked';
import {
  DEFAULT_MATCHMAKING,
  type MatchGames,
  MatchmakingService,
  type MatchSession,
  type OpenMatch,
  type StoredPlayer,
} from '../matchmaking/service';
import { quietLog } from '../testing';
import { type PersonaProfile, type PersonaSource, type SeatablePersona, StealthMatcher } from './match';

/**
 * The stealth bot in matchmaking (stealth-bot.md §4, §7) [D90, D94, D95], with a manual clock and timers, a
 * store in memory, stand-in game rooms that claim their match as the game room does, and personas in memory:
 * when it comes in (only after the drawn wait, only with nobody to meet, only in a two-player queue, only while
 * on), the `found` it makes (a person's shapes), the persona's seat in the room's setup, and the D95 notice.
 */

const T0 = Date.UTC(2026, 9, 20, 12);
const S = 1000;
const WAIT = 8000;

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
    this.onClose(this.id);
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

class Personas implements PersonaSource {
  readonly profiles = new Map<string, PersonaProfile>();
  made = 0;
  reads = 0;
  poolFull = false;
  seatable(): Promise<SeatablePersona[]> {
    this.reads++;
    return Promise.resolve([...this.profiles.values()]);
  }
  count() {
    return Promise.resolve(this.profiles.size);
  }
  profile(userId: string) {
    return Promise.resolve(this.profiles.get(userId));
  }
  add(userId: string, rating: number, level = 1): PersonaProfile {
    const p: PersonaProfile = {
      userId,
      rating,
      games: 4,
      provisional: true,
      name: `Noa${userId.slice(0, 4)}`,
      avatarId: 'lava-lamp',
      country: 'IL',
      level,
    };
    this.profiles.set(userId, p);
    return p;
  }
  create(): Promise<PersonaProfile | null> {
    if (this.poolFull) return Promise.resolve(null);
    return Promise.resolve(this.add(`0000000${++this.made}-made-uuid`, 1200));
  }
}

interface Room {
  match: OpenMatch;
  link: RankedMatchLink;
  calls: string[];
}

interface SetupOptions {
  stealth?: Partial<StealthBotSettings> | null;
  on?: boolean;
  players?: Record<string, Partial<StoredPlayer>>;
  blocks?: Record<string, string[]>;
  /** The room seats a persona while `found` is still on its way (before open() resolves). */
  seatBotsWhileOpening?: boolean;
}

function setup({
  stealth = {},
  on = true,
  players = {},
  blocks = {},
  seatBotsWhileOpening = false,
}: SetupOptions = {}) {
  const clock = new ManualClock(T0);
  const scheduler = new ManualScheduler(clock);
  const rooms: Room[] = [];
  const personas = new Personas();
  const paceAsked: string[] = [];
  const sw = { on };
  let ids = 0;
  const games: MatchGames = {
    open(match) {
      const calls: string[] = [];
      const hooks: RankedRoomHooks = {
        onCountdown: (startsAt) => calls.push(`countdown@${startsAt - T0}`),
        onGo: () => calls.push('go'),
        onCancel: () => calls.push('cancel'),
      };
      const link = service.claim(match.id, hooks);
      if (!link) return Promise.reject(new Error('claim refused'));
      rooms.push({ match, link, calls });
      if (seatBotsWhileOpening) for (const bot of link.setup.bots ?? []) link.join(bot.userId);
      const roomId = `ROOM${rooms.length}`;
      const reservations = new Map<string, MatchSeatReservation>(
        match.players.map((p) => [p.userId, { name: 'game', roomId, sessionId: `seat-${p.userId}` }]),
      );
      return Promise.resolve({ roomId, reservations });
    },
  };
  const log = quietLog();
  const matcher =
    stealth === null
      ? undefined
      : new StealthMatcher({
          settings: { ...DEFAULT_STEALTH_BOT, enabled: true, ...stealth },
          switch: {
            isOn: () => sw.on,
            state: () =>
              Promise.resolve({
                available: true,
                enabled: sw.on,
                on: sw.on,
                updatedAt: null,
                updatedBy: null,
              }),
          },
          personas,
          pace: {
            history: (userId, gameType): Promise<PaceHistory> => {
              paceAsked.push(`${userId} ${gameType}`);
              return Promise.resolve({ gameType, games: [], stealthWins: [] });
            },
          },
          // The waits at their shortest: 8 s, and 0.3 s to "connect".
          random: () => 0,
          now: () => clock.now(),
          log,
        });
  const service: MatchmakingService = new MatchmakingService({
    store: {
      player: (userId) =>
        Promise.resolve({
          name: userId,
          avatarId: 'lava-lamp',
          country: 'IL',
          rating: 1200,
          games: 3,
          provisional: true,
          ...players[userId],
        }),
      opponents: () => Promise.resolve([]),
      blocked: (userId) => Promise.resolve(blocks[userId] ?? []),
    },
    games,
    ratingOption: 'B',
    now: () => clock.now(),
    scheduler,
    newId: () => `match-${++ids}`,
    log,
    config: DEFAULT_MATCHMAKING,
    stealth: matcher,
  });
  const sessions = new Map<string, FakeSession>();
  const join = async (userId: string, queueKey: unknown = 'fast-2p', kinds?: unknown) => {
    const session = new FakeSession(`s-${userId}-${sessions.size}`, (id) => service.left(id));
    sessions.set(userId, session);
    await service.enqueue(session, { userId, name: userId }, queueKey, kinds);
    return session;
  };
  const settle = async () => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
  };
  const advance = async (ms: number) => {
    for (let left = ms; left > 0; left -= Math.min(left, 500)) {
      scheduler.advance(Math.min(left, 500));
      await settle();
    }
  };
  return { clock, service, rooms, personas, join, advance, settle, sw, paceAsked, log };
}

describe('the stealth bot comes in (D94)', () => {
  it('only after the drawn wait, with nobody to meet: `found` with a persona, in a person’s shapes', async () => {
    const t = setup();
    const p = t.personas.add('5b1f9a2c-0d3e-4f5a-8b6c-7d8e9f0a1b2c', 1230, 3);
    const ana = await t.join('ana', 'fast-2p', [...INTERFERENCE_KINDS]);
    await t.advance(WAIT - 500);
    expect(ana.of('found')).toEqual([]);
    await t.advance(500);
    const found = ana.last('found');
    expect(found).toMatchObject({ playerId: 'ana', rematch: false, matchId: 'match-1' });
    const human: MatchPlayer = {
      id: 'ana',
      name: 'ana',
      avatarId: 'lava-lamp',
      country: 'IL',
      rating: 1200,
      provisional: true,
    };
    expect(found.players).toEqual([
      human,
      { id: p.userId, name: p.name, avatarId: 'lava-lamp', country: 'IL', rating: 1230, provisional: true },
    ]);
    // The persona's profile has exactly a person's fields, nothing more.
    expect(Object.keys(found.players[1]!).sort()).toEqual(Object.keys(human).sort());
    // Within the range on his screen at that moment (±50 at 8 s).
    expect(Math.abs(found.players[1]!.rating - 1200)).toBeLessThanOrEqual(ana.last('searching').range);
    expect(t.service.queued('fast-2p')).toEqual([]);
    expect(t.paceAsked).toEqual(['ana fast']);
  });

  it('the room’s setup: the persona’s seat, no reservation for it, and the person’s own kinds [D47]', async () => {
    const t = setup();
    const p = t.personas.add('persona-1', 1200, 1);
    await t.join('ana', 'fast-2p', ['fireworks', 'cats', 'warp', 'ink']);
    await t.advance(WAIT);
    const room = t.rooms[0]!;
    expect(room.match.players).toEqual([{ userId: 'ana', name: 'ana' }]);
    expect(room.link.setup.players).toEqual([
      { userId: 'ana', name: 'ana', rating: 1200, games: 3 },
      { userId: p.userId, name: p.name, rating: 1200, games: 4 },
    ]);
    expect(room.link.setup.rules.interferenceKinds).toEqual([...LEGACY_INTERFERENCE_KINDS, 'ink']);
    expect(room.link.setup.bots).toEqual([
      {
        userId: p.userId,
        name: p.name,
        level: expect.objectContaining({ reactions: {} }),
        readyAfterMs: 300,
      },
    ]);
    // A human match has no `bots` at all.
    const h = setup({ stealth: null });
    await h.join('ana');
    await h.join('ben');
    await h.advance(500);
    expect(h.rooms[0]!.link.setup).not.toHaveProperty('bots');
  });

  it('then as with a person: its "connect" is `ready`, the person’s the countdown, GO; busy until the game ends', async () => {
    const t = setup();
    const p = t.personas.add('persona-1', 1200);
    const ana = await t.join('ana');
    await t.advance(WAIT);
    const room = t.rooms[0]!;
    room.link.join(p.userId); // the room seats it (0.3 s after it opened)
    expect(ana.last('ready').ready).toEqual([p.userId]);
    room.link.join('ana');
    expect(ana.last('ready').ready).toEqual(['ana', p.userId]);
    expect(room.calls).toEqual([`countdown@${WAIT + 3000}`]);
    await t.advance(3000);
    expect(ana.last('started')).toMatchObject({ roomId: 'ROOM1' });
    expect(t.service.isPlaying(p.userId)).toBe(true);
    // Busy: Ben, alone now, gets another persona (a new one).
    const ben = await t.join('ben');
    await t.advance(WAIT);
    expect(ben.last('found').players[1]!.id).not.toBe(p.userId);
    expect(t.personas.made).toBe(1);
    // Its game over: free again.
    room.link.over();
    expect(t.service.isPlaying(p.userId)).toBe(false);
    expect(t.service.isPlaying('ana')).toBe(false);
  });

  it('a persona the room seats before `found` went out: `ready` comes right after `found`', async () => {
    const t = setup({ seatBotsWhileOpening: true });
    const p = t.personas.add('persona-1', 1200);
    const ana = await t.join('ana');
    await t.advance(WAIT);
    expect(ana.types.slice(-2)).toEqual(['found', 'ready']);
    expect(ana.last('ready').ready).toEqual([p.userId]);
  });

  it('a person first, always: someone he could meet is searching, or comes before the wait', async () => {
    const t = setup({ players: { ben: { rating: 1450 } } });
    t.personas.add('persona-1', 1200);
    const ana = await t.join('ana');
    const ben = await t.join('ben'); // 250 away: within reach (±300), not yet in range
    await t.advance(30 * S);
    expect(ana.of('found')).toEqual([]);
    expect(ana.last('searching').nextRange).toBe(250);
    await t.advance(15 * S); // ±275 at 45 s… ±250 covers them from 40 s
    expect(ana.last('found').players.map((x) => x.id)).toEqual(['ana', 'ben']);
    expect(ben.last('found').players.map((x) => x.id)).toEqual(['ana', 'ben']);

    const u = setup();
    u.personas.add('persona-1', 1200);
    const cy = await u.join('cy');
    await u.advance(5 * S);
    const dan = await u.join('dan');
    await u.advance(500);
    expect(cy.last('found').players.map((x) => x.id)).toEqual(['cy', 'dan']);
    expect(dan.of('found')).toHaveLength(1);
    expect(u.personas.made).toBe(0);
  });

  it('a persona he blocked (from a report on its card, as a person) is never seated against him (§12)', async () => {
    const t = setup({ blocks: { ana: ['persona-1'] } });
    t.personas.add('persona-1', 1200);
    t.personas.add('persona-2', 1210);
    const ana = await t.join('ana');
    await t.advance(WAIT);
    expect(ana.last('found').players[1]!.id).toBe('persona-2');
    // The blocked one alone, and none to make: no bot at all, the usual search.
    const u = setup({ blocks: { ana: ['persona-1'] }, stealth: { personaPoolMax: 1 } });
    u.personas.add('persona-1', 1200);
    const alone = await u.join('ana');
    await u.advance(WAIT + 10_000);
    expect(alone.of('found')).toEqual([]);
    expect(u.personas.made).toBe(0);
  });

  it('players who blocked each other are nobody to each other: each may get a bot', async () => {
    const t = setup({ blocks: { ana: ['ben'], ben: ['ana'] } });
    t.personas.add('persona-1', 1200);
    t.personas.add('persona-2', 1210);
    const ana = await t.join('ana');
    const ben = await t.join('ben');
    await t.advance(WAIT + 1000);
    const a = ana.last('found').players[1]!.id;
    const b = ben.last('found').players[1]!.id;
    expect([a, b].sort()).toEqual(['persona-1', 'persona-2']);
  });

  it('never in a 3–4 player queue, never when off (master or admin switch), never after a cancel', async () => {
    const three = setup();
    three.personas.add('persona-1', 1200);
    const a = await three.join('ana', 'fast-3p');
    await three.advance(30 * S);
    expect(a.of('found')).toEqual([]);
    expect(a.last('searching').nextRange).toBeNull();

    const master = setup({ stealth: { enabled: false } });
    master.personas.add('persona-1', 1200);
    const b = await master.join('ana');
    await master.advance(30 * S);
    expect(b.of('found')).toEqual([]);
    expect(b.last('searching').nextRange).toBeNull();

    const admin = setup({ on: false });
    admin.personas.add('persona-1', 1200);
    const c = await admin.join('ana');
    await admin.advance(30 * S);
    expect(c.of('found')).toEqual([]);
    expect(c.last('searching').nextRange).toBeNull();
    // Off: not a read of the personas (as before the stealth bot).
    expect(admin.personas.reads).toBe(0);
    expect(master.personas.reads).toBe(0);
    // Turned on meanwhile: the personas are read at the next round, and the round after it seats one (the
    // wait is long over).
    admin.sw.on = true;
    await admin.advance(1000);
    expect(c.of('found')).toHaveLength(1);

    const cancel = setup();
    cancel.personas.add('persona-1', 1200);
    const d = await cancel.join('ana');
    await cancel.advance(4 * S);
    cancel.service.cancel(d.id);
    await cancel.advance(30 * S);
    expect(d.of('found')).toEqual([]);
    expect(cancel.rooms).toEqual([]);
  });

  it('turned off: no new bot from the next round; a match already found goes on', async () => {
    const t = setup();
    const p = t.personas.add('persona-1', 1200);
    const ana = await t.join('ana');
    await t.advance(WAIT);
    t.sw.on = false;
    const room = t.rooms[0]!;
    room.link.join(p.userId);
    room.link.join('ana');
    await t.advance(3000);
    expect(ana.last('started').roomId).toBe('ROOM1');
    const ben = await t.join('ben');
    await t.advance(30 * S);
    expect(ben.of('found')).toEqual([]);
  });

  it('no persona in range: no bot this round; the range widens and a later round finds one', async () => {
    const t = setup({ players: { ana: { rating: 1290 } } });
    t.personas.poolFull = true;
    t.personas.add('persona-1', 1200); // 90 away: ±100 from 10 s
    const ana = await t.join('ana');
    await t.advance(9500);
    expect(ana.of('found')).toEqual([]);
    await t.advance(500);
    expect(ana.last('found').players[1]!.id).toBe('persona-1');
  });

  it('a no-show (he never connects) calls it off as with a person; the persona is free again', async () => {
    const t = setup();
    const p = t.personas.add('persona-1', 1200);
    const ana = await t.join('ana');
    await t.advance(WAIT);
    t.rooms[0]!.link.join(p.userId);
    await t.advance(10 * S);
    expect(ana.last('matchCancelled')).toEqual({
      type: 'matchCancelled',
      matchId: 'match-1',
      reason: 'noShow',
      missing: ['ana'],
      requeued: false,
    });
    expect(t.rooms[0]!.calls).toEqual(['cancel']);
    expect(t.service.isPlaying(p.userId)).toBe(false);
    const ben = await t.join('ben');
    await t.advance(WAIT);
    expect(ben.last('found').players[1]!.id).toBe(p.userId);
  });
});

describe('"nobody else is searching" (D95)', () => {
  it('left out while a persona is within his reach: the app shows the range bar', async () => {
    const t = setup();
    t.personas.add('persona-1', 1450);
    const ana = await t.join('ana');
    const first = ana.last('searching');
    expect(first).not.toHaveProperty('nextRange');
    expect(Object.keys(first).sort()).toEqual(
      ['elapsedMs', 'extended', 'queueKey', 'range', 'rating', 'serverTime', 'timeoutAt', 'type'].sort(),
    );
    await t.advance(5 * S);
    expect(ana.last('searching')).not.toHaveProperty('nextRange');
  });

  it('a person within reach: his next range, as always', async () => {
    const t = setup({ players: { ben: { rating: 1300 } } });
    t.personas.add('persona-1', 1200);
    const ana = await t.join('ana');
    expect(ana.last('searching')).not.toHaveProperty('nextRange');
    const ben = await t.join('ben');
    expect(ben.last('searching').nextRange).toBe(100);
    await t.advance(500); // the next round tells Ana
    expect(ana.last('searching').nextRange).toBe(100);
  });

  it('no persona can reach him (rated far above them all, the pool full): `nextRange: null`, as today', async () => {
    const t = setup({ players: { ana: { rating: 1600 } } });
    t.personas.poolFull = true;
    t.personas.add('persona-1', 1200);
    const ana = await t.join('ana');
    expect(ana.last('searching').nextRange).toBeNull();
    await t.advance(60 * S);
    expect(ana.last('timeout').nextRange).toBeNull();
    expect(ana.of('found')).toEqual([]);
  });

  it('STEALTH_BOT_HIDE_NOBODY=false: the notice as before, then "found"', async () => {
    const t = setup({ stealth: { hideNobody: false } });
    t.personas.add('persona-1', 1200);
    const ana = await t.join('ana');
    expect(ana.last('searching').nextRange).toBeNull();
    await t.advance(WAIT);
    expect(ana.of('found')).toHaveLength(1);
  });

  it('switched off: the notice as before', async () => {
    const t = setup({ on: false });
    t.personas.add('persona-1', 1200);
    const ana = await t.join('ana');
    expect(ana.last('searching').nextRange).toBeNull();
  });
});
