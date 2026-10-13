/**
 * The contract between the app's matchmaking and this server (work plan stage 9, "סיום": two accounts find
 * each other, play, and the rating moves by the formula), end to end: the app's own MatchmakingClient,
 * OnlineSession and RemoteGameHost (apps/mobile/src/net and src/game: pure TypeScript, the very code the phone
 * runs; only the React Native wiring is left out) and its account API client, against the real server
 * (Colyseus + Express + an in-memory PGlite, a free port), through the GameHost interface the screens use.
 *
 * - Two registered accounts (development tokens, as the app's development sign-in makes them) search in
 *   fast-2p: both see `searching`, find each other ("found": the other's name and rating, provisional),
 *   take their reserved seats in the match's room at once (D37: connected = ready), count down to GO in the
 *   phone's clock, and get the game at GO.
 * - They play it to the end through the GameHost interface (each works the answers out from the givens with
 *   the engine's solver: the server never sends the solution of a running game).
 * - GET /v1/me (the app's account client) shows each one's new rating in the queue's rating key, exactly the
 *   engine's eloChanges for the final places, and the result the hosts got says the same.
 * - A lonely search ends in the timeout (scaled), and "keep searching" goes on without the cap.
 * - A second search from the same account is refused ('alreadyQueued'), and a cancel lets it go.
 * - A Firebase account whose email is not verified is refused ('emailNotVerified', D22): the code the app's
 *   match screen turns into "אמת את המייל" (the verification screen).
 *
 * The timings are scaled through createAppServer's matchmaking options, as in ranked.e2e.test.ts: the range
 * steps every 250 ms, the timeout is 3 s, the countdown 600 ms. The ranked pool holds real puzzles a few
 * cells from the end, loaded the way `npm run db:seed-puzzles` does. FAKE_LOG=1 prints what the app says.
 */
import type { AddressInfo } from 'node:net';

import { Client } from '@colyseus/sdk';
import { type Digit, eloChanges, type GameType } from '@sudoku-fight/engine';
import {
  devToken,
  MATCH_RANGE,
  MATCH_TIMEOUT_MS,
  type MatchRangeRules,
  type QueueKey,
} from '@sudoku-fight/protocol';

// The app's code (pure TypeScript, no React Native): what the phone runs.
import { createAccountApi } from '../../mobile/src/api/accountApi';
import { OnlineSession } from '../../mobile/src/game/onlineSession';
import {
  createMatchmakingConnector,
  MatchmakingClient,
  type MatchmakingInfo,
  type MatchPhase,
} from '../../mobile/src/net/matchmaking';
import { createOnlineClient } from '../../mobile/src/net/onlineClient';
import { RemoteGameHost } from '../../mobile/src/net/remoteGameHost';
import { createAppServer } from '../src/app';
import type { GamePuzzle } from '../src/game/puzzles';
import { DEFAULT_MATCHER } from '../src/matchmaking';
import { type BankPuzzle, seedRankedPuzzles } from '../src/puzzles';
import { createTestDb, PUZZLE, quietLog, testConfig, type TestDb } from '../src/testing';
import { solveGivens } from '../src/testing/fakeClient';
import { testTokens, type TestTokens } from '../src/testing/tokens';

// ---------------------------------------------------------------------------------------------------------
// Scaled timings (ranked.e2e.test.ts's)

const SCALE = 20;
const RANGE: MatchRangeRules = { ...MATCH_RANGE, stepMs: MATCH_RANGE.stepMs / SCALE };
const TIMEOUT_MS = MATCH_TIMEOUT_MS / SCALE;
const COUNTDOWN_MS = 600;

// Real puzzles a few cells from the end (one solution each: every blank has 8 givens in its row).
const nearlyDone = (id: string, blanks: number[]): GamePuzzle => ({
  id,
  givens: [...PUZZLE.solution].map((d, i) => (blanks.includes(i) ? '0' : d)).join(''),
  solution: PUZZLE.solution,
});
const bankPuzzle = (p: GamePuzzle, gameType: GameType): BankPuzzle => ({
  ...p,
  gameType,
  techniques: ['nakedSingle'],
  givensCount: [...p.givens].filter((c) => c !== '0').length,
  source: 'appMatchmaking.contract',
  pool: 'ranked',
});

