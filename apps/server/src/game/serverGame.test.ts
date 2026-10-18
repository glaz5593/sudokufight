import {
  defaultRules,
  type GameConfig,
  type GameEvent,
  ManualClock,
  ManualScheduler,
  missedPoints,
  type Rules,
  toPublicEvent,
} from '@sudoku-fight/engine';

import { digitAt, emptyCells, NEARLY_DONE, PUZZLE, wrongDigitAt } from '../testing/game';
import { ServerGame, type ServerGameUpdate } from './serverGame';

const T0 = Date.UTC(2026, 9, 9, 12);
const [C1, C2, C3] = emptyCells(PUZZLE) as [number, number, number];

function setup({
  players = ['ana', 'ben'],
  rules = {},
  puzzle = PUZZLE,
}: { players?: string[]; rules?: Partial<Rules>; puzzle?: typeof PUZZLE } = {}) {
  const clock = new ManualClock(T0);
  const scheduler = new ManualScheduler(clock);
  const config: GameConfig = {
    id: 'g1',
    mode: 'ranked',
    gameType: 'fast',
    puzzle,
    players: players.map((id) => ({ id, name: id })),
    rules: defaultRules('ranked', 'fast', rules),
    seed: 1,
  };
  const updates: ServerGameUpdate[] = [];
  const errors: unknown[] = [];
  const game = new ServerGame({
    config,
    clock,
    scheduler,
    onUpdate: (u) => updates.push(u),
    onError: (e) => errors.push(e),
  });
  /** Every event delivered so far, flattened. */
  const events = () => updates.flatMap((u) => u.events);
  const types = () => events().map((e) => e.type);
  return { clock, scheduler, game, updates, errors, events, types };
}

