import { type CellIndex, type HostUpdate, type Rules, toView } from '@sudoku-fight/engine';
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
    // Without the soft phase [D42] (its play offline is tested below).
    const table = await liveTable({ rules: { softGraceMs: 0 } });
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
    // The hard phase at once (no soft phase [D42]): the two-player freeze, and the "back" banner.
    const table = await liveTable({ rules: { softGraceMs: 0 } });
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
    expect(host.online.reconnect).toMatchObject({
      lostAt,
      softEndsAt: null,
      graceEndsAt: lostAt + 15_000,
      resyncing: false,
    });
    expect(host.online.offlinePlay).toBeNull();
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
      props: { durationMs: expect.any(Number), success: true, phase: 'hard', queued: 0 },
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
    // The soft phase 10 s [D42] + the grace 3 s + the server's notice 4.5 s + 1 s.
    const r = table.host.online.reconnect!;
    expect(r.deadline - r.since).toBe(10_000 + 3000 + 4500 + 1000);
    expect(r.graceEndsAt - r.lostAt).toBe(13_000);
    await elapse(table, 18_300);
    expect(table.host.online.status).toBe('reconnecting');
    expect(reconnects(table).length).toBeGreaterThan(5);
    await elapse(table, 1500);
    expect(table.host.online).toMatchObject({ status: 'closed', closeReason: 'lostConnection' });
    expect(infos.at(-1)?.error?.code).toBe('network');
    expect(table.tracked).toContainEqual({
      name: 'reconnect',
      props: { durationMs: expect.any(Number), success: false, phase: 'hard', queued: 0 },
    });
    const calls = table.calls.length;
    await elapse(table, 5000);
    expect(table.calls.length).toBe(calls);
  });

  it('back after the grace: the snapshot shows the game lost by abandonment', async () => {
    const table = await liveTable({ rules: { graceMs: 2000 } });
    table.offline = true;
    table.cutMe();
    // The soft phase (10 s) [D42], then the grace (2 s).
    await elapse(table, 12_500);
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

  // Moshe's black screens of 1.0.0: a finished game has nothing to come back to.
  it('after the end, a silent server closes the host as gameOver: no reconnect, no join', async () => {
    const table = await liveTable();
    table.opponent({ type: 'surrender' });
    await elapse(table, 100);
    expect(table.host.getView().status).toBe('over');
    expect(table.host.solution).not.toBeNull();
    const calls = table.calls.length;
    table.pong = false;
    await elapse(table, 10_000);
    expect(table.host.online).toMatchObject({ status: 'closed', closeReason: 'gameOver', reconnect: null });
    expect(table.calls.length).toBe(calls);
    expect(reconnects(table)).toEqual([]);
    // Said goodbye (the server's seat is not held for a game that is over), and kept the result.
    expect(table.rooms[0]!.left).toBe(true);
    expect(table.host.getView().status).toBe('over');
    expect(table.logs).toContain('the connection went after the end: closing');
  });

  it('after the end, a gap in the events closes the host too (no fresh snapshot to fetch)', async () => {
    const table = await liveTable();
    table.opponent({ type: 'surrender' });
    await elapse(table, 100);
    const seq = table.host.game!.seq;
    // An event far ahead of the last one: the gap timer would fetch a snapshot in a running game.
    table.toMe({ type: 'events', events: [{ ...table.game!.log.at(-1)!, seq: seq + 5 }] });
    await elapse(table, 2000);
    expect(table.host.online).toMatchObject({ status: 'closed', closeReason: 'gameOver' });
    expect(reconnects(table)).toEqual([]);
    expect(joins(table)).toEqual([]);
  });
});

/** The actions of a kind this phone sent, on every connection. */
const sentOf = (table: FakeTable, type: string) =>
  table.rooms.flatMap((r) => r.actions).filter((a) => a.type === type);

const lastRejected = (updates: HostUpdate[]) =>
  updates.filter((u): u is Extract<HostUpdate, { kind: 'rejected' }> => u.kind === 'rejected').at(-1);

