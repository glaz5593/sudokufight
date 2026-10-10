/**
 * The contract between the app's usage reports and this server (spec §27.1–§27.3), end to end: the app's own
 * telemetry client (track → queue → batches → sender, the very modules the phone runs) sends to the real
 * server (Colyseus + Express + an in-memory PGlite, one port), and the admin site's numbers show what the app
 * reported.
 *
 * - The events are the app's: app_open, a screen_view for every route in apps/mobile/app (by the app's own
 *   screenOf), game_start / game_end with the props the app builds (src/game/analyticsProps) from real engine
 *   games, and props too big for the contract, which the app cuts down.
 * - Every batch is taken (202, never 400). A batch whose answer was lost is sent again, and the server counts
 *   its events as duplicates. A phone offline for days keeps the newest events up to the queue's cap.
 * - The admin's overview and screens count exactly that.
 *
 * Only the React Native wiring (services/telemetry/index.ts: AppState, expo-sqlite, Platform) is left out.
 * The phone's timers are frozen but for the request timeout: the test triggers every send itself.
 */
import { readdirSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import {
  botPlayer,
  defaultRules,
  type GameConfig,
  type GameMode,
  type GameResult,
  type GameType,
  INTERFERENCE_KINDS,
  LocalGameHost,
  ManualClock,
  ManualScheduler,
  type PlayerInfo,
  REACTIONS,
} from '@sudoku-fight/engine';
import {
  type AdminInstallRow,
  type AdminOverview,
  type AdminPage,
  type AdminScreens,
  MAX_BATCH_BYTES,
  MAX_EVENTS_PER_BATCH,
  MAX_PROPS_BYTES,
  TELEMETRY_PATH,
  type TelemetryBatch,
  type TelemetryEventName,
  type TelemetryProps,
  type TelemetryResponse,
} from '@sudoku-fight/protocol';
import { asc, eq } from 'drizzle-orm';

// The app's code (pure TypeScript, no React Native): what the phone runs.
import { gameEndProps, gameStartProps } from '../../mobile/src/game/analyticsProps';
import { type BatchMeta, cleanAppVersion, sanitizeProps } from '../../mobile/src/services/telemetry/batching';
import { createTelemetryClient, type TelemetryClient } from '../../mobile/src/services/telemetry/client';
import type { TelemetryStore } from '../../mobile/src/services/telemetry/queue';
import { screenOf } from '../../mobile/src/services/telemetry/screens';
import { type FetchLike, REQUEST_TIMEOUT_MS, type Timers } from '../../mobile/src/services/telemetry/sender';
import { isUuid, uuidV4 } from '../../mobile/src/services/telemetry/uuid';
import { createAppServer } from '../src/app';
import { SAMPLE_FUTURE_SCREENS, SAMPLE_SCREENS } from '../src/seed/sampleData';
import { appEvents, installs } from '../src/db/schema';
import {
  createTestDb,
  digitAt,
  emptyCells,
  fakeClock,
  NEARLY_DONE,
  PUZZLE,
  signedInAdmin,
  type TestDb,
  testConfig,
} from '../src/testing';

const T = Date.UTC(2026, 9, 9, 12); // 15:00 in Jerusalem: every event below is "today" or within the week
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;

const MOBILE = path.resolve(__dirname, '../../mobile');
const APP_VERSION = cleanAppVersion(
  (JSON.parse(readFileSync(path.join(MOBILE, 'app.json'), 'utf8')) as { expo: { version: string } }).expo
    .version,
);

// ---- the server ------------------------------------------------------------------------------------------

const clock = fakeClock(T);
let db: TestDb;
let server: ReturnType<typeof createAppServer>;
let url = '';

beforeAll(async () => {
  db = await createTestDb();
  server = createAppServer({ gracefullyShutdown: false, config: testConfig(), db, now: clock.now });
  await server.listen(0);
  url = `http://127.0.0.1:${(server.transport.server!.address() as AddressInfo).port}`;
}, 30_000);

const clients: TelemetryClient[] = [];
afterAll(async () => {
  clients.forEach((c) => c.stop());
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  await db.close();
  // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
  await new Promise((r) => setTimeout(r, 1100));
});

// ---- the phone -------------------------------------------------------------------------------------------

/** What went over the wire, request by request: the body, and the answer the server gave. */
interface Exchange {
  body: string;
  events: number;
  status: number;
  answer: unknown;
}

/**
 * The phone's network: the real fetch, recorded. `offline`: fails before reaching the server. `loseAnswers`:
 * the next N requests reach the server, but their answers never come back (the phone sees a network error).
 */
function phoneNetwork() {
  const exchanges: Exchange[] = [];
  const net = {
    offline: false,
    loseAnswers: 0,
    exchanges,
    fetch: (async (target, init) => {
      if (net.offline) throw new TypeError('Network request failed');
      const res = await fetch(target, init);
      const text = await res.text();
      exchanges.push({
        body: init.body,
        events: (JSON.parse(init.body) as TelemetryBatch).events.length,
        status: res.status,
        answer: text === '' ? null : JSON.parse(text),
      });
      if (net.loseAnswers > 0) {
        net.loseAnswers--;
        throw new TypeError('Network request failed');
      }
      return { status: res.status, headers: res.headers, text: () => Promise.resolve(text) };
    }) as FetchLike,
  };
  return net;
}

/** The queue's disk, in memory: what was saved stays for the next run. */
function memoryStore(): TelemetryStore {
  const saved = new Map<string, TelemetryBatch['events'][number]>();
  return {
    load: () => Promise.resolve([...saved.values()]),
    save: ({ added, removed }) => {
      removed.forEach((id) => saved.delete(id));
      added.forEach((e) => saved.set(e.id, e));
      return Promise.resolve();
    },
  };
}

/** Only the request timeout runs; ticks, disk writes and retries wait for the test to call flush(). */
const frozenTimers: Timers = {
  setTimeout: (callback, ms) => (ms === REQUEST_TIMEOUT_MS ? setTimeout(callback, ms) : null),
  clearTimeout: (handle) => {
    if (handle !== null) clearTimeout(handle as NodeJS.Timeout);
  },
};

/** A phone running the app's telemetry client, with a clock the test sets. */
function phone(platform: BatchMeta['platform'], queueCap?: number) {
  const meta: BatchMeta = { installId: uuidV4(), platform, appVersion: APP_VERSION };
  const net = phoneNetwork();
  const p = {
    meta,
    net,
    now: T,
    /** What the app tracked, in order (name, props as given, time). */
    tracked: [] as { name: TelemetryEventName; props: TelemetryProps; t: number }[],
    client: null as unknown as TelemetryClient,
    /** track() at the phone's time `t`. */
    track(t: number, name: TelemetryEventName, props: TelemetryProps = {}) {
      p.now = t;
      p.tracked.push({ name, props, t });
      p.client.track(name, props);
    },
  };
  p.client = createTelemetryClient({
    openStore: () => Promise.resolve(memoryStore()),
    url: `${url}${TELEMETRY_PATH}`,
    meta: () => meta,
    fetch: net.fetch,
    now: () => p.now,
    random: () => 0, // the shortest backoff: 2.5 s after a first failure
    timers: frozenTimers,
    appState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
    newId: () => uuidV4(),
    ...(queueCap === undefined ? {} : { queueCap }),
  });
  clients.push(p.client);
  return p;
}

// ---- the app's screens and games -------------------------------------------------------------------------

/** apps/mobile/app's routes as expo-router's segments ('results/[id].tsx' → ['results', '[id]']). */
function appRoutes(dir = path.join(MOBILE, 'app'), parent: string[] = []): string[][] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return appRoutes(path.join(dir, entry.name), [...parent, entry.name]);
    const name = entry.name.replace(/\.(tsx?|jsx?)$/, '');
    if (name === entry.name || name.startsWith('_')) return []; // not a route file, or a layout
    return [[...parent, name]];
  });
}

