import { MATCH_RANGE, MATCH_TIMEOUT_MS } from '@sudoku-fight/protocol';

import {
  createMatchmakingConnector,
  type FoundMessage,
  MatchmakingClient,
  MatchmakingFailure,
  matchmakingFailureOf,
  type MatchmakingInfo,
  type SdkMatchmakingRoomLike,
} from '../matchmaking';
import {
  FakeMatchEntry,
  FakeMatchmaking,
  MATCH_ID,
  MATCH_PLAYERS,
  RESERVATION,
} from '../testing/fakeMatchmaking';
import { CODE, elapse, FakeTable, ME, OPP, sdkError, settle } from '../testing/fakeServer';

/**
 * The app's side of matchmaking (stage 9, spec §10, protocol matchmaking.ts) against a fake matchmaking room:
 * searching and the widening range, "found" and the reserved seat taken at once (D37: connected = ready), the
 * countdown off both rooms, GO, cancelling (never after "found", D32), the timeout with "keep searching" or a
 * bot, a match that falls through, and every failure. Times are the phone's; the server's clock is skewed.
 */

const tracked = () => [] as { name: string; props: Record<string, unknown> }[];

/** A client whose match's room is a real RemoteGameHost on a FakeTable (the game server, faked). */
function realSetup(skewMs = 0) {
  const table = new FakeTable({ skewMs });
  const mm = new FakeMatchmaking(table.clock, table.scheduler);
  mm.skewMs = skewMs;
  const events = tracked();
  const found: FoundMessage[] = [];
  const client = new MatchmakingClient('fast-2p', {
    connector: mm,
    clock: table.clock,
    scheduler: table.scheduler,
    enter: (m) => {
      found.push(m);
      void table.host.enterReserved(m.reservation);
      return { host: table.host, close: () => table.host.close() };
    },
    track: (name, props) => events.push({ name, props }),
  });
  const infos: MatchmakingInfo[] = [];
  client.subscribe((info) => infos.push(info));
  return { table, mm, client, events, found, infos };
}

/** A client whose entries are FakeMatchEntry (no real room). */
function fakeSetup() {
  const table = new FakeTable();
  const mm = new FakeMatchmaking(table.clock, table.scheduler);
  const events = tracked();
  const entries: FakeMatchEntry[] = [];
  const client = new MatchmakingClient('normal-2p', {
    connector: mm,
    clock: table.clock,
    scheduler: table.scheduler,
    enter: (m) => {
      const entry = new FakeMatchEntry(() => table.clock.now(), m.reservation);
      entries.push(entry);
      return entry;
    },
    track: (name, props) => events.push({ name, props }),
  });
  return { table, mm, client, events, entries };
}

const waits = (events: { name: string; props: Record<string, unknown> }[]) =>
  events.filter((e) => e.name === 'matchmaking_wait').map((e) => e.props);

