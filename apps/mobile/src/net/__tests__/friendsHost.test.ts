import type { HostUpdate } from '@sudoku-fight/engine';
import type { MatchSeatReservation } from '@sudoku-fight/protocol';

import { OnlineSession, type OnlineTrackName } from '../../game/onlineSession';
import { OnlineError } from '../errors';
import type { OnlineInfo } from '../remoteGameHost';
import { AVI, DANA, elapse, FakeFriendsTable, FCODE, FROOM } from '../testing/fakeFriends';
import { CODE, FakeTable, ME } from '../testing/fakeServer';

/**
 * RemoteGameHost in a friends room (1.0.4, friends-room.md §3, §4, §7): the seat a ticket reserved, the lobby's
 * new fields, the host's commands, the server's roomClosed and lobbyRefused, and the seat held while the app is
 * away [D84a]: back with the token, or without a seat for it through POST /v1/rooms/join.
 */

const SEAT = { name: 'friends', sessionId: 's0', roomId: FROOM };

async function inLobby(table = new FakeFriendsTable()): Promise<FakeFriendsTable> {
  await table.host.enterFriends(FCODE, table.reservation(), table.rejoin);
  await elapse(table, 50);
  return table;
}

const kinds = (table: FakeFriendsTable) => table.calls.map((c) => c.kind);

function infos(table: FakeFriendsTable): OnlineInfo[] {
  const seen: OnlineInfo[] = [];
  table.host.subscribeOnline((i) => seen.push(i));
  return seen;
}

describe('RemoteGameHost in a friends room: getting in, and the lobby', () => {
  it('takes the reserved seat; the code is the 6 digits, never the room’s id', async () => {
    const table = new FakeFriendsTable({ others: [] });
    const entering = table.host.enterFriends(FCODE, { ...SEAT, roomId: FROOM }, table.rejoin);
    // Before any word from the room, the code is already the room's 6 digits.
    expect(table.host.online).toMatchObject({ status: 'connecting', code: FCODE });
    expect(table.host.online.friends).toEqual({ code: FCODE, closed: null, refused: null });
    await entering;
    expect(kinds(table)).toEqual(['reserved']);
    expect(table.host.isFriendsRoom).toBe(true);
    expect(table.host.roomCode).toBe(FCODE);
    expect(table.host.online.code).toBe(FCODE);
    expect(table.host.online.code).not.toBe(FROOM);
    await elapse(table, 50);
    expect(table.host.online).toMatchObject({ status: 'lobby', code: FCODE, playerId: ME });
  });

  it('the lobby carries the host, the seat limits, and each seat’s avatar, flag, rating and away', async () => {
    const table = await inLobby(
      new FakeFriendsTable({
        others: [{ id: DANA, name: 'Dana', avatarId: 'av00', country: 'IL', rating: 1190, away: true }],
      }),
    );
    expect(table.host.online.lobby).toEqual({
      code: FCODE,
      gameType: 'normal',
      playerCount: 4,
      players: [
        { id: ME, name: 'Moshe', avatarId: 'av00', country: 'IL', rating: 1287, away: false },
        { id: DANA, name: 'Dana', avatarId: 'av00', country: 'IL', rating: 1190, away: true },
      ],
      hostId: ME,
      minPlayers: 2,
      maxPlayers: 4,
    });
    table.arrive({ id: AVI, name: 'Avi' });
    await elapse(table, 50);
    expect(table.host.online.lobby?.players.map((p) => p.id)).toEqual([ME, DANA, AVI]);
  });

  it('a dev room’s lobby has none of the friends fields', async () => {
    const table = new FakeTable();
    await table.host.create({});
    table.lobby();
    await elapse(table, 50);
    expect(table.host.online.lobby).toEqual({
      code: CODE,
      gameType: 'fast',
      playerCount: 2,
      players: [{ id: ME, name: 'Moshe' }],
    });
    expect(table.host.online.friends).toBeUndefined();
    expect(table.host.isFriendsRoom).toBe(false);
  });

  it('without a reservation, it takes one through the route first (a retry, the app opened again)', async () => {
    const table = new FakeFriendsTable();
    await table.host.enterFriends(FCODE, null, table.rejoin);
    expect(kinds(table)).toEqual(['rejoin', 'reserved']);
    await elapse(table, 50);
    expect(table.host.online.status).toBe('lobby');
  });

  it('a refused way in closes the host as refused, with the route’s own code kept', async () => {
    const table = new FakeFriendsTable();
    table.rejoinRefusal = 'kicked';
    await expect(table.host.enterFriends(FCODE, null, table.rejoin)).rejects.toBeInstanceOf(OnlineError);
    expect(table.host.online).toMatchObject({ status: 'closed', closeReason: 'refused' });
    expect(table.host.online.error).toMatchObject({ code: 'kicked', friends: 'kicked' });

    // The room's own refusal at the door (the ticket came, then the host removed me): GAME_ROOM_ERRORS.
    const late = new FakeFriendsTable();
    late.consumeRefusal = 'roomClosed: the room closed';
    await expect(late.host.enterFriends(FCODE, late.reservation(), late.rejoin)).rejects.toThrow();
    expect(late.host.online.error?.code).toBe('roomClosed');
  });
});