/** A real game in the engine: solo on a nearly finished board, solved; against a bot, surrendered. */
function playGame(mode: Extract<GameMode, 'solo' | 'bot'>): {
  type: GameType;
  players: number;
  result: GameResult;
} {
  const type: GameType = mode === 'solo' ? 'normal' : 'fast';
  const puzzle = mode === 'solo' ? NEARLY_DONE : PUZZLE;
  const players: PlayerInfo[] = mode === 'solo' ? [{ id: 'me' }] : [{ id: 'me' }, botPlayer(3)];
  const config: GameConfig = {
    id: `contract-${mode}`,
    mode,
    gameType: type,
    puzzle,
    players,
    rules: defaultRules(mode, type),
    seed: 7,
  };
  const gameClock = new ManualClock(T);
  const scheduler = new ManualScheduler(gameClock);
  const host = new LocalGameHost({ config, playerId: 'me', clock: gameClock, scheduler });
  if (mode === 'solo') {
    for (const cell of emptyCells(puzzle)) {
      scheduler.advance(1200);
      host.select(cell);
      host.place(cell, digitAt(puzzle, cell));
    }
  } else {
    scheduler.advance(30 * SECOND);
    host.surrender();
  }
  const { result } = host.state;
  if (!result) throw new Error(`the ${mode} game did not end`);
  host.close();
  return { type, players: players.length, result };
}

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
const sorted = <V>(entries: [string, V][]) => entries.sort(([a], [b]) => a.localeCompare(b));

