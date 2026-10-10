import {
  createRng,
  defaultRules,
  type GameConfig,
  type GameEvent,
  type GameResult,
  INITIAL_RATING,
  ratingKey,
  type Rng,
} from '@sudoku-fight/engine';
import type { Platform, TelemetryEventName, TelemetryProps } from '@sudoku-fight/protocol';

import type {
  appEvents,
  gameEvents,
  gamePlayers,
  games,
  installs,
  opponentHistory,
  puzzleHistory,
  puzzles,
  ratings,
  users,
} from '../db/schema';
import { between, chance, intBetween, pick, shuffle, uuid, weighted } from './random';
import { playRankedGame } from './rankedGame';

/**
 * Sample data for the admin site in development (`npm run seed -w @sudoku-fight/server`): realistic and
 * deterministic (one seed, one `now` → the same rows).
 *
 * The story it tells, over the last `days` days:
 * - Installs arrive a little faster each week. Signing up is required (spec §3, D24 open), so most installs
 *   that never sign up stop at Login or halfway through registration: that is the drop-off.
 * - Signed-up installs are short-lived (a day or three), casual (some days over a few weeks) or loyal (about
 *   every other day until now). A few users have a second device; two delete their account.
 * - Sessions are screen paths through the app (spec §4.2): Home → Modes → GameType → (BotSelect) → Game →
 *   Results, the leaderboard, history, settings… with game_start / game_end of practice games.
 * - Ranked games between users who were active then, played move by move by the engine
 *   (./rankedGame), with ratings that evolve game by game, and a session on each player's phone around it.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Israel in summer; close enough for when people play. */
const LOCAL_UTC_OFFSET_H = 3;

export const SAMPLE_DEFAULTS = { seed: 20261009, installs: 300, users: 80, games: 150, days: 45 };
/** Firebase uids of sample users start with this, so a database with sample data is recognised. */
export const SAMPLE_UID_PREFIX = 'sample-';
/** App versions and how many days before `now` each came out. */
export const SAMPLE_VERSIONS: readonly (readonly [string, number])[] = [
  ['0.1.0', 60],
  ['0.1.1', 26],
  ['0.2.0', 9],
];

/**
 * Screens by the names the app reports them in screen_view: their route patterns (apps/mobile/app, named by
 * the app's services/telemetry/screens.ts), so sample data and real reports are the same screens in the admin
 * site. The matchmaking, replay and profile screens come in later stages (SAMPLE_FUTURE_SCREENS):
 * the patterns their routes will most likely have. The splash screen is native, never a screen_view.
 */
export const SAMPLE_SCREENS = {
  home: '/',
  modes: '/modes',
  gameType: '/game-type',
  botSelect: '/bot-select',
  game: '/game',
  results: '/results/[id]',
  settings: '/settings',
  leaderboard: '/leaderboard',
  history: '/history',
  achievements: '/achievements',
  login: '/login',
  registerFighter: '/register/fighter',
  registerAccount: '/register/account',
  matchSearch: '/match-search',
  replay: '/replay/[id]',
  profile: '/profile',
} as const;
export type SampleScreen = (typeof SAMPLE_SCREENS)[keyof typeof SAMPLE_SCREENS];
/** The screens of SAMPLE_SCREENS that the app does not have yet. */
export const SAMPLE_FUTURE_SCREENS: readonly SampleScreen[] = ['/match-search', '/replay/[id]', '/profile'];
const S = SAMPLE_SCREENS;

export interface SamplePuzzle {
  id: string;
  givens: string;
  solution: string;
  gameType: string;
  techniques: string[];
  givensCount: number;
  source: string;
  pool: 'offline' | 'ranked';
}

export interface SampleOptions {
  /** The end of the story (epoch ms); nothing happens after it. */
  now: number;
  /** The bank to play ranked games on (packages/engine/data/puzzles.json). */
  puzzles: readonly SamplePuzzle[];
  seed?: number;
  installs?: number;
  users?: number;
  games?: number;
  days?: number;
}

