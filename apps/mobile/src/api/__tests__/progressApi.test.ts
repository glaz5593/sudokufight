import {
  type LevelBest,
  type LevelsSyncResponse,
  MAX_LEVELS_PER_REQUEST,
  MAX_PRACTICE_RESULTS,
  type PracticeResult,
} from '@sudoku-fight/protocol';

import {
  createProgressApi,
  isProgressOffline,
  leaderboardPath,
  playerPath,
  type ProgressApiError,
} from '../progressApi';
import {
  readLeaderboard,
  readLevelsSyncResponse,
  readMyLevels,
  readMyProgress,
  readPlayerCard,
  readPracticeResultsResponse,
} from '../progressGuards';
import { board, bodyOf, card, entry, type FakeReply, fakeFetch, myProgress } from '../testing/fakeProgress';

/**
 * The progress routes as the app calls them (protocol progress.ts; work plan stage 12): the paths and
 * queries, the ID token (refreshed once on a 401), the answers checked, and every failure mapped to a code.
 */

const BASE = 'https://game.example';

function api(reply: (url: string) => FakeReply, { token = 'tok' as string | null } = {}) {
  const fetch = fakeFetch((call) => reply(call.url));
  const tokens: boolean[] = [];
  const timers: (() => void)[] = [];
  const client = createProgressApi({
    baseUrl: BASE,
    getToken: async (force) => {
      tokens.push(force);
      return token === null ? null : force ? `${token}-fresh` : token;
    },
    fetch,
    timeoutMs: 1000,
    setTimeout: (cb) => timers.push(cb),
    clearTimeout: () => undefined,
  });
  return { client, fetch, tokens, timers };
}

const fail = async (p: Promise<unknown>): Promise<ProgressApiError> => {
  try {
    await p;
  } catch (error) {
    return error as ProgressApiError;
  }
  throw new Error('expected a failure');
};

describe('paths', () => {
  it('builds the leaderboard query: tab, players (option A only), cursor', () => {
    expect(leaderboardPath({ tab: 'general' })).toBe('/v1/leaderboard?tab=general');
    expect(leaderboardPath({ tab: 'normal', players: 3 })).toBe('/v1/leaderboard?tab=normal&players=3');
    expect(leaderboardPath({ tab: 'fast', players: null, cursor: 'a b&c' })).toBe(
      '/v1/leaderboard?tab=fast&cursor=a%20b%26c',
    );
    expect(playerPath('u/1')).toBe('/v1/players/u%2F1');
  });
});

