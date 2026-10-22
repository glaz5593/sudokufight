import { randomInt } from 'node:crypto';

import {
  currentCycle,
  type GameType,
  INITIAL_RATING,
  type RatingOption,
  type Rng,
} from '@sudoku-fight/engine';
import {
  type AvatarId,
  type CountryCode,
  isCountryCode,
  type NO_AVATAR_ID,
  normalizeAvatarId,
  type QueueKey,
} from '@sudoku-fight/protocol';
import { and, eq, isNull } from 'drizzle-orm';

import type { StealthBotSettings } from '../config';
import type { Db } from '../db';
import { ratings, users, xp } from '../db/schema';
import { capOf, DEFAULT_MATCHER, type MatcherConfig, rangeOf, type Ticket } from '../matchmaking/matcher';
import type { GameRoomLog } from '../rooms/GameRoom';
import { createPersona, personaCount, seatablePersonas } from './personas';
import { dbStealthPace, type StealthBotSeat, type StealthPaceSource, stealthLevelFor } from './seat';
import type { StealthSwitch } from './switch';

/**
 * When the stealth bot comes into a search, and as whom (stealth-bot.md §4, §6) [D90, D94, D95, D99].
 *
 * When (D94): only in a two-player ranked queue the settings name (STEALTH_BOT_QUEUES), only while the bot is
 * on (STEALTH_BOT_ENABLED and the admin switch), only after the wait drawn when the search started
 * (STEALTH_BOT_AFTER_MS: 8–20 s), and only while nobody the player could meet is searching: exactly the test
 * that tells the app "nobody else is searching" today (matcher.ts rule 7: nextRange null), blocks included. A
 * recent opponent in his reach counts as someone he could meet (since 23.10.2026, matcher.ts rule 2 lets a
 * repeat through when no game without one is possible): a person within reach comes before the bot, a recent
 * opponent too. A person who comes first is met as always; matchmaking (service.ts) runs this check every round
 * and seats one bot at a time.
 *
 * As whom (§6): a persona, chosen like an opponent (choosePersona):
 * 1. free (not in a match or a game now), and blocked neither way (the player's blocks, loaded with his search);
 * 2. seatable: not deleted, suspended or waiting for a new name (./personas.ts seatablePersonas);
 * 3. not a recent opponent of his: the rule of §7, with its 80% reset over the personas he could meet;
 * 4. within the range his search screen shows now (D6: ±50 and widening), never beyond it;
 * 5. one he never met first, then the closest rating; then one he met (not recently: rule 3), as a rematch.
 * No free persona in range at all, and the pool not full: a new persona is made (at 1200, so only when 1200 is
 * in his range). Personas are made only when needed, so they build up games and a rating history, and a new,
 * empty card stays rare. None and none to make: no bot this round; the range widens and the next round looks
 * again, until the usual timeout.
 *
 * "Nobody else is searching" (D95): while the bot is on in his queue and a persona is within his reach (free,
 * not blocked, within his maximum range: ±300, or none after "keep searching"; or one could be made at 1200
 * within it), `searching` carries no `nextRange` (the app shows the range bar, as before 15.10). A player no
 * persona can reach (say rated 1600 when they all stand near 1200) gets `nextRange: null` as today, and the app
 * offers a practice bot at once.
 */

/** A persona that may be seated, with its rating in the queue's key (./personas.ts seatablePersonas). */
export interface SeatablePersona {
  userId: string;
  rating: number;
  games: number;
  provisional: boolean;
}

/** What the player is shown of the persona (in `found`, exactly a person's fields), and its level by XP. */
export interface PersonaProfile extends SeatablePersona {
  name: string;
  avatarId: AvatarId | typeof NO_AVATAR_ID;
  country: CountryCode | null;
  /** Its level (xp.level) [D17]: the interference kinds it may send. */
  level: number;
}

