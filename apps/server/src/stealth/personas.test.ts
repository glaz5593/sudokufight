import { BOT_LEVELS, createRng, INITIAL_RATING } from '@sudoku-fight/engine';
import {
  AVATAR_IDS,
  isAvatarId,
  isCountryCode,
  normalizeForCompare,
  validateDisplayName,
} from '@sudoku-fight/protocol';
import { asc, eq } from 'drizzle-orm';

import { BlockedWords, defaultBlockedWords } from '../accounts/blockedWords';
import { isNameTaken } from '../accounts/store';
import { personas, ratings, retiredNames, users } from '../db/schema';
import { createTestDb, type TestDb } from '../testing/db';
import { addAccounts, T0 } from '../testing/ranked';
import {
  BOT_AVATAR_IDS,
  createPersona,
  DEFAULT_PERSONA_POOL_MAX,
  inventPersonaName,
  isPersonaNameAcceptable,
  type NewPersona,
  PERSONA_AVATAR_IDS,
  PERSONA_UID_PREFIX,
  personaCount,
  personaNameCandidate,
  seatablePersonas,
} from './personas';

/**
 * The stealth bot's personas (stealth-bot.md §3.1, §6, §12 "מחולל השמות") [D91, D97b]: invented names that
 * nobody has, drawn like the people's, made on demand, on PGlite.
 */

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
}, 30_000);
beforeEach(() => t.reset());
afterAll(() => t.close());

const words = defaultBlockedWords();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** People with these countries (and no avatar for `bare` of them). */
async function addPeople(countries: Record<string, number>, bare = 0) {
  let k = 0;
  for (const [country, n] of Object.entries(countries)) {
    for (let i = 0; i < n; i++, k++) {
      const id = `u${k}`;
      await t.db.insert(users).values({
        id,
        firebaseUid: `uid-${id}`,
        displayName: `person_${k}`,
        country,
        avatarId: k < bare ? null : 'moon',
      });
    }
  }
}

describe('the name generator (D91: invented, never a real player’s)', () => {
  it('names in a player’s style: 3–16 allowed characters, past the word filter, never a practice bot’s', () => {
    const rng = createRng(7);
    const names = Array.from({ length: 2000 }, (_, k) =>
      personaNameCandidate(rng, ['IL', 'US', 'FR', 'DE', 'RU', 'BR', 'JP', 'XX'][k % 8]!),
    );
    const accepted = names.filter((n) => isPersonaNameAcceptable(n, words));
    // Almost every candidate is a valid name as it is.
    expect(accepted.length).toBeGreaterThan(names.length * 0.9);
    for (const name of accepted) {
      expect(validateDisplayName(name)).toBeNull();
      expect(words.match(name)).toBeNull();
      expect(BOT_LEVELS.map((l) => normalizeForCompare(l.name))).not.toContain(normalizeForCompare(name));
      expect(name).not.toMatch(/bot/i);
    }
    // Varied: few repeats in 2,000.
    expect(new Set(names.map(normalizeForCompare)).size).toBeGreaterThan(1500);
    // Israel: Hebrew and Latin names both; elsewhere Latin only.
    const israeli = Array.from({ length: 400 }, () => personaNameCandidate(rng, 'IL'));
    const hebrew = israeli.filter((n) => /[א-ת]/.test(n)).length;
    expect(hebrew).toBeGreaterThan(400 * 0.3);
    expect(hebrew).toBeLessThan(400 * 0.6);
    expect(
      Array.from({ length: 200 }, () => personaNameCandidate(rng, 'FR')).some((n) => /[א-ת]/.test(n)),
    ).toBe(false);
  });

  it('the same seed gives the same names', () => {
    const draw = (seed: number) => {
      const rng = createRng(seed);
      return Array.from({ length: 50 }, () => personaNameCandidate(rng, 'IL'));
    };
    expect(draw(42)).toEqual(draw(42));
    expect(draw(42)).not.toEqual(draw(43));
  });

  it('refuses what the filter, the rules or a practice bot’s name refuse', () => {
    expect(isPersonaNameAcceptable('Tal88', words)).toBe(true);
    expect(isPersonaNameAcceptable('נועה_Fox', words)).toBe(true);
    expect(isPersonaNameAcceptable('Ta', words)).toBe(false); // too short
    expect(isPersonaNameAcceptable('Tal-88', words)).toBe(false); // a character the rules don't allow
    expect(isPersonaNameAcceptable('Biscuit', words)).toBe(false);
    expect(isPersonaNameAcceptable('MAESTRO', words)).toBe(false);
    expect(isPersonaNameAcceptable('admin', words)).toBe(false); // reserved
    const strict = new BlockedWords({
      en: { substring: ['tal'], exact: [] },
      he: { substring: [], exact: [] },
      reserved: { substring: [], exact: [] },
      allow: [],
    });
    expect(isPersonaNameAcceptable('Tal88', strict)).toBe(false);
  });

  it('a free name: never one an account has (any case, final letters), never a retired one', async () => {
    // Find what the generator would give first, then take it (in another case) and retire the next ones.
    const first = await inventPersonaName(t.db, { rng: createRng(5), country: 'US', words });
    await addAccounts(t.db, [{ id: 'taker', name: first.toUpperCase() }]);
    const second = await inventPersonaName(t.db, { rng: createRng(5), country: 'US', words });
    expect(normalizeForCompare(second)).not.toBe(normalizeForCompare(first));
    await t.db.insert(retiredNames).values({ nameKey: normalizeForCompare(second) });
    const third = await inventPersonaName(t.db, { rng: createRng(5), country: 'US', words });
    expect([first, second].map(normalizeForCompare)).not.toContain(normalizeForCompare(third));
    expect(await isNameTaken(t.db, third)).toBe(false);
    // A deleted account's old name is free again (its row's name is `deleted:…` by then).
    await t.db
      .update(users)
      .set({ deletedAt: new Date(T0), displayName: 'deleted:x' })
      .where(eq(users.id, 'taker'));
    expect(await inventPersonaName(t.db, { rng: createRng(5), country: 'US', words })).toBe(first);
  });
});

