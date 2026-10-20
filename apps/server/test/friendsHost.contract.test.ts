/**
 * Playing with friends (1.0.4; docs/handoff/2026-10-19/friends-room.md), end to end across the lanes: the app's
 * own friends code (apps/mobile/src/net/friends.ts with its HTTP routes, api/roomsApi.ts; RemoteGameHost and
 * OnlineSession, pure TypeScript, the very code the phone runs; only the React Native wiring and the screens
 * are left out) against the real server in production (Colyseus + Express + an in-memory PGlite, one port,
 * real accounts with Firebase-style tokens). Each side has its own tests; this one checks that they agree.
 *
 * - "צור חדר" and "הצטרף עם קוד" (the code as typed, or picked out of a whole share message): the room as the
 *   screens draw it (seats with their cards, host, who may start), its 6-digit code (never the room's id), the
 *   host's commands and the server's refusals, the 3… 2… 1…, a whole game, no rating moved, and the history
 *   (GET /v1/me/games: a ranked game flagged `friends`).
 * - The app in the background in the lobby [D84a]: the seat is held, shown away to the others; the host must
 *   say yes to start without it [D83]; and back in the foreground, the one left out hears "gameStarted".
 * - Out of a room: a kick [D85a] and its way back refused; "יציאה מהחדר"; a closed room's code.
 * - The analytics the app sends on the way (generation 3, game_start/game_end with `friends`) all pass the
 *   server's own check of POST /v1/events, and never carry the code or an id.
 *
 * Its own file: Colyseus's matchmaker is one per process (one per Jest worker).
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import type { Digit } from '@sudoku-fight/engine';
import {
  ACCOUNT_PATHS,
  extractFriendCode,
  FRIEND_CODE_PATTERN,
  formatFriendCode,
  type Me,
  roomLink,
} from '@sudoku-fight/protocol';

// The app's code (pure TypeScript, no React Native): what the phone runs.
import { createRoomsApi } from '../../mobile/src/api/roomsApi';
import {
  type FriendsRequest,
  type FriendsSessionDeps,
  OnlineSession,
} from '../../mobile/src/game/onlineSession';
import {
  createFriendsRooms,
  type FriendsRooms,
  type FriendsRoomView,
  type FriendsStore,
} from '../../mobile/src/net/friends';
import { createOnlineClient } from '../../mobile/src/net/onlineClient';
import { type AppStateLike, RemoteGameHost } from '../../mobile/src/net/remoteGameHost';
import { createHistoryApi } from '../../mobile/src/screens/history/historyApi';
import { createAppServer } from '../src/app';
import { createTestDb, NEARLY_DONE, quietLog, testConfig, testPuzzles, type TestDb } from '../src/testing';
import { call, fighter } from '../src/testing/accounts';
import { solveGivens } from '../src/testing/fakeClient';
import { addPuzzles } from '../src/testing/ranked';
import { testTokens } from '../src/testing/tokens';
import { parseBatch } from '../src/telemetry/schema';

const COUNTDOWN_MS = 200;

let t: TestDb;
let server: ReturnType<typeof createAppServer>;
let httpUrl = '';
let wsUrl = '';
let hostPort = '';
const log = quietLog();

interface Account {
  token: string;
  me: Me;
}
const accounts = new Map<string, Account>();

beforeAll(async () => {
  t = await createTestDb();
  // The ranked pool (a friends game's puzzles come from it): a game four moves from the end, of each type.
  for (const gameType of ['fast', 'normal', 'hard'] as const)
    await addPuzzles(t.db, [{ ...NEARLY_DONE, id: `nearly-done-${gameType}` }], { gameType });
  const tokens = await testTokens();
  server = createAppServer({
    gracefullyShutdown: false,
    config: testConfig({ nodeEnv: 'production' }),
    db: t,
    tokens: tokens.verifier(Date.now, { devTokens: false }),
    game: { puzzles: testPuzzles, log, closeAfterGameMs: 300 },
    friends: { rules: { countdownMs: COUNTDOWN_MS } },
  });
  await server.listen(0);
  const port = (server.transport.server!.address() as AddressInfo).port;
  hostPort = `127.0.0.1:${port}`;
  httpUrl = `http://${hostPort}`;
  wsUrl = `ws://${hostPort}`;
  for (const name of ['Ana', 'Ben', 'Cy', 'Dan', 'Eve', 'Fay']) {
    const token = await tokens.sign(
      { uid: `fb-${name}`, email: `${name.toLowerCase()}@example.com`, emailVerified: true },
      Date.now(),
    );
    const res = await call<Me>(httpUrl, 'POST', ACCOUNT_PATHS.users, {
      token,
      body: fighter({ displayName: `${name}_Pal`, avatarId: 'noam', country: 'IL' }),
      headers: { connection: 'close' },
    });
    expect(res.status).toBe(201);
    accounts.set(name, { token, me: res.body });
  }
}, 30_000);

const phones = new Set<Phone>();
afterEach(() => {
  for (const p of phones) p.rooms.leave();
  phones.clear();
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
  server.transport.server?.closeAllConnections();
  await t.close();
  // Colyseus leaves ~1 s matchmaker timers that are not unref'd; let them run out.
  await new Promise((r) => setTimeout(r, 1100));
});

// ---- the phone ------------------------------------------------------------------------------------------

interface Tracked {
  name: string;
  props: Record<string, unknown>;
}

interface Phone {
  name: string;
  me: Me;
  rooms: FriendsRooms;
  /** Every analytics event the app's code sent (the room's, the session's and the connection's). */
  tracked: Tracked[];
  appState: AppStateLike & { set(state: string): void };
  /** The friends room as the screens draw it. */
  room(): FriendsRoomView | null;
  online(): OnlineSession | null;
}