/** What matchmaking reads and makes of the personas (dbPersonaSource: the database). */
export interface PersonaSource {
  /** Every persona that may be seated now, with its rating in `ratingKey`. */
  seatable(ratingKey: string): Promise<SeatablePersona[]>;
  /** How many personas there are, whatever their state (the pool, against STEALTH_PERSONA_POOL_MAX). */
  count(): Promise<number>;
  /** The persona's profile now; undefined when it is gone (deleted). */
  profile(userId: string, ratingKey: string): Promise<PersonaProfile | undefined>;
  /** A new persona (at INITIAL_RATING); null when the pool is full. */
  create(ratingKey: string): Promise<PersonaProfile | null>;
}

export interface PersonaChoiceInput {
  /** The player's ticket: rating, search time, recent opponents, blocks. */
  ticket: Ticket;
  now: number;
  personas: readonly SeatablePersona[];
  /** In a match or a game now. */
  busy: (userId: string) => boolean;
  /** A new persona may be made (the pool is not full). */
  canCreate: boolean;
  initialRating?: number;
  matcher?: MatcherConfig;
}

export type PersonaChoice =
  { kind: 'persona'; persona: SeatablePersona; rematch: boolean } | { kind: 'create' } | null;

/** The personas the player could meet in this search: free, blocked neither way, within his maximum range. */
export function reachablePersonas(input: PersonaChoiceInput): SeatablePersona[] {
  const { ticket, matcher = DEFAULT_MATCHER } = input;
  const cap = capOf(ticket, matcher);
  return input.personas.filter(
    (p) =>
      p.userId !== ticket.userId &&
      !input.busy(p.userId) &&
      !ticket.blocked.has(p.userId) &&
      Math.abs(p.rating - ticket.rating) <= cap,
  );
}

/** [D95] Some persona is within the player's reach in this search (or could be made within it). */
export function personaReachable(input: PersonaChoiceInput): boolean {
  const { ticket, matcher = DEFAULT_MATCHER, initialRating = INITIAL_RATING } = input;
  if (reachablePersonas(input).length > 0) return true;
  return input.canCreate && Math.abs(initialRating - ticket.rating) <= capOf(ticket, matcher);
}

/** [D94, §6] The persona to seat against the player now (the rules above), a new one to make, or none. */
export function choosePersona(input: PersonaChoiceInput): PersonaChoice {
  const { ticket, now, matcher = DEFAULT_MATCHER, initialRating = INITIAL_RATING } = input;
  const pool = reachablePersonas(input);
  // Rule 3: §7's recent opponents, with the 80% reset over the personas he could meet.
  const plays = ticket.opponents.map((o) => ({ puzzleId: o.opponentId, playedAt: o.playedAt }));
  const recent = new Set(
    pool.length === 0
      ? []
      : currentCycle(
          plays,
          pool.map((p) => p.userId),
          matcher.resetShare,
        ).map((p) => p.puzzleId),
  );
  const range = rangeOf(ticket, now, matcher);
  const lastMet = new Map<string, number>();
  for (const o of ticket.opponents)
    lastMet.set(o.opponentId, Math.max(lastMet.get(o.opponentId) ?? 0, o.playedAt));
  const distance = (p: SeatablePersona) => Math.abs(p.rating - ticket.rating);
  const inRange = pool.filter((p) => !recent.has(p.userId) && distance(p) <= range);
  const closest = (list: SeatablePersona[]) =>
    [...list].sort(
      (a, b) =>
        distance(a) - distance(b) ||
        (lastMet.get(a.userId) ?? 0) - (lastMet.get(b.userId) ?? 0) ||
        a.userId.localeCompare(b.userId),
    )[0];

  // §6: one he never met first; then one he met, not recently; only when no free persona is in range is a new
  // one made (personas then build up games and a rating history, and a new, empty card stays rare).
  const fresh = closest(inRange.filter((p) => !lastMet.has(p.userId)));
  if (fresh) return { kind: 'persona', persona: fresh, rematch: false };
  const met = closest(inRange);
  if (met) return { kind: 'persona', persona: met, rematch: true };
  if (input.canCreate && Math.abs(initialRating - ticket.rating) <= range) return { kind: 'create' };
  return null;
}