export interface SampleData {
  users: (typeof users.$inferInsert)[];
  installs: (typeof installs.$inferInsert)[];
  appEvents: (typeof appEvents.$inferInsert)[];
  puzzles: (typeof puzzles.$inferInsert)[];
  games: (typeof games.$inferInsert)[];
  gamePlayers: (typeof gamePlayers.$inferInsert)[];
  gameEvents: (typeof gameEvents.$inferInsert)[];
  ratings: (typeof ratings.$inferInsert)[];
  puzzleHistory: (typeof puzzleHistory.$inferInsert)[];
  opponentHistory: (typeof opponentHistory.$inferInsert)[];
}

type RankedRows = Pick<
  SampleData,
  'puzzles' | 'games' | 'gamePlayers' | 'gameEvents' | 'ratings' | 'puzzleHistory' | 'opponentHistory'
>;

// ---------------------------------------------------------------------------------------------------------
// Plans

type Archetype = 'short' | 'casual' | 'loyal';
type Activity = 'solo' | 'bot' | 'browse' | 'settings';

interface RankedPlan {
  id: string;
  start: number;
  players: UserPlan[];
  /** Set once played. */
  result?: GameResult;
  startedAt?: number;
  endedAt?: number;
}

type SessionPlan =
  | { kind: 'guest' | 'register' | 'signin' | 'normal' | 'delete'; start: number }
  | { kind: 'ranked'; start: number; game: RankedPlan };

interface InstallPlan {
  id: string;
  platform: Platform;
  firstAt: number;
  /** How long after a release this phone updates. */
  updateLagMs: number;
  user: UserPlan | null;
  sessions: SessionPlan[];
  /** When this install signed in (set while rendering). */
  signedInAt: number | null;
}

interface UserPlan {
  id: string;
  firebaseUid: string;
  displayName: string;
  email: string | null;
  country: string;
  avatarId: string;
  archetype: Archetype;
  main: InstallPlan;
  extra: InstallPlan | null;
  /** Last moment the user is around (now, or earlier for those who stop or delete). */
  activeUntil: number;
  deleted: boolean;
  /** Set while rendering the registration. */
  registeredAt: number | null;
}

const HOUR_WEIGHTS: readonly (readonly [number, number])[] = [
  [7, 1],
  [8, 2],
  [9, 2],
  [10, 2],
  [11, 2],
  [12, 3],
  [13, 3],
  [14, 3],
  [15, 3],
  [16, 4],
  [17, 5],
  [18, 6],
  [19, 7],
  [20, 8],
  [21, 8],
  [22, 6],
  [23, 3],
];

const HEBREW_NAMES = [
  'נועה',
  'איתי',
  'מאיה',
  'יונתן',
  'תמר',
  'אורי',
  'שירה',
  'עומר',
  'יעל',
  'דניאל',
  'רוני',
  'אביב',
];
const LATIN_NAMES = [
  'Moshe',
  'Dana',
  'Noam',
  'Tal',
  'Lior',
  'Gal',
  'Shai',
  'Ella',
  'Ben',
  'Mia',
  'Adam',
  'Lea',
  'Alex',
  'Sam',
];
const NAME_STYLES = ['Sudoku', 'Ninja', 'Pro', 'King', 'Queen', 'Fox', 'Tiger', 'Wiz'];
const COUNTRIES: readonly (readonly [string, number])[] = [
  ['IL', 75],
  ['US', 9],
  ['GB', 5],
  ['FR', 4],
  ['DE', 3],
  ['RU', 4],
];
const AVATARS = Array.from({ length: 51 }, (_, k) => `av${String(k + 1).padStart(2, '0')}`).filter(
  (a) => a !== 'av36',
);

class SampleBuilder {
  private readonly rng: Rng;
  private readonly now: number;
  private readonly days: number;
  /** Midnight UTC of the story's first day. */
  private readonly firstDay: number;
  private readonly installs: InstallPlan[] = [];
  private readonly users: UserPlan[] = [];
  private readonly ranked: RankedPlan[] = [];
  private readonly usedNames = new Set<string>();

