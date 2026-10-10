import { type CellIndex, type HostUpdate, toView } from '@sudoku-fight/engine';
import { PROTOCOL_VERSION } from '@sudoku-fight/protocol';

import { answerIn, emptyCellsOf, PUZZLE, wrongIn } from '../../game/testing/practice';
import { TokenBucket } from '../clockSync';
import { OnlineError } from '../errors';
import type { AppStateLike, OnlineInfo } from '../remoteGameHost';
import { CODE, elapse, FakeTable, liveTable, ME, OPP, sdkError, settle } from '../testing/fakeServer';

const cells = emptyCellsOf(PUZZLE);
const [c0, c1, c2] = cells as [CellIndex, CellIndex, CellIndex];

/** The host's picture is exactly the engine's picture of the server's game (spec §18: evolve + toView). */
function expectInSync(table: FakeTable): void {
  expect(table.host.getView()).toEqual(toView(table.game!.publicState(), ME, table.host.serverNow()));
}

function record(table: FakeTable): { updates: HostUpdate[]; infos: OnlineInfo[] } {
  const updates: HostUpdate[] = [];
  const infos: OnlineInfo[] = [];
  table.host.subscribe((u) => updates.push(u));
  table.host.subscribeOnline((i) => infos.push(i));
  return { updates, infos };
}