/** A persona chosen for a search, with the bot's seat for the game room. */
export interface StealthPick {
  profile: PersonaProfile;
  /** He met this persona before in this game type (`found`'s `rematch`, as with a person). */
  rematch: boolean;
  seat: StealthBotSeat;
}

/** The matchmaking side of the stealth bot (service.ts asks it): the settings, the switch, the personas. */
export interface StealthMatchmaking {
  /** The settings let a bot into this queue (whatever the switch says). */
  isStealthQueue(key: QueueKey): boolean;
  /** A bot may come into this queue now: the settings and the switch. */
  activeFor(key: QueueKey): boolean;
  /** The wait before a bot may come into a search that starts now (ms). */
  drawAfterMs(): number;
  /**
   * Reads what the checks below need before a search's first `searching`: the switch, and (while it is on) the
   * personas.
   */
  prepare(ratingKey: string): Promise<void>;
  /** [D95] `searching` leaves out "nobody else is searching" for this ticket now. */
  hidesNobody(key: QueueKey, ratingKey: string, ticket: Ticket, busy: (userId: string) => boolean): boolean;
  /** From what is known now (no database): a pick would find a persona (or make one). */
  wouldPick(ratingKey: string, ticket: Ticket, now: number, busy: (userId: string) => boolean): boolean;
  /** Chooses (or makes) the persona and builds the bot against this player; null: none in range now. */
  pick(
    gameType: GameType,
    ratingKey: string,
    ticket: Ticket,
    now: number,
    busy: (userId: string) => boolean,
  ): Promise<StealthPick | null>;
}

export interface StealthMatcherDeps {
  settings: Pick<
    StealthBotSettings,
    'enabled' | 'queues' | 'afterMs' | 'hideNobody' | 'personaPoolMax' | 'readyAfterMs'
  >;
  switch: Pick<StealthSwitch, 'isOn' | 'state'>;
  personas: PersonaSource;
  pace: StealthPaceSource;
  /** An integer in [0, n): the waits. */
  random: (n: number) => number;
  now: () => number;
  log: GameRoomLog;
  matcher?: MatcherConfig;
  /** How long a list of personas read from the database is used for the checks (ms). */
  cacheMs?: number;
}

export const PERSONA_CACHE_MS = 5000;

interface PersonaCache {
  personas: SeatablePersona[];
  total: number;
  at: number;
  loading: Promise<void> | null;
}

export class StealthMatcher implements StealthMatchmaking {
  private readonly caches = new Map<string, PersonaCache>();
  private switchRead = false;

  constructor(private readonly deps: StealthMatcherDeps) {}

  isStealthQueue(key: QueueKey): boolean {
    return this.deps.settings.enabled && this.deps.settings.queues.includes(key);
  }

  activeFor(key: QueueKey): boolean {
    return this.isStealthQueue(key) && this.deps.switch.isOn();
  }

  drawAfterMs(): number {
    return draw(this.deps.random, this.deps.settings.afterMs);
  }

  async prepare(ratingKey: string): Promise<void> {
    if (!this.deps.settings.enabled) return;
    if (!this.switchRead) {
      await this.deps.switch.state();
      this.switchRead = true;
    }
    // Switched off: nothing of the personas is read (it is read at the first round after it is on).
    if (!this.deps.switch.isOn()) return;
    const cache = this.caches.get(ratingKey);
    if (cache === undefined || this.stale(cache)) await this.load(ratingKey);
  }

  hidesNobody(key: QueueKey, ratingKey: string, ticket: Ticket, busy: (userId: string) => boolean): boolean {
    if (!this.deps.settings.hideNobody || !this.activeFor(key)) return false;
    const cache = this.cached(ratingKey);
    return cache !== null && personaReachable(this.choiceInput(cache, ticket, this.deps.now(), busy));
  }