describe('createProgressApi', () => {
  it('GET /v1/leaderboard with the bearer token, the answer checked', async () => {
    const b = board({ tab: 'normal', ratingKey: 'normal', me: entry({ id: 'me', rank: 214 }) });
    const { client, fetch } = api(() => ({ body: b }));
    await expect(client.leaderboard({ tab: 'normal' })).resolves.toEqual(b);
    expect(fetch.calls[0]!.url).toBe(`${BASE}/v1/leaderboard?tab=normal`);
    expect(fetch.calls[0]!.init).toMatchObject({
      method: 'GET',
      headers: { Authorization: 'Bearer tok', Accept: 'application/json' },
    });
  });

  it('GET /v1/players/:id and /v1/me/progress', async () => {
    const c = card({ id: 'nina' });
    const p = myProgress();
    const { client, fetch } = api((url) => ({ body: url.endsWith('/v1/me/progress') ? p : c }));
    await expect(client.player('nina')).resolves.toEqual(c);
    await expect(client.myProgress()).resolves.toEqual(p);
    expect(fetch.calls.map((x) => x.url)).toEqual([`${BASE}/v1/players/nina`, `${BASE}/v1/me/progress`]);
  });

  it('POST /v1/me/practice-results with the results as JSON', async () => {
    const result: PracticeResult = {
      id: 'practice-1',
      mode: 'bot',
      gameType: 'fast',
      outcome: 'win',
      correct: 12,
      endedAt: 1,
    };
    const { client, fetch } = api(() => ({ body: { accepted: 1, duplicates: 0, progress: myProgress() } }));
    await expect(client.sendPracticeResults([result])).resolves.toMatchObject({ accepted: 1, duplicates: 0 });
    expect(fetch.calls[0]!.init.method).toBe('POST');
    expect(fetch.calls[0]!.init.headers['Content-Type']).toBe('application/json');
    expect(bodyOf(fetch.calls[0]!)).toEqual({ results: [result] });
  });

  it('refuses an empty or oversized batch without a request', async () => {
    const { client, fetch } = api(() => ({ body: {} }));
    expect((await fail(client.sendPracticeResults([]))).code).toBe('badRequest');
    const many = Array.from({ length: MAX_PRACTICE_RESULTS + 1 }, (_, i) => ({
      id: `p${i}`,
      mode: 'solo' as const,
      gameType: 'fast' as const,
      outcome: 'completed' as const,
      correct: 0,
      endedAt: 1,
    }));
    expect((await fail(client.sendPracticeResults(many))).code).toBe('badRequest');
    expect(fetch.calls).toHaveLength(0);
  });

  it('a 401 refreshes the token and tries once more', async () => {
    let n = 0;
    const { client, fetch, tokens } = api(() => (n++ === 0 ? { status: 401 } : { body: myProgress() }));
    await expect(client.myProgress()).resolves.toEqual(myProgress());
    expect(tokens).toEqual([false, true]);
    expect(fetch.calls[1]!.init.headers.Authorization).toBe('Bearer tok-fresh');
  });

  it.each([
    [{ status: 404, body: { error: 'notFound' } }, 'notFound'],
    [{ status: 404, body: { error: 'notRegistered' } }, 'notRegistered'],
    [{ status: 400 }, 'badRequest'],
    [{ status: 413 }, 'tooLarge'],
    [{ status: 500 }, 'internal'],
    [{ status: 503 }, 'unavailable'],
    [{ status: 200, body: '<html>proxy</html>' }, 'unexpected'],
    [{ status: 200, body: { tab: 'nope' } }, 'unexpected'],
    [{ fail: true }, 'network'],
  ] as [FakeReply, string][])('%j → %s', async (reply, code) => {
    const { client } = api(() => reply);
    expect((await fail(client.leaderboard({ tab: 'general' }))).code).toBe(code);
  });

  it('429 keeps the Retry-After', async () => {
    const { client } = api(() => ({ status: 429, headers: { 'Retry-After': '30' } }));
    const error = await fail(client.myProgress());
    expect(error).toMatchObject({ code: 'tooManyRequests', status: 429, retryAfterMs: 30_000 });
    expect(isProgressOffline(error)).toBe(true);
  });

  it('a request with no answer in time is a timeout', async () => {
    let release: (() => void) | null = null;
    const fetch = fakeFetch(
      (call) =>
        new Promise<FakeReply>((resolve) => {
          call.init.signal?.addEventListener('abort', () => resolve({ fail: true }));
          release = () => resolve({ body: myProgress() });
        }),
    );
    const timers: (() => void)[] = [];
    const client = createProgressApi({
      baseUrl: BASE,
      getToken: async () => 'tok',
      fetch,
      timeoutMs: 10,
      setTimeout: (cb) => timers.push(cb),
      clearTimeout: () => undefined,
    });
    const pending = client.myProgress();
    await new Promise((r) => setImmediate(r));
    timers[0]!();
    expect((await fail(pending)).code).toBe('timeout');
    expect(release).not.toBeNull();
  });

  it('signed out: no request', async () => {
    const { client, fetch } = api(() => ({ body: {} }), { token: null });
    expect((await fail(client.player('x'))).code).toBe('signedOut');
    expect(fetch.calls).toHaveLength(0);
  });
});