// ---------------------------------------------------------------------------------------------------------
// The server

const log = quietLog();
let db: TestDb;
let tokens: TestTokens;
let server: ReturnType<typeof createAppServer>;
let url = '';

beforeAll(async () => {
  db = await createTestDb();
  // Firebase tokens signed here, and development tokens (as the app's development sign-in makes them).
  tokens = await testTokens();
  await seedRankedPuzzles(db.db, [
    bankPuzzle(nearlyDone('contract-fast-1', [0, 13, 40, 80, 22, 57]), 'fast'),
    bankPuzzle(nearlyDone('contract-fast-2', [1, 14, 41, 79, 23, 58]), 'fast'),
  ]);
  server = createAppServer({
    gracefullyShutdown: false,
    config: testConfig(),
    db,
    tokens: tokens.verifier(Date.now),
    game: { log, closeAfterGameMs: 500 },
    matchmaking: {
      config: {
        tickMs: 25,
        matcher: { ...DEFAULT_MATCHER, range: RANGE, timeoutMs: TIMEOUT_MS },
        extendedTimeoutMs: TIMEOUT_MS,
        keepSearchingWindowMs: 2000,
        readyTimeoutMs: 3000,
        countdownMs: COUNTDOWN_MS,
      },
    },
  });
  await server.listen(0);
  url = `http://127.0.0.1:${(server.transport.server!.address() as AddressInfo).port}`;
}, 30_000);

const clients = new Set<MatchmakingClient<OnlineSession>>();
const sessions = new Set<OnlineSession>();

afterEach(() => {
  for (const c of clients) c.close();
  for (const s of sessions) s.close();
  clients.clear();
  sessions.clear();
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  await db.close();
  // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
  await new Promise((r) => setTimeout(r, 1100));
}, 30_000);

// ---------------------------------------------------------------------------------------------------------
// The phone

const clock = { now: () => Date.now() };
const scheduler = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * A signed-in player: the development sign-in's token (or `token`), its profile made with the app's account
 * client.
 */
async function account(name: string, token = devToken(`app-${name.toLowerCase()}`)) {
  const api = createAccountApi({
    baseUrl: url,
    getToken: () => Promise.resolve(token),
    fetch: (target, init) => fetch(target, init),
    timeoutMs: 10_000,
  });
  const me = await api.createUser({ displayName: name, avatarId: 'lava-lamp', country: 'IL' });
  return { name, token, api, me };
}

type Account = Awaited<ReturnType<typeof account>>;

/** The app searching in `queue`, wired like the phone (net/matchmakingDevice.ts, gameStore.startRanked). */
function search(who: Account, queue: QueueKey = 'fast-2p') {
  const say = (line: string) => {
    if (process.env.FAKE_LOG) console.log(`[${who.name}] ${line}`);
  };
  const tracked: { name: string; props: Record<string, unknown> }[] = [];
  const phases: MatchPhase[] = [];
  const client = new MatchmakingClient<OnlineSession>(queue, {
    connector: createMatchmakingConnector({ sdk: new Client(url), token: () => Promise.resolve(who.token) }),
    enter: (found) => {
      const session = new OnlineSession({
        host: new RemoteGameHost({
          client: createOnlineClient({
            endpoint: url,
            identity: () => Promise.resolve({ kind: 'token', token: who.token }),
          }),
          clock,
          scheduler,
          log: say,
          options: { pingEveryMs: 400 },
        }),
        request: { kind: 'match', queueKey: queue, matchId: found.matchId, reservation: found.reservation },
        track: (name, props) => tracked.push({ name, props }),
      });
      sessions.add(session);
      return session;
    },
    clock,
    scheduler,
    track: (name, props) => tracked.push({ name, props }),
    log: say,
  });
  client.subscribe((info) => {
    if (phases.at(-1) !== info.phase) phases.push(info.phase);
  });
  clients.add(client);
  void client.start();
  return { client, tracked, phases };
}