  constructor(private readonly o: Required<Omit<SampleOptions, 'puzzles'>> & Pick<SampleOptions, 'puzzles'>) {
    this.rng = createRng(o.seed);
    this.now = o.now;
    this.days = o.days;
    this.firstDay = Math.floor(o.now / DAY) * DAY - (o.days - 1) * DAY;
  }

  build(): SampleData {
    this.planInstalls();
    this.planSessions();
    this.planRankedGames();
    const played = this.playRankedGames();
    const telemetry = this.renderSessions();
    return { ...played, ...telemetry, users: this.userRows() };
  }

  // ---- planning ------------------------------------------------------------------------------------------

  /** A moment on day `d` (0 = the first day) at a likely local hour. */
  private momentOn(d: number): number {
    const hour = weighted(this.rng, HOUR_WEIGHTS) - LOCAL_UTC_OFFSET_H;
    return (
      this.firstDay +
      d * DAY +
      hour * HOUR +
      intBetween(this.rng, 0, 59) * MINUTE +
      intBetween(this.rng, 0, 59) * 1000
    );
  }

  private dayOf(t: number): number {
    return Math.floor((t - this.firstDay) / DAY);
  }

  private newInstall(firstAt: number, user: UserPlan | null = null): InstallPlan {
    const install: InstallPlan = {
      id: uuid(this.rng),
      platform: chance(this.rng, 0.58) ? 'android' : 'ios',
      firstAt,
      updateLagMs: between(this.rng, 0, 4) * DAY,
      user,
      sessions: [],
      signedInAt: null,
    };
    this.installs.push(install);
    return install;
  }

  private planInstalls(): void {
    const { installs: total, users: userCount } = this.o;
    // More installs each week: the weight of a day grows from 1 to 3; Friday and Saturday a bit more.
    const dayWeights = Array.from({ length: this.days }, (_, d) => {
      const weekday = new Date(this.firstDay + d * DAY).getUTCDay();
      return [d, (1 + (2 * d) / this.days) * (weekday === 5 || weekday === 6 ? 1.3 : 1)] as const;
    });
    const extras = Math.min(Math.round(userCount * 0.08), Math.max(0, total - userCount));
    const mains = Math.min(userCount, total);

    // Users: their main install comes first, early enough for a story of a few days.
    for (let k = 0; k < mains; k++) {
      const d = Math.min(weighted(this.rng, dayWeights), this.days - 1);
      const firstAt = Math.min(this.momentOn(d), this.now - 2 * HOUR);
      const archetype = weighted<Archetype>(this.rng, [
        ['short', 15],
        ['casual', 40],
        ['loyal', 45],
      ]);
      const install = this.newInstall(firstAt);
      const user = this.newUser(archetype, install);
      install.user = user;
      user.activeUntil = this.lifetimeEnd(firstAt, archetype);
      this.users.push(user);
    }
    // Two users delete their account at the end of their story.
    for (const user of shuffle(this.rng, this.users).slice(0, this.users.length >= 10 ? 2 : 0)) {
      user.deleted = true;
      user.activeUntil = Math.min(user.activeUntil, this.now - between(this.rng, 1, 5) * DAY);
      if (user.activeUntil <= user.main.firstAt + DAY) user.deleted = false;
    }
    // A second device for a few.
    for (const user of shuffle(this.rng, this.users).slice(0, extras)) {
      const span = user.activeUntil - user.main.firstAt;
      if (span < 2 * DAY) continue;
      const firstAt = user.main.firstAt + between(this.rng, 0.2, 0.7) * span;
      user.extra = this.newInstall(firstAt, user);
    }
    // The rest never sign up.
    const missing = total - this.installs.length;
    for (let k = 0; k < missing; k++) {
      const d = Math.min(weighted(this.rng, dayWeights), this.days - 1);
      this.newInstall(Math.min(this.momentOn(d), this.now - HOUR));
    }
  }

