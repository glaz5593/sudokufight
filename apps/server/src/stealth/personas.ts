import { randomUUID } from 'node:crypto';

import { BOT_LEVELS, INITIAL_RATING, pick, type RatingOption, type Rng } from '@sudoku-fight/engine';
import {
  AVATAR_IDS,
  type AvatarId,
  type CountryCode,
  isCountryCode,
  normalizeForCompare,
  ratingKeysFor,
} from '@sudoku-fight/protocol';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';

import { type BlockedWords, defaultBlockedWords } from '../accounts/blockedWords';
import { checkName } from '../accounts/names';
import { NAME_INDEX, uniqueViolation } from '../accounts/store';
import { type Db, queryRows } from '../db';
import {
  displayNameKey,
  type PersonaTemperament,
  personas,
  ratings,
  retiredNames,
  users,
} from '../db/schema';
import { chance, intBetween, weighted } from '../seed/random';

/**
 * A stealth bot's personas (stealth-bot.md §3.1, §6) [D90, D91, D97b]: the accounts the server seats the bot
 * under, made when matchmaking needs one and none is free (createPersona), up to the pool's size
 * (STEALTH_PERSONA_POOL_MAX, default 1,000). Made one at a time, so their "playing since" dates spread by
 * themselves, with nothing faked.
 *
 * A persona is a users row like a registration's, with kind 'persona', a sign-in id no sign-in has
 * (`persona:<id>`), no email, and ratings at 1200 (provisional) in every key of the server's option; and a
 * personas row (its temperament). What it shows a player is drawn to look like the people's:
 * - a name invented in the style players choose (inventPersonaName): a first name common in its country, and
 *   sometimes a word (Pro, Fox), an initial or a number: "Tal88", "LiorK", "נועה_Fox". Never a real player's
 *   name [D91]: it must be free (users, among accounts not deleted, compared as the unique index compares) and
 *   not retired (retired_names); it follows the name rules and passes the offensive-word filter, as a
 *   registration's must; and it is none of the practice bots' names.
 * - a country drawn by the people's own countries (mostly Israel): 30 flags on an Israeli server would stand out.
 * - an avatar from the catalog, never one of the five practice bots' (an owl gives Mr. Hoot away); none (the
 *   app's av00) as often as people have none.
 * - [D97b] a temperament (40% quiet, 40% normal, 20% lively), kept for the alternative of reactions; the
 *   default is that no persona reacts.
 *
 * The draws come from the Rng given (the same seed and the same database: the same persona); the account's id
 * is a random UUID, like a person's.
 */

/** STEALTH_PERSONA_POOL_MAX's default (stealth-bot.md §8): the most personas there may be. */
export const DEFAULT_PERSONA_POOL_MAX = 1000;

/** A persona's sign-in id: `persona:<users.id>` (no Firebase uid has this form: nobody signs in to one). */
export const PERSONA_UID_PREFIX = 'persona:';

/** [D97b] The share of each temperament among new personas. */
export const PERSONA_TEMPERAMENT_SHARES: readonly (readonly [PersonaTemperament, number])[] = [
  ['quiet', 40],
  ['normal', 40],
  ['lively', 20],
];

/** The practice bots' avatars (the engine's BOT_LEVELS): never a persona's. */
export const BOT_AVATAR_IDS: readonly string[] = BOT_LEVELS.map((l) => l.avatar);

/** The avatars a persona may have: the catalog without the practice bots'. */
export const PERSONA_AVATAR_IDS: readonly AvatarId[] = AVATAR_IDS.filter(
  (id) => !BOT_AVATAR_IDS.includes(id),
);

/** The practice bots' names, as names compare: never a persona's (nor a part an exact name could match). */
const BOT_NAME_KEYS = new Set(BOT_LEVELS.map((l) => normalizeForCompare(l.name)));

/** The country of a persona when no person has one yet. */
const FALLBACK_COUNTRY: CountryCode = 'IL';