/** Resolves once `done()` holds (checked every 10 ms). */
async function until(done: () => boolean, what: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error(`no ${what} within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * Plays like a person through the GameHost interface, faster: lock an empty cell nobody holds, then its
 * answer, worked out from the givens with the engine's solver (the server never sends it).
 */
function drive(host: RemoteGameHost, everyMs = 110): () => void {
  let solution: string | null = null;
  const timer = setInterval(() => {
    if (host.online.status !== 'live' || !host.online.hasGame) return;
    const v = host.getView();
    if (v.status !== 'running') return;
    solution ??= solveGivens(host.game!.config.puzzle.givens).solution;
    const me = v.players.find((p) => p.id === v.me)!;
    if (me.lock) return host.place(me.lock.cell, Number(solution[me.lock.cell]) as Digit);
    if (host.pendingCell !== null) return;
    const held = new Set(v.players.flatMap((p) => (p.lock ? [p.lock.cell] : [])));
    const cooling = new Set(v.cooldowns.map((c) => c.cell));
    const cell = v.grid.findIndex((d, i) => d === 0 && !held.has(i) && !cooling.has(i));
    if (cell >= 0) host.select(cell);
  }, everyMs);
  return () => clearInterval(timer);
}

const infoOf = (s: { client: MatchmakingClient<OnlineSession> }): MatchmakingInfo => s.client.info;

// ---------------------------------------------------------------------------------------------------------

describe("the app's matchmaking on the real server", () => {
  it('two accounts find each other, count down, play to the end, and GET /v1/me has the formula’s ratings', async () => {
    const [ana, ben] = await Promise.all([account('AnaApp'), account('BenApp')]);
    expect(ana.me.ratings.find((r) => r.key === 'fast')).toMatchObject({ rating: 1200, games: 0 });

    const a = search(ana);
    await until(() => infoOf(a).phase === 'searching', 'the first search');
    expect(infoOf(a).search).toMatchObject({ rating: 1200, range: MATCH_RANGE.initial, extended: false });
    const b = search(ben);

    // "found": each sees the other, and takes its seat in the match's room at once (D37).
    await until(() => [a, b].every((s) => s.client.entry !== null), 'the match');
    const [ma, mb] = [infoOf(a).match!, infoOf(b).match!];
    expect(ma.matchId).toBe(mb.matchId);
    expect(ma.players.find((p) => p.id !== ma.me)).toMatchObject({
      id: ben.me.id,
      name: 'BenApp',
      rating: 1200,
      provisional: true,
    });
    expect(ma.me).toBe(ana.me.id);
    expect(mb.me).toBe(ben.me.id);
    // No cancelling after "found" [D32].
    expect(a.client.cancel()).toBe(false);

    // 3… 2… 1… in the phone's clock, then GO and the game on both.
    await until(() => [a, b].every((s) => infoOf(s).match?.goAt != null), 'the countdown');
    const goAt = infoOf(a).match!.goAt!;
    expect(goAt - Date.now()).toBeLessThanOrEqual(COUNTDOWN_MS + 50);
    await until(() => [a, b].every((s) => infoOf(s).phase === 'started' && infoOf(s).hasGame), 'GO');
    expect(Date.now()).toBeGreaterThanOrEqual(goAt - 100);
    for (const s of [a, b])
      expect(s.phases).toEqual(['connecting', 'searching', 'found', 'countdown', 'started']);
    const [sa, sb] = [a.client.entry!, b.client.entry!];
    expect(sa.host.roomCode).toBe(sb.host.roomCode);
    expect(sa.queueKey).toBe('fast-2p');
    // Spec §21: no solution while the game runs.
    expect(sa.host.game!.config.puzzle.solution).toBe('');
    expect(sa.host.game!.config.mode).toBe('ranked');

    // The game, through the GameHost interface.
    const stops = [drive(sa.host, 80), drive(sb.host, 240)];
    await until(() => [sa, sb].every((s) => s.getView().status === 'over'), 'the end', 30_000);
    stops.forEach((stop) => stop());
    const result = sa.getView().result!;
    expect(result.reason).toBe('boardComplete');
    expect(sb.getView().result).toEqual(result);

    // The engine's formula for the final places (spec §11.2): both provisional, 1200 each.
    const formula = eloChanges(
      result.ranking.map((r) => ({
        id: r.playerId,
        rating: 1200,
        games: 0,
        place: r.place,
        abandoned: false,
      })),
    );
    expect(result.ratingChanges).toEqual(expect.arrayContaining(formula));

    // GET /v1/me (the server writes the result in the background): the new rating in the queue's key.
    for (const who of [ana, ben]) {
      const change = formula.find((c) => c.playerId === who.me.id)!;
      let entry = (await who.api.getMe()).ratings.find((r) => r.key === 'fast')!;
      for (let k = 0; k < 50 && entry.games === 0; k++) {
        await new Promise((r) => setTimeout(r, 100));
        entry = (await who.api.getMe()).ratings.find((r) => r.key === 'fast')!;
      }
      expect(entry).toMatchObject({ rating: change.after, games: 1, provisional: true });
      expect(change.after).toBe(1200 + change.delta);
    }
    // Provisional K = 64 at 1200 each: ±32 for a win and a loss, 0 for a true tie (D16).
    const tie = result.ranking[0]!.place === result.ranking[1]!.place;
    expect(formula.map((c) => c.delta).sort((x, y) => x - y)).toEqual(tie ? [0, 0] : [-32, 32]);

    // Analytics (spec §22): the wait, then the game's start and end.
    for (const s of [a, b]) {
      expect(s.tracked.find((e) => e.name === 'matchmaking_wait')?.props).toMatchObject({ result: 'found' });
      expect(s.tracked.map((e) => e.name)).toEqual(['matchmaking_wait', 'game_start', 'game_end']);
    }
  }, 60_000);

  it('a lonely search times out; "keep searching" goes on without the cap', async () => {
    const solo = await account('SoloApp');
    const s = search(solo, 'hard-2p');
    await until(() => infoOf(s).phase === 'timeout', 'the timeout', TIMEOUT_MS + 3000);
    expect(infoOf(s).timeout).toMatchObject({ range: MATCH_RANGE.cap, extended: false });
    expect(s.tracked).toEqual([
      { name: 'matchmaking_wait', props: { sec: expect.any(Number), result: 'timeout' } },
    ]);
    s.client.keepSearching();
    await until(() => infoOf(s).phase === 'searching' && infoOf(s).search!.range > MATCH_RANGE.cap, 'no cap');
    expect(infoOf(s).search!.extended).toBe(true);
    expect(s.client.cancel()).toBe(true);
    expect(infoOf(s).phase).toBe('cancelled');
  }, 20_000);

  it('one search per account: a second one is refused, and a cancel lets the first go', async () => {
    const cy = await account('CyApp');
    const first = search(cy, 'normal-2p');
    await until(() => infoOf(first).phase === 'searching', 'the search');
    // The SDK warns of a connection the server closed while joining: that is the refusal.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const second = search(cy, 'fast-2p');
    await until(() => infoOf(second).phase === 'failed', 'the refusal');
    warn.mockRestore();
    expect(infoOf(second).error!.code).toBe('alreadyQueued');
    expect(first.client.cancel()).toBe(true);
    // Out of the queue: a new search is taken.
    await new Promise((r) => setTimeout(r, 200));
    const again = search(cy, 'fast-2p');
    await until(() => infoOf(again).phase === 'searching', 'the new search');
  }, 20_000);

  it('an email that is not verified: refused with "emailNotVerified", for the verification screen [D22]', async () => {
    const unverified = await tokens.sign(
      { uid: 'fb-app-dana', email: 'dana@example.com', emailVerified: false },
      Date.now(),
    );
    const dana = await account('DanaApp', unverified);
    expect(dana.me.emailVerified).toBe(false);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = search(dana, 'fast-2p');
    await until(() => infoOf(s).phase === 'failed', 'the refusal');
    warn.mockRestore();
    expect(infoOf(s).error!.code).toBe('emailNotVerified');
    // With the SDK's status for a refusal in onAuth.
    expect(infoOf(s).error!.supportCode).toMatch(/^emailNotVerified-\d+$/);
    expect(s.tracked).toEqual([
      { name: 'matchmaking_wait', props: { sec: expect.any(Number), result: 'error' } },
    ]);
  }, 20_000);
});
