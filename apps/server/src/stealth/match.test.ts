import {
  createRng,
  INTERFERENCE_KINDS,
  LEGACY_INTERFERENCE_KINDS,
  type PaceHistory,
} from '@sudoku-fight/engine';
import { eq } from 'drizzle-orm';

import { DEFAULT_STEALTH_BOT } from '../config';
import { users, xp } from '../db/schema';
import type { Ticket } from '../matchmaking/matcher';
import { createTestDb, quietLog, type TestDb } from '../testing';
import { addAccounts } from '../testing/ranked';
import {
  choosePersona,
  dbPersonaSource,
  draw,
  type PersonaProfile,
  type PersonaSource,
  personaProfile,
  personaReachable,
  type SeatablePersona,
  serverStealthMatcher,
  StealthMatcher,
  type StealthMatcherDeps,
} from './match';
import { dbStealthPace, personaKinds } from './seat';

/**
 * When the stealth bot comes, and as whom (stealth-bot.md §4, §6) [D94, D95]: the persona chosen like an
 * opponent, a new one made only when no free persona is in range, and the "nobody else is searching" notice.
 */

const T0 = Date.UTC(2026, 9, 20, 12);
const S = 1000;

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    userId: 'me',
    queueKey: 'fast-2p',
    rating: 1200,
    enqueuedAt: T0,
    searchStart: T0,
    deadline: T0 + 60 * S,
    extended: false,
    priority: false,
    opponents: [],
    blocked: new Set(),
    seq: 1,
    ...over,
  };
}

const persona = (userId: string, rating: number): SeatablePersona => ({
  userId,
  rating,
  games: 3,
  provisional: true,
});

const free = () => false;

describe('choosePersona (§6)', () => {
  const base = { now: T0, busy: free, canCreate: false };

  it('only within the range the search screen shows now (±50, 25 wider every 5 s)', () => {
    const personas = [persona('p1', 1290)];
    expect(choosePersona({ ...base, ticket: ticket(), personas })).toBeNull();
    // 90 away: ±100 at 10 s.
    expect(choosePersona({ ...base, now: T0 + 9999, ticket: ticket(), personas })).toBeNull();
    expect(choosePersona({ ...base, now: T0 + 10 * S, ticket: ticket(), personas })).toEqual({
      kind: 'persona',
      persona: personas[0],
      rematch: false,
    });
  });

  it('the closest; never one in a match or a game, never one blocked either way', () => {
    const personas = [
      persona('far', 1240),
      persona('near', 1190),
      persona('busy', 1200),
      persona('bl', 1201),
    ];
    const choice = choosePersona({
      ...base,
      ticket: ticket({ blocked: new Set(['bl']) }),
      personas,
      busy: (id) => id === 'busy',
    });
    expect(choice).toMatchObject({ kind: 'persona', persona: { userId: 'near' } });
  });

  it('one he never met first, then the closest of those he met (not recently)', () => {
    const personas = [persona('met', 1200), persona('new', 1230), persona('other', 1300)];
    const opponents = [{ opponentId: 'met', playedAt: T0 - 86_400_000 }];
    expect(choosePersona({ ...base, ticket: ticket({ opponents }), personas })).toMatchObject({
      persona: { userId: 'new' },
      rematch: false,
    });
  });

  it('a recent opponent is left out (§7, with the 80% reset over the personas he could meet)', () => {
    const opponents = [{ opponentId: 'p1', playedAt: T0 - 60_000 }];
    // Two he could meet, one met: 50% of them, not over 80%: p1 is recent, p2 is out of range now.
    const two = [persona('p1', 1200), persona('p2', 1400)];
    expect(choosePersona({ ...base, ticket: ticket({ opponents }), personas: two })).toBeNull();
    // Only p1 to meet: he met all of them, the history starts over, and p1 comes back (a rematch).
    const one = [persona('p1', 1200)];
    expect(choosePersona({ ...base, ticket: ticket({ opponents }), personas: one })).toEqual({
      kind: 'persona',
      persona: one[0],
      rematch: true,
    });
  });

  it('no free persona in range: a new one (at 1200, so only with 1200 in range), if the pool is not full', () => {
    // p1 met and recent (two he could meet, one met: no reset), p2 out of range: nothing free, one is made.
    const two = [persona('p1', 1210), persona('p2', 1400)];
    const opponents = [{ opponentId: 'p1', playedAt: T0 - 60_000 }];
    expect(choosePersona({ ...base, canCreate: true, ticket: ticket({ opponents }), personas: two })).toEqual(
      { kind: 'create' },
    );
    expect(choosePersona({ ...base, canCreate: true, ticket: ticket(), personas: [] })).toEqual({
      kind: 'create',
    });
    // 1200 out of his range (±50 at 1300): nothing to make.
    expect(
      choosePersona({ ...base, canCreate: true, ticket: ticket({ rating: 1300 }), personas: [] }),
    ).toBeNull();
    // A fresh one in range: no new one.
    expect(
      choosePersona({ ...base, canCreate: true, ticket: ticket(), personas: [persona('p9', 1220)] }),
    ).toMatchObject({ kind: 'persona', persona: { userId: 'p9' } });
  });

  it('a met persona that is not recent comes back (a rematch) before a new one is made (§6, §7)', () => {
    // He met p1 only, so it is all he could meet: the 80% reset, and p1 is free again.
    const one = [persona('p1', 1210)];
    const opponents = [{ opponentId: 'p1', playedAt: T0 - 60_000 }];
    expect(choosePersona({ ...base, canCreate: true, ticket: ticket({ opponents }), personas: one })).toEqual(
      {
        kind: 'persona',
        persona: one[0],
        rematch: true,
      },
    );
    // He met all four he could meet (over 80%: the history starts over), then a again: only a is recent.
    // b and c are in range (±50), d is not yet: the closest of b and c comes back, not a new persona.
    const four = [persona('a', 1200), persona('b', 1215), persona('c', 1240), persona('d', 1290)];
    const DAY = 86_400_000;
    const history = [
      { opponentId: 'a', playedAt: T0 - 4 * DAY },
      { opponentId: 'b', playedAt: T0 - 3 * DAY },
      { opponentId: 'c', playedAt: T0 - 2 * DAY },
      { opponentId: 'd', playedAt: T0 - DAY },
      { opponentId: 'a', playedAt: T0 - 60_000 },
    ];
    expect(
      choosePersona({ ...base, canCreate: true, ticket: ticket({ opponents: history }), personas: four }),
    ).toEqual({ kind: 'persona', persona: four[1], rematch: true });
  });
});

