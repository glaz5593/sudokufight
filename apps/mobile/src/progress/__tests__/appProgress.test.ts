import { ManualClock, ManualScheduler, type PlayerInfo } from '@sudoku-fight/engine';
import type { PracticeResult } from '@sudoku-fight/protocol';
import { AppState, type AppStateStatus } from 'react-native';

import type { ProgressApi } from '../../api/progressApi';
import { bodyOf, card, type FakeCall, fakeFetch, myProgress } from '../../api/testing/fakeProgress';
import { initAuth, setAuthDeps, signOut, useAuth } from '../../auth/authStore';
import { installSignedInPlayer } from '../../auth/testing/testAuth';
import { accountConfig } from '../../config/account';
import { FakeGame, OPP, rankedConfig } from '../../net/testing/fakeServer';
import {
  currentOwner,
  onlineGameEnded,
  practiceFinished,
  practiceSync,
  rankedRefresh,
  refreshMyProgress,
  setProgressFetch,
  startProgress,
} from '../appProgress';
import { adoptProgress, progressOf, useProgress } from '../progressStore';

/**
 * Progress wired to the phone (work plan stage 12, D41): when a player is signed in, what waits is sent and my
 * progress and card are read (app start, sign-in, the foreground); a practice's end is queued and sent; the
 * numbers belong to their account. The server is a fake fetch in place of the global one.
 */

const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
};

let offline = false;
const posted: PracticeResult[][] = [];
const server = fakeFetch((call: FakeCall) => {
  if (offline) return { fail: true };
  const path = new URL(call.url).pathname;
  if (path === '/v1/me/progress') return { body: myProgress({ level: 3, xpIntoLevel: 50, xpForNext: 600 }) };
  if (path.startsWith('/v1/players/'))
    return { body: card({ id: decodeURIComponent(path.split('/').pop()!) }) };
  if (path === '/v1/me/practice-results') {
    const { results } = bodyOf(call) as { results: PracticeResult[] };
    posted.push(results);
    return { body: { accepted: results.length, duplicates: 0, progress: myProgress({ level: 4 }) } };
  }
  return { status: 404 };
});

let foreground: ((state: AppStateStatus) => void) | null = null;
let stop: (() => void) | null = null;