function fakeAppState() {
  const listeners = new Set<(state: string) => void>();
  const appState: AppStateLike & { set(state: string): void } = {
    addEventListener: (_type, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    set: (state) => listeners.forEach((l) => l(state)),
  };
  return appState;
}

/** A phone signed in as `name`: the app's friends code wired as net/friendsDevice.ts wires it. */
function phone(name: string): Phone {
  const { token, me } = accounts.get(name)!;
  const tracked: Tracked[] = [];
  const track = (n: string, props: Record<string, unknown>) => tracked.push({ name: n, props });
  const appState = fakeAppState();
  const client = createOnlineClient({
    endpoint: wsUrl,
    identity: () => Promise.resolve({ kind: 'token', token }),
  });
  const makeHost = () =>
    new RemoteGameHost({
      client,
      clock: { now: () => Date.now() },
      scheduler: {
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      },
      appState,
      track,
      log: (line) => {
        if (process.env.FAKE_LOG) console.log(`[${name}] ${line}`);
      },
    });
  // The game store's part (game/gameStore.ts startFriends, clear), without React.
  let online: OnlineSession | null = null;
  const store: FriendsStore = {
    getOnline: () => online,
    startFriends(request: FriendsRequest, deps: FriendsSessionDeps) {
      online?.close();
      online = new OnlineSession({ host: deps.makeHost(), request, track, friends: { rejoin: deps.rejoin } });
      return online;
    },
    clear() {
      online?.close();
      online = null;
    },
  };
  const api = createRoomsApi({
    baseUrl: httpUrl,
    getToken: () => Promise.resolve(token),
    fetch: (target, init) => fetch(target, init),
    timeoutMs: 5000,
  });
  const rooms = createFriendsRooms({ api: () => api, store, makeHost, track });
  const p: Phone = { name, me, rooms, tracked, appState, room: () => rooms.room(), online: () => online };
  phones.add(p);
  return p;
}

/** Waits until `find()` gives something (checked every 10 ms). */
async function until<T>(find: () => T | null | undefined | false, what: string, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const found = find();
    if (found) return found;
    if (Date.now() > end) throw new Error(`no ${what} within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Waits until `find()` resolves to something (asked again every 25 ms). */
async function untilAsync<T>(find: () => Promise<T | null | undefined>, what: string, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const found = await find();
    if (found !== null && found !== undefined) return found;
    if (Date.now() > end) throw new Error(`no ${what} within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const inLobby = (p: Phone, test: (r: FriendsRoomView) => boolean = () => true) =>
  until(() => {
    const r = p.room();
    return r?.phase === 'lobby' && test(r) ? r : null;
  }, `${p.name}'s lobby`);

/** Plays like a person through the GameHost interface: lock an empty cell, then its answer. */
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

/** The phone's analytics as one batch of POST /v1/events, checked by the server's own schema. */
function serverTakes(p: Phone) {
  return parseBatch(
    {
      installId: randomUUID(),
      platform: 'android',
      appVersion: '1.0.4',
      events: p.tracked.map((e) => ({ id: randomUUID(), name: e.name, props: e.props, t: Date.now() })),
    },
    Date.now(),
  );
}

const named = (p: Phone, name: string) => p.tracked.filter((e) => e.name === name).map((e) => e.props);

// ---------------------------------------------------------------------------------------------------------

describe("the app's friends rooms on the real server (1.0.4)", () => {
  it('create, join by the code as typed, the host’s commands, start, a whole game: unrated, in the history', async () => {
    const ana = phone('Ana');
    const ben = phone('Ben');

    // "צור חדר" with my last game type [D82].
    const opened = await ana.rooms.createRoom({ gameType: 'fast' });
    expect(opened.ok).toBe(true);
    const mine = await inLobby(ana);
    expect(mine.code).toMatch(FRIEND_CODE_PATTERN);
    // The code is the 6 digits, never the Colyseus room's id.
    expect(ana.online()!.host.roomCode).toBe(mine.code);
    expect(mine).toMatchObject({
      gameType: 'fast',
      isHost: true,
      hostId: ana.me.id,
      meId: ana.me.id,
      connected: 1,
      canStart: false,
      minPlayers: 2,
      maxPlayers: 4,
    });
    expect(mine.seats).toEqual([
      {
        id: ana.me.id,
        name: 'Ana_Pal',
        avatarId: 'noam',
        country: 'IL',
        rating: null,
        away: false,
        isHost: true,
        isMe: true,
      },
    ]);

    // The share message pasted whole into "הצטרף עם קוד", then the code as a person types it ("123 456").
    const message = `בוא לשחק איתי סודוקו פייט! קוד החדר: ${mine.code}\n${roomLink(hostPort, mine.code)}`;
    const code = extractFriendCode(message);
    expect(code).toBe(mine.code);
    const joined = await ben.rooms.joinByCode(formatFriendCode(code!), 'code');
    expect(joined.ok).toBe(true);
    const full = await inLobby(ana, (r) => r.connected === 2);
    expect(full.seats.map((s) => [s.id, s.isHost, s.isMe])).toEqual([
      [ana.me.id, true, true],
      [ben.me.id, false, false],
    ]);
    expect(full.canStart).toBe(true);
    const guest = await inLobby(ben, (r) => r.seats.length === 2);
    expect(guest).toMatchObject({ code: mine.code, isHost: false, hostId: ana.me.id, canStart: false });

    // A guest's start: the server refuses it, to Ben only.
    expect(ben.rooms.start()).toBe(true);
    expect((await until(() => ben.room()?.refused, 'the refusal')).reason).toBe('notHost');
    expect(ana.room()?.refused).toBeNull();

    // The host's game type reaches everyone [D82].
    expect(ana.rooms.setGameType('normal')).toBe(true);
    await inLobby(ben, (r) => r.gameType === 'normal');

    // "התחל משחק · 2 שחקנים": 3… 2… 1…, then the game, on both phones.
    expect(ana.rooms.start()).toBe(true);
    await until(() => ben.room()?.phase === 'countdown' || ben.room()?.phase === 'game', 'the countdown');
    await until(
      () => [ana, ben].every((p) => p.room()?.phase === 'game' && p.online()!.getView().status === 'running'),
      'the game',
    );
    // A lobby command after the start goes nowhere.
    expect(ana.rooms.setGameType('hard')).toBe(false);
    const sessions = [ana.online()!, ben.online()!];
    expect(sessions.map((s) => [s.isFriends, s.friendsCode, s.gameType])).toEqual([
      [true, mine.code, 'normal'],
      [true, mine.code, 'normal'],
    ]);
    // Spec §21: no solution while the game runs.
    expect(sessions[0]!.host.game!.config.puzzle.solution).toBe('');

    const stops = sessions.map((s, i) => drive(s.host, 110 + 20 * i));
    await until(() => sessions.every((s) => s.getView().status === 'over'), 'the end', 30_000);
    stops.forEach((stop) => stop());
    const result = sessions[0]!.getView().result!;
    expect(result.reason).toBe('boardComplete');
    // [D81a] Never rated.
    expect(result.ratingChanges ?? []).toEqual([]);
    for (const s of sessions) expect(s.getView().result).toEqual(result);
    await until(() => sessions.every((s) => s.online.status === 'closed'), 'the room closing', 5000);
    expect(sessions.map((s) => s.online.closeReason)).toEqual(['gameOver', 'gameOver']);

    // The history: a ranked game flagged `friends`, with no rating (protocol HistoryGame).
    const history = createHistoryApi({
      baseUrl: httpUrl,
      getToken: () => Promise.resolve(accounts.get('Ben')!.token),
      fetch: (target, init) => fetch(target, init),
      timeoutMs: 5000,
    });
    const page = await untilAsync(
      () => history.myGames(null).then((p) => (p.games.length > 0 ? p : null)),
      'the game in the history',
    );
    const game = page.games[0]!;
    expect(game).toMatchObject({ id: sessions[0]!.id, mode: 'ranked', gameType: 'normal', friends: true });
    for (const p of game.players) {
      expect(p.ratingBefore ?? null).toBeNull();
      expect(p.ratingAfter ?? null).toBeNull();
    }
    const replay = await history.replay(game.id);
    expect(replay.game.id).toBe(game.id);

    // The analytics on the way: the room's own (generation 3) and the game's, flagged `friends`.
    expect(named(ana, 'friends_room_open')).toEqual([{ gameType: 'fast', via: 'create' }]);
    expect(named(ben, 'friends_room_join')).toEqual([{ via: 'code', result: 'ok' }]);
    for (const p of [ana, ben]) {
      expect(named(p, 'friends_room_start')).toEqual([{ players: 2, waitedSec: expect.any(Number) }]);
      expect(named(p, 'game_start')).toEqual([{ mode: 'ranked', type: 'normal', players: 2, friends: true }]);
      expect(named(p, 'game_end')).toEqual([expect.objectContaining({ mode: 'ranked', friends: true })]);
      expect(named(p, 'friends_room_close')).toEqual([]);
      const checked = serverTakes(p);
      expect(checked).toMatchObject({ ok: true, ignored: 0 });
      // Never a room's code, nor anybody's id.
      const sent = JSON.stringify(p.tracked);
      for (const secret of [mine.code, ana.me.id, ben.me.id]) expect(sent).not.toContain(secret);
    }
  }, 60_000);

  it('[D84a, D83] the app in the background holds its seat; start needs the host’s yes; back, it was left out', async () => {
    const cy = phone('Cy');
    const dan = phone('Dan');
    const eve = phone('Eve');
    expect((await cy.rooms.createRoom()).ok).toBe(true);
    const { code } = await inLobby(cy);
    for (const p of [dan, eve]) expect((await p.rooms.joinByCode(code, 'link')).ok).toBe(true);
    await inLobby(cy, (r) => r.connected === 3);

    // Eve's app goes to the background (WhatsApp): her seat is held, away, and counted out of "התחל".
    eve.appState.set('background');
    const held = await inLobby(cy, (r) => r.connected === 2);
    expect(held.seats.map((s) => [s.id, s.away])).toEqual([
      [cy.me.id, false],
      [dan.me.id, false],
      [eve.me.id, true],
    ]);
    expect(held.away.map((s) => s.id)).toEqual([eve.me.id]);
    expect(held.canStart).toBe(true);

    // Back in the foreground: the same seat.
    eve.appState.set('active');
    await inLobby(cy, (r) => r.connected === 3);
    await inLobby(eve, (r) => r.seats.length === 3);

    // Away again, and the host presses "התחל" without saying yes: refused, with who is away.
    eve.appState.set('background');
    await inLobby(cy, (r) => r.connected === 2);
    expect(cy.rooms.start()).toBe(true);
    const refused = await until(() => cy.room()?.refused, 'playersAway');
    expect(refused).toMatchObject({ command: 'start', reason: 'playersAway', away: [eve.me.id] });
    // "Eve לא בחדר כרגע. להתחיל בלי Eve?" "כן".
    expect(cy.rooms.start(cy.room()!.away.map((s) => s.id))).toBe(true);
    await until(() => [cy, dan].every((p) => p.room()?.phase === 'game'), 'the game without Eve');
    expect(cy.online()!.host.game!.config.players.map((p) => p.id)).toEqual([cy.me.id, dan.me.id]);

    // Eve comes back: "המשחק התחיל בלעדיך".
    eve.appState.set('active');
    const closed = await until(() => eve.room()?.closed, 'Eve told');
    expect(closed.problem).toBe('gameStarted');
    // The game runs on without her; her session saw the lobby only.
    expect(named(eve, 'friends_room_start')).toEqual([]);
    expect(named(cy, 'friends_room_start')).toEqual([{ players: 2, waitedSec: expect.any(Number) }]);
    for (const p of [cy, dan, eve]) expect(serverTakes(p)).toMatchObject({ ok: true, ignored: 0 });
    cy.online()!.surrender();
    await until(() => dan.online()!.getView().status === 'over', 'the end');
  }, 60_000);

  it('[D85a] a kick, "יציאה מהחדר", and a closed room: what the screens are told', async () => {
    const ana = phone('Ana');
    const fay = phone('Fay');
    const ben = phone('Ben');
    expect((await ana.rooms.createRoom()).ok).toBe(true);
    const { code } = await inLobby(ana);
    // A wrong code: "לא מצאנו חדר".
    const wrong = code === '000000' ? '000001' : '000000';
    expect(await fay.rooms.joinByCode(wrong)).toMatchObject({ ok: false, problem: 'notFound' });
    expect(await fay.rooms.joinByCode('12345')).toMatchObject({
      ok: false,
      problem: 'badRequest',
      field: 'code',
    });
    for (const p of [fay, ben]) expect((await p.rooms.joinByCode(code)).ok).toBe(true);
    await inLobby(ana, (r) => r.connected === 3);

    // The host removes Fay: "המארח הוציא אותך מהחדר", and no way back into that room.
    expect(ana.rooms.kick(fay.me.id)).toBe(true);
    const out = await until(() => fay.room()?.closed, 'Fay out');
    expect(out).toMatchObject({ reason: 'kicked', problem: 'kicked' });
    await inLobby(ana, (r) => r.seats.length === 2);
    expect(await fay.rooms.joinByCode(code)).toMatchObject({ ok: false, problem: 'kicked' });
    expect(named(fay, 'friends_room_close')).toEqual([
      { reason: 'kicked', players: expect.any(Number), waitedSec: expect.any(Number) },
    ]);
    expect(named(fay, 'friends_room_join').at(-1)).toEqual({ via: 'code', result: 'kicked' });

    // "יציאה מהחדר": the seat is freed at once.
    ben.rooms.leave();
    await inLobby(ana, (r) => r.seats.length === 1);
    expect(named(ben, 'friends_room_close')).toEqual([
      { reason: 'left', players: expect.any(Number), waitedSec: expect.any(Number) },
    ]);
    // The host leaves too: the room closes, and its code says so.
    ana.rooms.leave();
    const closed = await untilAsync(async () => {
      const answer = await ben.rooms.joinByCode(code);
      if (answer.ok) ben.rooms.leave();
      return answer.ok ? null : answer;
    }, 'the closed room');
    expect(closed).toMatchObject({ ok: false, problem: 'roomClosed' });
    for (const p of [ana, fay, ben]) expect(serverTakes(p)).toMatchObject({ ok: true, ignored: 0 });
  }, 60_000);

  it('logged nothing unexpected', () => {
    expect(log.errors).toEqual([]);
  });
});