function fakeAppState() {
  const listeners = new Set<(state: string) => void>();
  const appState: AppStateLike & { set(state: string): void; listeners: number } = {
    addEventListener: (_type, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    set: (state) => listeners.forEach((l) => l(state)),
    get listeners() {
      return listeners.size;
    },
  };
  return appState;
}

const reconnects = (table: FakeTable) => table.calls.filter((c) => c.kind === 'reconnect');
const joins = (table: FakeTable) => table.calls.filter((c) => c.kind === 'join');

describe('RemoteGameHost: lobby, snapshot, events', () => {
  it('creates a room, shows who is in, then the game from the snapshot and the events', async () => {
    const table = new FakeTable();
    const { updates } = record(table);
    expect(table.host.online.status).toBe('connecting');

    const code = await table.host.create({ gameType: 'fast' });
    expect(code).toBe(CODE);
    expect(table.calls).toEqual([{ kind: 'create', arg: { gameType: 'fast' } }]);
    expect(table.host.online).toMatchObject({ status: 'lobby', code: CODE, hasGame: false, lobby: null });
    expect(() => table.host.getView()).toThrow(/snapshot/);

    table.lobby();
    await elapse(table, 50);
    expect(table.host.online.lobby).toEqual({
      code: CODE,
      gameType: 'fast',
      playerCount: 2,
      players: [{ id: ME, name: 'Moshe' }],
    });
    expect(table.host.playerId).toBe(ME);

    table.startGame();
    await elapse(table, 100);
    expect(table.host.online).toMatchObject({ status: 'live', hasGame: true });
    // The snapshot (no events: the picture changed), then the start as events.
    expect(updates[0]).toMatchObject({ kind: 'events', events: [] });
    expect(updates[1]!.kind === 'events' && updates[1]!.events.map((e) => e.type)).toContain('gameStarted');
    expect(table.host.getView().status).toBe('running');
    expectInSync(table);
  });

  it('joins by code; an unknown code is a typed refusal and the host closes', async () => {
    const table = new FakeTable();
    await table.host.join(CODE);
    expect(table.host.online.status).toBe('lobby');

    const other = new FakeTable();
    const error = await other.host.join('ZZZ999').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OnlineError);
    expect((error as OnlineError).code).toBe('notFound');
    expect(other.host.online).toMatchObject({ status: 'closed', closeReason: 'refused' });
    expect(other.host.online.error?.code).toBe('notFound');
  });

  it('a refused create rejects with the server’s GameRoomError', async () => {
    const table = new FakeTable();
    jest.spyOn(table, 'create').mockRejectedValue(sdkError('badOptions: private rooms are off', 521));
    await expect(table.host.create()).rejects.toMatchObject({ code: 'badOptions' });
    expect(table.host.online.closeReason).toBe('refused');
    await expect(table.host.create()).rejects.toThrow(/already/);
  });

  it('plays: my moves and the opponent’s, the view always the engine’s', async () => {
    const table = await liveTable();
    const { host } = table;
    host.select(c0);
    // Optimistic (spec §18): pending at once, before any answer.
    expect(host.pendingCell).toBe(c0);
    expect(host.online.pendingCell).toBe(c0);
    expect(table.room.actions).toEqual([{ type: 'select', cell: c0, clientSeq: 1 }]);
    await elapse(table, 100);
    expect(host.pendingCell).toBeNull();
    expect(host.getView().players[0]!.lock?.cell).toBe(c0);
    expectInSync(table);

    host.place(c0, answerIn(PUZZLE, c0));
    // A digit's result only comes from the server.
    expect(host.getView().grid[c0]).toBe(0);
    await elapse(table, 100);
    expect(host.getView().grid[c0]).toBe(answerIn(PUZZLE, c0));
    expect(table.room.actions.map((a) => a.clientSeq)).toEqual([1, 2]);

    table.opponent({ type: 'select', cell: c1 });
    table.opponent({ type: 'place', cell: c1, digit: wrongIn(PUZZLE, c1) });
    host.react('🔥');
    await elapse(table, 100);
    expect(host.getView().wrong[c1]).toEqual([{ digit: wrongIn(PUZZLE, c1), playerId: OPP }]);
    expectInSync(table);
  });

  it('skips events it has, and puts early ones in order', async () => {
    const table = await liveTable();
    const { host } = table;
    const { updates } = record(table);
    const seq = host.getView().seq;
    table.hold = true;
    table.opponent({ type: 'select', cell: c0 });
    table.opponent({ type: 'release' });
    table.opponent({ type: 'select', cell: c1 });
    const [e1, e2, e3] = table.held;
    expect([e1!.seq, e2!.seq, e3!.seq]).toEqual([seq + 1, seq + 2, seq + 3]);

    table.room.deliver({ type: 'events', events: [e2!] }); // early: waits for seq + 1
    expect(host.getView().seq).toBe(seq);
    expect(updates).toHaveLength(0);
    table.room.deliver({ type: 'events', events: [e1!, e2!] });
    expect(host.getView().seq).toBe(seq + 2);
    expect(updates).toEqual([expect.objectContaining({ kind: 'events', events: [e1, e2] })]);
    table.room.deliver({ type: 'events', events: [e1!, e2!] }); // duplicates
    table.room.deliver({ type: 'events', events: [{ ...e1!, seq: 1 }] }); // older than the snapshot
    expect(updates).toHaveLength(1);
    table.room.deliver({ type: 'events', events: [e3!] });
    expectInSync(table);
    expect(table.rooms).toHaveLength(1);
  });

  it('a hole that never fills: a fresh snapshot, by reconnecting', async () => {
    const table = await liveTable();
    table.hold = true;
    table.opponent({ type: 'select', cell: c0 });
    table.opponent({ type: 'release' });
    const [, e2] = table.held;
    table.hold = false;
    table.room.deliver({ type: 'events', events: [e2!] }); // seq + 1 is lost
    await elapse(table, 900);
    expect(table.rooms).toHaveLength(1);
    await elapse(table, 1000);
    expect(table.rooms[0]!.left).toBe(false); // a drop, not a goodbye: the seat stays
    expect(table.host.online.status).toBe('live');
    expectInSync(table);
  });

  it('a snapshot from another protocol version closes the host', async () => {
    const table = new FakeTable();
    await table.host.create();
    table.startGame();
    const snapshot = table.snapshotFor();
    table.room.deliver({ ...snapshot, protocol: (PROTOCOL_VERSION + 1) as typeof PROTOCOL_VERSION });
    expect(table.host.online).toMatchObject({ status: 'closed', closeReason: 'protocol' });
    expect(table.host.online.error?.code).toBe('protocol');
  });
});