describe('MatchmakingClient: searching', () => {
  it('connects, then follows the server: the rating, the range as it widens, and the search time', async () => {
    const { table, mm, client } = realSetup(1500);
    expect(client.info.phase).toBe('connecting');
    await client.start();
    expect(mm.joins).toEqual(['fast-2p']);
    expect(client.info.phase).toBe('connecting');

    const t0 = table.clock.now();
    mm.searching();
    expect(client.info).toMatchObject({
      phase: 'searching',
      queueKey: 'fast-2p',
      search: { rating: 1287, range: MATCH_RANGE.initial, extended: false, requeued: false },
    });
    // In the phone's clock, whatever the server's says.
    expect(client.info.search!.startedAt).toBe(t0);
    expect(client.info.search!.timeoutAt).toBe(t0 + MATCH_TIMEOUT_MS);

    await elapse(table, 5000, 500);
    mm.searching({ elapsedMs: 5000 });
    expect(client.info.search).toMatchObject({ range: 75, startedAt: t0 });
    await elapse(table, 10_000, 500);
    mm.searching({ elapsedMs: 15_000 });
    expect(client.info.search!.range).toBe(125);
    client.close();
  });

  it('cancels while searching: "cancel", out of the room, and the wait reported once', async () => {
    const { table, mm, client, events } = realSetup();
    await client.start();
    mm.searching();
    await elapse(table, 12_000, 1000);
    expect(client.cancel()).toBe(true);
    expect(client.info.phase).toBe('cancelled');
    expect(mm.room.sent).toEqual([{ type: 'cancel' }]);
    expect(mm.room.left).toBe(true);
    expect(waits(events)).toEqual([{ sec: 12, result: 'cancelled' }]);
    client.close();
    expect(waits(events)).toHaveLength(1);
  });

  it('a cancel while still connecting lets the late connection go', async () => {
    const { mm, client } = realSetup();
    mm.hang = true;
    void client.start();
    expect(client.cancel()).toBe(true);
    expect(client.info.phase).toBe('cancelled');
    mm.hang = false;
    // A new search is a new run: the client is fine to start again.
    await client.start();
    expect(mm.rooms).toHaveLength(1);
    expect(client.info.phase).toBe('connecting');
    client.close();
    expect(mm.room.left).toBe(true);
  });
});

describe('MatchmakingClient: found, ready, countdown, GO', () => {
  it('takes the reserved seat at once, counts down off the game room, and hands the game over at GO', async () => {
    const { table, mm, client, events, found, infos } = realSetup(800);
    await client.start();
    mm.searching();
    await elapse(table, 7000, 500);
    mm.searching({ elapsedMs: 7000 });
    await elapse(table, 2000, 500);

    mm.found();
    expect(client.info.phase).toBe('found');
    expect(found).toHaveLength(1);
    // The reservation went straight to the game room (D37: connected = ready).
    expect(table.calls.at(-1)).toEqual({ kind: 'reserved', arg: RESERVATION });
    expect(client.entry?.host).toBe(table.host);
    expect(client.info.match).toMatchObject({
      matchId: MATCH_ID,
      me: ME,
      players: MATCH_PLAYERS,
      rematch: false,
      ready: [],
      goAt: null,
    });
    expect(client.info.match!.readyBy).toBe(table.clock.now() + 10_000);
    expect(waits(events)).toEqual([{ sec: 9, result: 'found' }]);
    // No cancelling after "found" [D32].
    expect(client.cancel()).toBe(false);
    expect(mm.room.sent).toEqual([]);

    await settle();
    expect(table.host.online.status).toBe('lobby');
    mm.ready([ME]);
    mm.ready([ME, OPP]);
    expect(client.info.match!.ready).toEqual([ME, OPP]);

    // Matchmaking's countdown: GO in 3 s, in the phone's clock (the message's offset).
    const go = mm.countdown(3000);
    expect(client.info.phase).toBe('countdown');
    expect(client.info.match!.goAt).toBe(table.clock.now() + 3000);
    // The game room's own countdown, once the host's pings synced its clock, wins.
    await elapse(table, 300);
    expect(table.host.sync.synced).toBe(true);
    table.toMe({ type: 'countdown', startsAt: go, serverTime: table.serverNow() });
    await elapse(table, 100);
    expect(table.host.online.startsAt).toBe(go);
    expect(Math.abs(client.info.match!.goAt! - (go - 800))).toBeLessThanOrEqual(1);

    // GO: the snapshot comes, the game is the entry's.
    await elapse(table, 2600);
    table.startGame();
    await elapse(table, 100);
    expect(client.info).toMatchObject({ phase: 'started', hasGame: true });
    // Matchmaking is let go once the game is here (the server closes it at GO anyway).
    expect(mm.room.left).toBe(true);
    mm.started();
    expect(client.info.phase).toBe('started');
    expect(infos.map((i) => i.phase)).toEqual(
      expect.arrayContaining(['connecting', 'searching', 'found', 'countdown', 'started']),
    );

    // Closing the client after GO leaves the game alone: it is the game screen's now.
    client.close();
    expect(table.host.online.status).toBe('live');
    table.host.close();
  });

  it('runs off the game room alone when the matchmaking connection is gone after "found"', async () => {
    const { table, mm, client } = realSetup();
    await client.start();
    mm.searching();
    mm.found();
    await settle();
    mm.room.cut(1006);
    expect(client.info.phase).toBe('found');
    await elapse(table, 300);
    const go = table.serverNow() + 3000;
    table.toMe({ type: 'countdown', startsAt: go, serverTime: table.serverNow() });
    await elapse(table, 100);
    expect(client.info.phase).toBe('countdown');
    expect(client.info.match!.goAt).toBe(go);
    await elapse(table, 3000);
    table.startGame();
    await elapse(table, 100);
    expect(client.info).toMatchObject({ phase: 'started', hasGame: true });
    client.close();
    table.host.close();
  });

  it('fails when the match room closes before its game and matchmaking is gone too', async () => {
    const { table, mm, client } = realSetup();
    await client.start();
    mm.searching();
    mm.found();
    await settle();
    mm.room.cut(1006);
    table.room.cut(4000);
    await settle();
    expect(client.info.phase).toBe('failed');
    expect(client.info.error).toMatchObject({ code: 'lost' });
    expect(client.entry).toBeNull();
    client.close();
  });

  it('closing before GO leaves the match room too', async () => {
    const { table, mm, client } = realSetup();
    await client.start();
    mm.searching();
    mm.found();
    await settle();
    client.close();
    expect(table.host.online).toMatchObject({ status: 'closed', closeReason: 'left' });
    expect(mm.room.left).toBe(true);
  });
});

