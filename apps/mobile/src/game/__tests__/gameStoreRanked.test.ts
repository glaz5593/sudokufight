import { ManualClock, ManualScheduler } from '@sudoku-fight/engine';
import type { MatchPlayer } from '@sudoku-fight/protocol';

import { FakeMatchmaking, MATCH_ID, MATCH_PLAYERS, RESERVATION } from '../../net/testing/fakeMatchmaking';
import { CODE, elapse, FakeTable, settle } from '../../net/testing/fakeServer';
import { createGameStore, type GameStoreDeps, type RankedDeps } from '../gameStore';
import { smallPool } from '../testing/practice';

/**
 * The game store's ranked game (stage 9): a search (`match`) whose match's room becomes `online` at "found",
 * goes back to null if the match falls through, carries the game from GO, and lets go of everything on clear.
 */

jest.mock('../../services/analytics', () => ({ track: jest.fn() }));

function storeWith(tables: FakeTable[]) {
  const first = tables[0]!;
  const mm = new FakeMatchmaking(first.clock, first.scheduler);
  const clock = new ManualClock(1_700_000_000_000);
  const used: FakeTable[] = [];
  const tracked: { name: string; props: Record<string, unknown> }[] = [];
  const ranked = (): RankedDeps => ({
    connector: mm,
    clock: first.clock,
    scheduler: first.scheduler,
    track: (name, props) => tracked.push({ name, props }),
    makeHost: () => {
      const table = tables[used.length];
      if (!table) throw new Error('no more tables');
      used.push(table);
      return table.host;
    },
  });
  const deps: GameStoreDeps = {
    repo: () => Promise.resolve(null),
    session: { clock, scheduler: new ManualScheduler(clock), pool: smallPool(2), track: () => undefined },
    onlineTrack: (name, props) => tracked.push({ name, props }),
    ranked,
  };
  return { useStore: createGameStore(deps), mm, used, tracked };
}