describe('RemoteGameHost: optimistic select and refusals', () => {
  it('stops showing a select as pending when no answer comes (rate-limited)', async () => {
    const table = await liveTable({ answer: false });
    const { infos } = record(table);
    table.host.select(c0);
    expect(infos.at(-1)?.pendingCell).toBe(c0);
    await elapse(table, 1990);
    expect(table.host.pendingCell).toBe(c0);
    await elapse(table, 20);
    expect(table.host.pendingCell).toBeNull();
    expect(infos.at(-1)?.pendingCell).toBeNull();
  });

  it('a newer select takes over the pending cell', async () => {
    const table = await liveTable({ answer: false });
    table.host.select(c0);
    table.host.select(c1);
    expect(table.host.pendingCell).toBe(c1);
    await elapse(table, 2010);
    expect(table.host.pendingCell).toBeNull();
  });

  it('a refusal comes back as "rejected" with the action, and ends the pending', async () => {
    const table = await liveTable();
    const { updates } = record(table);
    table.opponent({ type: 'select', cell: c0 });
    await elapse(table, 50);
    table.host.select(c0);
    await elapse(table, 100);
    expect(updates.at(-1)).toMatchObject({
      kind: 'rejected',
      action: { type: 'select', cell: c0 },
      reason: 'cellTaken',
    });
    expect(table.host.pendingCell).toBeNull();
    expect(table.host.metrics.action.count).toBe(1);
  });

  it('while offline an action is refused here with "disconnected", and nothing goes out', async () => {
    const table = await liveTable();
    const { updates } = record(table);
    table.offline = true;
    table.cutMe();
    const sent = table.rooms.map((r) => r.sent.length);
    table.host.place(c0, 1);
    expect(updates.at(-1)).toMatchObject({
      kind: 'rejected',
      action: { type: 'place', cell: c0, digit: 1 },
      reason: 'disconnected',
    });
    expect(table.rooms.map((r) => r.sent.length)).toEqual(sent);
  });

  it('actions before the game are ignored', async () => {
    const table = new FakeTable();
    await table.host.create();
    table.host.select(c0);
    expect(table.room.actions).toEqual([]);
  });

  it('clientSeq carries on from the snapshot’s lastClientSeq', async () => {
    const table = new FakeTable();
    await table.host.create();
    table.lastClientSeq = 41;
    table.startGame();
    await elapse(table, 100);
    table.host.select(c0);
    expect(table.room.actions[0]!.clientSeq).toBe(42);
    await elapse(table, 100);
    expect(table.host.getView().players[0]!.lock?.cell).toBe(c0);
  });

  it('surrender (spec §6.6): in a two-player game an immediate loss', async () => {
    const table = await liveTable();
    table.host.surrender();
    await elapse(table, 100);
    const view = table.host.getView();
    expect(view.status).toBe('over');
    expect(view.result?.ranking.find((r) => r.playerId === ME)).toMatchObject({
      place: 2,
      status: 'surrendered',
    });
  });
});

describe('RemoteGameHost: the server’s clock (spec §18)', () => {
  it('works out the offset from ping/pong; the view’s deadlines are in server time', async () => {
    const table = await liveTable({ skewMs: 5000, oneWayMs: 30 });
    const { host } = table;
    expect(host.sync.synced).toBe(true);
    expect(host.sync.offsetMs).toBe(5000);
    expect(host.serverNow()).toBe(table.serverNow());
    expect(host.clock.now()).toBe(table.serverNow());
    expect(host.sync.rtt.summary()).toMatchObject({ p50: 60, p95: 60 });

    host.select(c0);
    await elapse(table, 100);
    const lock = host.getView().players[0]!.lock!;
    expect(lock.expiresAt! - host.serverNow()).toBe(lock.remainingMs);
    expect(lock.remainingMs).toBeLessThanOrEqual(host.getView().rules.thinkTimeMs);
    expectInSync(table);
  });

  it('pings: a burst of 5 at the join, then one every 2 s, never over the server’s limit', async () => {
    const table = new FakeTable();
    const t0 = table.clock.now();
    await table.host.create();
    await elapse(table, 450);
    expect(table.room.pings.map((p) => p.t - t0)).toEqual([0, 100, 200, 300, 400]);
    await elapse(table, 6000);
    expect(table.room.pings.length).toBe(8);
    // A drop and a quick return: the second burst stays within the server's bucket.
    table.startGame();
    await elapse(table, 100);
    table.cutMe();
    await elapse(table, 1000);
    expect(table.rooms.length).toBeGreaterThan(1);
    const server = new TokenBucket(5, 2500, t0);
    const all = table.rooms.flatMap((r) => r.pings.map((p) => p.t)).sort((a, b) => a - b);
    for (const t of all) expect(server.take(t)).toBe(true);
  });
});