describe('createPersona (stealth-bot.md §6)', () => {
  it('makes an account like a registration’s: kind persona, no sign-in, no email, ratings at 1200 in every key', async () => {
    await addPeople({ IL: 3 });
    const made = await createPersona(t.db, { rng: createRng(1), now: T0 + 5000, ratingOption: 'B' });
    expect(made).not.toBeNull();
    const persona = made!;
    expect(persona.userId).toMatch(UUID);
    expect(persona).toMatchObject({ country: 'IL', createdAt: T0 + 5000, rating: INITIAL_RATING });

    const [row] = await t.db.select().from(users).where(eq(users.id, persona.userId));
    expect(row).toEqual({
      id: persona.userId,
      firebaseUid: `${PERSONA_UID_PREFIX}${persona.userId}`,
      displayName: persona.displayName,
      displayNameChangedAt: null,
      country: 'IL',
      avatarId: persona.avatarId,
      email: null,
      createdAt: new Date(T0 + 5000),
      deletedAt: null,
      suspendedAt: null,
      nameResetRequired: false,
      kind: 'persona',
    });
    expect(await t.db.select().from(personas)).toEqual([
      { userId: persona.userId, temperament: persona.temperament, createdAt: new Date(T0 + 5000) },
    ]);
    expect(
      (
        await t.db
          .select()
          .from(ratings)
          .where(eq(ratings.userId, persona.userId))
          .orderBy(asc(ratings.ratingKey))
      ).map((r) => [r.ratingKey, r.rating, r.games, r.provisional, r.peak]),
    ).toEqual([
      ['fast', 1200, 0, true, 1200],
      ['hard', 1200, 0, true, 1200],
      ['normal', 1200, 0, true, 1200],
    ]);
    // Its name is taken now, for a person who tries it [D91].
    expect(await isNameTaken(t.db, persona.displayName.toLowerCase())).toBe(true);
    expect(validateDisplayName(persona.displayName)).toBeNull();

    // Option A: the nine keys.
    const optionA = await createPersona(t.db, { rng: createRng(2), now: T0, ratingOption: 'A' });
    expect(await t.db.$count(ratings, eq(ratings.userId, optionA!.userId))).toBe(9);
  });

  it('draws country by the people’s, an avatar of the catalog but never a practice bot’s, none as often as people have none', async () => {
    await addPeople({ IL: 60, US: 30, FR: 10 }, 20); // 20 of the 100 without an avatar
    // Personas themselves don't count: a persona from Japan changes nothing.
    await addAccounts(t.db, [{ id: 'old-persona' }]);
    await t.db.update(users).set({ kind: 'persona', country: 'JP' }).where(eq(users.id, 'old-persona'));

    const rng = createRng(11);
    const made: NewPersona[] = [];
    for (let k = 0; k < 120; k++)
      made.push((await createPersona(t.db, { rng, now: T0 + k, ratingOption: 'B' }))!);
    const share = (pred: (p: NewPersona) => boolean) => made.filter(pred).length / made.length;
    expect(share((p) => p.country === 'IL')).toBeGreaterThan(0.45);
    expect(share((p) => p.country === 'IL')).toBeLessThan(0.75);
    expect(share((p) => p.country === 'US')).toBeGreaterThan(0.15);
    expect(made.every((p) => ['IL', 'US', 'FR'].includes(p.country))).toBe(true);
    expect(share((p) => p.avatarId === null)).toBeGreaterThan(0.08);
    expect(share((p) => p.avatarId === null)).toBeLessThan(0.33);
    for (const p of made) {
      if (p.avatarId !== null) {
        expect(isAvatarId(p.avatarId)).toBe(true);
        expect(BOT_AVATAR_IDS).not.toContain(p.avatarId);
      }
    }
    // Temperaments about 40 / 40 / 20.
    expect(share((p) => p.temperament === 'lively')).toBeGreaterThan(0.08);
    expect(share((p) => p.temperament === 'lively')).toBeLessThan(0.32);
    expect(share((p) => p.temperament === 'quiet')).toBeGreaterThan(0.25);
    // Every name different, compared as the unique index compares them.
    expect(new Set(made.map((p) => normalizeForCompare(p.displayName))).size).toBe(made.length);
    expect(await personaCount(t.db)).toBe(121);
  });

  it('the avatars a persona may have: the catalog without the five practice bots’', () => {
    expect(BOT_AVATAR_IDS).toEqual(['hatchling', 'fox', 'owl', 'professor', 'furry-monster']);
    expect(PERSONA_AVATAR_IDS).toHaveLength(AVATAR_IDS.length - 5);
    for (const id of BOT_AVATAR_IDS) expect(PERSONA_AVATAR_IDS).not.toContain(id);
  });

  it('with no people yet: an Israeli persona; a full pool makes none', async () => {
    const first = await createPersona(t.db, { rng: createRng(3), now: T0, ratingOption: 'B', poolMax: 2 });
    expect(first!.country).toBe('IL');
    expect(isCountryCode(first!.country)).toBe(true);
    expect(
      await createPersona(t.db, { rng: createRng(4), now: T0, ratingOption: 'B', poolMax: 2 }),
    ).not.toBeNull();
    expect(
      await createPersona(t.db, { rng: createRng(5), now: T0, ratingOption: 'B', poolMax: 2 }),
    ).toBeNull();
    expect(await personaCount(t.db)).toBe(2);
    expect(DEFAULT_PERSONA_POOL_MAX).toBe(1000);
  });

  it('the same seed and the same database give the same persona (but a new id)', async () => {
    await addPeople({ IL: 5, US: 5 });
    const a = (await createPersona(t.db, { rng: createRng(77), now: T0, ratingOption: 'B' }))!;
    await t.db.delete(users).where(eq(users.id, a.userId));
    const b = (await createPersona(t.db, { rng: createRng(77), now: T0, ratingOption: 'B' }))!;
    expect({ ...b, userId: 'x' }).toEqual({ ...a, userId: 'x' });
    expect(b.userId).not.toBe(a.userId);
  });
});