  private newUser(archetype: Archetype, main: InstallPlan): UserPlan {
    const { rng } = this;
    let displayName = '';
    for (let tries = 0; displayName === '' || this.usedNames.has(displayName.toLowerCase()); tries++) {
      const hebrew = chance(rng, 0.45);
      const base = hebrew ? pick(rng, HEBREW_NAMES) : pick(rng, LATIN_NAMES);
      const style = chance(rng, 0.4) ? (hebrew ? '_' : '') + pick(rng, NAME_STYLES) : '';
      const number = tries > 0 || chance(rng, 0.5) ? String(intBetween(rng, 1, 99)) : '';
      displayName = `${base}${style}${number}`;
    }
    this.usedNames.add(displayName.toLowerCase());
    const id = uuid(rng);
    return {
      id,
      firebaseUid: `${SAMPLE_UID_PREFIX}${id.replace(/-/g, '').slice(0, 20)}`,
      displayName,
      email: chance(rng, 0.85) ? `player.${id.slice(0, 8)}@example.com` : null,
      country: weighted(rng, COUNTRIES),
      avatarId: pick(rng, AVATARS),
      archetype,
      main,
      extra: null,
      activeUntil: this.now,
      deleted: false,
      registeredAt: null,
    };
  }

  private lifetimeEnd(firstAt: number, archetype: Archetype): number {
    if (archetype === 'loyal') return this.now;
    const days = archetype === 'short' ? between(this.rng, 0.5, 3) : between(this.rng, 4, 20);
    return Math.min(this.now, firstAt + days * DAY);
  }

  private planSessions(): void {
    for (const install of this.installs) {
      const user = install.user;
      if (user === null) {
        this.planGuest(install);
        continue;
      }
      const isMain = user.main === install;
      install.sessions.push({ kind: isMain ? 'register' : 'signin', start: install.firstAt });
      const until = isMain
        ? user.activeUntil
        : Math.min(user.activeUntil, this.lifetimeEnd(install.firstAt, 'casual'));
      const perDay = { short: 0.8, casual: 0.35, loyal: 0.5 }[user.archetype] * (isMain ? 1 : 0.5);
      for (let d = this.dayOf(install.firstAt); d < this.days; d++) {
        if (!chance(this.rng, perDay)) continue;
        const count = weighted(this.rng, [
          [1, 6],
          [2, 3],
          [3, 1],
        ]);
        for (let k = 0; k < count; k++) {
          const start = this.momentOn(d);
          if (start <= install.firstAt || start >= until - 2 * HOUR || this.busy(install, start)) continue;
          install.sessions.push({ kind: 'normal', start });
        }
      }
      if (isMain && user.deleted) install.sessions.push({ kind: 'delete', start: user.activeUntil });
    }
  }

  /** Never signed up: a visit or three to Login and maybe part of the registration, then gone. */
  private planGuest(install: InstallPlan): void {
    install.sessions.push({ kind: 'guest', start: install.firstAt });
    if (!chance(this.rng, 0.35)) return;
    for (let k = intBetween(this.rng, 1, 2); k > 0; k--) {
      const start = install.firstAt + between(this.rng, 3 * HOUR, 4 * DAY);
      if (start < this.now - HOUR && !this.busy(install, start))
        install.sessions.push({ kind: 'guest', start });
    }
  }

  /** Another session of this install starts within two hours of `t`. */
  private busy(install: InstallPlan, t: number): boolean {
    return install.sessions.some((s) => Math.abs(s.start - t) < 2 * HOUR);
  }

  /** When a user can play ranked: after registering, before they stop. */
  private rankedWindow(user: UserPlan): [number, number] {
    return [
      Math.max(user.main.firstAt + 15 * MINUTE, this.now - 40 * DAY),
      Math.min(user.activeUntil, this.now) - HOUR,
    ];
  }