beforeEach(() => {
  offline = false;
  posted.length = 0;
  server.calls.length = 0;
  setProgressFetch(server);
  // The sync's notes (offline, kept) are development logs.
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    foreground = handler as (state: AppStateStatus) => void;
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => {
  setProgressFetch(null);
  stop?.();
  stop = null;
  practiceSync().stop();
  rankedRefresh().stop();
  jest.restoreAllMocks();
});

const paths = () => server.calls.map((c) => `${c.init.method} ${new URL(c.url).pathname}`);

describe('startProgress', () => {
  it('a signed-in player: sends what waits and reads my progress and my card', async () => {
    await installSignedInPlayer();
    await initAuth();
    const me = useAuth.getState().me!;
    stop = startProgress();
    await settle();
    expect(paths()).toEqual(expect.arrayContaining(['GET /v1/me/progress', `GET /v1/players/${me.id}`]));
    const owner = currentOwner()!;
    expect(progressOf(useProgress.getState(), owner)).toMatchObject({ level: 3, xpIntoLevel: 50 });
    expect(useProgress.getState().card?.id).toBe(me.id);
    expect(useProgress.getState().status).toBe('ok');
  });

  it('a practice that ends is queued and sent; the answer is my new progress', async () => {
    await installSignedInPlayer();
    await initAuth();
    stop = startProgress();
    await settle();
    practiceFinished({
      id: 'practice-xyz',
      mode: 'bot',
      gameType: 'fast',
      playerId: 'me',
      result: {
        reason: 'boardComplete',
        ranking: [
          { playerId: 'me', seat: 0, place: 1, score: 30, mistakes: 0, correct: 22, status: 'active' },
          { playerId: 'bot', seat: 1, place: 2, score: 10, mistakes: 1, correct: 8, status: 'active' },
        ],
      },
      endedAt: 123,
    });
    await settle();
    expect(posted).toEqual([
      [{ id: 'practice-xyz', mode: 'bot', gameType: 'fast', outcome: 'win', correct: 22, endedAt: 123 }],
    ]);
    expect(useProgress.getState().progress?.level).toBe(4);
    expect(useProgress.getState().pending).toBe(0);
  });

  it('offline: the practice waits on the phone, and goes when the app comes back to the foreground', async () => {
    await installSignedInPlayer();
    await initAuth();
    stop = startProgress();
    await settle();
    offline = true;
    practiceFinished({
      id: 'practice-offline',
      mode: 'solo',
      gameType: 'normal',
      playerId: 'me',
      result: { reason: 'boardComplete', ranking: [] },
      endedAt: 9,
    });
    await settle();
    expect(posted).toEqual([]);
    expect(useProgress.getState().pending).toBe(1);
    // My saved numbers stay, and say they are the saved ones.
    await refreshMyProgress();
    expect(useProgress.getState().status).toBe('offline');
    expect(useProgress.getState().progress).not.toBeNull();

    offline = false;
    practiceSync().stop(); // the backoff's timer, as if it ran out
    foreground!('active');
    await settle();
    expect(posted.flat().map((r) => r.id)).toEqual(['practice-offline']);
    expect(useProgress.getState().pending).toBe(0);
  });

  it('signed out: nothing is sent, nothing is queued, and the last player’s numbers go', async () => {
    await installSignedInPlayer();
    await initAuth();
    stop = startProgress();
    await settle();
    expect(useProgress.getState().owner).not.toBeNull();
    await signOut();
    await settle();
    expect(useProgress.getState()).toMatchObject({ owner: null, progress: null, card: null });
    server.calls.length = 0;
    practiceFinished({
      id: 'nobody',
      mode: 'solo',
      gameType: 'fast',
      playerId: 'me',
      result: { reason: 'practiceEnded', ranking: [] },
      endedAt: 1,
    });
    await refreshMyProgress();
    await settle();
    expect(server.calls).toHaveLength(0);
  });

  it('reads that overlap: an older answer that comes back last never overwrites a newer one', async () => {
    await installSignedInPlayer();
    await initAuth();
    const owner = currentOwner()!;
    /** A read whose answer comes when the test says. */
    const slowRead = (level: number) => {
      let answer: () => void = () => undefined;
      const progress = new Promise<ReturnType<typeof myProgress>>(
        (resolve) => (answer = () => resolve(myProgress({ level }))),
      );
      const api = {
        myProgress: () => progress,
        player: (id: string) => Promise.resolve(card({ id, level })),
      } as unknown as ProgressApi;
      return { api, answer };
    };
    // Home's read goes out before the server stored the game; the read after the store goes out later.
    const before = slowRead(3);
    const after = slowRead(4);
    const first = refreshMyProgress(before.api);
    const second = refreshMyProgress(after.api);
    after.answer();
    await second;
    expect(progressOf(useProgress.getState(), owner)?.level).toBe(4);
    // The older answer comes back last (a slow network): dropped.
    before.answer();
    await first;
    expect(progressOf(useProgress.getState(), owner)?.level).toBe(4);
    expect(useProgress.getState().card?.level).toBe(4);
    expect(useProgress.getState().status).toBe('ok');

    // In order, each is taken as usual.
    const next = slowRead(5);
    const reading = refreshMyProgress(next.api);
    next.answer();
    await reading;
    expect(progressOf(useProgress.getState(), owner)?.level).toBe(5);
  });

  it('another account never sees the saved numbers of the last one', () => {
    adoptProgress('someone-else', myProgress({ level: 30 }), 1);
    expect(progressOf(useProgress.getState(), 'me-uid')).toBeNull();
    expect(progressOf(useProgress.getState(), 'someone-else')?.level).toBe(30);
  });
});

describe('after a ranked game (Moshe’s device test of 1.0.0: the rating followed only after a restart)', () => {
  /** A rated 2-player ranked game, over: the opponent gave up, so I win. */
  function rankedOver(meId: string, ratedGames = 0) {
    const players: PlayerInfo[] = [
      { id: meId, name: 'Tester', rating: 1200, ratedGames },
      { id: OPP, name: 'Rival', rating: 1305, ratedGames: 30 },
    ];
    const clock = new ManualClock(1_700_000_000_000);
    const game = new FakeGame(rankedConfig({ players }), () => clock.now(), new ManualScheduler(clock));
    game.apply({ type: 'start' });
    const running = game.state;
    game.act(OPP, { type: 'surrender' });
    return { running, over: game.state };
  }

  const fastOf = () => useAuth.getState().me!.ratings.find((r) => r.key === rankedConfig().gameType)!;

  it('the game’s end shows my new rating at once, and follows the game until the server has it', async () => {
    await installSignedInPlayer();
    await initAuth();
    stop = startProgress();
    await settle();
    const me = useAuth.getState().me!;
    const { over } = rankedOver(me.id);
    const mine = over.result!.ratingChanges.find((c) => c.playerId === me.id)!;
    onlineGameEnded({ state: over, playerId: me.id, left: false });
    expect(fastOf()).toMatchObject({ rating: mine.after, games: 1 });
    expect(rankedRefresh().following).toMatchObject({ gameId: over.config.id, expectsStored: true });
    // Signing out lets it go.
    await signOut();
    await settle();
    expect(rankedRefresh().following).toBeNull();
  });

  it('leaving a running game waits for the grace; the stop of startProgress lets it go', async () => {
    await installSignedInPlayer();
    await initAuth();
    stop = startProgress();
    const me = useAuth.getState().me!;
    const { running } = rankedOver(me.id);
    onlineGameEnded({ state: running, playerId: me.id, left: true });
    expect(rankedRefresh().following).toMatchObject({
      left: true,
      waitMs: running.config.rules.graceMs + accountConfig.refresh.afterRanked.afterGraceMarginMs,
    });
    stop();
    stop = null;
    expect(rankedRefresh().following).toBeNull();
  });

  it('nobody signed in, or not a rated game: nothing is followed', async () => {
    setAuthDeps(null);
    const { over } = rankedOver('user-1');
    onlineGameEnded({ state: over, playerId: 'user-1', left: false });
    expect(rankedRefresh().following).toBeNull();

    await installSignedInPlayer();
    await initAuth();
    const me = useAuth.getState().me!;
    const unrated = {
      ...over,
      config: { ...over.config, players: over.config.players.map((p) => ({ id: p.id })) },
    };
    onlineGameEnded({ state: unrated, playerId: me.id, left: false });
    expect(rankedRefresh().following).toBeNull();
    expect(fastOf()).toMatchObject({ rating: 1200, games: 0 });
  });

  it('back in the foreground: the account again too, at most every refresh.minIntervalMs', async () => {
    const auth = await installSignedInPlayer();
    const clock = { now: 5_000_000 };
    setAuthDeps({ ...auth.deps, now: () => clock.now });
    await initAuth();
    stop = startProgress();
    await settle();
    const gets = () => auth.server.calls.filter((c) => c === 'GET /v1/me').length;
    expect(gets()).toBe(1);
    foreground!('active');
    await settle();
    expect(gets()).toBe(1);
    expect(paths().filter((p) => p === 'GET /v1/me/progress').length).toBeGreaterThanOrEqual(2);
    clock.now += accountConfig.refresh.minIntervalMs;
    foreground!('background');
    foreground!('active');
    await settle();
    expect(gets()).toBe(2);
  });
});