describe('RemoteGameHost in a friends room: the host’s commands, and the server’s answers', () => {
  it('sends start, setGameType and kick as room messages of their own', async () => {
    const table = await inLobby();
    expect(table.host.sendLobbyCommand({ type: 'setGameType', gameType: 'hard' })).toBe(true);
    expect(table.host.sendLobbyCommand({ type: 'kick', playerId: DANA })).toBe(true);
    expect(table.host.sendLobbyCommand({ type: 'start', withoutAway: [AVI] })).toBe(true);
    expect(table.commands).toEqual([
      { type: 'setGameType', gameType: 'hard' },
      { type: 'kick', playerId: DANA },
      { type: 'start', withoutAway: [AVI] },
    ]);
    // None of them is a game action: no clientSeq.
    expect(table.room.sent.every((m) => !('clientSeq' in m))).toBe(true);
  });

  it('sends nothing before the room, during the countdown, after the end, or in another room', async () => {
    const table = new FakeFriendsTable();
    expect(table.host.sendLobbyCommand({ type: 'start' })).toBe(false);
    await inLobby(table);
    table.countdown();
    await elapse(table, 50);
    expect(table.host.online.startsAt).not.toBeNull();
    expect(table.host.sendLobbyCommand({ type: 'start' })).toBe(false);
    table.host.close();
    expect(table.host.sendLobbyCommand({ type: 'start' })).toBe(false);
    expect(table.commands).toEqual([]);

    const dev = new FakeTable();
    await dev.host.create({});
    dev.lobby();
    await elapse(dev, 50);
    expect(dev.host.sendLobbyCommand({ type: 'start' })).toBe(false);
    expect(dev.room.sent.filter((m) => m.type !== 'ping')).toEqual([]);
  });

  it('a refused command shows, numbered, so the same refusal twice is two changes', async () => {
    const table = await inLobby();
    table.refuse('start', 'playersAway', [DANA]);
    await elapse(table, 50);
    const first = table.host.online.friends?.refused;
    expect(first).toMatchObject({
      type: 'lobbyRefused',
      command: 'start',
      reason: 'playersAway',
      away: [DANA],
    });
    table.refuse('start', 'playersAway', [DANA]);
    await elapse(table, 50);
    expect(table.host.online.friends?.refused?.seq).toBe((first?.seq ?? 0) + 1);
    expect(table.host.online.status).toBe('lobby');
  });

  it.each([
    ['kicked', 'kicked'],
    ['removed', 'roomClosed'],
    ['otherDevice', 'roomClosed'],
    ['serverRestart', 'roomClosed'],
    ['closed', 'roomClosed'],
  ] as const)('roomClosed %s closes the host at once, and nothing comes back', async (reason, code) => {
    const table = await inLobby();
    table.closeMe(reason);
    await elapse(table, 5000);
    expect(table.host.online).toMatchObject({ status: 'closed', closeReason: 'serverClosed' });
    expect(table.host.online.error?.code).toBe(code);
    expect(table.host.online.friends?.closed).toBe(reason);
    expect(kinds(table)).toEqual(['reserved']); // no reconnect, no rejoin
  });

  it('the countdown, then the game at GO, as in a ranked match', async () => {
    const table = await inLobby();
    const updates: HostUpdate[] = [];
    table.host.subscribe((u) => updates.push(u));
    const startsAt = table.countdown(3000);
    await elapse(table, 50);
    expect(table.host.online.startsAt).toBe(startsAt);
    table.startGame();
    await elapse(table, 100);
    expect(table.host.online).toMatchObject({ status: 'live', hasGame: true, code: FCODE });
    expect(table.host.getView().status).toBe('running');
    expect(updates.length).toBeGreaterThan(0);
  });
});

