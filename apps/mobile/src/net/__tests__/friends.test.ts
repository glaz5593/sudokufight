import { ManualClock, ManualScheduler } from '@sudoku-fight/engine';

import { RoomsApiError } from '../../api/roomsApi';
import { createGameStore, type GameStoreDeps } from '../../game/gameStore';
import type { FriendsRequest } from '../../game/onlineSession';
import { smallPool } from '../../game/testing/practice';
import { friendsProblemOf, OnlineError, onlineErrorOfFriends } from '../errors';
import { createFriendsRooms, type FriendsRoomsDeps, friendsRoomOf, friendsRoomOfSession } from '../friends';
import type { OnlineInfo } from '../remoteGameHost';
import { AVI, DANA, elapse, FakeFriendsTable, FakeRoomsApi, FCODE } from '../testing/fakeFriends';
import { FakeTable, ME } from '../testing/fakeServer';

/**
 * net/friends.ts (1.0.4, friends-room.md §3, §7.4): "צור חדר" and "הצטרף עם קוד" through the routes into the
 * game store's session, the host's commands, "יציאה מהחדר", the analytics without codes or ids, and the room as
 * the screens draw it.
 */

jest.mock('../../services/analytics', () => ({ track: jest.fn() }));

function setup({ tables = [new FakeFriendsTable()], signedIn = true } = {}) {
  const clock = new ManualClock(1_700_000_000_000);
  const made: FakeFriendsTable[] = [];
  const sessionTracked: { name: string; props: Record<string, unknown> }[] = [];
  const storeDeps: GameStoreDeps = {
    repo: () => Promise.resolve(null),
    session: { clock, scheduler: new ManualScheduler(clock), pool: smallPool(2), track: () => undefined },
    onlineTrack: (name, props) => sessionTracked.push({ name, props }),
    onlineEnd: () => undefined,
  };
  const useStore = createGameStore(storeDeps);
  const api = new FakeRoomsApi(tables[0]!);
  const tracked: { name: string; props: Record<string, unknown> }[] = [];
  const deps: FriendsRoomsDeps = {
    api: () => (signedIn ? api : null),
    store: {
      getOnline: () => useStore.getState().online,
      startFriends: (request, d) => useStore.getState().startFriends(request, d),
      clear: () => useStore.getState().clear(),
    },
    makeHost: () => {
      const table = tables[made.length];
      if (!table) throw new Error('no more tables');
      made.push(table);
      return table.host;
    },
    track: (name, props) => tracked.push({ name, props }),
    interferenceKinds: ['freeze', 'blur'],
  };
  return { rooms: createFriendsRooms(deps), useStore, api, tracked, sessionTracked, made, tables };
}

describe('createRoom: "צור חדר"', () => {
  it('opens a room through the route and enters it: the store’s online session, in the lobby', async () => {
    const { rooms, useStore, api, tracked, tables } = setup();
    const entry = await rooms.createRoom({ gameType: 'hard' });
    expect(entry.ok).toBe(true);
    if (!entry.ok) return;
    expect(api.calls).toEqual([
      { kind: 'create', body: { gameType: 'hard', interferenceKinds: ['freeze', 'blur'] } },
    ]);
    expect(useStore.getState().online).toBe(entry.session);
    expect(entry.session.isFriends).toBe(true);
    expect(entry.room?.code).toBe(FCODE);
    expect(rooms.current()).toBe(entry.session);
    await entry.session.ready;
    await elapse(tables[0]!, 50);
    expect(rooms.room()).toMatchObject({ phase: 'lobby', code: FCODE, isHost: true });
    // Never a code or an id in the analytics.
    expect(tracked).toEqual([{ name: 'friends_room_open', props: { gameType: 'normal', via: 'create' } }]);
  });

  it('the default game type is "רגיל"; a double tap opens one room', async () => {
    const { rooms, api } = setup();
    const [a, b] = await Promise.all([rooms.createRoom(), rooms.createRoom()]);
    expect(a).toBe(b);
    expect(api.calls).toEqual([
      { kind: 'create', body: { gameType: 'normal', interferenceKinds: ['freeze', 'blur'] } },
    ]);
  });

  it('a lobby I host already: tooManyRooms with its code; then replace: true', async () => {
    const { rooms, api } = setup();
    api.refuse = new RoomsApiError('tooManyRooms', 409, {
      error: 'tooManyRooms',
      rooms: true,
      code: '654321',
    });
    const entry = await rooms.createRoom();
    expect(entry).toEqual({
      ok: false,
      problem: 'tooManyRooms',
      openCode: '654321',
      retryAfterMs: null,
      field: null,
    });
    api.refuse = null;
    expect((await rooms.createRoom({ replace: true })).ok).toBe(true);
    expect(api.calls[1]?.body).toMatchObject({ replace: true });
  });

  it('signed out: unauthorized, nothing called', async () => {
    const { rooms, api, tracked } = setup({ signedIn: false });
    expect(await rooms.createRoom()).toMatchObject({ ok: false, problem: 'unauthorized' });
    expect(api.calls).toEqual([]);
    expect(tracked).toEqual([]);
  });

  it('too many: how long to wait', async () => {
    const { rooms, api } = setup();
    api.refuse = new RoomsApiError('tooManyRequests', 429, null, 60_000);
    expect(await rooms.createRoom()).toMatchObject({
      ok: false,
      problem: 'tooManyRequests',
      retryAfterMs: 60_000,
    });
  });
});