  wouldPick(ratingKey: string, ticket: Ticket, now: number, busy: (userId: string) => boolean): boolean {
    const cache = this.cached(ratingKey);
    return cache !== null && choosePersona(this.choiceInput(cache, ticket, now, busy)) !== null;
  }

  async pick(
    gameType: GameType,
    ratingKey: string,
    ticket: Ticket,
    now: number,
    busy: (userId: string) => boolean,
  ): Promise<StealthPick | null> {
    // The freshest list for the pick itself.
    await this.load(ratingKey);
    const cache = this.caches.get(ratingKey)!;
    const choice = choosePersona(this.choiceInput(cache, ticket, now, busy));
    if (choice === null) return null;
    let profile: PersonaProfile | null | undefined;
    if (choice.kind === 'create') {
      profile = await this.deps.personas.create(ratingKey);
      // Full meanwhile (another server, or the count was old): no more until the next read.
      if (profile === null) cache.total = this.deps.settings.personaPoolMax;
      else this.forget();
      this.deps.log.info(
        `[stealth] ${profile ? `a new persona ${profile.userId}` : 'the persona pool is full'}`,
      );
    } else {
      profile = await this.deps.personas.profile(choice.persona.userId, ratingKey);
      // Gone meanwhile (deleted): read the list again next time.
      if (profile === undefined) this.forget();
    }
    if (!profile) return null;
    const level = await stealthLevelFor(
      this.deps.pace,
      ticket.userId,
      gameType,
      profile.level,
      this.deps.log,
    );
    return {
      profile,
      rematch: choice.kind === 'persona' && choice.rematch,
      seat: {
        userId: profile.userId,
        name: profile.name,
        level,
        readyAfterMs: draw(this.deps.random, this.deps.settings.readyAfterMs),
      },
    };
  }

  private choiceInput(
    cache: PersonaCache,
    ticket: Ticket,
    now: number,
    busy: (userId: string) => boolean,
  ): PersonaChoiceInput {
    return {
      ticket,
      now,
      personas: cache.personas,
      busy,
      canCreate: cache.total < this.deps.settings.personaPoolMax,
      matcher: this.deps.matcher,
    };
  }

  /** The list in memory (read again in the background once old); null before the first read. */
  private cached(ratingKey: string): PersonaCache | null {
    const cache = this.caches.get(ratingKey);
    if (cache === undefined || this.stale(cache)) void this.load(ratingKey).catch(() => undefined);
    return cache ?? null;
  }

  private stale(cache: PersonaCache): boolean {
    return this.deps.now() - cache.at >= (this.deps.cacheMs ?? PERSONA_CACHE_MS);
  }

  /** Every list is read again at its next use (a persona was made or went away). */
  private forget(): void {
    for (const cache of this.caches.values()) cache.at = -Infinity;
  }

  private load(ratingKey: string): Promise<void> {
    const existing = this.caches.get(ratingKey);
    if (existing?.loading) return existing.loading;
    const loading = Promise.all([this.deps.personas.seatable(ratingKey), this.deps.personas.count()])
      .then(([personas, total]) => {
        this.caches.set(ratingKey, { personas, total, at: this.deps.now(), loading: null });
      })
      .catch((error: unknown) => {
        this.deps.log.error('[stealth] the personas could not be read', error);
        // Tried again after cacheMs. Nothing known yet: no bot, and "nobody else" as before, until a read
        // succeeds; known before: that list meanwhile.
        const cache = this.caches.get(ratingKey);
        if (cache) Object.assign(cache, { loading: null, at: this.deps.now() });
        else
          this.caches.set(ratingKey, { personas: [], total: Infinity, at: this.deps.now(), loading: null });
      });
    if (existing) existing.loading = loading;
    else this.caches.set(ratingKey, { personas: [], total: Infinity, at: -Infinity, loading });
    return loading;
  }
}

