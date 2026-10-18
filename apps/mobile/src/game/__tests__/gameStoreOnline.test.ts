import { ManualClock, ManualScheduler } from '@sudoku-fight/engine';

import { CODE, elapse, FakeTable } from '../../net/testing/fakeServer';
import { createGameStore, type GameStoreDeps } from '../gameStore';
import type { OnlineEnd } from '../onlineSession';
import { smallPool } from '../testing/practice';

/** The game store's online game (stage 7): at most one game at a time, retries, and letting go. */

jest.mock('../../services/analytics', () => ({ track: jest.fn() }));

function storeWith(tables: FakeTable[]) {
  const clock = new ManualClock(1_700_000_000_000);
  const made: FakeTable[] = [];
  const ends: OnlineEnd[] = [];
  const deps: GameStoreDeps = {
    repo: () => Promise.resolve(null),
    session: { clock, scheduler: new ManualScheduler(clock), pool: smallPool(2), track: () => undefined },
    onlineHost: () => {
      const table = tables[made.length];
      if (!table) throw new Error('no more tables');
      made.push(table);
      return table.host;
    },
    onlineTrack: () => undefined,
    onlineEnd: (end) => ends.push(end),
  };
  return { useStore: createGameStore(deps), made, ends };
}

describe('the game store online', () => {
  it('goes online at once (the session shows the joining), and follows the game’s picture', async () => {
    const table = new FakeTable();
    const { useStore } = storeWith([table]);
    const online = useStore.getState().startOnline({ kind: 'create', options: { gameType: 'fast' } });
    expect(useStore.getState()).toMatchObject({ online, session: null, view: null });
    expect(online.online.status).toBe('connecting');
    await online.ready;
    table.lobby();
    table.startGame();
    await elapse(table, 300);
    expect(useStore.getState().view?.status).toBe('running');
    expect(useStore.getState().lastUpdate?.kind).toBe('events');
  });

  it('a practice closes the online game, and an online game closes the practice', async () => {
    const table = new FakeTable();
    const { useStore } = storeWith([table, new FakeTable()]);
    const online = useStore.getState().startOnline({ kind: 'join', code: CODE });
    await online.ready;
    const practice = await useStore.getState().startPractice({ gameType: 'fast' });
    expect(practice).not.toBeNull();
    expect(useStore.getState().online).toBeNull();
    expect(table.room.left).toBe(true); // left the room on purpose
    expect(online.online.closeReason).toBe('left');

    const next = useStore.getState().startOnline({ kind: 'join', code: CODE });
    expect(useStore.getState()).toMatchObject({ online: next, session: null });
  });

  it('"נסה שוב" makes a new session for the same room by its code', async () => {
    const first = new FakeTable();
    first.offline = true;
    const second = new FakeTable();
    const { useStore, made } = storeWith([first, second]);
    const failed = useStore.getState().startOnline({ kind: 'create', options: { gameType: 'normal' } });
    await failed.ready;
    expect(failed.online).toMatchObject({ status: 'closed', closeReason: 'refused' });
    // No room yet (the create failed): the same request again.
    const retried = useStore.getState().retryOnline()!;
    expect(made).toEqual([first, second]);
    expect(retried.request).toEqual({ kind: 'create', options: { gameType: 'normal' } });
    expect(useStore.getState().online).toBe(retried);
    await retried.ready;
    expect(retried.online.status).toBe('lobby');

    // In a room by now: a retry joins it by its code (same identity), whatever the first request was.
    const third = new FakeTable();
    const { useStore: store2 } = storeWith([new FakeTable(), third]);
    const inRoom = store2.getState().startOnline({ kind: 'create', options: {} });
    await inRoom.ready;
    expect(inRoom.host.roomCode).toBe(CODE);
    const rejoin = store2.getState().retryOnline()!;
    // With the room's game type as known so far (the loading card's tag before the game says it).
    expect(rejoin.request).toEqual({ kind: 'join', code: CODE, gameType: inRoom.gameType });
    expect(inRoom.online.closeReason).toBe('left');
    await rejoin.ready;
    expect(third.calls).toEqual([{ kind: 'join', arg: CODE }]);
  });

  it('without an online game, a retry does nothing; startOnline needs a way to make a host', () => {
    const { useStore } = storeWith([]);
    expect(useStore.getState().retryOnline()).toBeNull();
    const bare = createGameStore({ repo: () => Promise.resolve(null) });
    expect(() => bare.getState().startOnline({ kind: 'join', code: CODE })).toThrow(/deviceHost/);
    const tables: FakeTable[] = [];
    const make = () => {
      const table = new FakeTable();
      tables.push(table);
      return table.host;
    };
    const online = bare.getState().startOnline({ kind: 'join', code: CODE }, make);
    expect(bare.getState().online).toBe(online);
    // A retry makes its host the same way.
    const retried = bare.getState().retryOnline();
    expect(retried?.host).toBe(tables[1]!.host);
  });

  it('endPractice is the online game’s surrender; clear() leaves the room', async () => {
    const table = new FakeTable();
    const { useStore } = storeWith([table]);
    const online = useStore.getState().startOnline({ kind: 'create', options: {} });
    await online.ready;
    table.lobby();
    table.startGame();
    await elapse(table, 300);
    useStore.getState().endPractice();
    expect(table.room.actions.at(-1)).toMatchObject({ type: 'surrender' });
    await elapse(table, 100);
    expect(useStore.getState().view?.status).toBe('over');

    useStore.getState().clear();
    expect(useStore.getState()).toMatchObject({ online: null, session: null, view: null });
    expect(online.online.status).toBe('closed');
  });

  it('every session reports its game’s end to deps.onlineEnd (the account’s rating follows it)', async () => {
    const table = new FakeTable();
    const rejoin = new FakeTable();
    const { useStore, ends } = storeWith([table, rejoin]);
    const online = useStore.getState().startOnline({ kind: 'create', options: {} });
    await online.ready;
    table.lobby();
    table.startGame();
    await elapse(table, 300);
    // "נסה שוב" closes the running session (leaving it), and the new one reports too.
    const again = useStore.getState().retryOnline()!;
    expect(ends.map((e) => e.left)).toEqual([true]);
    await again.ready;
    useStore.getState().clear();
    expect(ends.map((e) => e.left)).toEqual([true]);

    const third = new FakeTable();
    const { useStore: store2, ends: ends2 } = storeWith([third]);
    const played = store2.getState().startOnline({ kind: 'create', options: {} });
    await played.ready;
    third.lobby();
    third.startGame();
    await elapse(third, 300);
    store2.getState().endPractice();
    await elapse(third, 200);
    expect(ends2.map((e) => [e.left, e.state.status])).toEqual([[false, 'over']]);
    store2.getState().clear();
    expect(ends2).toHaveLength(1);
  });
});