describe('personaReachable [D95]', () => {
  const base = { now: T0, busy: free, canCreate: false };

  it('a free persona not blocked within his maximum range (±300; none after "keep searching")', () => {
    expect(personaReachable({ ...base, ticket: ticket(), personas: [persona('p', 1500)] })).toBe(true);
    expect(personaReachable({ ...base, ticket: ticket(), personas: [persona('p', 1501)] })).toBe(false);
    expect(
      personaReachable({ ...base, ticket: ticket({ extended: true }), personas: [persona('p', 2400)] }),
    ).toBe(true);
    expect(
      personaReachable({
        ...base,
        ticket: ticket({ blocked: new Set(['p']) }),
        personas: [persona('p', 1200)],
      }),
    ).toBe(false);
    expect(
      personaReachable({ ...base, ticket: ticket(), personas: [persona('p', 1200)], busy: () => true }),
    ).toBe(false);
  });

  it('or one could be made at 1200 within that range', () => {
    expect(
      personaReachable({ ...base, canCreate: true, ticket: ticket({ rating: 1490 }), personas: [] }),
    ).toBe(true);
    expect(
      personaReachable({ ...base, canCreate: true, ticket: ticket({ rating: 1600 }), personas: [] }),
    ).toBe(false);
  });
});

it('draw: an integer within the span, both ends included', () => {
  expect(draw(() => 0, { min: 8000, max: 20_000 })).toBe(8000);
  expect(draw((n) => n - 1, { min: 8000, max: 20_000 })).toBe(20_000);
  expect(draw(() => 0, { min: 300, max: 300 })).toBe(300);
});

// ---------------------------------------------------------------------------------------------------------

class FakePersonas implements PersonaSource {
  list: SeatablePersona[] = [];
  profiles = new Map<string, PersonaProfile>();
  total = 0;
  made = 0;
  reads = 0;
  failing = false;
  seatable() {
    this.reads++;
    return this.failing ? Promise.reject(new Error('db down')) : Promise.resolve([...this.list]);
  }
  count() {
    return Promise.resolve(this.total);
  }
  profile(userId: string) {
    return Promise.resolve(this.profiles.get(userId));
  }
  add(p: PersonaProfile) {
    this.list.push(p);
    this.profiles.set(p.userId, p);
    this.total++;
  }
  create() {
    const p = profile(`new-${++this.made}`, 1200, 1);
    this.add(p);
    return Promise.resolve(p);
  }
}

const profile = (userId: string, rating: number, level = 1): PersonaProfile => ({
  userId,
  rating,
  games: 2,
  provisional: true,
  name: `Tal${userId}`,
  avatarId: 'lava-lamp',
  country: 'IL',
  level,
});