describe('RemoteGameHost: losing the connection and coming back (spec §16.2)', () => {
  it('comes back with the reconnection token, and is current again', async () => {
    const table = await liveTable();
    const { host } = table;
    const { infos } = record(table);
    const token = table.room.reconnectionToken;
    host.select(c0);
    await elapse(table, 100);
    const lostAt = table.serverNow();
    table.cutMe();
    expect(host.online.status).toBe('reconnecting');
    expect(infos.some((i) => i.reconnect?.cause === 'drop' && i.reconnect.attempt === 1)).toBe(true);
    // In the server's clock, like the view's deadlines (the countdowns of the connection screens).
    expect(host.online.reconnect).toMatchObject({ lostAt, resyncing: false });
    expect(host.online.resyncedAt).toBeNull();

    await elapse(table, 1000);
    expect(reconnects(table).at(-1)?.arg).toBe(token);
    expect(host.online).toMatchObject({ status: 'live', reconnect: null });
    // The socket was back before its snapshot came ("resyncing"), and when it came is known.
    expect(infos.some((i) => i.status === 'reconnecting' && i.reconnect?.resyncing)).toBe(true);
    expect(host.online.resyncedAt).toBeGreaterThan(lostAt);
    expectInSync(table);
    // The two-player freeze is over, my lock is kept (spec §16.2).
    expect(host.getView().status).toBe('running');
    expect(host.getView().players[0]!.lock?.cell).toBe(c0);
    expect(host.metrics.reconnect.count).toBe(1);
    expect(host.metrics.sync.count).toBe(1);
    expect(table.tracked).toContainEqual({
      name: 'reconnect',
      props: { durationMs: expect.any(Number), success: true },
    });
    // The token is a bearer secret: never in a log.
    expect(table.logs.join('\n')).not.toContain('secret');

    host.place(c0, answerIn(PUZZLE, c0));
    await elapse(table, 100);
    expect(host.getView().grid[c0]).toBe(answerIn(PUZZLE, c0));
  });

  it('the server has not noticed the drop yet: keeps trying until it has', async () => {
    const table = await liveTable();
    table.unnoticed = true;
    table.cutMe();
    await elapse(table, 1500);
    expect(table.host.online.status).toBe('reconnecting');
    expect(table.host.online.reconnect!.attempt).toBeGreaterThan(2);
    expect(joins(table).length).toBeGreaterThan(0); // tried by code too: "alreadyInRoom"
    table.notice();
    await elapse(table, 1500);
    expect(table.host.online.status).toBe('live');
    expectInSync(table);
  });

  it('token refused but the room alive: rejoins by code with the same identity', async () => {
    const table = await liveTable();
    table.host.select(c0);
    await elapse(table, 100);
    table.refuseToken = true;
    table.cutMe();
    await elapse(table, 1000);
    // The first try may come before the server noticed the drop ("alreadyInRoom"); then it gets in.
    expect(joins(table).length).toBeGreaterThan(0);
    expect(joins(table).every((c) => c.arg === CODE)).toBe(true);
    expect(table.host.online.status).toBe('live');
    expectInSync(table);
    // The server's count started over; this host carries on above its own.
    table.host.release();
    expect(table.room.actions[0]!.clientSeq).toBe(2);
    await elapse(table, 100);
    expect(table.host.getView().players[0]!.lock).toBeNull();
  });

  it('gives up when the grace is over: closed, lostConnection', async () => {
    const table = await liveTable({ rules: { graceMs: 3000 } });
    const { infos } = record(table);
    table.offline = true;
    table.cutMe();
    // grace 3 s + the server's notice 4.5 s + 1 s
    await elapse(table, 8300);
    expect(table.host.online.status).toBe('reconnecting');
    expect(reconnects(table).length).toBeGreaterThan(5);
    await elapse(table, 1500);
    expect(table.host.online).toMatchObject({ status: 'closed', closeReason: 'lostConnection' });
    expect(infos.at(-1)?.error?.code).toBe('network');
    expect(table.tracked).toContainEqual({
      name: 'reconnect',
      props: { durationMs: expect.any(Number), success: false },
    });
    const calls = table.calls.length;
    await elapse(table, 5000);
    expect(table.calls.length).toBe(calls);
  });

  it('back after the grace: the snapshot shows the game lost by abandonment', async () => {
    const table = await liveTable({ rules: { graceMs: 2000 } });
    table.offline = true;
    table.cutMe();
    await elapse(table, 3000);
    table.offline = false;
    await elapse(table, 1500);
    const view = table.host.getView();
    expect(view.status).toBe('over');
    expect(view.result?.ranking.find((r) => r.playerId === ME)?.status).toBe('abandoned');
    expect(table.host.solution).toBe(PUZZLE.solution);
  });

  it('the room is gone: closed at once', async () => {
    const table = await liveTable();
    table.disposed = true;
    table.cutMe();
    await elapse(table, 100);
    expect(table.host.online).toMatchObject({ status: 'closed', closeReason: 'lostConnection' });
    expect(table.host.online.error?.code).toBe('roomGone');
    expect(reconnects(table)).toHaveLength(1);
  });

  it('an attempt that never answers times out, and the next one gets through', async () => {
    const table = await liveTable();
    table.hang = true;
    table.cutMe();
    await elapse(table, 4000);
    expect(reconnects(table)).toHaveLength(1);
    table.hang = false;
    await elapse(table, 2000);
    expect(reconnects(table).length).toBeGreaterThan(1);
    expect(table.host.online.status).toBe('live');
  });

  it('a silent server is taken for a drop', async () => {
    const table = await liveTable();
    table.pong = false;
    await elapse(table, 5000);
    expect(table.rooms).toHaveLength(1);
    await elapse(table, 4000);
    expect(table.rooms[0]!.left).toBe(false);
    expect(table.rooms.length).toBeGreaterThan(1);
  });

  it('a phone that was asleep does not blame the server for its own silence', async () => {
    const table = await liveTable();
    table.clock.advance(30_000); // timers did not run meanwhile
    table.scheduler.advance(0);
    await settle();
    expect(table.host.online.status).toBe('live');
    expect(table.rooms).toHaveLength(1);
  });

  it('a drop in the lobby: back by code', async () => {
    const table = new FakeTable();
    await table.host.create();
    table.lobby();
    await elapse(table, 50);
    table.cutMe();
    expect(table.host.online.status).toBe('reconnecting');
    await elapse(table, 50);
    expect(joins(table)).toEqual([{ kind: 'join', arg: CODE }]);
    table.lobby();
    await elapse(table, 50);
    expect(table.host.online).toMatchObject({ status: 'lobby', reconnect: null });
  });

  it('the server closes the room after the game: closed, gameOver; before it: serverClosed', async () => {
    const over = await liveTable();
    over.opponent({ type: 'surrender' });
    await elapse(over, 100);
    over.cutMe(4000);
    expect(over.host.online).toMatchObject({ status: 'closed', closeReason: 'gameOver' });

    const early = await liveTable();
    early.cutMe(4000);
    expect(early.host.online).toMatchObject({ status: 'closed', closeReason: 'serverClosed' });
  });
});

