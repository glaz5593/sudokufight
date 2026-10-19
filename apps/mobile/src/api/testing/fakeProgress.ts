/* Test-only: the progress routes' answers, a fake fetch, and an in-memory ProgressApi for the screens. */
import { isLevelId, LEVEL_RULES, levelNumber, maxLevel, type Stars } from '@sudoku-fight/engine';
import type {
  Leaderboard,
  LeaderboardEntry,
  LeaderboardTab,
  LevelBest,
  LevelsSyncResponse,
  MyLevels,
  MyProgress,
  PlayerCard,
  PracticeResult,
  PracticeResultsResponse,
  PutMyLevelsRequest,
  RatingSummary,
  RecentResult,
} from '@sudoku-fight/protocol';

import type { AccountFetch, FetchInit, FetchResponse } from '../accountApi';
import { type LeaderboardQuery, type ProgressApi, ProgressApiError } from '../progressApi';

export const T0 = 1_760_000_000_000;

export function entry(over: Partial<LeaderboardEntry> & { id: string }): LeaderboardEntry {
  return {
    displayName: over.id,
    avatarId: 'lava-lamp',
    country: 'IL',
    league: 'gold',
    level: 5,
    rank: 1,
    rating: 1300,
    provisional: false,
    games: 20,
    ...over,
  };
}

/** `n` players ranked from `from`, ratings going down by 5. */
export function ranked(n: number, from = 1, prefix = 'p'): LeaderboardEntry[] {
  return Array.from({ length: n }, (_, i) =>
    entry({
      id: `${prefix}${from + i}`,
      displayName: `Player${from + i}`,
      rank: from + i,
      rating: 1600 - 5 * (from + i),
    }),
  );
}

export function board(over: Partial<Leaderboard> = {}): Leaderboard {
  return {
    tab: 'general',
    ratingKey: null,
    players: null,
    entries: ranked(5),
    me: null,
    nextCursor: null,
    friends: null,
    ...over,
  };
}

export function myProgress(over: Partial<MyProgress> = {}): MyProgress {
  return {
    xp: 2380 + 10_000,
    level: 14,
    xpIntoLevel: 2380,
    xpForNext: 3000,
    league: 'gold',
    leagueRating: 1276,
    ...over,
  };
}

export function rating(key: string, over: Partial<RatingSummary> = {}): RatingSummary {
  return {
    key,
    rating: 1287,
    peak: 1302,
    games: 30,
    provisional: false,
    trend: [1270, 1265, 1276, 1287],
    ...over,
  };
}

export function recent(n: number): RecentResult[] {
  return Array.from({ length: n }, (_, i) => ({
    gameId: `g${i + 1}`,
    gameType: 'normal' as const,
    players: 2,
    place: i % 3 === 2 ? 2 : 1,
    outcome: i % 3 === 2 ? ('loss' as const) : ('win' as const),
    score: 40 + i,
    ratingDelta: i % 3 === 2 ? -15 : 16,
    endedAt: T0 - i * 86_400_000,
  }));
}

export function card(over: Partial<PlayerCard> & { id: string }): PlayerCard {
  return {
    displayName: 'MosheG',
    avatarId: 'lava-lamp',
    country: 'IL',
    league: 'gold',
    level: 14,
    // "במשחק מאז אפריל 2026" (Profile.dc.html).
    joinedAt: Date.UTC(2026, 3, 12, 9, 30),
    xp: 12_380,
    ratings: [
      rating('fast', { rating: 1342, peak: 1361 }),
      rating('normal'),
      rating('hard', { rating: 1198, peak: 1214, trend: [1196, 1198] }),
    ],
    stats: {
      games: 86,
      wins: 49,
      losses: 37,
      winRate: 49 / 86,
      streak: 3,
      bestStreak: 7,
      bestMove: { points: 12.5, gameId: 'g1' },
      avgMistakes: 2.5,
    },
    favoriteInterference: { kind: 'fireworks', count: 23 },
    recent: recent(10),
    achievements: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------------------------------------
// fetch

export interface FakeCall {
  url: string;
  init: FetchInit;
}

export interface FakeReply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Throws instead of answering (no connection). */
  fail?: boolean;
}

/** A fetch whose answers come from `reply`; every call is kept. */
export function fakeFetch(reply: (call: FakeCall) => FakeReply | Promise<FakeReply>): AccountFetch & {
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  const fn = async (url: string, init: FetchInit): Promise<FetchResponse> => {
    const call = { url, init };
    calls.push(call);
    const r = await reply(call);
    if (r.fail) throw new TypeError('Network request failed');
    const headers = new Map(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      status: r.status ?? 200,
      headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
      text: async () =>
        r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body),
    };
  };
  return Object.assign(fn, { calls });
}