function matcher(over: Partial<StealthMatcherDeps> = {}, on = true) {
  let now = T0;
  const personas = new FakePersonas();
  const pace: { history: (userId: string, gameType: 'fast' | 'normal' | 'hard') => Promise<PaceHistory> } = {
    history: (_userId, gameType) =>
      Promise.resolve({
        gameType,
        games: Array.from({ length: 10 }, () => ({
          gameType,
          paceMs: 9000,
          paceMoves: 30,
          digits: 40,
          mistakes: 4,
        })),
        stealthWins: [],
      }),
  };
  const log = quietLog();
  const m = new StealthMatcher({
    settings: { ...DEFAULT_STEALTH_BOT, enabled: true },
    switch: {
      isOn: () => on,
      state: () => Promise.resolve({ available: true, enabled: on, on, updatedAt: null, updatedBy: null }),
    },
    personas,
    pace,
    random: (n) => Math.floor(n / 2),
    now: () => now,
    log,
    ...over,
  });
  return { m, personas, log, advance: (ms: number) => (now += ms) };
}

describe('StealthMatcher', () => {
  it('a stealth queue: the master switch and the queue list; active: and the admin switch', () => {
    const { m } = matcher();
    expect(m.isStealthQueue('fast-2p')).toBe(true);
    expect(m.isStealthQueue('fast-3p')).toBe(false);
    expect(m.activeFor('hard-2p')).toBe(true);
    expect(matcher({}, false).m.activeFor('fast-2p')).toBe(false);
    const off = matcher({ settings: { ...DEFAULT_STEALTH_BOT } });
    expect(off.m.isStealthQueue('fast-2p')).toBe(false);
    expect(off.m.activeFor('fast-2p')).toBe(false);
    const only = matcher({ settings: { ...DEFAULT_STEALTH_BOT, enabled: true, queues: ['hard-2p'] } });
    expect(only.m.activeFor('fast-2p')).toBe(false);
    expect(only.m.activeFor('hard-2p')).toBe(true);
  });

  it('draws the wait (8–20 s) and the persona’s "connect" (0.3–1.5 s) from its random', () => {
    expect(matcher({ random: () => 0 }).m.drawAfterMs()).toBe(8000);
    expect(matcher({ random: (n) => n - 1 }).m.drawAfterMs()).toBe(20_000);
  });

  it('[D95] hides "nobody" only once the personas are known, while on, and with one within reach', async () => {
    // A full pool (1): only the persona there is can reach him.
    const { m, personas } = matcher({
      settings: { ...DEFAULT_STEALTH_BOT, enabled: true, personaPoolMax: 1 },
    });
    personas.add(profile('p1', 1250));
    const t = ticket();
    expect(m.hidesNobody('fast-2p', 'fast', t, free)).toBe(false); // not read yet
    await m.prepare('fast');
    expect(m.hidesNobody('fast-2p', 'fast', t, free)).toBe(true);
    expect(m.hidesNobody('fast-2p', 'fast', ticket({ rating: 1800 }), free)).toBe(false);
    expect(m.hidesNobody('fast-2p', 'fast', t, () => true)).toBe(false);
    expect(matcher({}, false).m.hidesNobody('fast-2p', 'fast', t, free)).toBe(false);
    const shown = matcher({ settings: { ...DEFAULT_STEALTH_BOT, enabled: true, hideNobody: false } });
    shown.personas.add(profile('p1', 1250));
    await shown.m.prepare('fast');
    expect(shown.m.hidesNobody('fast-2p', 'fast', t, free)).toBe(false);
  });

  it('picks the persona, with the bot built from his pace and its level’s kinds, and its "connect" time', async () => {
    const { m, personas } = matcher();
    personas.add(profile('p1', 1230, 3));
    await m.prepare('fast');
    expect(m.wouldPick('fast', ticket(), T0, free)).toBe(true);
    const pick = await m.pick('fast', 'fast', ticket(), T0, free);
    expect(pick).toEqual({
      profile: profile('p1', 1230, 3),
      rematch: false,
      seat: {
        userId: 'p1',
        name: 'Talp1',
        level: expect.objectContaining({
          thinkMs: { min: 6300, max: 11_700 },
          mistakeRate: 0.1,
          reactions: {},
          interference: expect.objectContaining({
            chance: 0,
            retaliate: expect.objectContaining({ kinds: personaKinds(3) }),
          }),
        }),
        readyAfterMs: 900,
      },
    });
  });

  it('makes a new persona when no free one is in range (a level-1 persona: the first three kinds)', async () => {
    const { m, personas } = matcher();
    await m.prepare('fast');
    expect(m.wouldPick('fast', ticket(), T0, free)).toBe(true);
    const pick = await m.pick('fast', 'fast', ticket(), T0, free);
    expect(personas.made).toBe(1);
    expect(pick?.profile.userId).toBe('new-1');
    expect(pick?.seat.level.interference.retaliate?.kinds).toEqual([...LEGACY_INTERFERENCE_KINDS]);
  });

  it('no persona in range and the pool full (or 1200 out of range): no pick, nothing made', async () => {
    const { m, personas } = matcher({
      settings: { ...DEFAULT_STEALTH_BOT, enabled: true, personaPoolMax: 1 },
    });
    personas.add(profile('p1', 1500));
    await m.prepare('fast');
    expect(m.wouldPick('fast', ticket(), T0, free)).toBe(false);
    expect(await m.pick('fast', 'fast', ticket(), T0, free)).toBeNull();
    expect(personas.made).toBe(0);
  });

  it('a persona gone meanwhile (deleted): no pick this time', async () => {
    const { m, personas } = matcher();
    personas.add(profile('p1', 1200));
    personas.profiles.delete('p1');
    await m.prepare('fast');
    expect(await m.pick('fast', 'fast', ticket(), T0, free)).toBeNull();
  });

  it('reads the personas again once its list is old (5 s), and keeps the last one when a read fails', async () => {
    const { m, personas, advance, log } = matcher();
    personas.add(profile('p1', 1200));
    await m.prepare('fast');
    expect(personas.reads).toBe(1);
    m.hidesNobody('fast-2p', 'fast', ticket(), free);
    expect(personas.reads).toBe(1);
    advance(5000);
    personas.failing = true;
    expect(m.hidesNobody('fast-2p', 'fast', ticket(), free)).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(personas.reads).toBe(2);
    expect(log.errors).toHaveLength(1);
    expect(m.hidesNobody('fast-2p', 'fast', ticket(), free)).toBe(true);
  });

  it('every kind in the engine has an unlock level (a new kind must be added to the persona’s table)', () => {
    expect(personaKinds(99)).toEqual([...INTERFERENCE_KINDS]);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('the personas in the database', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await addAccounts(t.db, [{ id: 'person-1', name: 'Dana_88' }]);
  });
  afterAll(async () => {
    await t.close();
  });

  it('makes one on demand, seats it, and shows it as a player (its level by XP)', async () => {
    const source = dbPersonaSource(t.db, {
      ratingOption: 'B',
      poolMax: 2,
      rng: createRng(5),
      now: () => T0,
    });
    expect(await source.seatable('fast')).toEqual([]);
    expect(await source.count()).toBe(0);
    const made = await source.create('fast');
    expect(made).toMatchObject({ rating: 1200, games: 0, provisional: true, level: 1 });
    expect(made!.name).not.toBe('Dana_88');
    expect(made!.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await source.seatable('fast')).map((p) => p.userId)).toEqual([made!.userId]);
    await t.db.insert(xp).values({ userId: made!.userId, level: 4, xp: 900 });
    expect(await source.profile(made!.userId, 'fast')).toEqual({ ...made, level: 4 });
    // A person is never a persona's profile.
    expect(await personaProfile(t.db, 'person-1', 'fast')).toBeUndefined();
  });

  it('serverStealthMatcher: none under STEALTH_BOT_ENABLED=false (or no settings); on the database otherwise', async () => {
    const sw = { isOn: () => true, state: () => Promise.reject(new Error('unused')) } as never;
    const common = { db: t.db, ratingOption: 'B' as const, switch: sw, log: quietLog() };
    expect(serverStealthMatcher({ ...common, settings: undefined })).toBeUndefined();
    expect(
      serverStealthMatcher({ ...common, settings: { ...DEFAULT_STEALTH_BOT, secret: 's'.repeat(32) } }),
    ).toBeUndefined();
    const on = serverStealthMatcher({
      ...common,
      settings: { ...DEFAULT_STEALTH_BOT, enabled: true, secret: 's'.repeat(32) },
    });
    expect(on?.isStealthQueue('normal-2p')).toBe(true);
    expect(on?.isStealthQueue('normal-4p')).toBe(false);
    // Its pace comes from the person's ranked games on the server: none yet, the defaults.
    expect(await dbStealthPace(t.db).history('person-1', 'fast')).toEqual({
      gameType: 'fast',
      games: [],
      stealthWins: [],
    });
  });

  it('none past the pool’s size; none for a deleted persona', async () => {
    const source = dbPersonaSource(() => t.db, {
      ratingOption: 'B',
      poolMax: 2,
      rng: createRng(6),
      now: () => T0,
    });
    const second = await source.create('fast');
    expect(second).not.toBeNull();
    expect(await source.create('fast')).toBeNull();
    await t.db
      .update(users)
      .set({ deletedAt: new Date(T0) })
      .where(eq(users.id, second!.userId));
    expect(await source.profile(second!.userId, 'fast')).toBeUndefined();
    expect(await source.count()).toBe(2);
  });
});