describe('ServerGame', () => {
  it('creates the game waiting (seq 1), and starts it at the server time', () => {
    const { game, clock, updates } = setup();
    expect(game.state.status).toBe('waiting');
    expect(game.state.seq).toBe(1);
    expect(game.events.map((e) => e.type)).toEqual(['gameCreated']);
    expect(updates).toHaveLength(0); // creation is the snapshot's business, not an update

    clock.advance(250);
    const r = game.start();
    expect(r.rejected).toBeUndefined();
    expect(updates).toHaveLength(1);
    expect(updates[0]!.events).toEqual([{ type: 'gameStarted', seq: 2, t: T0 + 250 }]);
    expect(updates[0]!.state.status).toBe('running');
    expect(game.start().rejected).toBe('alreadyStarted');
  });

  it("applies each player's action at the server's time, and a refusal changes nothing", () => {
    const { game, clock, updates, events } = setup();
    game.start();
    clock.advance(1234);
    game.act('ana', { type: 'select', cell: C1 });
    expect(events().at(-1)).toMatchObject({
      type: 'cellLocked',
      playerId: 'ana',
      cell: C1,
      t: T0 + 1234,
      expiresAt: T0 + 1234 + 8000,
    });

    const before = updates.length;
    const seq = game.state.seq;
    const r = game.act('ben', { type: 'select', cell: C1 }); // ana holds it
    expect(r.rejected).toBe('cellTaken');
    expect(updates).toHaveLength(before);
    expect(game.state.seq).toBe(seq);
    expect(game.act('zoe', { type: 'release' }).rejected).toBe('unknownPlayer');
  });

  it('checks digits against the solution and scores them (the client never had it)', () => {
    const { game, events } = setup();
    game.start();
    game.act('ana', { type: 'select', cell: C1 });
    game.act('ana', { type: 'place', cell: C1, digit: digitAt(PUZZLE, C1) });
    const correct = events().at(-1)!;
    expect(correct).toMatchObject({ type: 'placedCorrect', playerId: 'ana', cell: C1 });
    expect(correct.type === 'placedCorrect' && correct.points).toBeGreaterThan(0);

    // A mistake costs what the right digit would have scored there now (§6.5).
    const penalty = missedPoints(game.state.grid, C2, digitAt(PUZZLE, C2)).points;
    expect(penalty).toBeGreaterThanOrEqual(1.5);
    game.act('ben', { type: 'select', cell: C2 });
    game.act('ben', { type: 'place', cell: C2, digit: wrongDigitAt(PUZZLE, C2) });
    expect(events().slice(-2)).toMatchObject([
      { type: 'placedWrong', playerId: 'ben', penalty, mistakes: 1, score: -penalty },
      { type: 'cellReleased', playerId: 'ben', reason: 'mistake' },
    ]);
  });

  it('runs the timers on its own: a lock times out at its expiresAt', () => {
    const { game, scheduler, clock, events } = setup();
    game.start();
    game.act('ana', { type: 'select', cell: C1 });
    expect(scheduler.pending).toBe(1);
    scheduler.advance(7999);
    expect(events().at(-1)!.type).toBe('cellLocked');
    scheduler.advance(1);
    expect(events().at(-1)).toMatchObject({ type: 'cellReleased', reason: 'timeout', t: T0 + 8000 });
    expect(clock.now()).toBe(T0 + 8000);
    expect(scheduler.pending).toBe(0); // nothing left to wait for
  });

  it('a two-player game freezes on a disconnect: the lock timers stop, and move on after the reconnect', () => {
    const { game, scheduler, clock, events, types } = setup({ rules: { graceMs: 15_000 } });
    game.start();
    game.act('ana', { type: 'select', cell: C1 }); // expires at T0 + 8000
    clock.advance(1000);
    game.disconnect('ben');
    expect(events().slice(-2)).toEqual([
      { type: 'playerDisconnected', playerId: 'ben', graceEndsAt: T0 + 1000 + 15_000, seq: 4, t: T0 + 1000 },
      { type: 'gamePaused', reason: 'disconnect', seq: 5, t: T0 + 1000 },
    ]);
    // Frozen: ana can't act, and her lock does not run out although its time passes.
    expect(game.act('ana', { type: 'place', cell: C1, digit: digitAt(PUZZLE, C1) }).rejected).toBe('paused');
    scheduler.advance(10_000);
    expect(types()).not.toContain('cellReleased');

    game.reconnect('ben'); // at T0 + 11000, after 10 s frozen
    expect(events().slice(-2)).toEqual([
      { type: 'playerReconnected', playerId: 'ben', seq: 6, t: T0 + 11_000 },
      {
        type: 'gameResumed',
        reason: 'reconnect',
        pausedMs: 10_000,
        locks: [{ playerId: 'ana', cell: C1, expiresAt: T0 + 18_000, remainingMs: 7000 }],
        seq: 7,
        t: T0 + 11_000,
      },
    ]);
    scheduler.advance(6999);
    expect(types()).not.toContain('cellReleased');
    scheduler.advance(1);
    expect(events().at(-1)).toMatchObject({ type: 'cellReleased', reason: 'timeout', t: T0 + 18_000 });
  });

  it('a grace period that runs out is abandonment: in two players the other wins [D8]', () => {
    const { game, scheduler, events } = setup({ rules: { graceMs: 15_000 } });
    game.start();
    game.disconnect('ben');
    scheduler.advance(14_999);
    expect(game.isOver).toBe(false);
    scheduler.advance(1);
    expect(
      events()
        .slice(-2)
        .map((e) => e.type),
    ).toEqual(['playerAbandoned', 'gameOver']);
    const over = events().at(-1)!;
    expect(over.type === 'gameOver' && over.reason).toBe('lastPlayerStanding');
    expect(over.type === 'gameOver' && over.ranking.map((r) => [r.playerId, r.place, r.status])).toEqual([
      ['ana', 1, 'active'],
      ['ben', 2, 'abandoned'],
    ]);
    expect(game.isOver).toBe(true);
    expect(scheduler.pending).toBe(0);
  });

  it('a lost connection [D42]: the soft phase first (the game goes on), then the grace from its end', () => {
    const { game, scheduler, clock, events, types } = setup({
      rules: { softGraceMs: 10_000, graceMs: 15_000 },
    });
    game.start();
    game.act('ana', { type: 'select', cell: C1 }); // expires at T0 + 8000
    clock.advance(1000);
    expect(game.disconnect('ben', { soft: true }).rejected).toBeUndefined();
    expect(events().at(-1)).toEqual({
      type: 'playerConnectionLost',
      playerId: 'ben',
      softEndsAt: T0 + 11_000,
      seq: 4,
      t: T0 + 1000,
    });
    // A mark only: nothing froze, and ana's lock runs out on time.
    expect(game.state.status).toBe('running');
    scheduler.advance(7000);
    expect(events().at(-1)).toMatchObject({ type: 'cellReleased', reason: 'timeout', t: T0 + 8000 });
    expect(game.act('ana', { type: 'select', cell: C2 }).rejected).toBeUndefined();
    // His own actions wait for his return; a second drop report changes nothing.
    expect(game.act('ben', { type: 'select', cell: C3 }).rejected).toBe('disconnected');
    expect(game.disconnect('ben', { soft: true }).rejected).toBe('alreadyDisconnected');

    // The timer fires at softEndsAt: the hard phase, as a disconnect was before (two players: a freeze).
    scheduler.advance(2999);
    expect(types()).not.toContain('playerDisconnected');
    scheduler.advance(1);
    expect(events().slice(-2)).toMatchObject([
      { type: 'playerDisconnected', playerId: 'ben', graceEndsAt: T0 + 26_000, t: T0 + 11_000 },
      { type: 'gamePaused', reason: 'disconnect', t: T0 + 11_000 },
    ]);
    // And at the grace's end: abandonment, 25 s after the drop.
    scheduler.advance(14_999);
    expect(game.isOver).toBe(false);
    scheduler.advance(1);
    expect(
      events()
        .slice(-2)
        .map((e) => [e.type, e.t]),
    ).toEqual([
      ['playerAbandoned', T0 + 26_000],
      ['gameOver', T0 + 26_000],
    ]);
    expect(scheduler.pending).toBe(0);
  });

  it('back within the soft phase [D42]: only playerReconnected, and a move made offline is applied', () => {
    const { game, scheduler, clock, events, types } = setup();
    game.start();
    game.disconnect('ben', { soft: true });
    expect(scheduler.pending).toBe(1); // the end of the soft phase
    clock.advance(4000);
    game.reconnect('ben');
    expect(events().at(-1)).toEqual({ type: 'playerReconnected', playerId: 'ben', seq: 4, t: T0 + 4000 });
    expect(game.state.players[1]!.offlineWindow).toEqual({ until: T0 + 9000, left: 8 });
    expect(scheduler.pending).toBe(0); // nothing left to wait for: the soft timer went with him

    clock.advance(100);
    const digit = digitAt(PUZZLE, C2);
    expect(game.act('ben', { type: 'offlineMove', cell: C2, digit, thinkMs: 2500 }).rejected).toBeUndefined();
    expect(events().slice(-2)).toMatchObject([
      { type: 'cellLocked', playerId: 'ben', cell: C2 },
      { type: 'placedCorrect', playerId: 'ben', cell: C2, digit, thinkMs: 2500, offline: true },
    ]);
    scheduler.advance(30_000);
    expect(types()).not.toContain('gamePaused');
    expect(types()).not.toContain('playerDisconnected');
  });

  it('with the soft phase off (softGraceMs 0) a lost connection is hard at once, as before', () => {
    const { game, events } = setup({ rules: { softGraceMs: 0, graceMs: 15_000 } });
    game.start();
    game.disconnect('ben', { soft: true });
    expect(
      events()
        .slice(-2)
        .map((e) => e.type),
    ).toEqual(['playerDisconnected', 'gamePaused']);
  });

  it('with three players a disconnect does not freeze the game: the lock goes, and the game goes on', () => {
    const { game, scheduler, events, types } = setup({ players: ['ana', 'ben', 'cy'] });
    game.start();
    game.act('ben', { type: 'select', cell: C1 });
    game.disconnect('ben');
    expect(
      events()
        .slice(-2)
        .map((e) => e.type),
    ).toEqual(['playerDisconnected', 'cellReleased']);
    expect(game.state.status).toBe('running');
    game.act('ana', { type: 'select', cell: C2 });
    scheduler.advance(15_000);
    expect(types()).toContain('playerAbandoned');
    expect(game.isOver).toBe(false);
  });

  it('surrender in two players ends the game at once', () => {
    const { game, events } = setup();
    game.start();
    game.act('ben', { type: 'surrender' });
    expect(
      events()
        .slice(-2)
        .map((e) => e.type),
    ).toEqual(['playerSurrendered', 'gameOver']);
    const over = events().at(-1)!;
    expect(over.type === 'gameOver' && over.ranking[0]!.playerId).toBe('ana');
    expect(game.act('ana', { type: 'select', cell: C1 }).rejected).toBe('gameOver');
  });

  it('finishing the board ends the game (boardComplete)', () => {
    const { game, events } = setup({ puzzle: NEARLY_DONE });
    game.start();
    for (const cell of emptyCells(NEARLY_DONE)) {
      game.act('ana', { type: 'select', cell });
      game.act('ana', { type: 'place', cell, digit: digitAt(NEARLY_DONE, cell) });
    }
    const over = events().at(-1)!;
    expect(over.type === 'gameOver' && over.reason).toBe('boardComplete');
  });

  it('keeps the solution to itself while the game runs (spec §21)', () => {
    const { game, events } = setup();
    expect(JSON.stringify(game.publicState())).not.toContain(PUZZLE.solution);
    expect(game.publicState().config.puzzle.solution).toBe('');
    // The log keeps it (for the replay); the public form of gameCreated does not.
    expect(game.events[0]!.type === 'gameCreated' && game.events[0]!.config.puzzle.solution).toBe(
      PUZZLE.solution,
    );
    expect(JSON.stringify(toPublicEvent(game.events[0]!))).not.toContain(PUZZLE.solution);
    game.start();
    game.act('ana', { type: 'select', cell: C1 });
    expect(JSON.stringify(events())).not.toContain(PUZZLE.solution);
    game.act('ana', { type: 'surrender' });
    expect(game.publicState().config.puzzle.solution).toBe(PUZZLE.solution); // over: now it may go
    expect(game.solution).toBe(PUZZLE.solution);
  });

  it('delivers updates in order even when the receiver acts while being told', () => {
    const clock = new ManualClock(T0);
    const seen: string[] = [];
    const game: ServerGame = new ServerGame({
      config: {
        id: 'g',
        mode: 'ranked',
        gameType: 'fast',
        puzzle: PUZZLE,
        players: [{ id: 'ana' }, { id: 'ben' }],
        rules: defaultRules('ranked', 'fast'),
      },
      clock,
      scheduler: new ManualScheduler(clock),
      onUpdate: ({ events }) => {
        seen.push(events.map((e) => e.type).join('+'));
        // A receiver that acts at once (as a room may): its update must come after this one.
        if (events[0]!.type === 'gameStarted') game.act('ana', { type: 'select', cell: C1 });
        seen.push('/');
      },
    });
    game.start();
    expect(seen).toEqual(['gameStarted', '/', 'cellLocked', '/']);
  });

  it('a receiver that throws costs neither the game its clock nor later updates', () => {
    const clock = new ManualClock(T0);
    const scheduler = new ManualScheduler(clock);
    const errors: unknown[] = [];
    let calls = 0;
    const game = new ServerGame({
      config: {
        id: 'g',
        mode: 'ranked',
        gameType: 'fast',
        puzzle: PUZZLE,
        players: [{ id: 'ana' }, { id: 'ben' }],
        rules: defaultRules('ranked', 'fast'),
      },
      clock,
      scheduler,
      onUpdate: () => {
        calls++;
        throw new Error('broken socket');
      },
      onError: (e) => errors.push(e),
    });
    game.start();
    game.act('ana', { type: 'select', cell: C3 });
    scheduler.advance(8000); // the lock still times out
    expect(game.state.locks).toHaveLength(0);
    expect(calls).toBe(3);
    expect(errors).toHaveLength(3);
  });

  it('close() stops the timers and the updates', () => {
    const { game, scheduler, updates } = setup();
    game.start();
    game.act('ana', { type: 'select', cell: C1 });
    const n = updates.length;
    game.close();
    expect(game.isClosed).toBe(true);
    expect(scheduler.pending).toBe(0);
    scheduler.advance(20_000);
    expect(updates).toHaveLength(n);
    expect(() => game.act('ana', { type: 'release' })).toThrow('closed');
  });

  it('a timer that fires a little early waits for its deadline', () => {
    const clock = new ManualClock(T0);
    const pending: { fn: () => void; ms: number }[] = [];
    const updates: GameEvent[] = [];
    const game = new ServerGame({
      config: {
        id: 'g',
        mode: 'ranked',
        gameType: 'fast',
        puzzle: PUZZLE,
        players: [{ id: 'ana' }, { id: 'ben' }],
        rules: defaultRules('ranked', 'fast'),
      },
      clock,
      scheduler: {
        setTimeout: (fn, ms) => pending.push({ fn, ms }),
        clearTimeout: () => undefined,
      },
      onUpdate: (u) => updates.push(...u.events),
    });
    game.start();
    game.act('ana', { type: 'select', cell: C1 });
    expect(pending.at(-1)!.ms).toBe(8000);
    clock.advance(7998); // the host's timer fires 2 ms early
    pending.at(-1)!.fn();
    expect(updates.at(-1)!.type).toBe('cellLocked');
    expect(pending.at(-1)!.ms).toBe(2); // re-armed for the rest
  });
});