// ---------------------------------------------------------------------------------------------------------
// Names

/** First names common in a country (Latin letters, as players type them), and Hebrew ones for Israel. */
interface NameBook {
  latin: readonly string[];
  /** Hebrew first names, and the share of names written in Hebrew. */
  hebrew?: { names: readonly string[]; share: number };
}

// prettier-ignore
const ENGLISH = [
  'Emma', 'Olivia', 'Ava', 'Mia', 'Chloe', 'Grace', 'Lily', 'Ella', 'Zoe', 'Ruby', 'Kate', 'Amy', 'Jack', 'Liam',
  'Noah', 'Ethan', 'Mason', 'Lucas', 'Ryan', 'Tyler', 'Josh', 'Matt', 'Chris', 'Jake', 'Sam', 'Alex', 'Ben',
  'Tom', 'Nick', 'Dan', 'Will', 'Luke', 'Adam', 'Owen', 'Kyle', 'Sean', 'Holly', 'Jess', 'Megan', 'Abby',
];

// prettier-ignore
const SPANISH = [
  'Pablo', 'Diego', 'Javi', 'Carlos', 'Miguel', 'Sergio', 'Mateo', 'Hugo', 'Alvaro', 'Jorge', 'Nacho', 'Lucia',
  'Sofia', 'Paula', 'Marta', 'Carmen', 'Elena', 'Laura', 'Ana', 'Valeria', 'Camila', 'Andrea', 'Pilar', 'Rocio',
];

// prettier-ignore
const PORTUGUESE = [
  'Joao', 'Pedro', 'Gabriel', 'Lucas', 'Rafael', 'Thiago', 'Bruno', 'Felipe', 'Gustavo', 'Tiago', 'Beatriz',
  'Julia', 'Mariana', 'Larissa', 'Camila', 'Leticia', 'Bianca', 'Rita', 'Ines', 'Carol',
];

// prettier-ignore
const GERMAN = [
  'Lukas', 'Felix', 'Jonas', 'Leon', 'Paul', 'Finn', 'Elias', 'Tim', 'Jan', 'Niklas', 'Moritz', 'Sven', 'Jens',
  'Anna', 'Lena', 'Hannah', 'Marie', 'Sophie', 'Lara', 'Laura', 'Julia', 'Emilia', 'Lisa', 'Katrin',
];

// prettier-ignore
const RUSSIAN = [
  'Ivan', 'Dima', 'Sasha', 'Misha', 'Artem', 'Maxim', 'Nikita', 'Kirill', 'Pavel', 'Sergey', 'Anton', 'Oleg',
  'Denis', 'Igor', 'Roma', 'Anya', 'Masha', 'Dasha', 'Katya', 'Nastya', 'Olga', 'Yulia', 'Sveta', 'Vika',
  'Polina', 'Alina', 'Ksenia',
];

/** Names heard in many countries: for a country without a book of its own. */
// prettier-ignore
const INTERNATIONAL = [
  'Alex', 'Sam', 'Max', 'Leo', 'Mia', 'Nina', 'Lena', 'Adam', 'Ben', 'Kim', 'Ari', 'Eli', 'Theo', 'Ivy', 'Zoe',
  'Mila', 'Noel', 'Tara', 'Rina', 'Omar', 'Sara', 'Dani', 'Nico', 'Luca', 'Maya', 'Eva', 'Iris', 'Jonas',
];