describe('RemoteGameHost in a friends room: the app away, and back [D84a]', () => {
  it('the background in the lobby lets go of the socket (the seat held, shown away); back, the token', async () => {
    const table = await inLobby();
    const seen = infos(table);
    table.appState.set('background');
    expect(table.room.left).toBe(false); // a drop, not a goodbye: the seat is held
    expect(table.players.find((p) => p.id === ME)?.away).toBe(true);
    expect(table.host.online).toMatchObject({ status: 'reconnecting', reconnect: { cause: 'background' } });
    // 15 minutes in WhatsApp: nothing tried meanwhile, and nothing given up.
    await elapse(table, 15 * 60_000, 1000);
    expect(kinds(table)).toEqual(['reserved']);
    expect(table.host.online.status).toBe('reconnecting');

    table.appState.set('active');
    await elapse(table, 100);
    expect(kinds(table)).toEqual(['reserved', 'reconnect']);
    expect(table.host.online).toMatchObject({ status: 'lobby', code: FCODE, reconnect: null });
    expect(table.host.online.lobby?.hostId).toBe(ME); // still the host
    expect(seen.some((i) => i.status === 'reconnecting')).toBe(true);
  });

  it('no seat for the token: back through the route, the same account’s own seat', async () => {
    const table = await inLobby();
    table.appState.set('background');
    table.refuseToken = true;
    table.appState.set('active');
    await elapse(table, 100);
    expect(kinds(table)).toEqual(['reserved', 'reconnect', 'rejoin', 'reserved']);
    expect(table.host.online).toMatchObject({ status: 'lobby', code: FCODE });
  });

  it('a lost connection in the lobby keeps trying for friendsLobbyReturnMs, then gives up', async () => {
    const table = await inLobby(new FakeFriendsTable({ options: { friendsLobbyReturnMs: 60_000 } }));
    table.offline = true;
    table.room.cut(1006);
    // Past a game's deadline (soft phase + grace + slack, some 31 s): still trying.
    await elapse(table, 40_000, 250);
    expect(table.host.online.status).toBe('reconnecting');
    await elapse(table, 25_000, 250);
    expect(table.host.online).toMatchObject({ status: 'closed', closeReason: 'lostConnection' });
    expect(table.host.online.error?.code).toBe('network');
  });

  it('a lost connection that comes back in time takes the seat again', async () => {
    const table = await inLobby();
    table.offline = true;
    table.room.cut(1006);
    await elapse(table, 5000, 250);
    table.offline = false;
    await elapse(table, 2000, 250);
    expect(table.host.online).toMatchObject({ status: 'lobby', code: FCODE });
  });

  it.each([
    ['kicked', 'kicked'],
    ['gameStarted', 'gameStarted'],
    ['roomClosed', 'roomClosed'],
    ['notFound', 'notFound'],
  ] as const)('back from the background to a room that says %s: no more tries', async (refusal, code) => {
    const table = await inLobby();
    table.appState.set('background');
    table.refuseToken = true;
    table.rejoinRefusal = refusal;
    table.appState.set('active');
    await elapse(table, 5000, 100);
    expect(table.host.online).toMatchObject({ status: 'closed', closeReason: 'lostConnection' });
    expect(table.host.online.error).toMatchObject({ code, friends: refusal });
    expect(kinds(table).filter((k) => k === 'rejoin')).toHaveLength(1);
  });

  it('too many tries: waits as long as the route asked before the next', async () => {
    const table = await inLobby();
    table.appState.set('background');
    table.refuseToken = true;
    let calls = 0;
    const original = table.rejoin;
    const host = table.host as unknown as { friends: { rejoin: typeof original } };
    host.friends.rejoin = (code) => {
      calls++;
      if (calls === 1)
        return Promise.reject(
          Object.assign(new OnlineError('tooManyRequests', 'slow down', 429, { retryAfterMs: 8000 })),
        );
      return original(code);
    };
    table.appState.set('active');
    await elapse(table, 7000, 100);
    expect(calls).toBe(1);
    expect(table.host.online.status).toBe('reconnecting');
    await elapse(table, 2000, 100);
    expect(calls).toBe(2);
    expect(table.host.online.status).toBe('lobby');
  });

  it('the background during the game is the game’s own (a disconnect, back with the token)', async () => {
    const table = await inLobby();
    table.countdown(100);
    table.startGame();
    await elapse(table, 200);
    table.appState.set('background');
    expect(table.host.online.reconnect?.cause).toBe('background');
    expect(table.host.online.reconnect?.softEndsAt).not.toBeNull(); // the game's soft phase [D42]
    table.appState.set('active');
    await elapse(table, 200);
    expect(kinds(table)).toEqual(['reserved', 'reconnect']);
    expect(table.host.online.status).toBe('live');
  });

  it('a dev room’s lobby is not left in the background (as before)', async () => {
    const table = new FakeFriendsTable();
    const dev = new FakeTable({ appState: table.appState });
    await dev.host.create({});
    dev.lobby();
    await elapse(dev, 50);
    table.appState.set('background');
    expect(dev.room.open).toBe(true);
    expect(dev.host.online.status).toBe('lobby');
  });

  it('a friends message to a room that is not one changes nothing', async () => {
    const dev = new FakeTable();
    await dev.host.create({});
    dev.lobby();
    await elapse(dev, 50);
    dev.toMe({ type: 'lobbyRefused', command: 'start', reason: 'notHost' });
    await elapse(dev, 50);
    expect(dev.host.online.status).toBe('lobby');
    expect(dev.host.online.friends).toBeUndefined();
  });
});

