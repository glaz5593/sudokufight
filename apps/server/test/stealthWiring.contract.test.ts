/**
 * The stealth bot as createAppServer wires it (app.ts serverStealth; stealth-bot.md §4, §7, §8) [D90], against
 * the app's own matchmaking code: its MatchmakingClient (net/matchmaking.ts, unchanged since 1.0.3), and the
 * OnlineSession and RemoteGameHost whose ranked path is 1.0.3's (1.0.4 only added the friends room beside it).
 * So what a 1.0.3 phone does in a ranked search, against the new server.
 *
 * 1. The settings every server has today (loadConfig with no STEALTH_*: built OFF). Two apps find each other,
 *    count down and play a game to the end, rated, stored as a game between people, and each one's pace stored
 *    (the yardstick a stealth bot would be built from, once on). A lonely search is told "nobody else is
 *    searching" and times out, as before: no persona is ever made or seated. The admin site has no switch.
 * 2. STEALTH_BOT_ENABLED=true, the admin switch never turned (no row: off): still nobody but people. The admin
 *    turns it on through the admin API: the next lonely search, after the drawn wait, is "found" by a persona
 *    (made in the database), whose seat connects by itself and plays; the app plays the game to the end, rated;
 *    the game is marked stealth, the persona keeps no pace. The admin turns it off: the next lonely search times
 *    out again. No restart either way: one switch for matchmaking and the admin API.
 *
 * Timings are scaled as in appMatchmaking.contract.test.ts (a 3 s timeout); the stealth wait is 300 ms.
 */
import type { AddressInfo } from 'node:net';

import { Client } from '@colyseus/sdk';
import { type Digit, type GameType, INTERFERENCE_KINDS } from '@sudoku-fight/engine';
import {
  ADMIN_API_PREFIX,
  ADMIN_STEALTH_PATH,
  ADMIN_STEALTH_SWITCH_PATH,
  type AdminStealthSwitch,
  type AdminStealthSwitchResult,
  devToken,
  MATCH_RANGE,
  MATCH_TIMEOUT_MS,
  type MatchRangeRules,
  type QueueKey,
} from '@sudoku-fight/protocol';
import { eq, inArray } from 'drizzle-orm';

// The app's code (pure TypeScript, no React Native): what the phone runs.
import { createAccountApi } from '../../mobile/src/api/accountApi';
import { OnlineSession } from '../../mobile/src/game/onlineSession';
import {
  createMatchmakingConnector,
  MatchmakingClient,
  type MatchmakingInfo,
} from '../../mobile/src/net/matchmaking';
import { createOnlineClient } from '../../mobile/src/net/onlineClient';
import { RemoteGameHost } from '../../mobile/src/net/remoteGameHost';
import { createAppServer } from '../src/app';
import { loadConfig, type ServerConfig } from '../src/config';
import { gamePlayers, games, puzzleHistory, users } from '../src/db/schema';
import type { GamePuzzle } from '../src/game/puzzles';
import { DEFAULT_MATCHER } from '../src/matchmaking';
import { type BankPuzzle, seedRankedPuzzles } from '../src/puzzles';
import { paceHistoryOf } from '../src/stealth/pace';
import { adminLogin, createTestDb, PUZZLE, quietLog, testConfig, type TestDb } from '../src/testing';
import { solveGivens } from '../src/testing/fakeClient';

// ---------------------------------------------------------------------------------------------------------
// Scaled timings (appMatchmaking.contract.test.ts's)

const SCALE = 20;
const RANGE: MatchRangeRules = { ...MATCH_RANGE, stepMs: MATCH_RANGE.stepMs / SCALE };
const TIMEOUT_MS = MATCH_TIMEOUT_MS / SCALE;

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
  source: 'stealthWiring.contract',
  pool: 'ranked',
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---------------------------------------------------------------------------------------------------------
// A server, as createAppServer makes it

interface AppServer {
  url: string;
  db: TestDb;
  close(): Promise<void>;
}

const log = quietLog();

/** testConfig with the stealth bot's settings exactly as loadConfig reads them from `env`. */
function configWith(env: Record<string, string>): ServerConfig {
  const loaded = loadConfig({ NODE_ENV: 'test', ...env }, { warn: () => undefined });
  return testConfig({ stealth: loaded.stealth });
}