const NAME_BOOKS: Readonly<Partial<Record<CountryCode, NameBook>>> = {
  IL: {
    // prettier-ignore
    latin: [
      'Noa', 'Maya', 'Tamar', 'Yael', 'Shira', 'Hadar', 'Roni', 'Adi', 'Lior', 'Tal', 'Gal', 'Shaked', 'Neta',
      'Michal', 'Hila', 'Inbal', 'Rotem', 'Eden', 'Lihi', 'Itai', 'Yonatan', 'Omer', 'Uri', 'Daniel', 'Ariel',
      'Nadav', 'Ido', 'Asaf', 'Nir', 'Alon', 'Ron', 'Yoav', 'Amit', 'Itamar', 'Noam', 'Guy', 'Yuval', 'Ofek',
      'Shai', 'Ben', 'Avi', 'Rami', 'Sami', 'Nour', 'Lina', 'Karim',
    ],
    hebrew: {
      // prettier-ignore
      names: [
        'נועה', 'מאיה', 'תמר', 'יעל', 'שירה', 'הדר', 'רוני', 'עדי', 'ליאור', 'טל', 'גל', 'שקד', 'נטע', 'מיכל',
        'הילה', 'ענבל', 'רותם', 'עדן', 'ליהי', 'איתי', 'יונתן', 'עומר', 'אורי', 'דניאל', 'אריאל', 'נדב', 'עידו',
        'אסף', 'ניר', 'אלון', 'רון', 'יואב', 'עמית', 'איתמר', 'נועם', 'גיא', 'יובל', 'אופק', 'שי', 'אבי',
      ],
      share: 0.45,
    },
  },
  US: { latin: ENGLISH },
  GB: { latin: ENGLISH },
  CA: { latin: ENGLISH },
  AU: { latin: ENGLISH },
  IE: { latin: ENGLISH },
  NZ: { latin: ENGLISH },
  FR: {
    // prettier-ignore
    latin: [
      'Lucas', 'Hugo', 'Louis', 'Jules', 'Mathis', 'Theo', 'Nathan', 'Leo', 'Arthur', 'Paul', 'Remi', 'Antoine',
      'Maxime', 'Julien', 'Camille', 'Lea', 'Manon', 'Chloe', 'Ines', 'Jade', 'Louise', 'Clara', 'Julie',
      'Margaux', 'Lucie', 'Sarah',
    ],
  },
  BE: { latin: ['Lucas', 'Louis', 'Arthur', 'Noah', 'Jules', 'Emma', 'Louise', 'Olivia', 'Lina', 'Elena'] },
  DE: { latin: GERMAN },
  AT: { latin: GERMAN },
  CH: { latin: GERMAN },
  RU: { latin: RUSSIAN },
  UA: { latin: RUSSIAN },
  BY: { latin: RUSSIAN },
  ES: { latin: SPANISH },
  MX: { latin: SPANISH },
  AR: { latin: SPANISH },
  CO: { latin: SPANISH },
  CL: { latin: SPANISH },
  PE: { latin: SPANISH },
  BR: { latin: PORTUGUESE },
  PT: { latin: PORTUGUESE },
  IT: {
    // prettier-ignore
    latin: [
      'Marco', 'Luca', 'Matteo', 'Andrea', 'Giulia', 'Chiara', 'Sara', 'Francesca', 'Lorenzo', 'Davide', 'Simone',
      'Fede', 'Giorgio', 'Elisa', 'Martina', 'Alice', 'Paolo', 'Stefano', 'Valentina', 'Marta',
    ],
  },
  NL: {
    // prettier-ignore
    latin: [
      'Daan', 'Sem', 'Bram', 'Lars', 'Thijs', 'Jesse', 'Ruben', 'Joost', 'Sanne', 'Lotte', 'Fleur', 'Femke', 'Eva',
      'Iris', 'Noor', 'Anouk',
    ],
  },
};

/** Words players put after their name. Never "bot", nor anything a bot would be called. */
// prettier-ignore
const NAME_WORDS = [
  'Pro', 'Ninja', 'Fox', 'King', 'Queen', 'Tiger', 'Wiz', 'Ace', 'Star', 'Wolf', 'Zen', 'Hero', 'Nova', 'Dash',
  'Cat', 'Sun', 'Jet',
];

const INITIALS = [...'ABCDEFGHIJKLMNOPRSTVWYZ'];