describe('seatablePersonas', () => {
  it('live personas, not suspended, not waiting for a name; each with its rating in the key (1200 without a row)', async () => {
    const rng = createRng(21);
    const made: NewPersona[] = [];
    for (let k = 0; k < 5; k++)
      made.push((await createPersona(t.db, { rng, now: T0 + k, ratingOption: 'B' }))!);
    const [ok, suspended, deleted, renamed, noRow] = made.map((p) => p.userId) as [
      string,
      string,
      string,
      string,
      string,
    ];
    await t.db
      .update(users)
      .set({ suspendedAt: new Date(T0) })
      .where(eq(users.id, suspended));
    await t.db
      .update(users)
      .set({ deletedAt: new Date(T0) })
      .where(eq(users.id, deleted));
    await t.db.update(users).set({ nameResetRequired: true }).where(eq(users.id, renamed));
    await t.db.update(ratings).set({ rating: 1234, games: 7 }).where(eq(ratings.userId, ok));
    await t.db.delete(ratings).where(eq(ratings.userId, noRow));
    // A person is never one.
    await addAccounts(t.db, [{ id: 'person', rating: 1210 }]);

    const seatable = await seatablePersonas(t.db, 'fast');
    expect(seatable).toEqual(
      [
        { userId: ok, rating: 1234, games: 7, provisional: true, createdAt: T0 },
        { userId: noRow, rating: INITIAL_RATING, games: 0, provisional: true, createdAt: T0 + 4 },
      ].sort((a, b) => (a.userId < b.userId ? -1 : 1)),
    );
  });
});