describe('RemoteGameHost: the app in the background (work plan, stage 7)', () => {
  it('a ranked game in the background is a disconnect; back in the foreground it reconnects at once', async () => {
    const appState = fakeAppState();
    const table = await liveTable({ appState });
    const first = table.room;
    appState.set('inactive'); // a pulled-down control centre: nothing
    expect(first.open).toBe(true);
    appState.set('background');
    expect(first.left).toBe(false); // the socket closes, the token is kept
    expect(table.host.online).toMatchObject({
      status: 'reconnecting',
      reconnect: { cause: 'background', attempt: 0 },
    });
    await elapse(table, 5000);
    expect(reconnects(table)).toHaveLength(0);

    appState.set('active');
    expect(reconnects(table)).toHaveLength(0); // the attempt is on its way
    await elapse(table, 100);
    expect(reconnects(table)).toHaveLength(1);
    expect(table.host.online.status).toBe('live');
    expectInSync(table);
  });

  it('the background while reconnecting stops trying until the foreground', async () => {
    const appState = fakeAppState();
    const table = await liveTable({ appState });
    table.offline = true;
    table.cutMe();
    await elapse(table, 600);
    appState.set('background');
    const calls = table.calls.length;
    await elapse(table, 3000);
    expect(table.calls.length).toBe(calls);
    table.offline = false;
    appState.set('active');
    await elapse(table, 300);
    expect(table.host.online.status).toBe('live');
  });

  it('the lobby and a finished game stay connected in the background', async () => {
    const appState = fakeAppState();
    const lobby = new FakeTable({ appState });
    await lobby.host.create();
    appState.set('background');
    expect(lobby.room.open).toBe(true);

    const appState2 = fakeAppState();
    const done = await liveTable({ appState: appState2 });
    done.opponent({ type: 'surrender' });
    await elapse(done, 100);
    appState2.set('background');
    expect(done.room.open).toBe(true);
  });
});