describe('joinByCode: "הצטרף עם קוד" and a link', () => {
  it('takes a seat by the code as typed; friends_room_join once the seat is taken', async () => {
    const table = new FakeFriendsTable({ host: false });
    const { rooms, api, tracked } = setup({ tables: [table] });
    const entry = await rooms.joinByCode('123 456');
    expect(entry.ok).toBe(true);
    expect(api.calls).toEqual([
      { kind: 'join', body: { code: FCODE, interferenceKinds: ['freeze', 'blur'] } },
    ]);
    if (!entry.ok) return;
    await entry.session.ready;
    expect(tracked).toEqual([{ name: 'friends_room_join', props: { via: 'code', result: 'ok' } }]);
    await elapse(table, 50);
    expect(rooms.room()).toMatchObject({ phase: 'lobby', isHost: false, hostId: DANA });
  });

  it('a code that can not be one: badRequest (field code), nothing called, nothing counted', async () => {
    const { rooms, api, tracked } = setup();
    expect(await rooms.joinByCode('12345')).toMatchObject({
      ok: false,
      problem: 'badRequest',
      field: 'code',
    });
    expect(api.calls).toEqual([]);
    expect(tracked).toEqual([]);
  });

  it('a refusal: its code, and friends_room_join says it (a link’s too)', async () => {
    const { rooms, api, tracked } = setup();
    expect(await rooms.joinByCode('654321', 'link')).toMatchObject({ ok: false, problem: 'notFound' });
    api.refuse = new RoomsApiError('cantJoin', 403);
    expect(await rooms.joinByCode('123456')).toMatchObject({ ok: false, problem: 'cantJoin' });
    api.refuse = new RoomsApiError('notAvailable', 404);
    expect(await rooms.joinByCode('123456')).toMatchObject({ ok: false, problem: 'notAvailable' });
    expect(tracked).toEqual([
      { name: 'friends_room_join', props: { via: 'link', result: 'notFound' } },
      { name: 'friends_room_join', props: { via: 'code', result: 'cantJoin' } },
      { name: 'friends_room_join', props: { via: 'code', result: 'notAvailable' } },
    ]);
  });

  it('a ticket refused at the door (removed meanwhile): the join counts what the room said', async () => {
    const table = new FakeFriendsTable({ host: false });
    table.consumeRefusal = 'kicked: removed by the host';
    const { rooms, tracked } = setup({ tables: [table] });
    const entry = await rooms.joinByCode(FCODE);
    if (!entry.ok) throw new Error('the route gave a ticket');
    await entry.session.ready;
    expect(tracked).toEqual([{ name: 'friends_room_join', props: { via: 'code', result: 'kicked' } }]);
    expect(rooms.room()?.closed).toMatchObject({ closeReason: 'refused', problem: 'kicked' });
  });

  it('the same code again while in that room: the same session, no call', async () => {
    const table = new FakeFriendsTable({ host: false });
    const { rooms, api } = setup({ tables: [table] });
    const first = await rooms.joinByCode(FCODE, 'link');
    const again = await rooms.joinByCode(FCODE, 'link');
    expect(first.ok && again.ok && again.session === first.session).toBe(true);
    expect(api.calls).toHaveLength(1);
  });

  it('back to my room after the app was closed (resume): no analytics', async () => {
    const { rooms, tracked } = setup({ tables: [new FakeFriendsTable({ host: false })] });
    const entry = await rooms.joinByCode(FCODE, 'resume');
    expect(entry.ok).toBe(true);
    if (entry.ok) await entry.session.ready;
    expect(tracked).toEqual([]);
  });
});