async function startServer(config: ServerConfig, prefix: string): Promise<AppServer> {
  const db = await createTestDb();
  await seedRankedPuzzles(db.db, [
    bankPuzzle(nearlyDone(`${prefix}-fast-1`, [0, 13, 40, 80, 22, 57]), 'fast'),
    bankPuzzle(nearlyDone(`${prefix}-fast-2`, [1, 14, 41, 79, 23, 58]), 'fast'),
    bankPuzzle(nearlyDone(`${prefix}-fast-3`, [2, 15, 42, 78, 24, 59]), 'fast'),
  ]);
  const server = createAppServer({
    gracefullyShutdown: false,
    config,
    db,
    game: { log, closeAfterGameMs: 500 },
    matchmaking: {
      config: {
        tickMs: 25,
        matcher: { ...DEFAULT_MATCHER, range: RANGE, timeoutMs: TIMEOUT_MS },
        extendedTimeoutMs: TIMEOUT_MS,
        keepSearchingWindowMs: 2000,
        readyTimeoutMs: 4000,
        countdownMs: 300,
      },
    },
  });
  await server.listen(0);
  return {
    url: `http://127.0.0.1:${(server.transport.server!.address() as AddressInfo).port}`,
    db,
    close: async () => {
      await server.gracefullyShutdown(false);
      server.transport.server?.closeAllConnections();
      await db.close();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// The phone (appMatchmaking.contract.test.ts's)

const clock = { now: () => Date.now() };
const scheduler = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const clients = new Set<MatchmakingClient<OnlineSession>>();
const sessions = new Set<OnlineSession>();

afterEach(() => {
  for (const c of clients) c.close();
  for (const s of sessions) s.close();
  clients.clear();
  sessions.clear();
});

async function account(url: string, name: string) {
  const token = devToken(`wiring-${name.toLowerCase()}`);
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

function search(url: string, who: Account, queue: QueueKey = 'fast-2p') {
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
          log: () => undefined,
          options: { pingEveryMs: 400 },
        }),
        request: { kind: 'match', queueKey: queue, matchId: found.matchId, reservation: found.reservation },
        track: () => undefined,
      });
      sessions.add(session);
      return session;
    },
    clock,
    scheduler,
    track: () => undefined,
    log: () => undefined,
  });
  /** Every `search.nextRange` the app was told (undefined: left out). */
  const nextRanges: (number | null | undefined)[] = [];
  client.subscribe((info) => {
    if (info.phase === 'searching' && info.search) nextRanges.push(info.search.nextRange);
  });
  clients.add(client);
  void client.start();
  return { client, nextRanges };
}

const infoOf = (s: { client: MatchmakingClient<OnlineSession> }): MatchmakingInfo => s.client.info;