describe('RemoteGameHost: playing on while offline, the soft phase (D42)', () => {
  it('a drop: the soft phase from when it noticed; a tap locks here, a digit waits; nothing else goes', async () => {
    const table = await liveTable();
    const { host } = table;
    const { updates } = record(table);
    const thinkMs = table.rules.thinkTimeMs;
    table.offline = true;
    const lostAt = host.serverNow();
    table.cutMe();
    expect(host.online.status).toBe('reconnecting');
    expect(host.online.offlinePlay).toEqual({ since: lostAt, softEndsAt: lostAt + 10_000, playable: true });
    expect(host.online.reconnect).toMatchObject({
      lostAt,
      softEndsAt: lostAt + 10_000,
      graceEndsAt: lostAt + 25_000,
    });
    // Drawn again at once: I am marked.
    const marked = updates.at(-1);
    expect(marked).toMatchObject({ kind: 'events', events: [] });
    expect(marked?.view.players[0]!.softEndsAt).toBe(lostAt + 10_000);
    const sent = table.rooms.map((r) => r.sent.length);

    await elapse(table, 1000);
    host.select(c0);
    // Locked here, with its own countdown and the keypad on; I am marked in my own view.
    let view = host.getView();
    expect(updates.at(-1)).toMatchObject({ kind: 'events', events: [] });
    expect(view.players[0]!.lock).toMatchObject({ cell: c0, expiresAt: host.serverNow() + thinkMs });
    expect(view.players[0]!.softEndsAt).toBe(lostAt + 10_000);
    expect(view.keypad.enabled).toBe(true);
    // The game is not mine to judge: the digit waits, the cell stays empty.
    host.place(c0, answerIn(PUZZLE, c0));
    view = host.getView();
    expect(host.online.queuedMoves).toEqual([{ cell: c0, digit: answerIn(PUZZLE, c0) }]);
    expect(view.players[0]!.lock).toBeNull();
    expect(view.grid[c0]).toBe(0);
    // Its cell is taken by the waiting digit; a digit with no lock is refused, as the engine would.
    host.select(c0);
    expect(lastRejected(updates)).toMatchObject({
      action: { type: 'select', cell: c0 },
      reason: 'cellFilled',
    });
    host.place(c1, 1);
    expect(lastRejected(updates)).toMatchObject({ reason: 'noLock' });
    // What needs the server waits for it.
    for (const act of [() => host.interfere(OPP, 'cats'), () => host.react('🔥'), () => host.surrender()]) {
      act();
      expect(lastRejected(updates)?.reason).toBe('disconnected');
    }
    // My select can be let go of here too.
    host.select(c1);
    host.release();
    expect(host.getView().players[0]!.lock).toBeNull();
    // Nothing went out meanwhile.
    expect(table.rooms.map((r) => r.sent.length)).toEqual(sent);
  });

  it('back inside the soft phase: no banner; the moves go out in order, and their answers settle them', async () => {
    const table = await liveTable();
    const { host } = table;
    table.offline = true;
    table.cutMe();
    await elapse(table, 500);
    host.select(c0);
    await elapse(table, 1200);
    host.place(c0, answerIn(PUZZLE, c0));
    host.select(c1);
    host.place(c1, wrongIn(PUZZLE, c1));
    // The server marked me, and the game goes on there.
    expect(table.meAtServer?.softEndsAt).toBeGreaterThan(table.serverNow());
    expect(table.game!.state.status).toBe('running');

    table.offline = false;
    await elapse(table, 1500);
    expect(host.online).toMatchObject({
      status: 'live',
      resyncedAt: null,
      offlinePlay: null,
      queuedMoves: [],
    });
    expect(sentOf(table, 'offlineMove')).toEqual([
      { type: 'offlineMove', cell: c0, digit: answerIn(PUZZLE, c0), thinkMs: 1200, clientSeq: 1 },
      { type: 'offlineMove', cell: c1, digit: wrongIn(PUZZLE, c1), thinkMs: 0, clientSeq: 2 },
    ]);
    const view = host.getView();
    expect(view.grid[c0]).toBe(answerIn(PUZZLE, c0));
    expect(view.wrong[c1]).toEqual([{ digit: wrongIn(PUZZLE, c1), playerId: ME }]);
    expect(view.players[0]!.softEndsAt).toBeNull();
    expectInSync(table);
    const offline = table.game!.log.filter(
      (e) => (e.type === 'placedCorrect' || e.type === 'placedWrong') && e.offline,
    );
    expect(offline).toHaveLength(2);
    // Nothing froze, nothing went hard.
    const types = table.game!.log.map((e) => e.type);
    expect(types).toContain('playerConnectionLost');
    for (const type of ['playerDisconnected', 'gamePaused']) expect(types).not.toContain(type);
    expect(host.metrics.sync.count).toBe(1);
    expect(table.tracked).toContainEqual({
      name: 'reconnect',
      props: { durationMs: expect.any(Number), success: true, phase: 'soft', queued: 2 },
    });
  });

  it('a cell the opponent took meanwhile: my move comes back refused (lost, no penalty)', async () => {
    const table = await liveTable();
    const { host } = table;
    const { updates } = record(table);
    table.offline = true;
    table.cutMe();
    host.select(c0);
    host.place(c0, answerIn(PUZZLE, c0));
    await elapse(table, 300);
    table.opponent({ type: 'select', cell: c0 }); // the opponent, online, took the same cell
    table.offline = false;
    await elapse(table, 1500);
    expect(lastRejected(updates)).toMatchObject({
      action: { type: 'offlineMove', cell: c0, digit: answerIn(PUZZLE, c0) },
      reason: 'cellTaken',
    });
    expect(host.online.queuedMoves).toEqual([]);
    expect(host.getView().players[0]).toMatchObject({ score: 0, mistakes: 0 });
    expect(table.logs).toContain('a move made offline did not count: cellTaken');
    expectInSync(table);
  });

  it('an opponent’s lock that ran out meanwhile is gone here; a stopped one stays', async () => {
    const table = await liveTable();
    const { host } = table;
    const { updates } = record(table);
    table.opponent({ type: 'select', cell: c2 });
    await elapse(table, 100);
    const expiresAt = host.getView().players[1]!.lock!.expiresAt!;
    table.offline = true;
    table.cutMe();
    host.select(c2);
    expect(lastRejected(updates)).toMatchObject({ reason: 'cellTaken' });
    const before = updates.length;
    await elapse(table, expiresAt - host.serverNow() + 20);
    // Woken at its end: drawn again without it, and the cell is free here.
    expect(updates.length).toBeGreaterThan(before);
    expect(host.getView().players[1]!.lock).toBeNull();
    host.select(c2);
    expect(host.getView().players[0]!.lock?.cell).toBe(c2);
  });

  it('the soft phase runs out first: the lock here goes, the moves wait, and the return has its banner', async () => {
    const table = await liveTable();
    const { host } = table;
    const { updates } = record(table);
    table.offline = true;
    table.cutMe();
    host.select(c0);
    host.place(c0, answerIn(PUZZLE, c0));
    host.select(c1);
    await elapse(table, 10_100);
    // The phone's own soft phase is over: nothing more is played here.
    expect(host.getView().players[0]!.lock).toBeNull();
    expect(host.online.queuedMoves).toHaveLength(1);
    host.select(c2);
    expect(lastRejected(updates)?.reason).toBe('disconnected');
    // The server's is over too: the hard phase, the game frozen.
    expect(table.game!.state.status).toBe('paused');

    table.offline = false;
    await elapse(table, 1500);
    expect(host.online.status).toBe('live');
    expect(host.online.resyncedAt).not.toBeNull();
    expect(host.getView().status).toBe('running');
    expect(host.getView().grid[c0]).toBe(answerIn(PUZZLE, c0));
    // The cell held without a digit had run out with the soft phase: not taken again.
    expect(sentOf(table, 'select')).toEqual([]);
    expect(table.tracked).toContainEqual({
      name: 'reconnect',
      props: { durationMs: expect.any(Number), success: true, phase: 'hard', queued: 1 },
    });
    expectInSync(table);
  });

  it('the game ended meanwhile: the moves made offline go with it, unsent', async () => {
    const table = await liveTable();
    const { host } = table;
    table.offline = true;
    table.cutMe();
    host.select(c0);
    host.place(c0, answerIn(PUZZLE, c0));
    table.opponent({ type: 'surrender' });
    table.offline = false;
    await elapse(table, 1500);
    expect(host.getView().status).toBe('over');
    expect(host.online.queuedMoves).toEqual([]);
    expect(sentOf(table, 'offlineMove')).toEqual([]);
    expect(table.logs).toContain('the game went on without the 1 moves made offline');
  });

  it('a server without the soft phase (older rules): no play offline, as before', async () => {
    const table = await liveTable({
      rules: { softGraceMs: undefined, offlineMovesMax: undefined } as unknown as Partial<Rules>,
    });
    const { host } = table;
    const { updates } = record(table);
    table.offline = true;
    table.cutMe();
    expect(host.online.offlinePlay).toBeNull();
    expect(host.online.reconnect).toMatchObject({ softEndsAt: null });
    host.select(c0);
    expect(lastRejected(updates)).toMatchObject({ reason: 'disconnected' });
    await elapse(table, 200);
    expect(table.game!.state.status).toBe('paused'); // hard at once
    table.offline = false;
    await elapse(table, 1500);
    expect(host.online.resyncedAt).not.toBeNull();
    expect(sentOf(table, 'offlineMove')).toEqual([]);
  });

  it('a digit the server had not answered when the connection went: queued, and not sent twice once settled', async () => {
    const table = await liveTable();
    const { host } = table;
    host.select(c0);
    await elapse(table, 100);
    host.place(c0, answerIn(PUZZLE, c0));
    await elapse(table, 30); // at the server, its answer on the way
    table.offline = true;
    table.cutMe();
    expect(table.game!.state.grid[c0]).toBe(answerIn(PUZZLE, c0));
    expect(host.online.queuedMoves).toEqual([{ cell: c0, digit: answerIn(PUZZLE, c0) }]);
    table.offline = false;
    await elapse(table, 1500);
    expect(host.online.queuedMoves).toEqual([]);
    expect(sentOf(table, 'offlineMove')).toEqual([]);
    expect(host.getView().grid[c0]).toBe(answerIn(PUZZLE, c0));
    expectInSync(table);
  });

  it('a digit that never reached the server: sent on the return, its think time from the lock', async () => {
    const table = await liveTable();
    const { host } = table;
    host.select(c0);
    await elapse(table, 100);
    table.answer = false; // the network is already gone: it never arrives
    await elapse(table, 900);
    host.place(c0, answerIn(PUZZLE, c0));
    table.offline = true;
    table.cutMe();
    expect(host.online.queuedMoves).toEqual([{ cell: c0, digit: answerIn(PUZZLE, c0) }]);
    await elapse(table, 100);
    table.answer = true;
    expect(table.game!.state.grid[c0]).toBe(0);
    table.offline = false;
    await elapse(table, 1500);
    const [move] = sentOf(table, 'offlineMove');
    expect(move).toMatchObject({ cell: c0, digit: answerIn(PUZZLE, c0) });
    expect((move as { thinkMs: number }).thinkMs).toBeGreaterThanOrEqual(900);
    expect(host.getView().grid[c0]).toBe(answerIn(PUZZLE, c0));
  });

  it('a select the server had not answered becomes the lock here; held without a digit, it is taken again', async () => {
    const table = await liveTable();
    const { host } = table;
    table.answer = false; // it never arrives
    host.select(c1);
    table.offline = true;
    table.cutMe();
    expect(host.getView().players[0]!.lock?.cell).toBe(c1);
    await elapse(table, 100);
    table.answer = true;
    expect(table.game!.state.locks).toEqual([]);
    table.offline = false;
    await elapse(table, 1500);
    // Sent again on the return: the cell was still free.
    expect(sentOf(table, 'select')).toEqual([
      { type: 'select', cell: c1, clientSeq: 1 },
      { type: 'select', cell: c1, clientSeq: 2 },
    ]);
    expect(host.getView().players[0]!.lock?.cell).toBe(c1);
    expectInSync(table);
  });

  it('a cell held here and taken meanwhile: the return says "taken"', async () => {
    const table = await liveTable();
    const { host } = table;
    const { updates } = record(table);
    table.offline = true;
    table.cutMe();
    host.select(c1);
    table.opponent({ type: 'select', cell: c1 });
    table.offline = false;
    await elapse(table, 1500);
    expect(lastRejected(updates)).toMatchObject({
      action: { type: 'select', cell: c1 },
      reason: 'cellTaken',
    });
  });

  it('the connection goes again before the answers: the moves go out again after the next return', async () => {
    const table = await liveTable();
    const { host } = table;
    table.offline = true;
    table.cutMe();
    host.select(c0);
    host.place(c0, answerIn(PUZZLE, c0));
    table.answer = false; // the next connection dies before the server reads it
    table.offline = false;
    await elapse(table, 1500);
    expect(sentOf(table, 'offlineMove')).toHaveLength(1);
    table.offline = true;
    table.cutMe();
    table.answer = true;
    expect(host.online.queuedMoves).toHaveLength(1);
    table.offline = false;
    await elapse(table, 1500);
    expect(sentOf(table, 'offlineMove')).toHaveLength(2);
    expect(host.online.queuedMoves).toEqual([]);
    expect(host.getView().grid[c0]).toBe(answerIn(PUZZLE, c0));
  });

  it('an action with nothing heard for answerTimeoutMs: the connection is taken for lost at once', async () => {
    const table = await liveTable({ answer: false });
    const { host } = table;
    // Pongs still come: only the answer is missing (a rate limit), nothing is wrong with the connection.
    host.select(c0);
    await elapse(table, 3000);
    expect(table.rooms).toHaveLength(1);
    table.pong = false;
    host.select(c1);
    await elapse(table, 2400);
    expect(table.rooms).toHaveLength(1);
    table.offline = true;
    await elapse(table, 200);
    expect(table.logs).toContain('no answer from the server');
    expect(table.rooms[0]!.left).toBe(false); // a drop, not a goodbye
    expect(host.online.status).toBe('reconnecting');
    // The select it had sent is held here meanwhile.
    expect(host.getView().players[0]!.lock?.cell).toBe(c1);
  });

  it('the background: the soft phase from that moment, nothing played meanwhile; back, play goes on here', async () => {
    const appState = fakeAppState();
    const table = await liveTable({ appState });
    const { host } = table;
    const { updates } = record(table);
    table.offline = true;
    const at = host.serverNow();
    appState.set('background');
    expect(host.online.offlinePlay).toEqual({ since: at, softEndsAt: at + 10_000, playable: true });
    host.select(c0);
    expect(lastRejected(updates)?.reason).toBe('disconnected');
    await elapse(table, 3000);
    appState.set('active');
    host.select(c0);
    expect(host.getView().players[0]!.lock?.cell).toBe(c0);
    table.offline = false;
    await elapse(table, 1500);
    expect(host.online.status).toBe('live');
    expect(host.getView().players[0]!.lock?.cell).toBe(c0);
    expect(host.online.resyncedAt).toBeNull();
  });

  it("'turns' (D1): nothing is played offline", async () => {
    const table = await liveTable({ rules: { turnModel: 'turns' } });
    const { host } = table;
    const { updates } = record(table);
    table.offline = true;
    table.cutMe();
    expect(host.online.offlinePlay).toMatchObject({ playable: false });
    host.select(c0);
    expect(lastRejected(updates)?.reason).toBe('disconnected');
  });

  it('both dropped (one network), I am back first: the moves wait for the game to go on, then count', async () => {
    const table = await liveTable();
    const { host } = table;
    const { updates } = record(table);
    // The opponent's connection goes too: both soft, then both hard, the game frozen.
    table.game!.apply({ type: 'disconnect', playerId: OPP, soft: true });
    table.offline = true;
    table.cutMe();
    for (const cell of [c0, c1]) {
      host.select(cell);
      host.place(cell, answerIn(PUZZLE, cell));
    }
    await elapse(table, 10_500);
    expect(table.game!.state.status).toBe('paused');

    table.offline = false;
    await elapse(table, 1500);
    expect(host.online.status).toBe('live');
    expect(host.getView().status).toBe('paused'); // the opponent is still away
    // Sent now, each would be refused ('paused') and lost: they wait, still "waiting" on the board.
    expect(sentOf(table, 'offlineMove')).toEqual([]);
    expect(host.online.queuedMoves).toHaveLength(2);
    expect(table.logs).toContain('the game is frozen: 2 moves made offline wait for it to go on');

    // The opponent is back 8 s later, long after the 5 s of my window would have run out.
    await elapse(table, 8000);
    table.game!.apply({ type: 'reconnect', playerId: OPP });
    await elapse(table, 500);
    expect(sentOf(table, 'offlineMove')).toHaveLength(2);
    expect(host.online.queuedMoves).toEqual([]);
    expect(host.getView().grid[c0]).toBe(answerIn(PUZZLE, c0));
    expect(host.getView().grid[c1]).toBe(answerIn(PUZZLE, c1));
    expect(lastRejected(updates)).toBeUndefined();
    expectInSync(table);
  });

  it('a move made offline whose message the server dropped (its rate limit answers nothing) goes out again', async () => {
    const table = await liveTable();
    const { host } = table;
    const { updates } = record(table);
    table.offline = true;
    table.cutMe();
    host.select(c0);
    host.place(c0, answerIn(PUZZLE, c0));
    table.answer = false; // the server drops the move, and answers nothing (pongs still come)
    table.offline = false;
    await elapse(table, 1500);
    expect(host.online.status).toBe('live');
    expect(sentOf(table, 'offlineMove')).toHaveLength(1);
    expect(host.online.queuedMoves).toHaveLength(1);
    table.answer = true;

    await elapse(table, 2000);
    expect(table.logs).toContain('1 moves made offline got no answer: sending them again');
    expect(sentOf(table, 'offlineMove')).toHaveLength(2);
    expect(host.online.queuedMoves).toEqual([]);
    expect(host.getView().grid[c0]).toBe(answerIn(PUZZLE, c0));
    expect(lastRejected(updates)).toBeUndefined();
    // The connection itself was fine all along.
    expect(table.rooms).toHaveLength(2);
    // Answered: nothing more goes out.
    await elapse(table, 5000);
    expect(sentOf(table, 'offlineMove')).toHaveLength(2);
    expectInSync(table);
  });

  it('a lock the server kept, cancelled here: the return lets go of it there too', async () => {
    const table = await liveTable();
    const { host } = table;
    host.select(c0);
    await elapse(table, 100);
    expect(table.game!.state.locks).toMatchObject([{ playerId: ME, cell: c0 }]);
    table.offline = true;
    table.cutMe();
    expect(host.getView().players[0]!.lock?.cell).toBe(c0);
    host.release();
    expect(host.getView().players[0]!.lock).toBeNull();

    table.offline = false;
    await elapse(table, 1500);
    expect(host.online.status).toBe('live');
    expect(table.meAtServer?.softEndsAt).toBeUndefined(); // back inside the soft phase
    expect(sentOf(table, 'release')).toEqual([{ type: 'release', clientSeq: 2 }]);
    expect(table.game!.state.locks).toEqual([]);
    expect(host.getView().players[0]!.lock).toBeNull();
    expectInSync(table);
  });

  it('moved to another cell here, which was taken meanwhile: the kept lock is let go of all the same', async () => {
    const table = await liveTable();
    const { host } = table;
    const { updates } = record(table);
    host.select(c0);
    await elapse(table, 100);
    table.offline = true;
    table.cutMe();
    host.select(c1);
    table.opponent({ type: 'select', cell: c1 });
    table.offline = false;
    await elapse(table, 1500);
    expect(lastRejected(updates)).toMatchObject({
      action: { type: 'select', cell: c1 },
      reason: 'cellTaken',
    });
    expect(table.game!.state.locks).toMatchObject([{ playerId: OPP, cell: c1 }]);
    expect(host.getView().players[0]!.lock).toBeNull();
    expectInSync(table);
  });

  it('how the opponent’s absence began: a drop (soft first) or a deliberate leave (hard at once)', async () => {
    const table = await liveTable();
    const { host } = table;
    expect(host.online.hardLeavers).toEqual([]);
    table.game!.apply({ type: 'disconnect', playerId: OPP, soft: true });
    await elapse(table, 100);
    expect(host.online.hardLeavers).toEqual([]);
    table.game!.apply({ type: 'reconnect', playerId: OPP });
    table.game!.apply({ type: 'disconnect', playerId: OPP }); // a goodbye: hard at once
    await elapse(table, 100);
    expect(host.online.hardLeavers).toEqual([OPP]);
    table.game!.apply({ type: 'reconnect', playerId: OPP });
    await elapse(table, 100);
    expect(host.online.hardLeavers).toEqual([]);
    // A drop whose soft phase ran out is hard now, and still a drop.
    table.game!.apply({ type: 'disconnect', playerId: OPP, soft: true });
    await elapse(table, 10_100);
    expect(table.game!.state.status).toBe('paused');
    expect(host.online.hardLeavers).toEqual([]);

    // A goodbye that ends in abandonment stays known at the end.
    const left = await liveTable();
    left.game!.apply({ type: 'disconnect', playerId: OPP });
    await elapse(left, 15_100);
    expect(left.host.getView().status).toBe('over');
    expect(left.host.online.hardLeavers).toEqual([OPP]);
  });
});