  private planRankedGames(): void {
    const { rng } = this;
    const hosts = this.users.map((u) => [u, { short: 1, casual: 3, loyal: 6 }[u.archetype]] as const);
    if (this.users.length < 2) return;
    for (let attempts = 0; this.ranked.length < this.o.games && attempts < this.o.games * 60; attempts++) {
      const host = weighted(rng, hosts);
      const [from, to] = this.rankedWindow(host);
      if (to <= from) continue;
      const t = this.momentOn(this.dayOf(from + rng.next() * (to - from)));
      if (t < from || t > to || this.busy(host.main, t)) continue;
      const others = shuffle(
        rng,
        this.users.filter((u) => {
          if (u === host) return false;
          const [a, b] = this.rankedWindow(u);
          return t >= a && t <= b && !this.busy(u.main, t);
        }),
      );
      if (others.length === 0) continue;
      const want = weighted(rng, [
        [2, 70],
        [3, 20],
        [4, 10],
      ]);
      const players = shuffle(rng, [host, ...others.slice(0, want - 1)]);
      const game: RankedPlan = { id: uuid(rng), start: t, players };
      this.ranked.push(game);
      for (const p of players)
        p.main.sessions.push({ kind: 'ranked', start: t - intBetween(rng, 30, 120) * 1000, game });
    }
  }

  // ---- ranked games --------------------------------------------------------------------------------------

  private playRankedGames(): RankedRows {
    const { rng } = this;
    const rows: RankedRows = {
      puzzles: [],
      games: [],
      gamePlayers: [],
      gameEvents: [],
      ratings: [],
      puzzleHistory: [],
      opponentHistory: [],
    };
    const fast = this.o.puzzles.filter((p) => p.gameType === 'fast');
    if (fast.length === 0 && this.ranked.length > 0)
      throw new Error('No fast puzzles to play sample games on');
    /** `${userId} ${ratingKey}` → the rating so far. */
    const ratingOf = new Map<string, { rating: number; games: number; peak: number; at: number }>();
    const played = new Map<string, number>(); // `${userId} ${puzzleId}` → when
    const met = new Map<string, number>(); // `${userId} ${opponentId}` → when
    const usedPuzzles = new Map<string, SamplePuzzle>();

    for (const game of this.ranked.sort((a, b) => a.start - b.start)) {
      // A puzzle none of them has played, if one turns up in a few draws.
      let puzzle = pick(rng, fast);
      for (let k = 0; k < 8 && game.players.some((p) => played.has(`${p.id} ${puzzle.id}`)); k++)
        puzzle = pick(rng, fast);
      usedPuzzles.set(puzzle.id, puzzle);

      const rules = defaultRules('ranked', 'fast');
      const key = ratingKey('fast', game.players.length, rules.rating.option);
      const config: GameConfig = {
        id: game.id,
        mode: 'ranked',
        gameType: 'fast',
        puzzle: { id: puzzle.id, givens: puzzle.givens, solution: puzzle.solution },
        players: game.players.map((u) => ({
          id: u.id,
          name: u.displayName,
          rating: ratingOf.get(`${u.id} ${key}`)?.rating ?? INITIAL_RATING,
          ratedGames: ratingOf.get(`${u.id} ${key}`)?.games ?? 0,
        })),
        rules,
        seed: Math.floor(rng.next() * 2 ** 31),
      };
      const { events, state } = playRankedGame(rng, config, game.start);
      const result = state.result;
      if (result === null || state.startedAt === null || state.endedAt === null) {
        throw new Error(`sample game ${game.id} did not end`);
      }
      game.result = result;
      game.startedAt = state.startedAt;
      game.endedAt = state.endedAt;

      rows.games.push({
        id: game.id,
        mode: 'ranked',
        gameType: 'fast',
        playerCount: game.players.length,
        puzzleId: puzzle.id,
        rules,
        startedAt: new Date(state.startedAt),
        endedAt: new Date(state.endedAt),
        endReason: result.reason,
      });
      rows.gameEvents.push(...events.map((e) => eventRow(game.id, e)));
      for (const entry of result.ranking) {
        const change = result.ratingChanges.find((c) => c.playerId === entry.playerId);
        rows.gamePlayers.push({
          gameId: game.id,
          userId: entry.playerId,
          seat: entry.seat,
          finalScore: entry.score,
          mistakes: entry.mistakes,
          place: entry.place,
          status: entry.status,
          ratingKey: key,
          ratingBefore: change?.before ?? null,
          ratingAfter: change?.after ?? null,
        });
        if (change !== undefined) {
          const before = ratingOf.get(`${entry.playerId} ${key}`);
          ratingOf.set(`${entry.playerId} ${key}`, {
            rating: change.after,
            games: (before?.games ?? 0) + 1,
            peak: Math.max(before?.peak ?? change.before, change.after),
            at: state.endedAt,
          });
        }
        played.set(`${entry.playerId} ${puzzle.id}`, state.startedAt);
        for (const other of game.players) {
          if (other.id !== entry.playerId) met.set(`${entry.playerId} ${other.id}`, state.startedAt);
        }
      }
    }

    const provisionalGames = defaultRules('ranked', 'fast').rating.provisionalGames;
    for (const [k, r] of ratingOf) {
      const [userId, ratingKeyOf] = k.split(' ') as [string, string];
      rows.ratings.push({
        userId,
        ratingKey: ratingKeyOf,
        rating: r.rating,
        games: r.games,
        provisional: r.games < provisionalGames,
        peak: r.peak,
        updatedAt: new Date(r.at),
      });
    }
    rows.puzzles = [...usedPuzzles.values()].map((p) => ({
      id: p.id,
      givens: p.givens,
      solution: p.solution,
      gameType: p.gameType,
      techniques: p.techniques,
      givensCount: p.givensCount,
      source: p.source,
      pool: p.pool,
    }));
    for (const [k, at] of played) {
      const [userId, puzzleId] = k.split(' ') as [string, string];
      rows.puzzleHistory.push({ userId, puzzleId, playedAt: new Date(at) });
    }
    for (const [k, at] of met) {
      const [userId, opponentId] = k.split(' ') as [string, string];
      rows.opponentHistory.push({ userId, opponentId, gameType: 'fast', playedAt: new Date(at) });
    }
    return rows;
  }