describe('calling off a way in (cancel, leave): the screen that asked is gone', () => {
  /** The route is asked at once; its answer waits until `release()`. */
  function hold<T>(call: (...args: never[]) => Promise<T>) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    return {
      wrapped: (...args: never[]) => {
        const answer = call(...args);
        answer.catch(() => undefined);
        return gate.then(() => answer);
      },
      release: () => release(),
    };
  }
  /** The asked step reaches the route (its call is made, its answer not yet in). */
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('back during a pending "צור חדר": the late ticket enters nothing, and the practice under way stays', async () => {
    const { rooms, useStore, api, tracked } = setup();
    const create = hold(api.create.bind(api));
    api.create = create.wrapped as typeof api.create;
    const practice = await useStore.getState().startPractice({ gameType: 'fast' });
    expect(practice).not.toBeNull();
    const close = jest.spyOn(practice!, 'close');

    const pending = rooms.createRoom();
    await flush();
    expect(api.calls).toHaveLength(1);
    rooms.cancel();
    create.release();
    expect(await pending).toEqual({ ok: false, cancelled: true });
    expect(api.calls).toHaveLength(1);
    expect(useStore.getState().online).toBeNull();
    expect(useStore.getState().session).toBe(practice);
    expect(close).not.toHaveBeenCalled();
    expect(tracked).toEqual([]);

    // The next "צור חדר" is a new ask, not the one called off.
    api.create = create.wrapped as typeof api.create;
    const again = await rooms.createRoom();
    expect(again.ok).toBe(true);
    expect(api.calls).toHaveLength(2);
  });

  it('a pending join called off by leave(): nothing entered, no friends_room_join; a refusal after it is not said', async () => {
    const { rooms, useStore, api, tracked } = setup();
    const join = hold(api.join.bind(api));
    api.join = join.wrapped as typeof api.join;
    const pending = rooms.joinByCode(FCODE, 'link');
    await flush();
    expect(api.calls).toHaveLength(1);
    rooms.leave();
    join.release();
    expect(await pending).toEqual({ ok: false, cancelled: true });
    expect(useStore.getState().online).toBeNull();

    api.refuse = new RoomsApiError('notFound', 404, { error: 'notFound', rooms: true });
    const refused = hold(api.join.bind(api));
    api.join = refused.wrapped as typeof api.join;
    const second = rooms.joinByCode('654321', 'link');
    await flush();
    expect(api.calls).toHaveLength(2);
    rooms.cancel();
    refused.release();
    expect(await second).toEqual({ ok: false, cancelled: true });
    expect(tracked).toEqual([]);
  });

  it('called off before its turn came: the route is never asked; asked after the call-off: in as always', async () => {
    const { rooms, useStore, api } = setup();
    const early = rooms.createRoom();
    rooms.cancel();
    expect(await early).toEqual({ ok: false, cancelled: true });
    expect(api.calls).toEqual([]);
    const entry = await rooms.joinByCode(FCODE);
    expect(entry.ok).toBe(true);
    expect(useStore.getState().online?.isFriends).toBe(true);
  });
});

describe('the host’s commands, leaving, sharing', () => {
  it('start, setGameType and kick go to the room; nothing without a friends room', async () => {
    const table = new FakeFriendsTable({ others: [{ id: DANA, name: 'Dana' }] });
    const { rooms } = setup({ tables: [table] });
    expect(rooms.start()).toBe(false);
    const entry = await rooms.createRoom();
    if (!entry.ok) throw new Error('not in');
    await entry.session.ready;
    await elapse(table, 50);
    expect(rooms.setGameType('fast')).toBe(true);
    expect(rooms.kick(DANA)).toBe(true);
    expect(rooms.start()).toBe(true);
    expect(rooms.start([AVI])).toBe(true);
    expect(table.commands).toEqual([
      { type: 'setGameType', gameType: 'fast' },
      { type: 'kick', playerId: DANA },
      { type: 'start' },
      { type: 'start', withoutAway: [AVI] },
    ]);
  });

  it('"יציאה מהחדר": the seat is freed (a goodbye), the store holds nothing, friends_room_close says left', async () => {
    const table = new FakeFriendsTable();
    const { rooms, useStore, sessionTracked } = setup({ tables: [table] });
    const entry = await rooms.createRoom();
    if (!entry.ok) throw new Error('not in');
    await entry.session.ready;
    await elapse(table, 50);
    rooms.leave();
    expect(table.room.left).toBe(true);
    expect(useStore.getState().online).toBeNull();
    expect(rooms.current()).toBeNull();
    expect(sessionTracked).toEqual([
      { name: 'friends_room_close', props: { reason: 'left', players: 1, waitedSec: 0 } },
    ]);
    rooms.leave(); // nothing more
  });

  it('shared(): friends_invite_share by host or guest', async () => {
    const host = new FakeFriendsTable();
    const a = setup({ tables: [host] });
    a.rooms.shared(); // no room: nothing
    const entry = await a.rooms.createRoom();
    if (!entry.ok) throw new Error('not in');
    await entry.session.ready;
    await elapse(host, 50);
    a.rooms.shared();
    expect(a.tracked.slice(1)).toEqual([{ name: 'friends_invite_share', props: { by: 'host' } }]);

    const guest = new FakeFriendsTable({ host: false });
    const b = setup({ tables: [guest] });
    const joined = await b.rooms.joinByCode(FCODE);
    if (!joined.ok) throw new Error('not in');
    await joined.session.ready;
    await elapse(guest, 50);
    b.rooms.shared();
    expect(b.tracked.at(-1)).toEqual({ name: 'friends_invite_share', props: { by: 'guest' } });
  });
});