describe('the game store: a ranked game (stage 9)', () => {
  it('searches, enters the match room at "found", and follows the game from GO', async () => {
    const table = new FakeTable();
    const { useStore, mm, used, tracked } = storeWith([table]);
    const match = useStore.getState().startRanked({ gameType: 'fast', players: 2 });
    expect(match.queueKey).toBe('fast-2p');
    expect(useStore.getState()).toMatchObject({ match, online: null, session: null, view: null });
    await settle();
    mm.searching();
    expect(match.info.phase).toBe('searching');

    mm.found();
    const online = useStore.getState().online!;
    expect(online).toBe(match.entry);
    expect(online.queueKey).toBe('fast-2p');
    expect(online.request).toEqual({
      kind: 'match',
      queueKey: 'fast-2p',
      matchId: MATCH_ID,
      reservation: RESERVATION,
    });
    expect(used).toEqual([table]);
    // The VS's avatars and countries go with the game (the cards, the locks, the results); the names and
    // ratings too (the loading card of a rejoin, Loading.dc.html).
    expect(online.profiles).toEqual({
      me: { avatarId: 'lava-lamp', country: 'IL', name: 'Moshe', rating: 1287, provisional: false },
      opp: { avatarId: 'maya', country: 'DE', name: 'NinaVolt', rating: 1305, provisional: true },
    });
    await settle();
    expect(table.calls.at(-1)).toEqual({ kind: 'reserved', arg: RESERVATION });
    expect(online.gameType).toBe('fast');

    mm.countdown(3000);
    await elapse(table, 3000, 100);
    table.startGame();
    await elapse(table, 200);
    expect(match.info.phase).toBe('started');
    expect(useStore.getState().view?.status).toBe('running');
    expect(online.host.roomCode).toBe(CODE);
    expect(tracked.map((e) => e.name)).toEqual(['matchmaking_wait', 'game_start']);

    // Leaving the game's flow lets go of the room.
    useStore.getState().clear();
    expect(useStore.getState()).toMatchObject({ match: null, online: null });
    expect(table.room.left).toBe(true);
  });

  it('a match that falls through takes its room away; the search goes on, and the next match is followed', async () => {
    const first = new FakeTable();
    const second = new FakeTable();
    const { useStore, mm } = storeWith([first, second]);
    const match = useStore.getState().startRanked({ gameType: 'normal', players: 2 });
    await settle();
    mm.searching();
    mm.found();
    const old = useStore.getState().online!;
    mm.matchCancelled({ requeued: true });
    expect(useStore.getState().online).toBeNull();
    expect(old.host.online.closeReason).toBe('left');
    expect(match.info.phase).toBe('searching');

    mm.searching({ requeued: true });
    mm.found({ matchId: 'match-2' });
    expect(useStore.getState().online).toBe(match.entry);
    expect(useStore.getState().online).not.toBe(old);
    useStore.getState().clear();
  });

  it('a practice (a bot meanwhile) leaves the queue; a new search replaces the old one', async () => {
    const { useStore, mm } = storeWith([new FakeTable()]);
    const match = useStore.getState().startRanked({ gameType: 'hard', players: 2 });
    await settle();
    mm.searching();
    mm.timeout();
    const practice = await useStore.getState().startBotPractice({ gameType: 'fast', level: 2 });
    expect(practice).not.toBeNull();
    expect(useStore.getState().match).toBeNull();
    expect(mm.room.left).toBe(true);
    expect(match.info.phase).toBe('timeout'); // closed as it was: nothing more to say

    const again = useStore.getState().startRanked({ gameType: 'hard', players: 2 });
    expect(useStore.getState()).toMatchObject({ match: again, session: null });
    expect(again).not.toBe(match);
    useStore.getState().clear();
  });

  it('needs its deps once; then "search again" reuses them', () => {
    const plain = createGameStore({ repo: () => Promise.resolve(null) });
    expect(() => plain.getState().startRanked({ gameType: 'fast', players: 2 })).toThrow(/needs its deps/);
  });

  it('"נסה שוב" after a ranked game began rejoins its room by code: a new host, the same profiles', async () => {
    const table = new FakeTable();
    const rejoin = new FakeTable();
    const { useStore, mm, used } = storeWith([table, rejoin]);
    useStore.getState().startRanked({ gameType: 'fast', players: 3 });
    await settle();
    mm.searching();
    const third: MatchPlayer = {
      ...MATCH_PLAYERS[1]!,
      id: 'p3',
      name: 'Ziv',
      avatarId: 'omer',
      country: 'FR',
    };
    mm.found({ players: [...MATCH_PLAYERS, third] });
    await settle();
    const before = useStore.getState().online!;
    expect(before.host.roomCode).toBe(CODE);
    table.cutMe();
    const again = useStore.getState().retryOnline()!;
    expect(again).not.toBeNull();
    // The match's game type goes along: the loading card says "מדורג · מהיר" before the game does.
    expect(again.request).toEqual({ kind: 'join', code: CODE, gameType: 'fast' });
    expect(again.gameType).toBe('fast');
    expect(used).toEqual([table, rejoin]);
    expect(again.host).toBe(rejoin.host);
    expect(again.profiles).toEqual(before.profiles);
    expect(again.profiles?.p3).toMatchObject({ avatarId: 'omer', country: 'FR', name: 'Ziv' });
    useStore.getState().clear();
  });

  it('"נסה שוב" in a ranked game rejoins its room by code; without a code there is nothing to go back to', async () => {
    const table = new FakeTable();
    const { useStore, mm } = storeWith([table]);
    useStore.getState().startRanked({ gameType: 'fast', players: 2 });
    await settle();
    mm.searching();
    table.offline = true;
    mm.found();
    await settle();
    // The seat could not be taken: no room code, no retry.
    expect(useStore.getState().online?.host.roomCode).toBeNull();
    expect(useStore.getState().retryOnline()).toBeNull();
    useStore.getState().clear();
  });
});