  // ---- telemetry -----------------------------------------------------------------------------------------

  private renderSessions(): Pick<SampleData, 'installs' | 'appEvents'> {
    const installRows: SampleData['installs'] = [];
    const eventRows: SampleData['appEvents'] = [];
    for (const install of this.installs) {
      const drafts: Draft[] = [];
      for (const session of install.sessions.sort((a, b) => a.start - b.start)) {
        drafts.push(...this.renderSession(install, session));
      }
      const kept = drafts.filter((d) => d.t <= this.now);
      if (kept.length === 0) continue;
      const times = kept.map((d) => d.t);
      const lastSeen = Math.max(...times);
      installRows.push({
        id: install.id,
        platform: install.platform,
        appVersion: this.versionOf(install, lastSeen),
        firstSeen: new Date(Math.min(...times)),
        lastSeen: new Date(lastSeen),
        userId: install.signedInAt !== null && install.signedInAt <= this.now ? install.user!.id : null,
      });
      for (const d of kept) {
        eventRows.push({
          id: d.id,
          installId: install.id,
          userId: install.signedInAt !== null && d.t >= install.signedInAt ? install.user!.id : null,
          name: d.name,
          props: d.props,
          tClient: new Date(d.t),
          tServer: new Date(Math.min(this.now, d.tServer)),
        });
      }
    }
    return { installs: installRows, appEvents: eventRows };
  }

  private versionOf(install: InstallPlan, t: number): string {
    let version = SAMPLE_VERSIONS[0]![0];
    for (const [v, daysAgo] of SAMPLE_VERSIONS) {
      const released = this.now - daysAgo * DAY;
      // A new install gets what is out; an old one updates a while after the release.
      if (released <= install.firstAt || released + install.updateLagMs <= t) version = v;
    }
    return version;
  }