async function until(done: () => boolean | Promise<boolean>, what: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await done())) {
    if (Date.now() > end) throw new Error(`no ${what} within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

/** Plays like a person through the GameHost interface: lock an empty cell nobody holds, then its answer. */
function drive(host: RemoteGameHost, everyMs = 80): () => void {
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

/** A lonely search: "nobody else is searching" (nextRange null), then the timeout; never "found". */
async function searchesAlone(url: string, who: Account): Promise<void> {
  const s = search(url, who);
  await until(() => infoOf(s).phase === 'searching', 'the search');
  await until(() => infoOf(s).phase === 'timeout', 'the timeout', TIMEOUT_MS + 3000);
  expect(s.nextRanges.length).toBeGreaterThan(0);
  expect(s.nextRanges.every((n) => n === null)).toBe(true);
  expect(infoOf(s).timeout).toMatchObject({ nextRange: null });
  expect(infoOf(s).match).toBeNull();
  expect(s.client.cancel()).toBe(true);
}

/** A signed-in admin's GET and POST of the stealth bot's switch (the admin site's calls). */
async function adminOf(url: string) {
  // The server logs each admin sign-in (createAppServer's default log).
  const quiet = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  const { cookie } = await adminLogin(url).finally(() => quiet.mockRestore());
  const api = `${url}${ADMIN_API_PREFIX}`;
  return {
    async get(): Promise<{ status: number; body: AdminStealthSwitch }> {
      const res = await fetch(`${api}${ADMIN_STEALTH_PATH}`, { headers: { cookie } });
      return { status: res.status, body: (await res.json()) as AdminStealthSwitch };
    },
    async set(on: boolean): Promise<{ status: number; body: AdminStealthSwitchResult & { error?: string } }> {
      const res = await fetch(`${api}${ADMIN_STEALTH_SWITCH_PATH}`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ on }),
      });
      return {
        status: res.status,
        body: (await res.json()) as AdminStealthSwitchResult & { error?: string },
      };
    },
  };
}

const personaCount = async (db: TestDb) =>
  (await db.db.select({ id: users.id }).from(users).where(eq(users.kind, 'persona'))).length;

// ---------------------------------------------------------------------------------------------------------

describe('the default settings: the stealth bot is off (built OFF) [D90]', () => {
  let app: AppServer;
  beforeAll(async () => {
    const config = configWith({});
    expect(config.stealth).toMatchObject({ enabled: false });
    app = await startServer(config, 'off');
  }, 30_000);
  afterAll(() => app.close(), 30_000);

  it('two 1.0.3 apps meet and play to the end, rated, a game between people; each one’s pace stored', async () => {
    const [ana, ben] = await Promise.all([account(app.url, 'AnaOff'), account(app.url, 'BenOff')]);
    const a = search(app.url, ana);
    await until(() => infoOf(a).phase === 'searching', 'the first search');
    const b = search(app.url, ben);
    await until(() => [a, b].every((s) => infoOf(s).phase === 'started' && infoOf(s).hasGame), 'GO');
    const [sa, sb] = [a.client.entry!, b.client.entry!];
    expect(
      infoOf(a)
        .match!.players.map((p) => p.id)
        .sort(),
    ).toEqual([ana.me.id, ben.me.id].sort());
    expect(sa.host.game!.config.rules.interferenceKinds).toEqual([...INTERFERENCE_KINDS]);
    const stops = [drive(sa.host, 80), drive(sb.host, 200)];
    await until(() => [sa, sb].every((s) => s.getView().status === 'over'), 'the end', 30_000);
    stops.forEach((stop) => stop());
    expect(sa.getView().result!.reason).toBe('boardComplete');
    expect(sa.getView().result!.ratingChanges).toHaveLength(2);

    // Stored as a ranked game between people, with each one's pace [D96].
    await until(async () => {
      const [g] = await app.db.db.select().from(games);
      return g?.endedAt != null;
    }, 'the stored result');
    const [game] = await app.db.db.select().from(games);
    expect(game).toMatchObject({ mode: 'ranked', stealth: false });
    const seats = await app.db.db.select().from(gamePlayers).where(eq(gamePlayers.gameId, game!.id));
    expect(seats).toHaveLength(2);
    for (const seat of seats) {
      expect(seat.paceMs).toEqual(expect.any(Number));
      expect(seat.paceMoves).toBeGreaterThan(0);
      expect(seat.paceDigits).toBeGreaterThanOrEqual(seat.paceMoves!);
    }
    // What the next stealth bot against Ana would be built from (stealth/pace.ts): this game.
    const history = await paceHistoryOf(app.db.db, ana.me.id, 'fast');
    expect(history.games).toEqual([
      expect.objectContaining({
        gameType: 'fast',
        paceMs: seats.find((s) => s.userId === ana.me.id)!.paceMs,
      }),
    ]);
    expect(history.stealthWins).toEqual([]);
    expect(await personaCount(app.db)).toBe(0);
  }, 60_000);

  it('a lonely 1.0.3 search: "nobody else is searching", then the timeout; no persona made', async () => {
    await searchesAlone(app.url, await account(app.url, 'SoloOff'));
    expect(await personaCount(app.db)).toBe(0);
  }, 20_000);

  it('the admin site has no switch: GET says not enabled, and turning it answers 409 stealthDisabled', async () => {
    const admin = await adminOf(app.url);
    expect(await admin.get()).toEqual({
      status: 200,
      body: { enabled: false, on: false, changedAt: null, changedBy: null },
    });
    const turned = await admin.set(true);
    expect([turned.status, turned.body.error]).toEqual([409, 'stealthDisabled']);
    expect((await admin.get()).body.on).toBe(false);
  });
});

describe('STEALTH_BOT_ENABLED=true: the admin switch decides, with no restart [D90, D94]', () => {
  let app: AppServer;
  beforeAll(async () => {
    const config = configWith({ STEALTH_BOT_ENABLED: 'true', STEALTH_BOT_AFTER_MS: '300' });
    expect(config.stealth).toMatchObject({ enabled: true, afterMs: { min: 300, max: 300 } });
    app = await startServer(config, 'on');
  }, 30_000);
  afterAll(() => app.close(), 30_000);

  it('never turned (no row): off, as on any server today', async () => {
    const admin = await adminOf(app.url);
    expect((await admin.get()).body).toEqual({ enabled: true, on: false, changedAt: null, changedBy: null });
    await searchesAlone(app.url, await account(app.url, 'SoloOn'));
    expect(await personaCount(app.db)).toBe(0);
  }, 20_000);

  it('turned on: a lonely search is found by a persona that plays; turned off: alone again', async () => {
    const admin = await adminOf(app.url);
    const on = await admin.set(true);
    expect(on.status).toBe(200);
    expect(on.body.switch).toMatchObject({ enabled: true, on: true });
    expect(on.body.audit).toMatchObject({ action: 'stealthSwitch' });

    const cy = await account(app.url, 'CyOn');
    const s = search(app.url, cy);
    await until(() => infoOf(s).phase === 'started' && infoOf(s).hasGame, 'GO against a persona', 15_000);
    // [D95] While a persona was within reach, "nobody else is searching" was never said.
    expect(s.nextRanges).not.toContain(null);
    const opponent = infoOf(s).match!.players.find((p) => p.id !== cy.me.id)!;
    expect(opponent.id).toMatch(UUID);
    expect(opponent).toMatchObject({ rating: 1200, provisional: true });
    const entry = s.client.entry!;
    // The room's kinds are the app's own: the persona declared them all [D47].
    expect(entry.host.game!.config.rules.interferenceKinds).toEqual([...INTERFERENCE_KINDS]);
    expect(JSON.stringify(entry.host.game!.config)).not.toMatch(/isBot|persona|stealth/i);

    const stop = drive(entry.host, 80);
    await until(() => entry.getView().status === 'over', 'the end', 45_000);
    stop();
    expect(entry.getView().result!.reason).toBe('boardComplete');
    // Rated as any ranked game [D92].
    const rated = entry.getView().result!.ratingChanges.map((c) => c.playerId);
    expect(rated.sort()).toEqual([cy.me.id, opponent.id].sort());

    // Stored: a stealth game; the persona's account is of kind 'persona', keeps no pace and no puzzle history.
    await until(async () => {
      const [g] = await app.db.db.select().from(games);
      return g?.endedAt != null;
    }, 'the stored result');
    const [game] = await app.db.db.select().from(games);
    expect(game).toMatchObject({ mode: 'ranked', stealth: true });
    const [persona] = await app.db.db.select().from(users).where(eq(users.id, opponent.id));
    expect(persona).toMatchObject({ kind: 'persona', displayName: opponent.name });
    const seats = await app.db.db.select().from(gamePlayers).where(eq(gamePlayers.gameId, game!.id));
    expect(seats.find((x) => x.userId === opponent.id)).toMatchObject({ paceMs: null, paceMoves: null });
    expect(seats.find((x) => x.userId === cy.me.id)!.paceMs).toEqual(expect.any(Number));
    const histories = await app.db.db
      .select({ userId: puzzleHistory.userId })
      .from(puzzleHistory)
      .where(inArray(puzzleHistory.userId, [cy.me.id, opponent.id]));
    expect(histories.map((h) => h.userId)).toEqual([cy.me.id]);
    s.client.close();

    // Turned off (no restart): the next lonely search is alone again, and no other persona is made.
    const off = await admin.set(false);
    expect(off.body.switch).toMatchObject({ enabled: true, on: false });
    await searchesAlone(app.url, await account(app.url, 'DanOn'));
    expect(await personaCount(app.db)).toBe(1);
  }, 90_000);
});