// ---- the reports -----------------------------------------------------------------------------------------

const routes = appRoutes();
const screens = routes.map((segments) => ({ segments, screen: screenOf(segments) }));
const gameScreens = screens.flatMap((s) => (s.screen === null ? [] : [s.screen]));

type Phone = ReturnType<typeof phone>;
/** A player's evening (install A, Android): every screen of the app, a solo practice and one against a bot. */
let android: Phone;
/** A phone offline for three days (install B, iOS), with a queue capped at 300: its oldest events go. */
let iphone: Phone;
const IPHONE_CAP = 300;
beforeAll(() => {
  // After the server's beforeAll: the clients send to its URL.
  android = phone('android');
  iphone = phone('ios', IPHONE_CAP);
});

describe("the app's routes", () => {
  it('the app has routes, and screenOf names each by its pattern; the dev tools are not screens', () => {
    expect(gameScreens).toEqual(expect.arrayContaining(['/', '/game', '/results/[id]', '/settings']));
    for (const { segments, screen } of screens) {
      if (segments[0] === 'dev') expect(screen).toBeNull();
      else expect(screen).toBe(`/${segments.filter((s) => s !== 'index').join('/')}`);
    }
    expect(screens.some((s) => s.segments[0] === 'dev')).toBe(true);
    expect(new Set(gameScreens).size).toBe(gameScreens.length);
  });

  it('the sample data (npm run seed) names screens as the app does: each one an app route, or a future one', () => {
    const sample: string[] = Object.values(SAMPLE_SCREENS);
    expect(sample.filter((s) => !gameScreens.includes(s))).toEqual([...SAMPLE_FUTURE_SCREENS]);
  });

  it("the app's telemetry modules this test runs import nothing from React Native or Expo", () => {
    const files = [
      'src/services/telemetry/batching.ts',
      'src/services/telemetry/client.ts',
      'src/services/telemetry/queue.ts',
      'src/services/telemetry/screens.ts',
      'src/services/telemetry/sender.ts',
      'src/services/telemetry/uuid.ts',
      'src/game/analyticsProps.ts',
      'src/game/outcome.ts',
    ];
    // Each import is one of these files, or the protocol and the engine (pure themselves).
    const allowed = (from: string, spec: string) =>
      spec === '@sudoku-fight/protocol' ||
      spec === '@sudoku-fight/engine' ||
      (spec.startsWith('.') && files.includes(`${path.posix.join(path.posix.dirname(from), spec)}.ts`));
    for (const file of files) {
      const source = readFileSync(path.join(MOBILE, file), 'utf8');
      const imports = [...source.matchAll(/(?:from|import) '([^']+)'/g)].map((m) => m[1]!);
      expect([file, imports.filter((spec) => !allowed(file, spec))]).toEqual([file, []]);
    }
  });
});