/** The body of a POST as the server reads it. */
export const bodyOf = (call: FakeCall): unknown => (call.init.body ? JSON.parse(call.init.body) : undefined);

/** A server for POST /v1/me/practice-results that remembers the ids it took (a resend is a duplicate). */
export function practiceServer(progress: () => MyProgress = () => myProgress()) {
  const taken = new Set<string>();
  const state = {
    offline: false,
    status: 200,
    retryAfter: null as string | null,
    refuse: null as string | null,
  };
  const fetch = fakeFetch((call): FakeReply => {
    if (state.offline) return { fail: true };
    if (state.status !== 200)
      return {
        status: state.status,
        body: { error: state.status === 429 ? 'tooManyRequests' : 'internal' },
        headers: state.retryAfter ? { 'Retry-After': state.retryAfter } : undefined,
      };
    const { results } = bodyOf(call) as { results: PracticeResult[] };
    if (state.refuse && results.some((r) => r.id === state.refuse))
      return { status: 400, body: { error: 'badRequest' } };
    let accepted = 0;
    let duplicates = 0;
    for (const r of results) {
      if (taken.has(r.id)) duplicates++;
      else {
        taken.add(r.id);
        accepted++;
      }
    }
    const answer: PracticeResultsResponse = { accepted, duplicates, progress: progress() };
    return { body: answer };
  });
  return { fetch, taken, state };
}

// ---------------------------------------------------------------------------------------------------------
// GET and PUT /v1/me/levels (staged practice, 1.0.2)

const byLevel = (a: LevelBest, b: LevelBest) => (levelNumber(a.id) ?? 0) - (levelNumber(b.id) ?? 0);

/**
 * A server for /v1/me/levels, as apps/server/src/progress/levels.ts behaves: it keeps the max of each level
 * (stars and plays apart), pays 10 XP for each best star it stores, once, and lists ids above its maxLevel as
 * `unknown`. `mode`: 'modern' (1.0.2), 'old' (no route: 404 notFound) or 'offline' (no answer at all). While
 * `capFull`, what is earned is owed (owedXp) and paid by a later PUT. `status` answers every request with it
 * (429 with `retryAfter`, 500, 404 notRegistered…); a PUT with an id in `refuse` is a 400, as a whole.
 */
export function levelsServer(initial: readonly LevelBest[] = []) {
  const stored = new Map<string, LevelBest>(initial.map((l) => [l.id, { ...l }]));
  const state = {
    mode: 'modern' as 'modern' | 'old' | 'offline',
    status: 200,
    error: null as string | null,
    retryAfter: null as string | null,
    refuse: new Set<string>(),
    /** Levels a PUT takes (200) but does not keep: a broken server. */
    drop: new Set<string>(),
    maxLevel: maxLevel(LEVEL_RULES),
    capFull: false,
    /** All the level XP paid so far. */
    paid: 0,
  };
  const earned = () => 10 * [...stored.values()].reduce((sum, l) => sum + l.stars, 0);
  const owed = () => Math.max(0, earned() - state.paid);
  const mine = (): MyLevels => ({
    levels: [...stored.values()].sort(byLevel),
    maxLevel: state.maxLevel,
    owedXp: owed(),
  });
  const puts: LevelBest[][] = [];
  const fetch = fakeFetch((call): FakeReply => {
    if (state.mode === 'offline') return { fail: true };
    const path = new URL(call.url).pathname;
    if (state.mode === 'old' || path !== '/v1/me/levels') return { status: 404, body: { error: 'notFound' } };
    if (state.status !== 200)
      return {
        status: state.status,
        body: {
          error:
            state.error ??
            (state.status === 429 ? 'tooManyRequests' : state.status === 404 ? 'notRegistered' : 'internal'),
        },
        headers: state.retryAfter ? { 'Retry-After': state.retryAfter } : undefined,
      };
    if (call.init.method === 'GET') return { body: mine() };
    const { levels } = bodyOf(call) as PutMyLevelsRequest;
    if (levels.some((l) => state.refuse.has(l.id) || !isLevelId(l.id)))
      return { status: 400, body: { error: 'badRequest' } };
    puts.push(levels);
    const unknown = new Set<string>();
    for (const l of levels) {
      if ((levelNumber(l.id) ?? 0) > state.maxLevel) {
        unknown.add(l.id);
        continue;
      }
      const seen = stored.get(l.id);
      if ((l.stars === 0 && l.plays === 0) || state.drop.has(l.id)) continue;
      stored.set(l.id, {
        id: l.id,
        stars: Math.max(seen?.stars ?? 0, l.stars) as Stars,
        plays: Math.max(seen?.plays ?? 0, l.plays),
      });
    }
    const xp = state.capFull ? 0 : owed();
    state.paid += xp;
    const answer: LevelsSyncResponse = {
      ...mine(),
      xp,
      progress: myProgress({ xp: state.paid }),
      unknown: [...unknown].sort(),
    };
    return { body: answer };
  });
  return { fetch, stored, state, puts };
}

