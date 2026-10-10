import type { CellIndex, HostUpdate } from '@sudoku-fight/engine';

import { PROTOCOL_VERSION } from '@sudoku-fight/protocol';

import {
  CODE,
  elapse,
  FakeGame,
  FakeTable,
  ME,
  OPP,
  rankedConfig,
  sdkError,
} from '../../net/testing/fakeServer';
import { isOnlineSession, OnlineSession } from '../onlineSession';
import { answerIn, emptyCellsOf, PUZZLE } from '../testing/practice';

/** OnlineSession (stage 7): the practice session's surface around a RemoteGameHost, and its analytics. */

const cells = emptyCellsOf(PUZZLE);

function sessionOn(table: FakeTable, request: OnlineSession['request'] = { kind: 'create', options: {} }) {
  const tracked: { name: string; props: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  const session = new OnlineSession({
    host: table.host,
    request,
    track: (name, props) => tracked.push({ name, props }),
    onError: (e) => errors.push(e.code),
  });
  return { session, tracked, errors };
}

async function started(table = new FakeTable()) {
  const s = sessionOn(table);
  await s.session.ready;
  table.lobby();
  table.startGame();
  await elapse(table, 300);
  return { table, ...s };
}

describe('OnlineSession', () => {
  it('creates the room, and has the practice session’s surface once the game is here', async () => {
    const table = new FakeTable({ rules: { graceMs: 5000 } });
    const { session } = sessionOn(table, { kind: 'create', options: { gameType: 'fast', playerCount: 2 } });
    expect(isOnlineSession(session)).toBe(true);
    expect(session.mode).toBe('ranked');
    expect(session.hasGame).toBe(false);
    expect(session.id).toBe(session.key);
    expect(session.graceMs).toBeNull();
    expect(session.connection.graceMs).toBeNull();
    expect(session.gameType).toBe('fast');
    expect(session.online.status).toBe('connecting');
    await session.ready;
    expect(table.calls).toEqual([{ kind: 'create', arg: { gameType: 'fast', playerCount: 2 } }]);
    expect(session.connection.info.status).toBe('lobby');

    table.lobby();
    table.startGame();
    await elapse(table, 300);
    expect(session.hasGame).toBe(true);
    expect(session.id).toBe('online-1'); // the game's own id
    expect(session.playerId).toBe(ME);
    expect(session.graceMs).toBe(5000);
    expect(session.connection.graceMs).toBe(5000);
    expect(session.getView().status).toBe('running');
    // The clock is the server's (the host's synced clock), not the phone's.
    expect(session.clock).toBe(table.host.clock);
  });

  it('joins by code; a refusal is reported and shown, never thrown', async () => {
    const table = new FakeTable();
    const { session, errors } = sessionOn(table, { kind: 'join', code: 'zzz-999' });
    await expect(session.ready).resolves.toBeUndefined();
    expect(errors).toEqual(['notFound']);
    expect(session.online).toMatchObject({ status: 'closed', closeReason: 'refused' });

    const ok = sessionOn(new FakeTable(), { kind: 'join', code: CODE });
    await ok.session.ready;
    expect(ok.session.online.status).toBe('lobby');
  });

  it('tracks game_start when it sees the game begin, and game_end once at the end', async () => {
    const { table, session, tracked } = await started();
    expect(tracked).toEqual([{ name: 'game_start', props: { mode: 'ranked', type: 'fast', players: 2 } }]);

    // I solve one cell, then the opponent surrenders: I win.
    const updates: HostUpdate[] = [];
    session.subscribe((u) => updates.push(u));
    const cell = cells[0] as CellIndex;
    session.host.select(cell);
    await elapse(table, 100);
    session.host.place(cell, answerIn(PUZZLE, cell));
    await elapse(table, 100);
    table.opponent({ type: 'surrender' });
    await elapse(table, 100);
    expect(session.getView().status).toBe('over');
    // The solution after the end is one more update: still one game_end.
    await elapse(table, 100);
    expect(updates.some((u) => u.kind === 'events' && u.events.length === 0)).toBe(true);
    expect(tracked.map((t) => t.name)).toEqual(['game_start', 'game_end']);
    expect(tracked[1]!.props).toMatchObject({ mode: 'ranked', result: 'win', mistakes: 0 });
    expect(tracked[1]!.props.score).toBeGreaterThan(0);
  });

  it('a rejoin mid-game is not a new start; its end still counts once', async () => {
    const table = new FakeTable();
    const { session, tracked } = sessionOn(table, { kind: 'join', code: CODE });
    await session.ready;
    // The game started without this session (a retry joining by code): its first snapshot is a running game.
    const game = new FakeGame(
      rankedConfig(),
      () => table.serverNow(),
      table.scheduler,
      (events) => table.room.deliver({ type: 'events', events }),
    );
    game.apply({ type: 'start' });
    table.room.deliver({
      type: 'snapshot',
      protocol: PROTOCOL_VERSION,
      state: game.publicState(),
      playerId: ME,
      lastClientSeq: 3,
    });
    expect(session.getView().status).toBe('running');
    expect(tracked).toEqual([]);
    game.act(OPP, { type: 'surrender' });
    expect(session.getView().status).toBe('over');
    expect(tracked.map((t) => t.name)).toEqual(['game_end']);
    expect(tracked[0]!.props).toMatchObject({ result: 'win' });
  });

  it('"end practice" is the surrender (spec §6.6): with 2 players an immediate loss', async () => {
    const { table, session, tracked } = await started();
    session.endPractice();
    expect(table.room.actions.at(-1)).toMatchObject({ type: 'surrender' });
    await elapse(table, 100);
    const view = session.getView();
    expect(view.status).toBe('over');
    expect(view.result?.ranking.find((r) => r.playerId === ME)).toMatchObject({
      place: 2,
      status: 'surrendered',
    });
    expect(tracked.at(-1)).toMatchObject({ name: 'game_end', props: { result: 'loss' } });
    // Over: nothing more goes out.
    const sent = table.room.actions.length;
    session.surrender();
    expect(table.room.actions).toHaveLength(sent);
  });

  it('close() leaves the room and stops following it', async () => {
    const { table, session } = await started();
    session.close();
    expect(table.room.left).toBe(true);
    expect(session.online).toMatchObject({ status: 'closed', closeReason: 'left' });
    session.close(); // twice is fine
    table.opponent({ type: 'select', cell: cells[1] as CellIndex });
    await elapse(table, 100);
    expect(session.getView().players.find((p) => p.id === OPP)!.lock).toBeNull();
  });

  it('analytics that throw never break the game', async () => {
    const table = new FakeTable();
    const session = new OnlineSession({
      host: table.host,
      request: { kind: 'create', options: {} },
      track: () => {
        throw new Error('analytics down');
      },
    });
    await session.ready;
    table.lobby();
    table.startGame();
    await elapse(table, 300);
    expect(session.getView().status).toBe('running');
  });

  it('a refused create keeps the SDK error’s code', async () => {
    const table = new FakeTable();
    jest.spyOn(table, 'create').mockRejectedValue(sdkError('badOptions: private rooms are off', 521));
    const { session, errors } = sessionOn(table);
    await session.ready;
    expect(errors).toEqual(['badOptions']);
    expect(session.online.error?.supportCode).toBe('badOptions-521');
  });
});