describe('MatchmakingClient: the timeout (spec §10)', () => {
  it('"keep searching": the same search with no cap on the range', async () => {
    const { table, mm, client, events } = fakeSetup();
    await client.start();
    mm.searching();
    await elapse(table, 60_000, 5000);
    mm.searching({ elapsedMs: 55_000 });
    mm.timeout();
    expect(client.info).toMatchObject({
      phase: 'timeout',
      timeout: { elapsedMs: MATCH_TIMEOUT_MS, range: MATCH_RANGE.cap, extended: false },
    });
    expect(client.info.timeout!.keepSearchingUntil).toBe(table.clock.now() + 60_000);
    expect(waits(events)).toEqual([{ sec: 60, result: 'timeout' }]);

    client.keepSearching();
    expect(mm.room.sent).toEqual([{ type: 'keepSearching' }]);
    expect(client.info).toMatchObject({ phase: 'searching', timeout: null, search: { extended: true } });
    mm.searching({ elapsedMs: 60_000, extended: true });
    await elapse(table, 5000, 1000);
    mm.searching({ elapsedMs: 65_000, extended: true });
    expect(client.info.search).toMatchObject({ extended: true, range: 375 });

    mm.found();
    expect(waits(events)).toEqual([
      { sec: 60, result: 'timeout' },
      { sec: 65, result: 'found' },
    ]);
    client.close();
  });

  it('"keep searching" after the window (or the connection) is gone starts a new search', async () => {
    const { table, mm, client } = fakeSetup();
    await client.start();
    mm.searching();
    mm.timeout({ windowMs: 1000 });
    mm.room.cut(4000);
    expect(client.info.phase).toBe('timeout');
    await elapse(table, 2000, 500);
    client.keepSearching();
    await settle();
    expect(mm.joins).toEqual(['normal-2p', 'normal-2p']);
    expect(client.info.phase).toBe('connecting');
    client.close();
  });

  it('"a bot meanwhile" or home: cancelling at the timeout reports no second wait', async () => {
    const { mm, client, events } = fakeSetup();
    await client.start();
    mm.searching();
    mm.timeout();
    expect(client.cancel()).toBe(true);
    expect(client.info.phase).toBe('cancelled');
    expect(waits(events)).toEqual([{ sec: 60, result: 'timeout' }]);
  });
});