describe('the game store and a friends room', () => {
  it('"נסה שוב" comes back by the code through the route (no reservation, the room’s id is no code)', async () => {
    const first = new FakeFriendsTable();
    const second = new FakeFriendsTable();
    const { rooms, useStore, made, api } = setup({ tables: [first, second] });
    const entry = await rooms.createRoom();
    if (!entry.ok) throw new Error('not in');
    await entry.session.ready;
    await elapse(first, 50);
    first.offline = true;
    first.room.cut(1006);
    await elapse(first, 70_000, 500);
    expect(entry.session.online).toMatchObject({ status: 'closed', closeReason: 'lostConnection' });
    expect(rooms.room()?.closed?.problem).toBe('network');

    const retried = useStore.getState().retryOnline()!;
    expect(made).toEqual([first, second]);
    expect(retried.request).toEqual({
      kind: 'friends',
      code: FCODE,
      reservation: null,
      room: first.summary(),
      gameType: 'normal',
    });
    await retried.ready;
    // The route was asked for my seat (the store's rejoin), then the room took the reservation.
    expect(api.calls.at(-1)).toEqual({
      kind: 'join',
      body: { code: FCODE, interferenceKinds: ['freeze', 'blur'] },
    });
    expect(second.calls.map((c) => c.kind)).toEqual(['reserved']);
    expect(retried.online.code).toBe(FCODE);
  });
});