describe('OnlineSession in a friends room: the analytics (generation 3)', () => {
  function sessionOn(
    table: FakeFriendsTable,
    reservation: MatchSeatReservation | null = table.reservation(),
  ) {
    const tracked: { name: OnlineTrackName; props: Record<string, unknown> }[] = [];
    const session = new OnlineSession({
      host: table.host,
      request: { kind: 'friends', code: FCODE, reservation, room: table.summary() },
      track: (name, props) => tracked.push({ name, props }),
      friends: { rejoin: table.rejoin },
    });
    return { session, tracked };
  }

  it('is a friends room’s session: its code, game type, and no game for "עוד סיבוב"', async () => {
    const table = new FakeFriendsTable();
    const { session } = sessionOn(table);
    expect(session.isFriends).toBe(true);
    expect(session.friendsCode).toBe(FCODE);
    expect(session.gameType).toBe('normal');
    await session.ready;
    await elapse(table, 50);
    expect(session.online.status).toBe('lobby');
  });

  it('needs the way back in', () => {
    const table = new FakeFriendsTable();
    expect(
      () =>
        new OnlineSession({
          host: table.host,
          request: { kind: 'friends', code: FCODE, reservation: null },
        }),
    ).toThrow(/rejoin/);
  });

  it('friends_room_start at the countdown, and friends: true on game_start and game_end', async () => {
    const table = new FakeFriendsTable({
      others: [
        { id: DANA, name: 'Dana' },
        { id: AVI, name: 'Avi', away: true },
      ],
    });
    const { session, tracked } = sessionOn(table);
    await session.ready;
    await elapse(table, 50);
    await elapse(table, 90_000, 1000); // a minute and a half in the lobby
    table.countdown(3000);
    await elapse(table, 50);
    expect(tracked).toEqual([{ name: 'friends_room_start', props: { players: 2, waitedSec: 90 } }]);
    table.startGame();
    await elapse(table, 100);
    expect(tracked[1]).toMatchObject({
      name: 'game_start',
      props: { mode: 'ranked', players: 2, friends: true },
    });
    session.surrender();
    await elapse(table, 200);
    expect(tracked.find((t) => t.name === 'game_end')?.props).toMatchObject({
      mode: 'ranked',
      friends: true,
    });
    expect(tracked.filter((t) => t.name === 'friends_room_start')).toHaveLength(1);
    expect(tracked.some((t) => t.name === 'friends_room_close')).toBe(false);
  });

  it('friends_room_close: left on purpose', async () => {
    const table = new FakeFriendsTable({ others: [{ id: DANA, name: 'Dana' }] });
    const { session, tracked } = sessionOn(table);
    await session.ready;
    await elapse(table, 30_000, 1000);
    session.close();
    expect(table.room.left).toBe(true); // a goodbye: the seat is freed at once
    expect(tracked).toEqual([
      { name: 'friends_room_close', props: { reason: 'left', players: 2, waitedSec: 30 } },
    ]);
  });

  it.each([
    ['kicked', 'kicked'],
    ['removed', 'removed'],
    ['otherDevice', 'otherDevice'],
    ['serverRestart', 'serverRestart'],
    ['closed', 'abandoned'],
  ] as const)('friends_room_close: roomClosed %s → %s', async (reason, expected) => {
    const table = new FakeFriendsTable();
    const { session, tracked } = sessionOn(table);
    await session.ready;
    await elapse(table, 50);
    table.closeMe(reason);
    await elapse(table, 100);
    expect(tracked).toEqual([
      { name: 'friends_room_close', props: { reason: expected, players: 1, waitedSec: 0 } },
    ]);
  });

  it('a retry back into a running game counts no start (it was counted), and no close', async () => {
    const table = new FakeFriendsTable();
    table.countdown(10);
    table.startGame();
    const { session, tracked } = sessionOn(table, null);
    await session.ready;
    await elapse(table, 200);
    expect(session.hasGame).toBe(true);
    expect(tracked.filter((t) => t.name.startsWith('friends_'))).toEqual([]);
    session.close();
    expect(tracked.filter((t) => t.name.startsWith('friends_'))).toEqual([]);
  });

  it('no close for a way in that failed (the join’s own event says it), none twice', async () => {
    const table = new FakeFriendsTable();
    table.consumeRefusal = 'kicked: removed by the host';
    const { session, tracked } = sessionOn(table);
    await session.ready;
    session.close();
    expect(tracked).toEqual([]);
  });

  it('a dev room’s game has no friends flag', async () => {
    const table = new FakeTable();
    const tracked: { name: string; props: Record<string, unknown> }[] = [];
    const session = new OnlineSession({
      host: table.host,
      request: { kind: 'create', options: {} },
      track: (name, props) => tracked.push({ name, props }),
    });
    await session.ready;
    table.lobby();
    table.startGame();
    await elapse(table, 300);
    expect(session.isFriends).toBe(false);
    expect(session.friendsCode).toBeNull();
    expect(tracked[0]?.props).not.toHaveProperty('friends');
  });
});