describe('MatchmakingClient: a match that falls through', () => {
  it('requeued: the match room is let go, back to searching at the head of the queue, then a new match', async () => {
    const { mm, client, entries, events } = fakeSetup();
    await client.start();
    mm.searching();
    mm.found();
    expect(entries).toHaveLength(1);
    mm.matchCancelled({ requeued: true });
    expect(entries[0]!.closed).toBe(true);
    expect(client.entry).toBeNull();
    expect(client.info).toMatchObject({
      phase: 'searching',
      match: null,
      fellThrough: { reason: 'noShow', missing: [OPP] },
    });
    mm.searching({ elapsedMs: 4000, requeued: true });
    expect(client.info.search!.requeued).toBe(true);

    mm.found({ matchId: 'match-2', reservation: { ...RESERVATION, sessionId: 'seat-2' } });
    expect(entries).toHaveLength(2);
    expect(entries[1]!.reservation.sessionId).toBe('seat-2');
    expect(client.info.fellThrough).toBeNull();
    expect(waits(events).map((w) => w.result)).toEqual(['found', 'found']);
    // A stray message about the old match changes nothing.
    mm.ready([ME], MATCH_ID);
    expect(client.info.match!.ready).toEqual([]);
    client.close();
    expect(entries[1]!.closed).toBe(true);
  });

  it('not requeued: I was the one missing, and the search failed', async () => {
    const { mm, client } = fakeSetup();
    await client.start();
    mm.searching();
    mm.found();
    mm.matchCancelled({ requeued: false, missing: [ME] });
    expect(client.info.phase).toBe('failed');
    expect(client.info.error).toMatchObject({ code: 'noShow' });
    client.close();
  });

  it('a game room that runs its countdown and gets its game, through a fake entry', async () => {
    const { table, mm, client, entries } = fakeSetup();
    await client.start();
    mm.searching();
    mm.found();
    const host = entries[0]!.host;
    host.sync.synced = true;
    host.offsetMs = 250;
    host.set({ status: 'lobby', startsAt: table.clock.now() + 250 + 3000 });
    expect(client.info.phase).toBe('countdown');
    expect(client.info.match!.goAt).toBe(table.clock.now() + 3000);
    host.set({ status: 'live', hasGame: true });
    expect(client.info).toMatchObject({ phase: 'started', hasGame: true });
    client.close();
    expect(entries[0]!.closed).toBe(false);
  });
});

describe('MatchmakingClient: failures', () => {
  it.each([
    ['alreadyQueued', 'alreadyQueued-4215'],
    ['queueClosed', 'queueClosed-4215'],
    ['unauthenticated', 'unauthenticated-4215'],
    ['emailNotVerified', 'emailNotVerified-4215'],
  ])('a refusal (%s) fails with its code and a support code', async (refusal, support) => {
    const { mm, client, events } = fakeSetup();
    mm.refuse = FakeMatchmaking.refusal(refusal);
    await client.start();
    expect(client.info.phase).toBe('failed');
    expect(client.info.error!.code).toBe(refusal);
    expect(client.info.error!.supportCode).toBe(support);
    expect(waits(events)).toEqual([{ sec: 0, result: 'error' }]);
  });

  it('no network, or no answer within the limit: "network"; retry searches again', async () => {
    const { table, mm, client } = fakeSetup();
    mm.offline = true;
    await client.start();
    expect(client.info.error!.code).toBe('network');
    mm.offline = false;
    mm.hang = true;
    void client.retry();
    expect(client.info).toMatchObject({ phase: 'connecting', error: null });
    await elapse(table, 15_000, 1000);
    expect(client.info).toMatchObject({ phase: 'failed', error: { code: 'network' } });
    mm.hang = false;
    await client.retry();
    mm.searching();
    expect(client.info.phase).toBe('searching');
    expect(mm.joins).toHaveLength(3);
    client.close();
  });

  it('the connection lost while searching: "lost"', async () => {
    const { mm, client } = fakeSetup();
    await client.start();
    mm.searching();
    mm.room.cut(1006);
    expect(client.info).toMatchObject({ phase: 'failed', error: { code: 'lost', status: 1006 } });
  });

  it('maps SDK errors', () => {
    expect(matchmakingFailureOf(sdkError('alreadyQueued: busy', 4215))).toMatchObject({
      code: 'alreadyQueued',
      status: 4215,
    });
    // The server's own check of the email [D22]: its code, for the verification screen.
    expect(
      matchmakingFailureOf(sdkError('emailNotVerified: Ranked games need a verified email address', 4215)),
    ).toMatchObject({ code: 'emailNotVerified', status: 4215, supportCode: 'emailNotVerified-4215' });
    expect(matchmakingFailureOf(new TypeError('Network request failed')).code).toBe('network');
    expect(matchmakingFailureOf(sdkError('something odd', 400)).code).toBe('unknown');
    const own = new MatchmakingFailure('signedOut', 'x');
    expect(matchmakingFailureOf(own)).toBe(own);
    expect(own.supportCode).toBe('signedOut');
  });
});