describe('friendsRoomOf: the room as the screens draw it', () => {
  const request: FriendsRequest = { kind: 'friends', code: FCODE, reservation: null };
  const base: OnlineInfo = {
    status: 'lobby',
    closeReason: null,
    error: null,
    code: FCODE,
    playerId: ME,
    lobby: {
      code: FCODE,
      gameType: 'hard',
      playerCount: 4,
      players: [
        { id: ME, name: 'Moshe' },
        { id: DANA, name: 'Dana', away: false },
        { id: AVI, name: 'Avi', away: true },
      ],
      hostId: ME,
      minPlayers: 2,
      maxPlayers: 4,
    },
    reconnect: null,
    pendingCell: null,
    hasGame: false,
    resyncedAt: null,
    offlinePlay: null,
    queuedMoves: [],
    startsAt: null,
    friends: { code: FCODE, closed: null, refused: null },
  };

  it('the seats in order, me, the host, who is away; "התחל" counts the connected only [D83]', () => {
    const room = friendsRoomOf(base, request);
    expect(room.seats.map((s) => [s.id, s.isMe, s.isHost, s.away])).toEqual([
      [ME, true, true, false],
      [DANA, false, false, false],
      [AVI, false, false, true],
    ]);
    expect(room).toMatchObject({
      phase: 'lobby',
      code: FCODE,
      gameType: 'hard',
      isHost: true,
      hostId: ME,
      connected: 2,
      canStart: true,
      minPlayers: 2,
      maxPlayers: 4,
      closed: null,
    });
    expect(room.away.map((s) => s.id)).toEqual([AVI]);
    expect(room.host?.id).toBe(ME);
  });

  it('"התחל" stays off with one connected, for a guest, and outside the lobby', () => {
    const lone = {
      ...base,
      lobby: {
        ...base.lobby!,
        players: [
          { id: ME, name: 'Moshe' },
          { id: DANA, name: 'Dana', away: true },
        ],
      },
    };
    expect(friendsRoomOf(lone, request)).toMatchObject({ connected: 1, canStart: false });
    const guest = { ...base, lobby: { ...base.lobby!, hostId: DANA } };
    expect(friendsRoomOf(guest, request)).toMatchObject({ isHost: false, canStart: false });
    expect(friendsRoomOf({ ...base, status: 'reconnecting' }, request)).toMatchObject({
      phase: 'reconnecting',
      canStart: false,
    });
    expect(friendsRoomOf({ ...base, startsAt: 5000 }, request)).toMatchObject({
      phase: 'countdown',
      startsAt: 5000,
      canStart: false,
    });
    expect(friendsRoomOf({ ...base, hasGame: true, status: 'live' }, request).phase).toBe('game');
  });

  it('before the lobby: connecting, with the ticket’s summary and the defaults', () => {
    const room = friendsRoomOf(
      { ...base, status: 'connecting', lobby: null, playerId: null, friends: undefined },
      { ...request, gameType: 'fast' },
    );
    expect(room).toMatchObject({
      phase: 'connecting',
      code: FCODE,
      gameType: 'fast',
      seats: [],
      maxPlayers: 4,
    });
  });

  it('why I am out: what the screen says, and nothing for my own leave or the end', () => {
    const closed = (over: Partial<OnlineInfo>) =>
      friendsRoomOf({ ...base, status: 'closed', ...over }, request).closed;
    expect(closed({ closeReason: 'left' })).toMatchObject({ problem: null });
    expect(closed({ closeReason: 'gameOver' })).toMatchObject({ problem: null });
    expect(
      closed({
        closeReason: 'serverClosed',
        error: new OnlineError('kicked', 'roomClosed: kicked'),
        friends: { code: FCODE, closed: 'kicked', refused: null },
      }),
    ).toEqual({ closeReason: 'serverClosed', reason: 'kicked', problem: 'kicked', retryAfterMs: null });
    expect(
      closed({ closeReason: 'serverClosed', friends: { code: FCODE, closed: 'removed', refused: null } }),
    ).toMatchObject({ reason: 'removed', problem: 'roomClosed' });
    expect(closed({ closeReason: 'serverClosed' })).toMatchObject({ problem: 'roomClosed' });
    expect(
      closed({ closeReason: 'lostConnection', error: new OnlineError('gameStarted', 'gameStarted: …') }),
    ).toMatchObject({ problem: 'gameStarted' });
    expect(
      closed({ closeReason: 'refused', error: onlineErrorOfFriends('tooManyRequests', 429, 9000) }),
    ).toMatchObject({ problem: 'tooManyRequests', retryAfterMs: 9000 });
  });

  it('not a friends room’s session: null', async () => {
    expect(friendsRoomOfSession(null)).toBeNull();
    const table = new FakeTable();
    const { useStore } = setup();
    const dev = useStore.getState().startOnline({ kind: 'create', options: {} }, () => table.host);
    await dev.ready;
    expect(friendsRoomOfSession(dev)).toBeNull();
  });
});

describe('errors of the friends routes, as the host and the screens take them', () => {
  it.each([
    ['notFound', 'notFound'],
    ['roomFull', 'roomFull'],
    ['gameStarted', 'gameStarted'],
    ['roomClosed', 'roomClosed'],
    ['kicked', 'kicked'],
    ['suspended', 'suspended'],
    ['cantJoin', 'cantJoin'],
    ['tooManyRequests', 'tooManyRequests'],
    ['notAvailable', 'notAvailable'],
    ['unauthorized', 'unauthenticated'],
    ['notRegistered', 'unauthenticated'],
    ['network', 'network'],
    ['unavailable', 'network'],
    ['internal', 'network'],
    ['disabled', 'network'],
    ['badRequest', 'unknown'],
  ] as const)('%s → %s, and the screen still says %s', (problem, code) => {
    const e = onlineErrorOfFriends(problem, 400, problem === 'tooManyRequests' ? 5000 : null);
    expect(e).toBeInstanceOf(OnlineError);
    expect(e.code).toBe(code);
    expect(e.friends).toBe(problem);
    expect(friendsProblemOf(e)).toBe(problem);
    expect(e.retryAfterMs).toBe(problem === 'tooManyRequests' ? 5000 : null);
  });

  it('the room’s own refusals (GAME_ROOM_ERRORS) as a friends screen says them', () => {
    expect(friendsProblemOf(new OnlineError('roomGone', 'disposed'))).toBe('notFound');
    expect(friendsProblemOf(new OnlineError('kicked', 'kicked: …'))).toBe('kicked');
    expect(friendsProblemOf(new OnlineError('unauthenticated', '…'))).toBe('unauthorized');
    expect(friendsProblemOf(new OnlineError('alreadyInRoom', '…'))).toBe('internal');
  });
});