describe('the answers, checked', () => {
  it('a leaderboard keeps its good rows and drops a broken one', () => {
    const raw = { ...board(), entries: [entry({ id: 'a' }), { id: 'b' }, entry({ id: 'c', rank: 2 })] };
    expect(readLeaderboard(raw)?.entries.map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('is lenient where a newer server knows more: an avatar, a country, a league', () => {
    const raw = { ...entry({ id: 'a' }), avatarId: 'av99', country: 'XX', league: 'mythic' };
    expect(readLeaderboard({ ...board(), entries: [raw] })?.entries[0]).toMatchObject({
      avatarId: 'av00',
      country: null,
      league: null,
    });
  });

  it('reads an avatar of the retired av01–av51 pack (a card saved on the phone) as its replacement', () => {
    expect(readPlayerCard({ ...card({ id: 'a' }), avatarId: 'av50' })?.avatarId).toBe('fox');
    const raw = { ...entry({ id: 'a' }), avatarId: 'av07' };
    expect(readLeaderboard({ ...board(), entries: [raw] })?.entries[0]?.avatarId).toBe('lava-lamp');
  });

  it('reads the friends tab: recent opponents and the invite link (an empty one is none)', () => {
    const raw = {
      ...board({ tab: 'friends' }),
      friends: { recentOpponents: [entry({ id: 'x' })], inviteUrl: '' },
    };
    expect(readLeaderboard(raw)?.friends).toEqual({ recentOpponents: [entry({ id: 'x' })], inviteUrl: null });
  });

  it('refuses what the screens cannot show', () => {
    expect(readLeaderboard({ ...board(), players: 7 })).toBeNull();
    expect(readLeaderboard({ ...board(), entries: 'x' })).toBeNull();
    expect(readPlayerCard({ ...card({ id: 'a' }), stats: null })).toBeNull();
    expect(readPlayerCard({ ...card({ id: 'a' }), xp: 'lots' })).toBeNull();
    expect(readMyProgress({ ...myProgress(), level: null })).toBeNull();
    expect(readPracticeResultsResponse({ accepted: 1, duplicates: 0 })).toBeNull();
  });

  it('a practice answer keeps `rejected` when the server says it (optional)', () => {
    const progress = myProgress();
    expect(readPracticeResultsResponse({ accepted: 2, duplicates: 1, rejected: 1, progress })).toEqual({
      accepted: 2,
      duplicates: 1,
      rejected: 1,
      progress,
    });
    expect(readPracticeResultsResponse({ accepted: 2, duplicates: 1, progress })).toEqual({
      accepted: 2,
      duplicates: 1,
      progress,
    });
    expect(readPracticeResultsResponse({ accepted: 2, duplicates: 1, rejected: 'x', progress })).toEqual({
      accepted: 2,
      duplicates: 1,
      progress,
    });
  });

  it('a card keeps its numbers, and drops trend points that are not numbers', () => {
    const c = card({ id: 'a' });
    const raw = { ...c, ratings: [{ ...c.ratings[0]!, trend: [1, 'x', 2] }] };
    expect(readPlayerCard(raw)?.ratings[0]!.trend).toEqual([1, 2]);
    expect(readPlayerCard(c)).toEqual(c);
  });

  it('"במשחק מאז" and the favourite interference: kept, and null from an older server or an unknown kind', () => {
    const c = card({ id: 'a' });
    expect(readPlayerCard(c)).toMatchObject({
      joinedAt: c.joinedAt,
      favoriteInterference: { kind: 'fireworks', count: 23 },
    });
    // An older server (or a card an older app saved): neither field.
    const { joinedAt: _joined, favoriteInterference: _favorite, ...older } = c;
    expect(readPlayerCard(older)).toMatchObject({ joinedAt: null, favoriteInterference: null });
    // A newer server's kind this app has no picture for, or a count that is not one: none.
    for (const favoriteInterference of [
      { kind: 'lasers', count: 4 },
      { kind: 'cats', count: 0 },
      { kind: 'cats', count: 'many' },
      'cats',
    ])
      expect(readPlayerCard({ ...c, favoriteInterference })?.favoriteInterference).toBeNull();
    expect(readPlayerCard({ ...c, joinedAt: 'April' })?.joinedAt).toBeNull();
  });
});

describe('the levels’ bests: GET and PUT /v1/me/levels (staged practice, 1.0.2) [D57]', () => {
  const levels: LevelBest[] = [
    { id: 'L001', stars: 3, plays: 2 },
    { id: 'L002', stars: 1, plays: 1 },
  ];
  const answer: LevelsSyncResponse = {
    levels,
    maxLevel: 300,
    owedXp: 0,
    xp: 40,
    progress: myProgress({ xp: 40 }),
    unknown: [],
  };

  it('GET with the bearer token; the answer checked', async () => {
    const { client, fetch } = api(() => ({ body: { levels, maxLevel: 300, owedXp: 25 } }));
    await expect(client.myLevels()).resolves.toEqual({ levels, maxLevel: 300, owedXp: 25 });
    expect(fetch.calls[0]!.url).toBe(`${BASE}/v1/me/levels`);
    expect(fetch.calls[0]!.init).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer tok' } });
  });

  it('PUT with the levels as JSON; an empty one (only the owed XP) goes too', async () => {
    const { client, fetch } = api(() => ({ body: answer }));
    await expect(client.putMyLevels(levels)).resolves.toEqual(answer);
    expect(fetch.calls[0]!.init).toMatchObject({
      method: 'PUT',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    });
    expect(bodyOf(fetch.calls[0]!)).toEqual({ levels });
    // Only the protocol's keys go (the server refuses any other).
    await client.putMyLevels([{ ...levels[0]!, metric: 4000 } as LevelBest]);
    expect(bodyOf(fetch.calls[1]!)).toEqual({ levels: [levels[0]] });
    await client.putMyLevels([]);
    expect(bodyOf(fetch.calls[2]!)).toEqual({ levels: [] });
  });

  it('refuses more than MAX_LEVELS_PER_REQUEST without a request', async () => {
    const { client, fetch } = api(() => ({ body: answer }));
    const many = Array.from({ length: MAX_LEVELS_PER_REQUEST + 1 }, (_, i) => ({
      id: `L${String(i + 1).padStart(3, '0')}`,
      stars: 1 as const,
      plays: 1,
    }));
    expect((await fail(client.putMyLevels(many))).code).toBe('badRequest');
    expect(fetch.calls).toHaveLength(0);
  });

  it('an old server (no route: 404 notFound) is told apart from an unknown account (404 notRegistered)', async () => {
    const old = api(() => ({ status: 404, body: { error: 'notFound' } }));
    expect((await fail(old.client.myLevels())).code).toBe('notFound');
    // A server whose 404 says nothing at all reads the same.
    const bare = api(() => ({ status: 404 }));
    expect((await fail(bare.client.putMyLevels(levels))).code).toBe('notFound');
    const stranger = api(() => ({ status: 404, body: { error: 'notRegistered' } }));
    expect((await fail(stranger.client.putMyLevels(levels))).code).toBe('notRegistered');
    const malformed = api(() => ({ status: 400, body: { error: 'badRequest' } }));
    expect((await fail(malformed.client.putMyLevels(levels))).code).toBe('badRequest');
  });

  it('a 401 refreshes the token and tries once more', async () => {
    let n = 0;
    const { client, fetch, tokens } = api(() => (n++ === 0 ? { status: 401 } : { body: answer }));
    await expect(client.putMyLevels(levels)).resolves.toEqual(answer);
    expect(tokens).toEqual([false, true]);
    expect(fetch.calls[1]!.init.headers.Authorization).toBe('Bearer tok-fresh');
    expect(bodyOf(fetch.calls[1]!)).toEqual({ levels });
  });

  it('readMyLevels keeps the good entries, drops the bad ones, caps stars at 3', () => {
    const raw = {
      levels: [
        { id: 'L001', stars: 3, plays: 2 },
        { id: 'L002', stars: 5, plays: 1.7 },
        { id: 'l003', stars: 1, plays: 1 },
        { id: 'L004', stars: 'two', plays: 1 },
        { id: 'L005', stars: -1, plays: 1 },
        { id: 'L006', stars: 1 },
        'L007',
        { id: 'L0008', stars: 1, plays: 1 },
      ],
      maxLevel: 300,
      owedXp: 10,
    };
    expect(readMyLevels(raw)).toEqual({
      levels: [
        { id: 'L001', stars: 3, plays: 2 },
        { id: 'L002', stars: 3, plays: 1 },
      ],
      maxLevel: 300,
      owedXp: 10,
    });
    // Lenient where the app can do without: the app's own count, nothing owed.
    expect(readMyLevels({ levels: [] })).toEqual({ levels: [], maxLevel: 300, owedXp: 0 });
    expect(readMyLevels({ levels: 'none' })).toBeNull();
    expect(readMyLevels('<html>')).toBeNull();
  });

  it('a PUT’s answer needs my progress; unknown ids are kept, anything else in them dropped', () => {
    expect(readLevelsSyncResponse({ ...answer, unknown: ['L301', 7] })).toEqual({
      ...answer,
      unknown: ['L301'],
    });
    const { progress: _progress, ...noProgress } = answer;
    expect(readLevelsSyncResponse(noProgress)).toBeNull();
    const { xp: _xp, unknown: _unknown, ...older } = answer;
    expect(readLevelsSyncResponse(older)).toEqual({ ...answer, xp: 0, unknown: [] });
  });
});