/** Two digits as years are written: 70–99, 00–12. */
const yearDigits = (rng: Rng): string => {
  const year = intBetween(rng, 70, 112) % 100;
  return String(year).padStart(2, '0');
};

const lower = (s: string) => s.toLowerCase();

/** How a player's name is made from a Latin first name, and how often. */
const LATIN_STYLES: readonly (readonly [(first: string, rng: Rng) => string, number])[] = [
  [(f, r) => `${f}${intBetween(r, 1, 99)}`, 22], // Tal88
  [(f, r) => `${lower(f)}${intBetween(r, 1, 99)}`, 10], // tal88
  [(f, r) => `${f}${yearDigits(r)}`, 8], // Tal94
  [(f, r) => `${f}_${intBetween(r, 1, 99)}`, 7], // Tal_7
  [(f, r) => `${f}${pick(r, NAME_WORDS)}`, 10], // TalPro
  [(f, r) => `${f}_${pick(r, NAME_WORDS)}`, 9], // Tal_Fox
  [(f, r) => `${lower(f)}_${lower(pick(r, NAME_WORDS))}`, 4], // tal_fox
  [(f, r) => `${f}${pick(r, INITIALS)}`, 12], // LiorK
  [(f, r) => `${lower(f)}.${lower(pick(r, INITIALS))}`, 7], // lior.k
  [(f, r) => `${pick(r, NAME_WORDS)}${f}`, 3], // AceTal
  [(f) => f, 5], // Tal (rarely free)
  [(f) => lower(f), 3], // tal
];

/** How a player's name is made from a Hebrew first name, and how often. */
const HEBREW_STYLES: readonly (readonly [(first: string, rng: Rng) => string, number])[] = [
  [(f, r) => `${f}${intBetween(r, 1, 99)}`, 30], // נועה23
  [(f, r) => `${f}_${pick(r, NAME_WORDS)}`, 25], // נועה_Fox
  [(f, r) => `${f}_${intBetween(r, 1, 99)}`, 15], // נועה_7
  [(f, r) => `${f}${yearDigits(r)}`, 10], // נועה94
  [(f) => f, 12], // נועה
  [(f, r) => `${f}${pick(r, NAME_WORDS)}`, 8], // נועהPro
];

/**
 * A name in a player's style for `country` (a first name of its book, or the international one, and a style),
 * from the Rng; not yet checked against anything.
 */
export function personaNameCandidate(rng: Rng, country: string): string {
  const book = (isCountryCode(country) ? NAME_BOOKS[country] : undefined) ?? { latin: INTERNATIONAL };
  if (book.hebrew !== undefined && chance(rng, book.hebrew.share)) {
    const style = weighted(rng, HEBREW_STYLES);
    return style(pick(rng, book.hebrew.names), rng);
  }
  const style = weighted(rng, LATIN_STYLES);
  return style(pick(rng, book.latin), rng);
}

/**
 * Whether a candidate may be a persona's name before the database is asked: the name rules and the
 * offensive-word filter (as a registration's), and none of the practice bots' names.
 */
export function isPersonaNameAcceptable(name: string, words: BlockedWords): boolean {
  if (!checkName(name, words).ok) return false;
  return !BOT_NAME_KEYS.has(normalizeForCompare(name));
}

/** The names among `names` nobody may take now: an account not deleted has it, or it was retired. */
async function unavailableKeys(db: Db, names: readonly string[]): Promise<Set<string>> {
  const keys = [...new Set(names.map(normalizeForCompare))];
  if (keys.length === 0) return new Set();
  const [taken, retired] = await Promise.all([
    db
      .select({ key: displayNameKey(users.displayName) })
      .from(users)
      .where(and(inArray(displayNameKey(users.displayName), keys), isNull(users.deletedAt))),
    db.select({ key: retiredNames.nameKey }).from(retiredNames).where(inArray(retiredNames.nameKey, keys)),
  ]);
  return new Set([...taken, ...retired].map((r) => String(r.key)));
}