describe('the app reports to POST /v1/events', () => {
  const solo = playGame('solo');
  const bot = playGame('bot');

  it('install A: everything is taken (202); the batch whose answer was lost comes again, as duplicates', async () => {
    const { client, net } = android;
    // As the root layout does: start (loads the disk: empty), then app_open.
    client.start();
    expect(await client.flush()).toEqual({ sent: 0, dropped: 0, waitingUntil: null });

    // An evening, a minute apart: the menus, a solo practice, a game against a bot, then every other screen.
    let t = T - 90 * MINUTE;
    const next = () => (t += MINUTE);
    android.track(next(), 'app_open');
    const view = (screen: string) => android.track(next(), 'screen_view', { screen });
    ['/', '/modes', '/game-type', '/game'].forEach(view);
    android.track(next(), 'game_start', gameStartProps('solo', solo.type, solo.players));
    android.track(next(), 'game_end', gameEndProps('solo', solo.result, 'me'));
    ['/results/[id]', '/', '/modes', '/bot-select', '/game'].forEach(view);
    android.track(next(), 'game_start', gameStartProps('bot', bot.type, bot.players));
    android.track(next(), 'reaction_sent', { emoji: REACTIONS[0] });
    android.track(next(), 'interference_sent', { kind: INTERFERENCE_KINDS[0], cost: 8 });
    android.track(next(), 'game_end', gameEndProps('bot', bot.result, 'me'));
    view('/results/[id]');
    gameScreens.filter((s) => !android.tracked.some((e) => e.props.screen === s)).forEach(view);
    view('/');
    const count = android.tracked.length;
    expect(count).toBeLessThan(50); // under the client's own trigger: the test sends

    // The answer to the first batch is lost on the way back: the phone keeps the events and backs off…
    net.loseAnswers = 1;
    android.now = T - 10 * MINUTE;
    expect(await client.flush()).toEqual({ sent: 0, dropped: 0, waitingUntil: android.now + 2500 });
    expect(client.queue.size).toBe(count);
    // …sends nothing while it waits…
    expect(await client.flush()).toMatchObject({ sent: 0, waitingUntil: android.now + 2500 });
    expect(net.exchanges).toHaveLength(1);
    // …then sends them again: the server had them all.
    android.now += 2500;
    expect(await client.flush()).toEqual({ sent: count, dropped: 0, waitingUntil: null });
    expect(client.queue.size).toBe(0);
    expect(net.exchanges.map((x) => [x.status, x.answer])).toEqual([
      [202, { accepted: count, duplicates: 0 } satisfies TelemetryResponse],
      [202, { accepted: 0, duplicates: count } satisfies TelemetryResponse],
    ]);
  });

  it('install A: the server stored each event once, with the props the app built', async () => {
    const rows = await db.db
      .select()
      .from(appEvents)
      .where(eq(appEvents.installId, android.meta.installId))
      .orderBy(asc(appEvents.tClient));
    expect(rows.map((r) => ({ name: r.name, props: r.props, t: r.tClient.getTime() }))).toEqual(
      android.tracked,
    );
    expect(rows.every((r) => isUuid(r.id) && r.userId === null)).toBe(true);
    expect(rows.find((r) => r.name === 'game_end' && r.props.mode === 'solo')?.props).toEqual({
      mode: 'solo',
      result: 'completed',
      score: solo.result.ranking[0]!.score,
      mistakes: 0,
      durationSec: Math.round(solo.result.durationMs / 1000),
    });
    expect(rows.find((r) => r.name === 'game_end' && r.props.mode === 'bot')?.props).toMatchObject({
      result: 'loss',
    });
  });

  it('install B, offline for days: keeps the newest up to the cap, cuts props too big, sends it all in batches', async () => {
    const { client, net } = iphone;
    net.offline = true;
    iphone.now = T - 3 * DAY;
    client.start();
    await client.flush();

    // Three days ago, 10 s apart: browsing the history, then replays with props far over 2 KB (a bug).
    let t = T - 3 * DAY;
    const next = () => (t += 10 * SECOND);
    iphone.track(next(), 'app_open');
    iphone.track(next(), 'screen_view', { screen: '/' });
    for (let i = 0; i < 360; i++)
      iphone.track(next(), 'screen_view', { screen: i % 2 === 0 ? '/history' : '/results/[id]' });
    const huge = { source: 'history', note: 'ש'.repeat(3000), emoji: '🎆'.repeat(400), ok: true };
    for (let i = 0; i < 40; i++) iphone.track(next(), 'replay_open', { ...huge, i });
    await client.flush();
    expect(net.exchanges).toHaveLength(0);
    expect(client.queue.size).toBe(IPHONE_CAP);

    // Back online an hour ago: the whole queue goes in one flush, in batches the server takes.
    net.offline = false;
    iphone.now = T - 60 * MINUTE;
    expect(await client.flush()).toEqual({ sent: IPHONE_CAP, dropped: 0, waitingUntil: null });
    expect(client.queue.size).toBe(0);
    expect(net.exchanges.length).toBeGreaterThanOrEqual(4); // 300 events, 40 of them ~2 KB: split by size too
    for (const x of net.exchanges) {
      expect([x.status, x.answer]).toEqual([202, { accepted: x.events, duplicates: 0 }]);
      expect(bytes(x.body)).toBeLessThanOrEqual(MAX_BATCH_BYTES);
      expect(x.events).toBeLessThanOrEqual(MAX_EVENTS_PER_BATCH);
    }

    // Stored: exactly the newest 300, the big props cut by the app's own rule (to 2 KB, with "…").
    const kept = iphone.tracked.slice(-IPHONE_CAP);
    const rows = await db.db
      .select()
      .from(appEvents)
      .where(eq(appEvents.installId, iphone.meta.installId))
      .orderBy(asc(appEvents.tClient));
    expect(rows.map((r) => ({ name: r.name, props: r.props, t: r.tClient.getTime() }))).toEqual(
      kept.map((e) => ({ ...e, props: sanitizeProps(e.props) })),
    );
    const replay = rows.find((r) => r.name === 'replay_open')!;
    expect(bytes(JSON.stringify(replay.props))).toBeLessThanOrEqual(MAX_PROPS_BYTES);
    expect(replay.props).toMatchObject({ source: 'history', ok: true, i: 0 });
    expect(String(replay.props.note)).toMatch(/^ש+…$/);
  });

  it('a batch sent again, as it was, is counted as duplicates and changes nothing', async () => {
    const before = (await db.db.select({ id: appEvents.id }).from(appEvents)).length;
    for (const x of [...android.net.exchanges.slice(0, 1), ...iphone.net.exchanges]) {
      const res = await fetch(`${url}${TELEMETRY_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: x.body,
      });
      expect([res.status, await res.json()]).toEqual([202, { accepted: 0, duplicates: x.events }]);
    }
    const after = (await db.db.select({ id: appEvents.id }).from(appEvents)).length;
    expect(after).toBe(before);
    expect(after).toBe(android.tracked.length + IPHONE_CAP);
  });
});

describe('the admin site shows what the app reported', () => {
  const total = () => android.tracked.length + IPHONE_CAP;
  const reported = () => [
    ...android.tracked.map((e) => ({ ...e, install: 'A' })),
    ...iphone.tracked.slice(-IPHONE_CAP).map((e) => ({ ...e, install: 'B' })),
  ];

  it('the overview: two installs, active today, their events, and the two practice games', async () => {
    const { status, body } = await (await signedInAdmin(url)).get<AdminOverview>('/overview', { days: 7 });
    expect(status).toBe(200);
    expect(body.totals).toEqual({ installs: 2, users: 0, games: 0, practiceGames: 2, events: total() });
    // B's events are three days old: active this week, not today.
    expect([body.activeToday, body.activeThisWeek]).toEqual([1, 2]);
    expect(body.practicePerDay.find((d) => d.day === '2026-10-09')?.count).toBe(2);
  });

  it('the installs: each with its platform, the app version, and when it was last seen', async () => {
    const { body } = await (await signedInAdmin(url)).get<AdminPage<AdminInstallRow>>('/installs');
    const row = (p: typeof android) => body.items.find((i) => i.id === p.meta.installId);
    expect(row(android)).toMatchObject({
      platform: 'android',
      appVersion: APP_VERSION,
      events: android.tracked.length,
      lastSeen: android.tracked.at(-1)!.t,
    });
    expect(row(iphone)).toMatchObject({
      platform: 'ios',
      appVersion: APP_VERSION,
      events: IPHONE_CAP,
      firstSeen: iphone.tracked.at(-IPHONE_CAP)!.t,
    });
    const [stored] = await db.db.select().from(installs).where(eq(installs.id, iphone.meta.installId));
    expect(stored?.userId).toBeNull();
  });

  it("the screens: every screen of the app by its pattern, with each install's views; no dev tools", async () => {
    const { body } = await (await signedInAdmin(url)).get<AdminScreens>('/screens', { days: 7 });
    const views = new Map<string, { views: number; installs: Set<string> }>();
    for (const e of reported()) {
      if (e.name !== 'screen_view') continue;
      const s = views.get(String(e.props.screen)) ?? { views: 0, installs: new Set<string>() };
      s.views++;
      s.installs.add(e.install);
      views.set(String(e.props.screen), s);
    }
    expect(sorted(body.screens.map((s) => [s.screen, [s.views, s.installs]]))).toEqual(
      sorted([...views].map(([screen, s]) => [screen, [s.views, s.installs.size]])),
    );
    expect(body.screens.map((s) => s.screen)).toEqual(expect.arrayContaining(gameScreens));
    expect(body.screens.some((s) => s.screen.startsWith('/dev'))).toBe(false);
    // One session each (no 30-minute gap), ending on its last screen.
    expect(body.sessions).toBe(2);
    expect(body.screens.find((s) => s.screen === '/')?.exits).toBe(1); // A ended at home
    expect(body.screens.find((s) => s.screen === '/results/[id]')?.exits).toBe(1); // B on its last results
  });
});