describe('RemoteGameHost: what it survives is reported (release builds: Crashlytics)', () => {
  it('a listener that throws: reported, and the others still get the update', async () => {
    const table = await liveTable();
    const boom = new Error('a screen failed');
    const seen: HostUpdate[] = [];
    table.host.subscribe(() => {
      throw boom;
    });
    table.host.subscribe((u) => seen.push(u));
    table.opponent({ type: 'select', cell: c1 });
    await elapse(table, 100);
    expect(seen.length).toBeGreaterThan(0);
    expect(table.reports).toContainEqual({ error: boom, context: 'listener failed' });
    expect(table.logs).toContain('listener failed: a screen failed');
  });

  it('an online listener that throws: reported, and the others still told', async () => {
    const table = await liveTable();
    const boom = new Error('a banner failed');
    const infos: OnlineInfo[] = [];
    table.host.subscribeOnline(() => {
      throw boom;
    });
    table.host.subscribeOnline((i) => infos.push(i));
    table.host.select(c0);
    expect(infos.at(-1)?.pendingCell).toBe(c0);
    expect(table.reports).toContainEqual({ error: boom, context: 'online listener failed' });
  });

  it('a message that breaks the mirror: reported, then a fresh snapshot (by reconnecting)', async () => {
    const table = await liveTable();
    table.toMe({
      type: 'snapshot',
      protocol: PROTOCOL_VERSION,
      state: null as never,
      playerId: ME,
      lastClientSeq: 0,
    });
    await elapse(table, 50);
    expect(table.reports).toHaveLength(1);
    expect(table.reports[0]!.context).toBe('message failed');
    await elapse(table, 1000);
    expect(reconnects(table).length).toBeGreaterThan(0);
    expect(table.host.online.status).toBe('live');
    expectInSync(table);
  });

  it('a report that throws itself never breaks the game', async () => {
    const table = await liveTable();
    Object.assign(table.reports, {
      push: () => {
        throw new Error('crashlytics down');
      },
    });
    table.host.subscribe(() => {
      throw new Error('a screen failed');
    });
    table.opponent({ type: 'select', cell: c1 });
    await elapse(table, 100);
    expect(table.host.online.status).toBe('live');
  });

  it('never puts the reconnection token in a log line', async () => {
    const table = await liveTable();
    table.cutMe();
    await elapse(table, 1000);
    table.opponent({ type: 'surrender' });
    table.pong = false;
    await elapse(table, 10_000);
    expect(table.logs.length).toBeGreaterThan(0);
    expect(table.logs.join('\n')).not.toContain('secret');
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

describe('RemoteGameHost: what only local play has (staged practice, 1.0.2)', () => {
  it('a tap (a tap level’s move) is refused here at once, and never sent: no wire message has it', async () => {
    const table = await liveTable();
    const { updates } = record(table);
    const sent = table.room.sent.length;
    table.host.tap(c0);
    expect(updates).toEqual([
      {
        kind: 'rejected',
        action: { type: 'tap', cell: c0 },
        reason: 'badAction',
        view: table.host.getView(),
      },
    ]);
    expect(table.room.sent).toHaveLength(sent);
  });

  it('a swap of boxes (the puzzle’s move, 1.0.3) is refused here at once, and never sent', async () => {
    const table = await liveTable();
    const { updates } = record(table);
    const sent = table.room.sent.length;
    const actions = table.room.actions.length;
    table.host.swapBoxes(1, 5);
    expect(updates).toEqual([
      {
        kind: 'rejected',
        action: { type: 'swapBoxes', from: 1, to: 5 },
        reason: 'badAction',
        view: table.host.getView(),
      },
    ]);
    expect(table.room.sent).toHaveLength(sent);
    expect(table.room.actions).toHaveLength(actions);
  });

  it('pause and resume [D65] do nothing and send nothing: an online game never freezes that way', async () => {
    const table = await liveTable();
    const { updates } = record(table);
    const actions = table.room.actions.length;
    table.host.pause();
    table.host.resume();
    table.host.pause();
    expect(updates).toEqual([]);
    expect(table.room.actions).toHaveLength(actions);
    expect(table.host.getView().status).toBe('running');
    expect(table.host.online.status).toBe('live');
    await elapse(table, 100);
    expectInSync(table);
  });
});