// ---------------------------------------------------------------------------------------------------------
// An in-memory ProgressApi for the screens

export interface FakeBoards {
  /** Every player of a tab (ranked), paged by `pageSize`. Missing tab: empty. */
  tabs?: Partial<Record<LeaderboardTab, LeaderboardEntry[]>>;
  /** Option A: a tab's players by table size ("fast:3"); its presence makes the game-type tabs option A. */
  sized?: Record<string, LeaderboardEntry[]>;
  me?: LeaderboardEntry | null;
  friends?: { recentOpponents: LeaderboardEntry[]; inviteUrl: string | null };
  pageSize?: number;
  cards?: Record<string, PlayerCard>;
  progress?: MyProgress;
  /** What the server keeps of my levels. */
  levels?: LevelBest[];
}

export interface FakeProgressApi extends ProgressApi {
  readonly queries: LeaderboardQuery[];
  /** Every call fails with this code while set. */
  failWith: ProgressApiError['code'] | null;
}

export function fakeProgressApi(data: FakeBoards = {}): FakeProgressApi {
  const pageSize = data.pageSize ?? 50;
  const levels = new Map<string, LevelBest>((data.levels ?? []).map((l) => [l.id, l]));
  const api: FakeProgressApi = {
    queries: [],
    failWith: null,
    async leaderboard(query) {
      api.queries.push(query);
      if (api.failWith) throw new ProgressApiError(api.failWith);
      const gameType = query.tab === 'fast' || query.tab === 'normal' || query.tab === 'hard';
      const optionA = data.sized !== undefined && gameType;
      const players = optionA ? (query.players ?? 2) : null;
      const all = optionA ? (data.sized![`${query.tab}:${players}`] ?? []) : (data.tabs?.[query.tab] ?? []);
      const start = query.cursor ? Number(query.cursor) : 0;
      const entries = query.tab === 'friends' ? [] : all.slice(start, start + pageSize);
      const next = start + pageSize < all.length && query.tab !== 'friends' ? String(start + pageSize) : null;
      return {
        tab: query.tab,
        ratingKey:
          query.tab === 'general' || query.tab === 'friends'
            ? null
            : optionA
              ? `${query.tab}-${players}p`
              : query.tab,
        players,
        entries,
        me: data.me ?? null,
        nextCursor: next,
        friends: query.tab === 'friends' ? (data.friends ?? { recentOpponents: [], inviteUrl: null }) : null,
      };
    },
    async player(id) {
      if (api.failWith) throw new ProgressApiError(api.failWith);
      const found = data.cards?.[id];
      if (!found) throw new ProgressApiError('notFound', 404);
      return found;
    },
    async myProgress() {
      if (api.failWith) throw new ProgressApiError(api.failWith);
      return data.progress ?? myProgress();
    },
    async sendPracticeResults(results) {
      if (api.failWith) throw new ProgressApiError(api.failWith);
      return { accepted: results.length, duplicates: 0, progress: data.progress ?? myProgress() };
    },
    async myLevels() {
      if (api.failWith) throw new ProgressApiError(api.failWith);
      return { levels: [...levels.values()].sort(byLevel), maxLevel: maxLevel(LEVEL_RULES), owedXp: 0 };
    },
    async putMyLevels(sent) {
      if (api.failWith) throw new ProgressApiError(api.failWith);
      for (const l of sent) {
        const seen = levels.get(l.id);
        levels.set(l.id, {
          id: l.id,
          stars: Math.max(seen?.stars ?? 0, l.stars) as Stars,
          plays: Math.max(seen?.plays ?? 0, l.plays),
        });
      }
      return {
        levels: [...levels.values()].sort(byLevel),
        maxLevel: maxLevel(LEVEL_RULES),
        owedXp: 0,
        xp: 0,
        progress: data.progress ?? myProgress(),
        unknown: [],
      };
    },
  };
  return api;
}