export interface PersonaNameOptions {
  rng: Rng;
  /** The persona's country: its name comes from that country's names. */
  country: string;
  /** The offensive-word filter (default the server's list). */
  words?: BlockedWords;
}

/** Candidates asked about at once, and rounds before the numbers get longer. */
const CANDIDATES_PER_ROUND = 8;
const ROUNDS = 6;

/**
 * [D91] An invented name for a persona that nobody has and nobody may take (stealth-bot.md §3.1): free among
 * the accounts not deleted (as the unique index compares names), not retired, within the name rules, past the
 * offensive-word filter, and none of the practice bots'. Also the new name a persona gets when an admin resets
 * its name (it has no app to choose one). Taken right after by someone else, the insert or update fails on the
 * unique index: try again.
 */
export async function inventPersonaName(db: Db, options: PersonaNameOptions): Promise<string> {
  const words = options.words ?? defaultBlockedWords();
  const { rng, country } = options;
  for (let round = 0; round < ROUNDS + 2; round++) {
    const candidates: string[] = [];
    const seen = new Set<string>();
    for (let k = 0; k < CANDIDATES_PER_ROUND * 4 && candidates.length < CANDIDATES_PER_ROUND; k++) {
      let name = personaNameCandidate(rng, country);
      // After a few rounds of taken names (a big pool), a longer number: still a player's style.
      if (round >= ROUNDS) name = `${name.replace(/[0-9_.]+$/u, '')}${intBetween(rng, 100, 9999)}`;
      const key = normalizeForCompare(name);
      if (seen.has(key) || !isPersonaNameAcceptable(name, words)) continue;
      seen.add(key);
      candidates.push(name);
    }
    const unavailable = await unavailableKeys(db, candidates);
    const free = candidates.find((name) => !unavailable.has(normalizeForCompare(name)));
    if (free !== undefined) return free;
  }
  throw new Error('No free name for a persona after many tries');
}

// ---------------------------------------------------------------------------------------------------------
// Making one

/** The people's countries (live accounts with a valid one), with how many have each. */
async function peopleCountries(db: Db): Promise<[CountryCode, number][]> {
  const rows = await queryRows<{ country: string | null; n: number }>(
    db,
    sql`select country, count(*)::int as n from users
        where kind = 'person' and deleted_at is null and country is not null
        group by country order by country`,
  );
  return rows.flatMap((r) =>
    isCountryCode(r.country) ? [[r.country, Number(r.n)] as [CountryCode, number]] : [],
  );
}

/** The share of people (live accounts) without an avatar. */
async function peopleWithoutAvatar(db: Db): Promise<number> {
  const [row] = await queryRows<{ none: number; all: number }>(
    db,
    sql`select (count(*) filter (where avatar_id is null))::int as none, count(*)::int as "all"
        from users where kind = 'person' and deleted_at is null`,
  );
  const all = Number(row?.all ?? 0);
  return all === 0 ? 0 : Number(row?.none ?? 0) / all;
}

/** How many personas there are (the pool, whatever their state). */
export async function personaCount(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(users).where(eq(users.kind, 'persona'));
  return Number(row?.n ?? 0);
}

export interface CreatePersonaOptions {
  /** Every draw (country, avatar, temperament, name). */
  rng: Rng;
  /** When it is made (users.created_at: its "playing since"). */
  now: number;
  /** The server's RATING_OPTION: its ratings start at 1200 in every key of it, as a registration's [D7, D23]. */
  ratingOption: RatingOption;
  /** STEALTH_PERSONA_POOL_MAX (default DEFAULT_PERSONA_POOL_MAX): with this many personas, none is made. */
  poolMax?: number;
  /** The offensive-word filter (default the server's list). */
  words?: BlockedWords;
}