  private renderSession(install: InstallPlan, session: SessionPlan): Draft[] {
    const { rng } = this;
    const s = new SessionWriter(rng, session.start);
    const user = install.user;
    s.emit('app_open', {}); // as the app sends it: the version and platform travel in the batch

    switch (session.kind) {
      case 'guest': {
        s.wait(2, 4); // the splash
        s.screen(S.login, 5, 40);
        if (chance(rng, 0.45)) {
          s.emit('register_step', { step: 'fighter' });
          s.screen(S.registerFighter, 20, 90);
          if (chance(rng, 0.4)) {
            s.emit('register_step', { step: 'account' });
            s.screen(S.registerAccount, 20, 60);
          }
        }
        break;
      }
      case 'register':
      case 'signin': {
        s.wait(2, 4); // the splash
        s.screen(S.login, 5, 30);
        if (session.kind === 'register') {
          s.emit('register_step', { step: 'fighter' });
          s.screen(S.registerFighter, 20, 90);
          s.emit('register_step', { step: 'account' });
          s.screen(S.registerAccount, 20, 60);
          s.emit('register_complete', {
            method: weighted(rng, [
              ['email', 5],
              ['google', 4],
              ['apple', 2],
            ] as const),
          });
          if (user !== null) user.registeredAt = s.t;
        }
        install.signedInAt = s.t;
        s.screen(S.home, 5, 20);
        this.activities(s, intBetween(rng, 1, 2));
        break;
      }
      case 'normal': {
        if (chance(rng, 0.7)) s.wait(2, 4); // the splash
        s.screen(S.home, 3, 20);
        this.activities(
          s,
          weighted(rng, [
            [1, 5],
            [2, 3],
            [3, 2],
          ] as const),
        );
        break;
      }
      case 'delete': {
        s.screen(S.home, 3, 10);
        s.screen(S.settings, 10, 40);
        s.emit('account_delete', {});
        break;
      }
      case 'ranked':
        this.rankedSession(s, install, session.game);
        break;
    }
    return s.drafts;
  }

  /** Around a ranked game: find a match, play it (the server's own times), see the results. */
  private rankedSession(s: SessionWriter, install: InstallPlan, game: RankedPlan): void {
    const { rng } = this;
    const me = install.user;
    const result = game.result;
    if (me === null || result === undefined || game.startedAt === undefined || game.endedAt === undefined)
      return;
    s.screen(S.home, 2, 6);
    s.screen(S.modes, 2, 5);
    s.screen(S.gameType, 2, 5);
    s.emit('screen_view', { screen: S.matchSearch });
    const searching = s.t;
    s.t = Math.max(s.t + 1000, game.startedAt - 4000);
    s.emit('matchmaking_wait', { ms: Math.round(s.t - searching), players: game.players.length });
    s.screen(S.game, 0, 0);
    s.t = Math.max(s.t, game.startedAt);
    s.emit('game_start', { mode: 'ranked', type: 'fast', players: game.players.length });
    s.t = Math.max(s.t, game.endedAt);
    const mine = result.ranking.find((r) => r.playerId === me.id);
    const firsts = result.ranking.filter((r) => r.place === 1).length;
    s.emit('game_end', {
      mode: 'ranked',
      result: mine?.place !== 1 ? 'loss' : firsts > 1 ? 'tie' : 'win',
      score: mine?.score ?? 0,
      mistakes: mine?.mistakes ?? 0,
      durationSec: Math.round(result.durationMs / 1000),
    });
    s.screen(S.results, 5, 25);
    if (chance(rng, 0.2)) {
      s.emit('replay_open', { mode: 'ranked' });
      s.screen(S.replay, 20, 120);
    }
    if (chance(rng, 0.5)) s.screen(S.home, 2, 10);
  }

  private activities(s: SessionWriter, count: number): void {
    const { rng } = this;
    for (let k = 0; k < count; k++) {
      const activity = weighted<Activity>(rng, [
        ['bot', 35],
        ['solo', 30],
        ['browse', 25],
        ['settings', 10],
      ]);
      if (activity === 'browse') {
        s.screen(
          weighted(rng, [
            [S.leaderboard, 4],
            [S.history, 3],
            [S.achievements, 2],
            [S.profile, 2],
          ] as const),
          5,
          40,
        );
      } else if (activity === 'settings') {
        s.screen(S.settings, 5, 30);
      } else if (!this.practice(s, activity)) {
        return; // left the app halfway
      }
      if (k < count - 1 || chance(rng, 0.5)) s.screen(S.home, 2, 8);
    }
  }

