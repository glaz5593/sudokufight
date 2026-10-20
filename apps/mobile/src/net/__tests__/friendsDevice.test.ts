import { act, renderHook } from '@testing-library/react-native';

import { useGameStore } from '../../game/gameStore';
import { track } from '../../services/analytics';
import { createFriendsRooms } from '../friends';
import {
  currentFriendsRoomCode,
  deviceFriendsDeps,
  friendsLog,
  friendsRoomLink,
  friendsRooms,
  setFriendsRooms,
  signedInRoomsApi,
  subscribeCurrentFriendsRoom,
  useFriendsRoom,
} from '../friendsDevice';
import { DANA, elapse, FakeFriendsTable, FCODE } from '../testing/fakeFriends';

/**
 * Playing with friends wired to the phone (net/friendsDevice.ts): the routes only for a signed-in player, the
 * game store, the share link of this app's server, the room for the screens on every change, and "the room I
 * am in" for the link handling.
 */

jest.mock('../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('../../services/crashlytics', () => {
  const reporter = { enabled: true, recordError: jest.fn(), setUser: jest.fn(), log: jest.fn() };
  return { crashReporter: () => reporter };
});
const crash = jest
  .requireMock<{ crashReporter: () => { log: jest.Mock } }>('../../services/crashlytics')
  .crashReporter();

function enter(table = new FakeFriendsTable()) {
  const session = useGameStore
    .getState()
    .startFriends(
      { kind: 'friends', code: FCODE, reservation: table.reservation(), room: table.summary() },
      { makeHost: () => table.host, rejoin: table.rejoin },
    );
  return { table, session };
}

afterEach(() => {
  useGameStore.getState().clear();
  setFriendsRooms(null);
});

describe('friendsDevice', () => {
  it('the share link is this app’s server’s', () => {
    // Jest's server is the default local one (config/server.ts).
    expect(friendsRoomLink('123 456')).toBe('http://localhost:2567/r/123456');
  });

  it('no routes while nobody is signed in', () => {
    expect(signedInRoomsApi()).toBeNull();
  });

  it('the phone’s friends rooms are one for the run, and a test can put its own', () => {
    expect(friendsRooms()).toBe(friendsRooms());
    const own = createFriendsRooms(deviceFriendsDeps({ api: () => null }));
    setFriendsRooms(own);
    expect(friendsRooms()).toBe(own);
  });

  it('the store’s deps reach the game store; the log never breaks', () => {
    const { session } = enter();
    expect(deviceFriendsDeps().store.getOnline()).toBe(session);
    friendsLog('a room opened');
    expect(crash.log).toHaveBeenCalledWith('[friends] a room opened');
    deviceFriendsDeps().store.clear();
    expect(useGameStore.getState().online).toBeNull();
  });

  it('“the room I am in”: while in it (and while it may come back), not after leaving it', async () => {
    const codes: (string | null)[] = [];
    const stop = subscribeCurrentFriendsRoom((code) => codes.push(code));
    expect(codes).toEqual([null]);
    const { table, session } = enter();
    expect(currentFriendsRoomCode()).toBe(FCODE);
    await session.ready;
    await elapse(table, 50);
    // A lost connection may come back: still my room.
    table.offline = true;
    table.room.cut(1006);
    await elapse(table, 70_000, 1000);
    expect(session.online.closeReason).toBe('lostConnection');
    expect(currentFriendsRoomCode()).toBe(FCODE);
    // Left (the store let go of it): no room.
    useGameStore.getState().clear();
    expect(codes).toEqual([null, FCODE, null]);
    stop();
  });

  it('put out of the room: no room any more', async () => {
    const codes: (string | null)[] = [];
    const stop = subscribeCurrentFriendsRoom((code) => codes.push(code));
    const { table, session } = enter();
    await session.ready;
    await elapse(table, 50);
    table.closeMe('kicked');
    await elapse(table, 100);
    expect(codes).toEqual([null, FCODE, null]);
    expect(currentFriendsRoomCode()).toBeNull();
    stop();
  });

  it('useFriendsRoom: the room on every change; null without one', async () => {
    const hook = await renderHook(() => useFriendsRoom());
    expect(hook.result.current).toBeNull();
    const table = new FakeFriendsTable();
    let session!: ReturnType<typeof enter>['session'];
    await act(async () => {
      session = enter(table).session;
      await session.ready;
      await elapse(table, 50);
    });
    expect(hook.result.current?.session).toBe(session);
    expect(hook.result.current?.room).toMatchObject({
      phase: 'lobby',
      code: FCODE,
      isHost: true,
      connected: 1,
    });
    await act(async () => {
      table.arrive({ id: DANA, name: 'Dana' });
      await elapse(table, 50);
    });
    expect(hook.result.current?.room).toMatchObject({ connected: 2, canStart: true });
    await act(async () => {
      useGameStore.getState().clear();
    });
    expect(hook.result.current).toBeNull();
    // Leaving is counted through the app's analytics (the store's default track).
    expect(track).toHaveBeenCalledWith('friends_room_close', expect.objectContaining({ reason: 'left' }));
  });
});