/** An integer in [min, max], from `random` (an integer in [0, n)). */
export function draw(random: (n: number) => number, span: { min: number; max: number }): number {
  const min = Math.round(Math.min(span.min, span.max));
  const max = Math.round(Math.max(span.min, span.max));
  return min + random(max - min + 1);
}

// ---------------------------------------------------------------------------------------------------------
// The database

export interface ServerStealthOptions {
  /** config.stealth (absent, as in tests: off). */
  settings: StealthBotSettings | undefined;
  db: Db | (() => Db);
  ratingOption: RatingOption;
  /** The process's switch (the admin site turns the same one). */
  switch: StealthSwitch;
  log: GameRoomLog;
  now?: () => number;
  /** An integer in [0, n): the waits (default crypto.randomInt). */
  random?: (n: number) => number;
}

/**
 * The stealth bot's matchmaking side for the server (app.ts), on the database: undefined when STEALTH_BOT_ENABLED
 * is false (matchmaking then never asks anything of it). The game rooms get `{ secret: settings.secret }`.
 */
export function serverStealthMatcher(options: ServerStealthOptions): StealthMatcher | undefined {
  const { settings } = options;
  if (settings === undefined || !settings.enabled) return undefined;
  const now = options.now ?? Date.now;
  return new StealthMatcher({
    settings,
    switch: options.switch,
    personas: dbPersonaSource(options.db, {
      ratingOption: options.ratingOption,
      poolMax: settings.personaPoolMax,
      rng: { next: () => randomInt(2 ** 32) / 2 ** 32 },
      now,
    }),
    pace: dbStealthPace(options.db),
    random: options.random ?? randomInt,
    now,
    log: options.log,
  });
}

export interface DbPersonaSourceOptions {
  ratingOption: RatingOption;
  /** STEALTH_PERSONA_POOL_MAX. */
  poolMax: number;
  /** A new persona's draws (country, avatar, name). */
  rng: Rng;
  now: () => number;
}

/** The personas in the database: ./personas.ts (the pool, the rules 2 and 4, making one) and their profiles. */
export function dbPersonaSource(db: Db | (() => Db), options: DbPersonaSourceOptions): PersonaSource {
  const database = typeof db === 'function' ? db : () => db;
  return {
    seatable: (ratingKey) => seatablePersonas(database(), ratingKey),
    count: () => personaCount(database()),
    profile: (userId, ratingKey) => personaProfile(database(), userId, ratingKey),
    async create() {
      const made = await createPersona(database(), {
        rng: options.rng,
        now: options.now(),
        ratingOption: options.ratingOption,
        poolMax: options.poolMax,
      });
      if (made === null) return null;
      return {
        userId: made.userId,
        name: made.displayName,
        avatarId: normalizeAvatarId(made.avatarId),
        country: isCountryCode(made.country) ? made.country : null,
        rating: made.rating,
        games: 0,
        provisional: true,
        level: 1,
      };
    },
  };
}

/** A persona's profile as `found` shows a player's (matchmaking/store.ts), with its level; undefined: gone. */
export async function personaProfile(
  db: Db,
  userId: string,
  ratingKey: string,
): Promise<PersonaProfile | undefined> {
  const [row] = await db
    .select({
      name: users.displayName,
      avatarId: users.avatarId,
      country: users.country,
      rating: ratings.rating,
      games: ratings.games,
      provisional: ratings.provisional,
      level: xp.level,
    })
    .from(users)
    .leftJoin(ratings, and(eq(ratings.userId, users.id), eq(ratings.ratingKey, ratingKey)))
    .leftJoin(xp, eq(xp.userId, users.id))
    .where(and(eq(users.id, userId), eq(users.kind, 'persona'), isNull(users.deletedAt)));
  if (row === undefined) return undefined;
  return {
    userId,
    name: row.name,
    avatarId: normalizeAvatarId(row.avatarId),
    country: isCountryCode(row.country) ? row.country : null,
    rating: row.rating ?? INITIAL_RATING,
    games: row.games ?? 0,
    provisional: row.provisional ?? true,
    level: row.level ?? 1,
  };
}