describe('createMatchmakingConnector: the SDK', () => {
  function sdk() {
    const room = {
      reconnection: { enabled: true },
      onMessage: jest.fn(),
      onLeave: jest.fn(),
      send: jest.fn(),
      leave: jest.fn(() => Promise.resolve(4000)),
    } satisfies SdkMatchmakingRoomLike;
    return {
      room,
      sdk: {
        auth: { token: undefined as string | undefined },
        joinOrCreate: jest.fn((_name: string, _options: object) => Promise.resolve(room)),
      },
    };
  }

  it('joins the queue with the account token as the auth token', async () => {
    const { sdk: s, room } = sdk();
    const connector = createMatchmakingConnector({ sdk: s, token: async () => 'id-token' });
    const like = await connector.join('hard-2p');
    expect(s.auth.token).toBe('id-token');
    expect(s.joinOrCreate).toHaveBeenCalledWith('matchmaking', { queueKey: 'hard-2p' });
    expect(room.reconnection.enabled).toBe(false);
    const cb = jest.fn();
    like.onMessage('searching', cb);
    expect(room.onMessage).toHaveBeenCalledWith('searching', cb);
    const onLeave = jest.fn();
    like.onLeave(onLeave);
    (room.onLeave.mock.calls[0] as unknown as [(code: number) => void])[0](1006);
    expect(onLeave).toHaveBeenCalledWith(1006);
    like.send('cancel', { type: 'cancel' });
    expect(room.send).toHaveBeenCalledWith('cancel', { type: 'cancel' });
    await like.leave(true);
    expect(room.leave).toHaveBeenCalledWith(true);
  });

  it('refuses without a sign-in, and maps the SDK refusals', async () => {
    const { sdk: s } = sdk();
    await expect(
      createMatchmakingConnector({ sdk: s, token: async () => null }).join('fast-2p'),
    ).rejects.toMatchObject({ code: 'signedOut' });
    expect(s.joinOrCreate).not.toHaveBeenCalled();
    s.joinOrCreate.mockRejectedValueOnce(sdkError('queueClosed: 3 players later', 4215));
    await expect(
      createMatchmakingConnector({ sdk: s, token: async () => 't' }).join('fast-3p'),
    ).rejects.toMatchObject({ code: 'queueClosed' });
    const noToken = createMatchmakingConnector({
      sdk: s,
      token: () => Promise.reject(new TypeError('Network request failed')),
    });
    await expect(noToken.join('fast-2p')).rejects.toMatchObject({ code: 'network' });
  });
});

describe('the match room code', () => {
  it('is the room the reservation names', () => {
    expect(RESERVATION.roomId).toBe(CODE);
  });
});