/** A persona just made. */
export interface NewPersona {
  userId: string;
  displayName: string;
  /** Null: no avatar (the app draws av00), as some people have. */
  avatarId: AvatarId | null;
  country: CountryCode;
  temperament: PersonaTemperament;
  createdAt: number;
  /** Its rating in every key of the option at the start (INITIAL_RATING, provisional, no games). */
  rating: number;
}

/** Tries at the insert when its name was taken in between. */
const INSERT_TRIES = 3;

/**
 * Makes a persona (stealth-bot.md §6): its users row (kind 'persona'), its personas row and its ratings, in one
 * transaction. Null when the pool is full (`poolMax`). Matchmaking calls it when no persona is free within the
 * player's range and 1200 is in it (a new one starts there).
 */
export async function createPersona(db: Db, options: CreatePersonaOptions): Promise<NewPersona | null> {
  const poolMax = options.poolMax ?? DEFAULT_PERSONA_POOL_MAX;
  if ((await personaCount(db)) >= poolMax) return null;
  const { rng } = options;
  const [countries, noAvatarShare] = await Promise.all([peopleCountries(db), peopleWithoutAvatar(db)]);
  const country = countries.length === 0 ? FALLBACK_COUNTRY : weighted(rng, countries);
  const temperament = weighted(rng, PERSONA_TEMPERAMENT_SHARES);
  const avatarId = chance(rng, noAvatarShare) ? null : pick(rng, PERSONA_AVATAR_IDS);
  const at = new Date(options.now);

  for (let attempt = 1; ; attempt++) {
    const displayName = await inventPersonaName(db, { rng, country, words: options.words });
    const id = randomUUID();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(users).values({
          id,
          firebaseUid: `${PERSONA_UID_PREFIX}${id}`,
          displayName,
          avatarId,
          country,
          email: null,
          createdAt: at,
          kind: 'persona',
        });
        await tx.insert(personas).values({ userId: id, temperament, createdAt: at });
        await tx.insert(ratings).values(
          ratingKeysFor(options.ratingOption).map((ratingKey) => ({
            userId: id,
            ratingKey,
            rating: INITIAL_RATING,
            games: 0,
            provisional: true,
            peak: INITIAL_RATING,
            updatedAt: at,
          })),
        );
      });
      return {
        userId: id,
        displayName,
        avatarId,
        country,
        temperament,
        createdAt: options.now,
        rating: INITIAL_RATING,
      };
    } catch (err) {
      // Someone took the name between the look and the insert: another name.
      if (uniqueViolation(err) !== NAME_INDEX || attempt >= INSERT_TRIES) throw err;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// Reading them

/** A persona matchmaking may seat, with its rating in one key. */
export interface PersonaCandidate {
  userId: string;
  /** In the key asked for: INITIAL_RATING when the key has no row yet (as a person's [D23]). */
  rating: number;
  games: number;
  provisional: boolean;
  createdAt: number;
}

/**
 * The personas that may be seated (stealth-bot.md §6, selection rules 2 and 4): not deleted, not suspended,
 * not waiting for a new name; each with its rating in `ratingKey`, in id order. The rest of the rules (free,
 * blocked neither way, not a recent opponent, within the range on the screen, the closest) are matchmaking's.
 */
export async function seatablePersonas(db: Db, ratingKey: string): Promise<PersonaCandidate[]> {
  const rows = await db
    .select({
      userId: users.id,
      rating: ratings.rating,
      games: ratings.games,
      provisional: ratings.provisional,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(ratings, and(eq(ratings.userId, users.id), eq(ratings.ratingKey, ratingKey)))
    .where(
      and(
        eq(users.kind, 'persona'),
        isNull(users.deletedAt),
        isNull(users.suspendedAt),
        eq(users.nameResetRequired, false),
      ),
    )
    .orderBy(users.id);
  return rows.map((r) => ({
    userId: r.userId,
    rating: r.rating ?? INITIAL_RATING,
    games: r.games ?? 0,
    provisional: r.provisional ?? true,
    createdAt: r.createdAt.getTime(),
  }));
}