  /** A practice game; false when the player leaves the app before it starts. */
  private practice(s: SessionWriter, mode: 'solo' | 'bot'): boolean {
    const { rng } = this;
    s.screen(S.modes, 2, 8);
    s.screen(S.gameType, 2, 8);
    if (mode === 'bot') s.screen(S.botSelect, 3, 15);
    if (chance(rng, 0.08)) return false;
    s.screen(S.game, 0, 1);
    s.emit('game_start', { mode, type: 'fast', players: mode === 'bot' ? 2 : 1 });
    const surrendered = chance(rng, 0.06);
    const durationSec = intBetween(rng, surrendered ? 30 : 90, surrendered ? 200 : 420);
    s.t += durationSec * 1000;
    const result =
      mode === 'solo'
        ? surrendered
          ? 'ended'
          : 'completed'
        : surrendered
          ? 'loss'
          : weighted(rng, [
              ['win', 55],
              ['loss', 40],
              ['tie', 5],
            ] as const);
    s.emit('game_end', {
      mode,
      result,
      score: intBetween(rng, 10, 120) / 2,
      mistakes: weighted(rng, [
        [0, 3],
        [1, 4],
        [2, 3],
        [3, 2],
        [4, 1],
        [6, 1],
      ] as const),
      durationSec,
    });
    s.screen(S.results, 5, 20);
    if (chance(rng, 0.12)) {
      s.emit('replay_open', { mode });
      s.screen(S.replay, 20, 120);
    }
    return true;
  }

  private userRows(): SampleData['users'] {
    return this.users
      .filter((u) => u.registeredAt !== null && u.registeredAt <= this.now)
      .map((u) => ({
        id: u.id,
        firebaseUid: u.firebaseUid,
        displayName: u.displayName,
        country: u.country,
        avatarId: u.avatarId,
        email: u.email,
        createdAt: new Date(u.registeredAt!),
        deletedAt: u.deleted ? new Date(u.activeUntil + 5 * MINUTE) : null,
      }));
  }
}

interface Draft {
  id: string;
  name: TelemetryEventName;
  props: TelemetryProps;
  t: number;
  tServer: number;
}

/** Writes one session's events, moving its own clock. Most sessions are sent at once; some only later. */
class SessionWriter {
  readonly drafts: Draft[] = [];
  private readonly offline: boolean;
  private readonly sentLater: number;

  constructor(
    private readonly rng: Rng,
    public t: number,
  ) {
    this.offline = chance(rng, 0.15);
    this.sentLater = between(rng, 5, 90) * MINUTE;
  }

  emit(name: TelemetryEventName, props: TelemetryProps): void {
    this.drafts.push({ id: uuid(this.rng), name, props, t: Math.round(this.t), tServer: 0 });
    this.t += intBetween(this.rng, 200, 1500);
    // Online: each event a moment later. Offline: the whole session when the phone is back.
    for (const d of this.drafts) d.tServer = this.offline ? Math.round(this.t + this.sentLater) : d.t + 1500;
  }

  screen(name: SampleScreen, minSec: number, maxSec: number): void {
    this.emit('screen_view', { screen: name });
    this.wait(minSec, maxSec);
  }

  /** The player looks at something that is not reported (the splash, a screen's content). */
  wait(minSec: number, maxSec: number): void {
    this.t += between(this.rng, minSec, maxSec) * 1000;
  }
}

function eventRow(gameId: string, e: GameEvent): typeof gameEvents.$inferInsert {
  const { seq, t, type, ...payload } = e;
  return { gameId, seq, tMs: t, type, payload };
}

/** The sample data for these options. Pure: the same options give the same rows. */
export function generateSampleData(options: SampleOptions): SampleData {
  return new SampleBuilder({ ...SAMPLE_DEFAULTS, ...options }).build();
}