describe('RemoteGameHost: the solution only after the end (spec §21)', () => {
  it('keeps no solution while the game runs, and takes it once the game is over', async () => {
    const table = await liveTable();
    const { updates } = record(table);
    expect(table.host.game!.config.puzzle.solution).toBe('');
    expect(table.host.getView().solution).toBeNull();
    table.room.deliver({ type: 'solution', solution: PUZZLE.solution });
    expect(table.host.solution).toBeNull();
    expect(table.host.getView().solution).toBeNull();

    table.opponent({ type: 'surrender' });
    await elapse(table, 100);
    expect(table.host.solution).toBe(PUZZLE.solution);
    expect(table.host.getView().solution).toBe(PUZZLE.solution);
    expect(updates.at(-1)).toMatchObject({ kind: 'events', events: [] });
    expectInSync(table);
  });
});

describe('RemoteGameHost: measures (spec §18, §22)', () => {
  it('c2s, s2c, action time; latency_sample every N samples, at most once a minute', async () => {
    const table = await liveTable({
      skewMs: 3000,
      oneWayMs: 25,
      options: { metrics: { reportEvery: 3, reportMinIntervalMs: 60_000 } },
    });
    const { host } = table;
    const before = table.tracked.filter((t) => t.name === 'latency_sample').length;
    host.select(c0);
    await elapse(table, 100);
    expect(host.metrics.action.values().at(-1)).toBe(50);
    expect(host.metrics.c2s.values().at(-1)).toBe(25);
    expect(host.metrics.s2c.values().at(-1)).toBe(25);
    host.place(c0, answerIn(PUZZLE, c0));
    host.select(c2);
    await elapse(table, 100);
    const samples = table.tracked.filter((t) => t.name === 'latency_sample');
    expect(samples.length - before).toBeLessThanOrEqual(1);
    expect(samples.at(-1)?.props).toEqual({ c2sP95: 25, s2cP95: 25, actionP95: 50 });
    const count = samples.length;
    await elapse(table, 61_000);
    host.release();
    await elapse(table, 100);
    expect(table.tracked.filter((t) => t.name === 'latency_sample').length).toBe(count + 1);
    expect(host.metrics.summary()).toMatchObject({ lost: 0 });
  });
});

describe('RemoteGameHost: close()', () => {
  it('leaves on purpose, stops every timer and update', async () => {
    const appState = fakeAppState();
    const table = await liveTable({ appState });
    const { updates, infos } = record(table);
    table.host.select(c0);
    table.host.close();
    expect(table.room.left).toBe(true);
    expect(infos.at(-1)).toMatchObject({ status: 'closed', closeReason: 'left' });
    expect(appState.listeners).toBe(0);
    await elapse(table, 200);
    table.game!.close();
    // Nothing of the host's is left on the clock: no pings, no pending, no watchdog.
    expect(table.scheduler.pending).toBe(0);
    const pings = table.room.pings.length;
    await elapse(table, 10_000);
    expect(table.room.pings.length).toBe(pings);
    expect(updates).toHaveLength(0);
    table.host.select(c1);
    expect(table.room.actions).toHaveLength(1);
    table.host.close(); // twice is fine
  });

  it('stops a reconnect loop', async () => {
    const table = await liveTable();
    table.offline = true;
    table.cutMe();
    await elapse(table, 600);
    table.host.close();
    const calls = table.calls.length;
    await elapse(table, 5000);
    expect(table.calls.length).toBe(calls);
    expect(table.host.online.closeReason).toBe('left');
  });

  it('closed while joining: the room that comes is left', async () => {
    const table = new FakeTable();
    const joining = table.host.create();
    table.host.close();
    await expect(joining).rejects.toBeInstanceOf(OnlineError);
    expect(table.room.left).toBe(true);
  });
});
