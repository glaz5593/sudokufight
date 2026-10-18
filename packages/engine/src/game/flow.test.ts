import { parseCellName } from '../sudoku/board';
import {
  type ConfigOptions,
  EMPTY,
  GameDriver,
  PUZZLE,
  answer,
  cellNameOf,
  makeConfig,
  solveAll,
  wrongDigit,
} from '../testing/game';
import { ManualClock } from '../util/clock';
import { createRng, type Rng } from '../util/random';
import { ManualScheduler, type Scheduler } from '../util/scheduler';
import { createGame, nextDeadline, tick } from './engine';
import { evolve } from './evolve';
import { type ClientAction, type HostUpdate, LocalGameHost } from './host';
import type { ReleaseReason } from './rules';
import type { Action, GameEvent, GameEventType, GameState, PlayerId, Turn } from './types';
import { type GameView, publicConfig, replay, toPublicEvent } from './view';

/*
 * Flow of a game: the turns model [D1], the event log, replay, determinism, views and LocalGameHost
 * (spec §6.1, §13.1, §17.2, §18, §21).
 */

const A1 = parseCellName('A1');
const A2 = parseCellName('A2');
const A3 = parseCellName('A3'); // a given (4)
const A5 = parseCellName('A5');

/** Every event type, so a missing one is a compile error. */
const ALL_EVENT_TYPES: Record<GameEventType, true> = {
  gameCreated: true,
  gameStarted: true,
  turnStarted: true,
  turnCleared: true,
  cellLocked: true,
  cellReleased: true,
  placedCorrect: true,
  placedWrong: true,
  interference: true,
  interferenceEnded: true,
  reaction: true,
  playerConnectionLost: true,
  playerDisconnected: true,
  playerReconnected: true,
  playerAbandoned: true,
  playerSurrendered: true,
  gamePaused: true,
  gameResumed: true,
  gameOver: true,
};
const ALL_RELEASE_REASONS: Record<ReleaseReason, true> = {
  cancel: true,
  timeout: true,
  switch: true,
  mistake: true,
  surrender: true,
  disconnect: true,
  abandon: true,
};

function asType<T extends GameEventType>(e: GameEvent | undefined, type: T): Extract<GameEvent, { type: T }> {
  if (!e || e.type !== type) throw new Error(`Expected ${type}, got ${e?.type}`);
  return e as Extract<GameEvent, { type: T }>;
}

const hasSolution = (x: unknown): boolean => JSON.stringify(x).includes(PUZZLE.solution);
const timeline = (events: readonly GameEvent[]) => events.map((e) => [e.type, e.t]);

/** seq 1, 2, 3 … with no gap, and t never going back. */
function expectWellFormedLog(log: readonly GameEvent[]): void {
  expect(log.map((e) => e.seq)).toEqual(log.map((_, k) => k + 1));
  const backwards = log.filter((e, k) => k > 0 && e.t < log[k - 1]!.t);
  expect(backwards).toEqual([]);
}

/** A game in the turns model [D1]. */
const turns = (o: ConfigOptions = {}, opts?: { start?: boolean; at?: number }): GameDriver =>
  GameDriver.of({ ...o, rules: { turnModel: 'turns', ...o.rules } }, opts);

/** The turn in the state: running until `endsAt`, or stopped by an interference with `stoppedMs` left [D11]. */
const turnOf = (playerId: PlayerId, endsAt: number | null, stoppedMs: number | null = null): Turn => ({
  playerId,
  endsAt,
  stoppedMs,
});

interface Played {
  g: GameDriver;
  /** The live state after each step, and how many events the log had then. */
  steps: { n: number; state: GameState }[];
}

function recorder(g: GameDriver): { steps: Played['steps']; step: (f: () => unknown) => void } {
  const steps: Played['steps'] = [{ n: g.log.length, state: g.state }];
  return {
    steps,
    step: (f) => {
      f();
      steps.push({ n: g.log.length, state: g.state });
    },
  };
}

/**
 * A 4-player game that freezes on a disconnect (freezeUpToPlayers 4) and charges for a timeout: it produces
 * every event type except the turn events (turnStarted, turnCleared), and ends with a full board.
 */
function playLongGame(): Played {
  const g = GameDriver.of({ players: 4, rules: { timeoutPenalty: 1, freezeUpToPlayers: 4 } });
  const { steps, step } = recorder(g);
  step(() => g.solve('p1', 'A1', 0)); // 8 points
  step(() => g.select('p2', 'A2', 100));
  step(() => g.reject({ type: 'select', playerId: 'p3', cell: A2 }, 150)); // taken: refused, nothing logged
  step(() => g.select('p2', 'B1', 200)); // switch
  step(() => g.playerAct('p2', { type: 'release' }, 300)); // cancel
  step(() => g.miss('p3', 'C1', 400)); // mistake
  step(() => g.select('p4', 'D1', 500));
  step(() => g.tickTo(8500)); // timeout, with a penalty
  step(() => g.select('p2', 'E3', 9000)); // expires 17000
  step(() => g.playerAct('p1', { type: 'interfere', targetId: 'p2', kind: 'cats' }, 10000)); // E3 stops, 7000 left
  step(() => g.tickTo(15000)); // interferenceEnded: E3 runs again until 22000
  step(() => g.playerAct('p3', { type: 'react', emoji: '😂' }, 15500));
  step(() => g.disconnect('p3', { soft: true, at: 15600 })); // the soft phase [D42]: nothing stops
  step(() => g.reconnect('p3', 15700)); // back within it: the offline window opens
  step(() => g.offlineMove('p3', 'H1', { thinkMs: 3000, at: 15800 })); // locked and placed, offline
  step(() => g.act({ type: 'disconnect', playerId: 'p4' }, 16000)); // frozen
  step(() => g.act({ type: 'reconnect', playerId: 'p4' }, 18000)); // resumed (reconnect): E3 until 24000
  step(() => g.place('p2', 'E3', answer('E3'), 19000));
  step(() => g.select('p4', 'F1', 19500));
  step(() => g.act({ type: 'disconnect', playerId: 'p4' }, 20000)); // frozen again
  step(() => g.tickTo(35000)); // abandoned: lock released (abandon), resumed (abandon)
  step(() => g.select('p3', 'G2', 36000));
  step(() => g.playerAct('p3', { type: 'surrender' }, 37000)); // released (surrender)
  let k = 0;
  for (const i of EMPTY) if (g.state.grid[i] === 0) step(() => g.solve(k++ % 2 ? 'p2' : 'p1', cellNameOf(i)));
  return { g, steps };
}

/**
 * A 3-player game in turns: every way a turn ends, a skipped player, a turn nobody can take, and a full
 * board.
 */
function playTurnsGame(): Played {
  const g = turns({ players: 3 });
  const { steps, step } = recorder(g);
  step(() => g.solve('p1', 'A1', 1000)); // → p2
  step(() => g.miss('p2', 'A2', 2000)); // → p3
  step(() => g.reject({ type: 'select', playerId: 'p1', cell: A5 }, 2500)); // notYourTurn
  step(() => g.select('p3', 'A5', 3000));
  step(() => g.playerAct('p3', { type: 'release' }, 4000)); // → p1
  step(() => g.select('p1', 'A6', 5000));
  step(() => g.tickTo(13000)); // lock timeout → p2
  step(() => g.tickTo(21000)); // unused turn → p3
  step(() => g.select('p3', 'A8', 22000));
  step(() => g.act({ type: 'disconnect', playerId: 'p3' }, 23000)); // released (disconnect) → p1
  step(() => g.tickTo(31000)); // → p2 (p3 skipped)
  step(() => g.act({ type: 'disconnect', playerId: 'p1' }, 32000)); // 3 still in the game: it goes on
  step(() => g.act({ type: 'disconnect', playerId: 'p2' }, 33000)); // nobody can take the turn: turnCleared
  step(() => g.tickTo(38000)); // p3 abandoned
  step(() => g.act({ type: 'reconnect', playerId: 'p2' }, 38200)); // the first one back gets the turn
  step(() => g.act({ type: 'reconnect', playerId: 'p1' }, 38300));
  step(() => g.solve('p2', 'A2', 38500)); // → p1
  for (const i of EMPTY)
    if (g.state.grid[i] === 0) step(() => g.solve(g.state.turn!.playerId, cellNameOf(i)));
  return { g, steps };
}

// =========================================================================================================

describe('the turns model (§6.1) [D1]', () => {
  it("'simultaneous' is the default: no turns, everyone may lock at once", () => {
    const g = GameDriver.of({ players: 3 });
    expect(g.state.config.rules.turnModel).toBe('simultaneous');
    expect(g.types()).toEqual(['gameCreated', 'gameStarted']);
    expect(g.state.turn).toBeNull();
    expect(g.deadline).toBeNull();
    g.select('p2', 'A1', 100);
    g.select('p3', 'A2', 100);
    g.select('p1', 'A5', 100);
    expect(g.state.locks.map((l) => l.playerId)).toEqual(['p2', 'p3', 'p1']);
    g.advance(60000);
    expect(g.types()).not.toContain('turnStarted');
  });

  it('start gives the turn to seat 0 until now + turnPickMs, the think time of the game type by default', () => {
    for (const [gameType, ms] of [
      ['fast', 8000],
      ['normal', 12000],
      ['hard', 18000],
    ] as const) {
      const g = turns({ gameType, players: 3 }, { at: 1000 });
      expect(g.log.slice(1)).toEqual([
        { type: 'gameStarted', seq: 2, t: 1000 },
        { type: 'turnStarted', playerId: 'p1', endsAt: 1000 + ms, remainingMs: ms, seq: 3, t: 1000 },
      ]);
      expect(g.state.turn).toEqual(turnOf('p1', 1000 + ms));
      expect(g.deadline).toBe(1000 + ms);
    }
  });

  it('turnPickMs may differ from the think time of the lock', () => {
    const g = turns({ rules: { turnPickMs: 3000 } });
    expect(g.last('turnStarted')).toMatchObject({ playerId: 'p1', endsAt: 3000, remainingMs: 3000 });
    expect(g.state.turn).toEqual(turnOf('p1', 3000));
    g.select('p1', 'A1', 1000);
    expect(g.lock('p1')).toMatchObject({ expiresAt: 9000, remainingMs: 8000 });
    g.place('p1', 'A1', answer('A1'), 2000);
    expect(g.last('turnStarted')).toMatchObject({ playerId: 'p2', endsAt: 5000, remainingMs: 3000 });
    expect(g.state.turn).toEqual(turnOf('p2', 5000));
  });

  it('only the player whose turn it is may lock a cell; the others are refused without a penalty', () => {
    const g = turns({ players: 3 });
    expect(g.reject({ type: 'select', playerId: 'p2', cell: A1 }, 100)).toBe('notYourTurn');
    expect(g.reject({ type: 'select', playerId: 'p3', cell: A1 }, 100)).toBe('notYourTurn');
    expect(g.state.players.map((p) => p.score)).toEqual([0, 0, 0]);
    expect(g.state.locks).toEqual([]);
    g.select('p1', 'A1', 200);
    expect(g.lock('p1')!.cell).toBe(A1);
  });

  it('outside one’s turn the answer is notYourTurn, before anything about the cell is checked', () => {
    const g = turns({ players: 3 });
    g.select('p1', 'A2', 0);
    g.playerAct('p1', { type: 'release' }, 500); // p1 may not take A2 again before 1500; p2's turn
    g.select('p2', 'A1', 1000);
    // Taken by p2, p1's own re-lock wait, a given, off the board: none of it is p1's business now.
    for (const cell of [A1, A2, A3, 81, -1])
      expect(g.reject({ type: 'select', playerId: 'p1', cell }, 1200)).toBe('notYourTurn');
    expect(g.reject({ type: 'select', playerId: 'p3', cell: A3 }, 1200)).toBe('notYourTurn');
    // The player whose turn it is hears about the cell.
    expect(g.reject({ type: 'select', playerId: 'p2', cell: A3 }, 1200)).toBe('cellFilled');
    expect(g.reject({ type: 'select', playerId: 'p2', cell: 81 }, 1200)).toBe('badCell');
    expect(g.reject({ type: 'select', playerId: 'p2', cell: A1 }, 1200)).toBe('alreadyHeld');
  });

  it('one lock per turn: the player cannot switch to another cell, and the lock timer replaces the turn timer', () => {
    const g = turns();
    g.select('p1', 'A1', 1000);
    expect(g.state.turn).toEqual(turnOf('p1', null));
    expect(g.reject({ type: 'select', playerId: 'p1', cell: A2 }, 2000)).toBe('alreadyHeld');
    expect(g.reject({ type: 'select', playerId: 'p1', cell: A1 }, 2000)).toBe('alreadyHeld');
    expect(g.state.locks).toHaveLength(1);
    expect(g.lock('p1')!.cell).toBe(A1);
    expect(g.deadline).toBe(9000); // the lock, not the 8000 of the turn
    expect(g.tickTo(8000)).toEqual([]);
  });

  it('a correct digit ends the turn: the next seat gets a fresh turn at once', () => {
    const g = turns({ players: 3 });
    const events = g.solve('p1', 'A1', 2000);
    expect(g.types(events)).toEqual(['cellLocked', 'placedCorrect', 'turnStarted']);
    expect(events[2]).toMatchObject({ playerId: 'p2', endsAt: 10000, remainingMs: 8000, t: 2000 });
    expect(g.state.turn).toEqual(turnOf('p2', 10000));
  });

  it('a wrong digit ends the turn after the release [D3]', () => {
    const g = turns({ players: 3 });
    const events = g.miss('p1', 'A1', 2000);
    expect(g.types(events)).toEqual(['cellLocked', 'placedWrong', 'cellReleased', 'turnStarted']);
    expect(events[1]).toMatchObject({ penalty: 8, mistakes: 1, score: -8 });
    expect(events[2]).toMatchObject({ reason: 'mistake' });
    expect(events[3]).toMatchObject({ playerId: 'p2', endsAt: 10000, t: 2000 });
  });

  it('with afterMistake keepLock the turn goes on until the lock ends [D3]', () => {
    const g = turns({ players: 3, rules: { afterMistake: 'keepLock' } });
    g.select('p1', 'A1', 1000);
    const events = g.place('p1', 'A1', wrongDigit('A1'), 2000);
    expect(g.types(events)).toEqual(['placedWrong']);
    expect(g.state.turn).toEqual(turnOf('p1', null));
    expect(g.lock('p1')).toMatchObject({ cell: A1, expiresAt: 9000 });
    const right = g.place('p1', 'A1', answer('A1'), 3000);
    expect(g.types(right)).toEqual(['placedCorrect', 'turnStarted']);
    expect(right[1]).toMatchObject({ playerId: 'p2', endsAt: 11000 });

    // …or the lock times out, and then the turn passes.
    g.select('p2', 'A2', 4000);
    g.place('p2', 'A2', wrongDigit('A2'), 5000);
    expect(g.tickTo(12000).map((e) => [e.type, e.t])).toEqual([
      ['cellReleased', 12000],
      ['turnStarted', 12000],
    ]);
    expect(g.state.turn).toEqual(turnOf('p3', 20000));
  });

  it('"cancel selection" ends the turn', () => {
    const g = turns({ players: 3 });
    g.select('p1', 'A1', 1000);
    const events = g.playerAct('p1', { type: 'release' }, 3000);
    expect(g.types(events)).toEqual(['cellReleased', 'turnStarted']);
    expect(events[0]).toMatchObject({ reason: 'cancel' });
    expect(events[1]).toMatchObject({ playerId: 'p2', endsAt: 11000, t: 3000 });
  });

  it('a lock that times out ends the turn, at the deadline', () => {
    const g = turns({ players: 3 });
    g.select('p1', 'A1', 1000);
    expect(g.tickTo(8999)).toEqual([]);
    const events = g.tickTo(9000);
    expect(g.types(events)).toEqual(['cellReleased', 'turnStarted']);
    expect(events[0]).toMatchObject({ reason: 'timeout', t: 9000 });
    expect(events[1]).toMatchObject({ playerId: 'p2', endsAt: 17000, t: 9000 });
    expect(g.score('p1')).toBe(0);
  });

  it('an unused turn runs out and passes on, in seat order, round and round, without a penalty', () => {
    const g = turns({ players: 4 });
    expect(g.tickTo(7999)).toEqual([]);
    expect(g.tickTo(8000)).toEqual([
      { type: 'turnStarted', playerId: 'p2', endsAt: 16000, remainingMs: 8000, seq: 4, t: 8000 },
    ]);
    // Noticed late: every turn that ran out in between, each at its own deadline.
    const late = g.tickTo(35000);
    expect(late.map((e) => e.type === 'turnStarted' && [e.playerId, e.t, e.endsAt])).toEqual([
      ['p3', 16000, 24000],
      ['p4', 24000, 32000],
      ['p1', 32000, 40000],
    ]);
    expect(g.state.players.map((p) => p.score)).toEqual([0, 0, 0, 0]);
  });

  it('solo practice in turns: the turn comes back to the same player', () => {
    const g = turns({ players: 1 });
    expect(g.tickTo(8000)).toEqual([
      expect.objectContaining({ type: 'turnStarted', playerId: 'p1', endsAt: 16000 }),
    ]);
    const events = g.solve('p1', 'A1', 9000);
    expect(events[2]).toMatchObject({ type: 'turnStarted', playerId: 'p1', endsAt: 17000 });
  });

  it('outside their turn players can still react, interfere and surrender', () => {
    const g = turns({ players: 3 });
    g.solve('p1', 'A1', 0); // 8 points → p2's turn
    expect(g.types(g.playerAct('p1', { type: 'react', emoji: '🔥' }, 1000))).toEqual(['reaction']);
    expect(g.types(g.playerAct('p1', { type: 'interfere', targetId: 'p3', kind: 'cats' }, 1000))).toEqual([
      'interference',
    ]);
    expect(g.types(g.playerAct('p3', { type: 'surrender' }, 1000))).toEqual(['playerSurrendered']);
    expect(g.state.turn).toEqual(turnOf('p2', 8000));
  });

  it('skips a player who surrendered (3 players) [D36]', () => {
    const g = turns({ players: 3 });
    g.playerAct('p2', { type: 'surrender' }, 1000);
    expect(g.state.turn).toEqual(turnOf('p1', 8000));
    const events = g.solve('p1', 'A1', 2000);
    expect(events[2]).toMatchObject({ type: 'turnStarted', playerId: 'p3', endsAt: 10000 });
    expect(g.tickTo(10000)).toEqual([expect.objectContaining({ type: 'turnStarted', playerId: 'p1' })]);
  });

  it('surrendering on one’s own turn releases the lock and passes the turn at once', () => {
    const g = turns({ players: 3 });
    g.select('p1', 'A1', 1000);
    const events = g.playerAct('p1', { type: 'surrender' }, 2000);
    expect(g.types(events)).toEqual(['cellReleased', 'playerSurrendered', 'turnStarted']);
    expect(events[0]).toMatchObject({ reason: 'surrender' });
    expect(events[2]).toMatchObject({ playerId: 'p2', endsAt: 10000, t: 2000 });
  });

  it('a turn given up by surrender goes to the next seat after the one who left, not back to seat 0 (4 players)', () => {
    const g = turns({ players: 4 });
    g.solve('p1', 'A1', 1000); // → p2
    const events = g.playerAct('p2', { type: 'surrender' }, 2000);
    expect(g.types(events)).toEqual(['playerSurrendered', 'turnStarted']);
    expect(events[1]).toMatchObject({ playerId: 'p3', endsAt: 10000, remainingMs: 8000, t: 2000 });
    expect(g.state.turn).toEqual(turnOf('p3', 10000));
  });

  it('the last surrender ends the game: no further turn and no timer', () => {
    const g = turns();
    g.select('p1', 'A1', 1000);
    const events = g.playerAct('p1', { type: 'surrender' }, 2000);
    expect(g.types(events)).toEqual(['cellReleased', 'playerSurrendered', 'gameOver']);
    expect(g.state.turn).toBeNull();
    expect(g.deadline).toBeNull();
    expect(g.advance(60000)).toEqual([]);
  });

  it('the move that fills the board ends the game without a new turn', () => {
    const g = turns();
    for (const i of EMPTY) g.solve(g.state.turn!.playerId, cellNameOf(i));
    expect(g.types(g.log.slice(-3))).toEqual(['cellLocked', 'placedCorrect', 'gameOver']);
    expect(g.state.turn).toBeNull();
    expect(g.deadline).toBeNull();
  });

  it('skips a disconnected player, and an abandoned one after the grace period (3 players) [D4]', () => {
    const g = turns({ players: 3 });
    expect(g.types(g.act({ type: 'disconnect', playerId: 'p2' }, 500))).toEqual(['playerDisconnected']);
    expect(g.state.turn).toEqual(turnOf('p1', 8000));
    expect(g.tickTo(8000)).toEqual([
      expect.objectContaining({ type: 'turnStarted', playerId: 'p3', endsAt: 16000 }),
    ]);
    expect(g.types(g.tickTo(15500))).toEqual(['playerAbandoned']);
    expect(g.state.turn).toEqual(turnOf('p3', 16000));
    expect(g.tickTo(16000)).toEqual([expect.objectContaining({ type: 'turnStarted', playerId: 'p1' })]);
    expect(g.tickTo(24000)).toEqual([expect.objectContaining({ type: 'turnStarted', playerId: 'p3' })]);
  });

  it('a player who disconnects on their turn loses it at once, and the lock is released (3 players) [D4]', () => {
    const g = turns({ players: 3 });
    g.select('p1', 'A1', 1000);
    const events = g.act({ type: 'disconnect', playerId: 'p1' }, 2000);
    expect(g.types(events)).toEqual(['playerDisconnected', 'cellReleased', 'turnStarted']);
    expect(events[1]).toMatchObject({ playerId: 'p1', reason: 'disconnect' });
    expect(events[2]).toMatchObject({ playerId: 'p2', endsAt: 10000, t: 2000 });
  });

  it('a turn lost to a disconnect goes to the next seat after that player, not back to seat 0 (3 players) [D4]', () => {
    const g = turns({ players: 3 });
    g.solve('p1', 'A1', 1000); // → p2
    const events = g.act({ type: 'disconnect', playerId: 'p2' }, 2000);
    expect(g.types(events)).toEqual(['playerDisconnected', 'turnStarted']);
    expect(events[1]).toMatchObject({ playerId: 'p3', endsAt: 10000, remainingMs: 8000, t: 2000 });
  });

  it('a player who comes back rejoins the rotation', () => {
    const g = turns({ players: 3 });
    g.act({ type: 'disconnect', playerId: 'p2' }, 1000);
    expect(g.types(g.act({ type: 'reconnect', playerId: 'p2' }, 3000))).toEqual(['playerReconnected']);
    expect(g.state.turn).toEqual(turnOf('p1', 8000));
    expect(g.tickTo(8000)).toEqual([expect.objectContaining({ type: 'turnStarted', playerId: 'p2' })]);
  });

  it('when nobody could take the turn, the first player to come back gets it', () => {
    const g = turns({ players: 3 });
    g.act({ type: 'disconnect', playerId: 'p2' }, 1000);
    g.act({ type: 'disconnect', playerId: 'p3' }, 2000);
    // Two players are left and both are away: the game freezes [D4].
    expect(g.types(g.playerAct('p1', { type: 'surrender' }, 3000))).toEqual([
      'playerSurrendered',
      'gamePaused',
    ]);
    expect(g.state.turn).toBeNull();
    expect(g.deadline).toBe(16000); // only p2's grace period
    const events = g.act({ type: 'reconnect', playerId: 'p3' }, 4000);
    expect(g.types(events)).toEqual(['playerReconnected', 'turnStarted']);
    // Still frozen (p2 is away): the turn counts from the freeze, so the resume gives it its full 8 s.
    expect(events[1]).toMatchObject({ playerId: 'p3', endsAt: 11000, t: 4000 });
    const resumed = g.act({ type: 'reconnect', playerId: 'p2' }, 6000);
    expect(g.types(resumed)).toEqual(['playerReconnected', 'gameResumed']);
    expect(g.state.turn).toMatchObject({ playerId: 'p3', endsAt: 14000 });
  });

  it('nobody left to take the turn (everyone still in the game is away): turnCleared, no turn timer, and the first one back gets a fresh turn (3 players) [D4]', () => {
    const g = turns({ players: 3 });
    g.act({ type: 'disconnect', playerId: 'p2' }, 1000);
    g.act({ type: 'disconnect', playerId: 'p3' }, 2000);
    const gone = g.act({ type: 'disconnect', playerId: 'p1' }, 3000); // the turn holder; nobody to pass it to
    expect(gone).toEqual([
      { type: 'playerDisconnected', playerId: 'p1', graceEndsAt: 18000, seq: 6, t: 3000 },
      { type: 'turnCleared', seq: 7, t: 3000 },
    ]);
    expect(g.state.turn).toBeNull();
    expect(g.view('p1').turn).toBeNull();
    expect(g.deadline).toBe(16000); // only the grace periods
    expect(g.tickTo(8000)).toEqual([]); // the old turn's deadline: nothing happens
    const back = g.act({ type: 'reconnect', playerId: 'p2' }, 9000);
    expect(g.types(back)).toEqual(['playerReconnected', 'turnStarted']);
    expect(back[1]).toMatchObject({ playerId: 'p2', endsAt: 17000, remainingMs: 8000, t: 9000 });
    // The next one back only rejoins the rotation.
    expect(g.types(g.act({ type: 'reconnect', playerId: 'p1' }, 10000))).toEqual(['playerReconnected']);
    expect(g.state.turn).toEqual(turnOf('p2', 17000));
    // At 17000 p3's grace runs out first; then p2's turn passes over p3 to p1.
    expect(timeline(g.tickTo(17000))).toEqual([
      ['playerAbandoned', 17000],
      ['turnStarted', 17000],
    ]);
    expect(g.state.turn).toEqual(turnOf('p1', 25000));
    expectWellFormedLog(g.log);
    expect(g.replayMatches()).toBe(true);
  });

  it('a holder who leaves with nobody to take over takes the turn along: no turnCleared is needed', () => {
    const g = turns({ players: 3 });
    g.act({ type: 'disconnect', playerId: 'p2' }, 1000);
    g.act({ type: 'disconnect', playerId: 'p3' }, 2000);
    // The holder leaves: their turn goes with them, and there is nobody to give a new one to.
    // Two players are left and both are away, so the game also freezes [D4].
    expect(g.types(g.playerAct('p1', { type: 'surrender' }, 3000))).toEqual([
      'playerSurrendered',
      'gamePaused',
    ]);
    expect(g.state.turn).toBeNull();
    expect(g.types()).not.toContain('turnCleared');
  });

  it('2 players: a disconnect freezes the turn timer too; it goes on where it stopped [D4]', () => {
    const g = turns();
    expect(g.types(g.act({ type: 'disconnect', playerId: 'p2' }, 2000))).toEqual([
      'playerDisconnected',
      'gamePaused',
    ]);
    expect(g.deadline).toBe(17000); // only the grace period
    // Screens show it stopped, with the time it had at the freeze.
    expect(g.view('p1').turn).toEqual({ playerId: 'p1', expiresAt: null, remainingMs: 6000 });
    expect(g.reject({ type: 'select', playerId: 'p1', cell: A1 }, 3000)).toBe('paused');
    expect(g.tickTo(9000)).toEqual([]);
    expect(g.view('p1').turn).toEqual({ playerId: 'p1', expiresAt: null, remainingMs: 6000 });
    const back = g.act({ type: 'reconnect', playerId: 'p2' }, 10000);
    expect(g.types(back)).toEqual(['playerReconnected', 'gameResumed']);
    expect(back[1]).toMatchObject({ pausedMs: 8000, locks: [] });
    expect(g.state.turn).toEqual(turnOf('p1', 16000));
    expect(g.view('p2').turn).toEqual({ playerId: 'p1', expiresAt: 16000, remainingMs: 6000 });
    expect(g.tickTo(15999)).toEqual([]);
    expect(g.tickTo(16000)).toEqual([
      expect.objectContaining({ type: 'turnStarted', playerId: 'p2', t: 16000 }),
    ]);
  });

  it('a frozen game (freezeUpToPlayers 3) keeps the turn of the disconnected player; abandoning passes it on [D4]', () => {
    const g = turns({ players: 3, rules: { freezeUpToPlayers: 3 } });
    g.select('p1', 'A1', 1000);
    expect(g.types(g.act({ type: 'disconnect', playerId: 'p1' }, 2000))).toEqual([
      'playerDisconnected',
      'gamePaused',
    ]);
    expect(g.state.turn).toEqual(turnOf('p1', null));
    expect(g.lock('p1')).toBeDefined();
    const events = g.tickTo(17000);
    expect(g.types(events)).toEqual(['cellReleased', 'playerAbandoned', 'gameResumed', 'turnStarted']);
    expect(events[0]).toMatchObject({ reason: 'abandon', t: 17000 });
    expect(events[2]).toMatchObject({ reason: 'abandon', pausedMs: 15000 });
    expect(events[3]).toMatchObject({ playerId: 'p2', endsAt: 25000, t: 17000 });
  });

  it('a holder who abandons a frozen game passes the turn to the next seat after them, with its full time (freezeUpToPlayers 3) [D4]', () => {
    const g = turns({ players: 3, rules: { freezeUpToPlayers: 3 } });
    g.solve('p1', 'A1', 1000); // → p2 until 9000
    g.act({ type: 'disconnect', playerId: 'p2' }, 2000); // frozen; p2 keeps the turn
    expect(g.state.turn).toEqual(turnOf('p2', 9000));
    const events = g.tickTo(17000);
    expect(g.types(events)).toEqual(['playerAbandoned', 'gameResumed', 'turnStarted']);
    expect(events[2]).toMatchObject({ playerId: 'p3', endsAt: 25000, remainingMs: 8000, t: 17000 });
  });

  // Engine bug: repairTurn() does nothing while the game is frozen, so passTurn()'s "count from the freeze"
  // branch is never reached. The turn just disappears, and on the resume it goes to seat 0 (p1, who has
  // just played) instead of the next seat after the holder who left.
  it('a holder who abandons while the game stays frozen passes the turn to the next seat after them, counted from the freeze (freezeUpToPlayers 4) [D1, D4]', () => {
    const g = turns({ players: 4, rules: { freezeUpToPlayers: 4 } });
    g.solve('p1', 'A1', 1000); // → p2
    g.act({ type: 'disconnect', playerId: 'p2' }, 2000); // frozen
    g.act({ type: 'disconnect', playerId: 'p3' }, 3000);
    g.tickTo(17000); // p2 abandoned; p3 is still away, so the game stays frozen
    g.act({ type: 'reconnect', playerId: 'p3' }, 17500); // resumed after 15500 ms
    // When p2 left, the next seat who could play was p4 (p3 was away); the turn started in the freeze, so
    // after the resume it has its full time.
    expect(g.state.turn).toEqual(turnOf('p4', 25500));
  });
});

describe('the turns model under interference (§6.1, §6.2.7) [D1, D11]', () => {
  it('the turn timer of a player under interference stops, and runs on with the time it had once it ends', () => {
    const g = turns({ players: 3 });
    g.solve('p1', 'A1', 0); // 8 points → p2 until 8000
    const hit = g.playerAct('p1', { type: 'interfere', targetId: 'p2', kind: 'cats' }, 1000); // until 6000
    expect(hit).toEqual([
      expect.objectContaining({ type: 'interference', targetId: 'p2', endsAt: 6000, locks: [] }),
    ]);
    expect(g.state.turn).toEqual(turnOf('p2', null, 7000));
    expect(g.view('p3').turn).toEqual({ playerId: 'p2', expiresAt: null, remainingMs: 7000 });
    expect(g.deadline).toBe(6000); // the interference, not the turn
    expect(g.tickTo(5999)).toEqual([]);
    expect(g.types(g.tickTo(6000))).toEqual(['interferenceEnded']);
    expect(g.state.turn).toEqual(turnOf('p2', 13000));
    expect(g.view('p3').turn).toEqual({ playerId: 'p2', expiresAt: 13000, remainingMs: 7000 });
    expect(g.tickTo(12999)).toEqual([]);
    expect(g.tickTo(13000)).toEqual([
      expect.objectContaining({ type: 'turnStarted', playerId: 'p3', endsAt: 21000 }),
    ]);
    expect(g.replayMatches()).toBe(true);
  });

  it('a turn that starts while its player is under interference starts stopped, with its full time', () => {
    const g = turns({ players: 3 });
    g.solve('p1', 'A1', 0); // 8 points → p2 until 8000
    g.playerAct('p1', { type: 'interfere', targetId: 'p3', kind: 'warp' }, 1000); // p3 until 6000
    g.select('p2', 'A2', 2000);
    const events = g.playerAct('p2', { type: 'release' }, 3000);
    expect(events[1]).toEqual({
      type: 'turnStarted',
      playerId: 'p3',
      endsAt: null,
      remainingMs: 8000,
      seq: 10,
      t: 3000,
    });
    expect(g.state.turn).toEqual(turnOf('p3', null, 8000));
    expect(g.view('p1').turn).toEqual({ playerId: 'p3', expiresAt: null, remainingMs: 8000 });
    expect(g.types(g.tickTo(6000))).toEqual(['interferenceEnded']);
    expect(g.state.turn).toEqual(turnOf('p3', 14000));
    expect(g.tickTo(14000)).toEqual([
      expect.objectContaining({ type: 'turnStarted', playerId: 'p1', endsAt: 22000 }),
    ]);
  });

  it('a holder with a lock: the lock stops instead, and its timeout still passes the turn', () => {
    const g = turns({ players: 3 });
    g.solve('p1', 'A1', 0); // 8 points → p2
    g.select('p2', 'A2', 1000); // expires 9000; the lock's timer counts instead of the turn's
    const hit = g.playerAct('p1', { type: 'interfere', targetId: 'p2', kind: 'cats' }, 2000); // until 7000
    expect(hit[0]).toMatchObject({
      locks: [{ playerId: 'p2', cell: A2, expiresAt: null, remainingMs: 7000 }],
    });
    expect(g.state.turn).toEqual(turnOf('p2', null));
    const end = g.tickTo(7000);
    expect(end).toEqual([
      expect.objectContaining({
        type: 'interferenceEnded',
        locks: [{ playerId: 'p2', cell: A2, expiresAt: 14000, remainingMs: 7000 }],
      }),
    ]);
    expect(g.state.turn).toEqual(turnOf('p2', null));
    expect(timeline(g.tickTo(14000))).toEqual([
      ['cellReleased', 14000],
      ['turnStarted', 14000],
    ]);
    expect(g.state.turn).toEqual(turnOf('p3', 22000));
  });

  it('a lock taken on a stopped turn starts stopped too, and both wait for the interference', () => {
    const g = turns({ players: 3 });
    g.solve('p1', 'A1', 0); // 8 points → p2 until 8000
    g.playerAct('p1', { type: 'interfere', targetId: 'p2', kind: 'cats' }, 1000); // until 6000
    expect(g.select('p2', 'A2', 2000)).toEqual([
      expect.objectContaining({ type: 'cellLocked', expiresAt: null, remainingMs: 8000 }),
    ]);
    expect(g.state.turn).toEqual(turnOf('p2', null)); // the lock counts now, not the 6000 left of the turn
    g.tickTo(6000);
    expect(g.lock('p2')).toMatchObject({ expiresAt: 14000 });
    expect(g.deadline).toBe(14000);
  });

  it('with pauseLockWhileInterfered off, the turn timer keeps running, and a turn starts running [D11]', () => {
    const g = turns({ players: 3, rules: { pauseLockWhileInterfered: false } });
    g.solve('p1', 'A1', 0); // 8 points → p2 until 8000
    g.playerAct('p1', { type: 'interfere', targetId: 'p2', kind: 'cats' }, 1000);
    g.playerAct('p1', { type: 'interfere', targetId: 'p3', kind: 'warp' }, 1000);
    expect(g.state.turn).toEqual(turnOf('p2', 8000));
    g.select('p2', 'A2', 2000);
    const events = g.playerAct('p2', { type: 'release' }, 3000);
    expect(events[1]).toMatchObject({
      type: 'turnStarted',
      playerId: 'p3',
      endsAt: 11000,
      remainingMs: 8000,
    });
    expect(g.state.turn).toEqual(turnOf('p3', 11000));
  });

  it('2 players: a stopped turn waits for the freeze and then for the interference, keeping its time [D4]', () => {
    const g = turns();
    g.solve('p1', 'A1', 0); // 8 points → p2 until 8000
    g.playerAct('p1', { type: 'interfere', targetId: 'p2', kind: 'cats' }, 1000); // until 6000; 7000 left
    g.act({ type: 'disconnect', playerId: 'p1' }, 2000); // frozen
    const v = g.view('p2');
    expect(v.turn).toEqual({ playerId: 'p2', expiresAt: null, remainingMs: 7000 });
    expect(v.players[1]!.hitBy).toEqual({ fromId: 'p1', kind: 'cats', expiresAt: null, remainingMs: 4000 });
    g.act({ type: 'reconnect', playerId: 'p1' }, 5000); // 3000 ms frozen
    expect(g.player('p2').hitBy).toMatchObject({ endsAt: 9000 });
    expect(g.state.turn).toEqual(turnOf('p2', null, 7000));
    expect(timeline(g.tickTo(16000))).toEqual([
      ['interferenceEnded', 9000],
      ['turnStarted', 16000],
    ]);
    expect(g.state.turn).toEqual(turnOf('p1', 24000));
  });
});

// =========================================================================================================

describe('the event log (§13.1, §18)', () => {
  it('createGame: gameCreated is seq 1 at the creation time; the game waits for start', () => {
    const config = makeConfig({ players: 3 });
    const { state, events } = createGame(config, 1234);
    expect(events).toEqual([{ type: 'gameCreated', config, seq: 1, t: 1234 }]);
    expect(state).toMatchObject({
      status: 'waiting',
      seq: 1,
      createdAt: 1234,
      lastEventAt: 1234,
      startedAt: null,
      turn: null,
    });
    expect(state.players.map((p) => [p.id, p.seat])).toEqual([
      ['p1', 0],
      ['p2', 1],
      ['p3', 2],
    ]);
    expect(nextDeadline(state)).toBeNull();
  });

  it('createGame takes 1–4 players with distinct ids and an 81-cell puzzle', () => {
    for (const n of [1, 2, 3, 4])
      expect(createGame(makeConfig({ players: n }), 0).state.players).toHaveLength(n);
    expect(() => createGame(makeConfig({ players: [] }), 0)).toThrow(RangeError);
    expect(() => createGame(makeConfig({ players: 5 }), 0)).toThrow(RangeError);
    expect(() => createGame(makeConfig({ players: [{ id: 'a' }, { id: 'b' }, { id: 'a' }] }), 0)).toThrow(
      RangeError,
    );
    for (const puzzle of [
      { ...PUZZLE, givens: PUZZLE.givens.slice(1) },
      { ...PUZZLE, givens: PUZZLE.givens + '0' },
      { ...PUZZLE, solution: PUZZLE.solution.slice(1) },
      { ...PUZZLE, solution: '' },
    ])
      expect(() => createGame(makeConfig({ puzzle }), 0)).toThrow(RangeError);
  });

  it('createGame takes { clock, rng } (spec §6) or a plain time; an rng draws a seed when the config has none', () => {
    const config = makeConfig();
    expect(config.seed).toBeUndefined();
    const clock = new ManualClock(4321);

    // The clock gives the creation time; without an rng there is no seed.
    const timed = createGame(config, { clock });
    expect(timed.events).toEqual([{ type: 'gameCreated', config, seq: 1, t: 4321 }]);
    expect(timed.state).toMatchObject({ createdAt: 4321, lastEventAt: 4321 });
    expect(timed.state.config.seed).toBeUndefined();
    expect(createGame(config, 10).state.config.seed).toBeUndefined();

    // With an rng: a seed in [0, 2^31), drawn once, carried by gameCreated so the replay has it.
    const seeded = createGame(config, { clock, rng: createRng(7) });
    const seed = asType(seeded.events[0], 'gameCreated').config.seed;
    expect(seed).toBe(Math.floor(createRng(7).next() * 2 ** 31));
    expect(Number.isInteger(seed) && seed! >= 0 && seed! < 2 ** 31).toBe(true);
    expect(seeded.state.config.seed).toBe(seed);
    expect(replay(seeded.events)[0]!.config.seed).toBe(seed);
    expect(config.seed).toBeUndefined(); // the given config is left alone
    // The same RNG seed gives the same game seed; another one another.
    expect(createGame(config, { clock, rng: createRng(7) }).state.config.seed).toBe(seed);
    expect(createGame(config, { clock, rng: createRng(8) }).state.config.seed).not.toBe(seed);

    // A seed in the config is kept, and the rng is not even asked.
    let draws = 0;
    const rng: Rng = {
      next: () => {
        draws++;
        return 0.5;
      },
    };
    expect(createGame({ ...config, seed: 99 }, { clock, rng }).state.config.seed).toBe(99);
    expect(createGame({ ...config, seed: 0 }, { clock, rng }).state.config.seed).toBe(0);
    expect(draws).toBe(0);
  });

  it('time never runs backwards: a now earlier than the last event counts as the time of that event', () => {
    const g = GameDriver.of({ players: 3 }, { start: false, at: 1234 });
    // Even the start: a clock behind the creation time starts the game at the creation time.
    expect(g.act({ type: 'start' }, 1000)).toEqual([{ type: 'gameStarted', seq: 2, t: 1234 }]);
    expect(g.state.startedAt).toBe(1234);
    g.select('p1', 'A1', 5000); // expires 13000
    expect(g.state.lastEventAt).toBe(5000);
    // A clock that went back (another device, a skew): the event keeps the time order.
    expect(g.select('p2', 'A2', 3000)).toEqual([
      { type: 'cellLocked', playerId: 'p2', cell: A2, expiresAt: 13000, remainingMs: 8000, seq: 4, t: 5000 },
    ]);
    // tick() too: nothing is due, nothing changes.
    const before = g.state;
    expect(tick(before, 0)).toEqual({ state: before, events: [] });
    expect(tick(before, 0).state).toBe(before);
    // Timer events carry their deadline, and the last of them sets lastEventAt (not the time of the tick).
    expect(timeline(g.tickTo(20000))).toEqual([
      ['cellReleased', 13000],
      ['cellReleased', 13000],
    ]);
    expect(g.state.lastEventAt).toBe(13000);
    expect(g.playerAct('p3', { type: 'react', emoji: '😂' }, 12000)).toEqual([
      expect.objectContaining({ type: 'reaction', t: 13000 }),
    ]);
    expectWellFormedLog(g.log);
    expect(g.replayMatches()).toBe(true);
  });

  it('an action the engine does not know is refused as badAction in every state, and leaves no trace', () => {
    const unknown = [
      { type: 'dance', playerId: 'p1' },
      { type: 'Select', playerId: 'p1', cell: A1 },
      { type: 'fly', playerId: 'stranger' }, // badAction, not unknownPlayer
      { type: 'toString', playerId: 'p1' },
      { type: 'constructor' },
      { playerId: 'p1' },
    ] as unknown as Action[];
    const g = GameDriver.of({}, { start: false });
    const check = (status: GameState['status']) => {
      expect(g.state.status).toBe(status);
      const n = g.log.length;
      for (const a of unknown) expect(g.reject(a, g.now)).toBe('badAction');
      expect(g.log).toHaveLength(n);
    };
    check('waiting');
    g.act({ type: 'start' }, 0);
    check('running');
    g.act({ type: 'disconnect', playerId: 'p2' }, 100);
    check('paused');
    g.tickTo(15100); // abandoned → over
    check('over');
    expect(g.types()).toEqual([
      'gameCreated',
      'gameStarted',
      'playerDisconnected',
      'gamePaused',
      'playerAbandoned',
      'gameOver',
    ]);
  });

  it('start: gameStarted at the start time; a second start is refused', () => {
    const g = GameDriver.of({}, { start: false, at: 500 });
    expect(g.act({ type: 'start' }, 2000)).toEqual([{ type: 'gameStarted', seq: 2, t: 2000 }]);
    expect(g.state).toMatchObject({ status: 'running', startedAt: 2000, createdAt: 500 });
    expect(g.reject({ type: 'start' }, 2500)).toBe('alreadyStarted');
    g.act({ type: 'disconnect', playerId: 'p2' }, 3000);
    expect(g.state.status).toBe('paused');
    expect(g.reject({ type: 'start' }, 3500)).toBe('alreadyStarted');
    g.tickTo(18000); // p2 abandoned → over
    expect(g.state.status).toBe('over');
    expect(g.reject({ type: 'start' }, 19000)).toBe('gameOver');
  });

  it('before start every other action is refused (notStarted) and no timer runs', () => {
    const g = GameDriver.of({}, { start: false });
    const actions: Action[] = [
      { type: 'select', playerId: 'p1', cell: A1 },
      { type: 'release', playerId: 'p1' },
      { type: 'place', playerId: 'p1', cell: A1, digit: answer('A1') },
      { type: 'interfere', playerId: 'p1', targetId: 'p2', kind: 'cats' },
      { type: 'react', playerId: 'p1', emoji: '😂' },
      { type: 'surrender', playerId: 'p1' },
      { type: 'disconnect', playerId: 'p2' },
      { type: 'reconnect', playerId: 'p2' },
      { type: 'select', playerId: 'stranger', cell: A1 },
    ];
    for (const a of actions) expect(g.reject(a, 5000)).toBe('notStarted');
    expect(g.types()).toEqual(['gameCreated']);
    expect(g.deadline).toBeNull();
    expect(g.tickTo(100000)).toEqual([]);
  });

  it('after gameOver every action is refused and no timer is left', () => {
    const g = GameDriver.of();
    g.select('p2', 'A2', 0);
    const end = g.playerAct('p1', { type: 'surrender' }, 1000);
    expect(g.types(end)).toEqual(['playerSurrendered', 'gameOver']);
    expect(g.state.locks).toEqual([]);
    expect(g.deadline).toBeNull();
    expect(g.tickTo(100000)).toEqual([]);
    const actions: Action[] = [
      { type: 'start' },
      { type: 'select', playerId: 'p2', cell: A1 },
      { type: 'release', playerId: 'p2' },
      { type: 'place', playerId: 'p2', cell: A2, digit: answer('A2') },
      { type: 'react', playerId: 'p2', emoji: '😂' },
      { type: 'surrender', playerId: 'p2' },
      { type: 'disconnect', playerId: 'p2' },
    ];
    for (const a of actions) expect(g.reject(a, 101000)).toBe('gameOver');
    expect(g.log.at(-1)!.type).toBe('gameOver');
  });

  it.each([
    ['a 4-player game', playLongGame],
    ['a 3-player game in turns', playTurnsGame],
  ])(
    '%s: seq starts at 1 and grows by exactly 1 (refused actions leave no gap); t never goes back',
    (_, play) => {
      const { g } = play();
      expectWellFormedLog(g.log);
      expect(g.state.seq).toBe(g.log.length);
      expect(g.log[0]!.type).toBe('gameCreated');
      expect(g.log.at(-1)!.type).toBe('gameOver');
    },
  );

  it('events in the same step share its time', () => {
    const g = GameDriver.of();
    const events = g.miss('p1', 'A1', 4321);
    expect(events.map((e) => e.t)).toEqual([4321, 4321, 4321]);
  });

  it('timer events carry their deadline, not the time they were noticed', () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p1', 'A1', 0); // 8 points
    g.select('p2', 'A2', 1000); // expires 9000
    g.playerAct('p1', { type: 'interfere', targetId: 'p3', kind: 'warp' }, 2000); // ends 7000
    g.act({ type: 'disconnect', playerId: 'p3' }, 3000); // 3 players: no freeze; grace ends 18000
    expect(timeline(g.tickTo(60000))).toEqual([
      ['interferenceEnded', 7000],
      ['cellReleased', 9000],
      ['playerAbandoned', 18000],
    ]);
  });

  it('an action first runs the timers that are due, each at its own time', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 0);
    expect(timeline(g.select('p2', 'A2', 10000))).toEqual([
      ['cellReleased', 8000],
      ['cellLocked', 10000],
    ]);
    // A refused action too: the timers ran, and they are in the log.
    g.select('p1', 'A5', 10000);
    expect(g.reject({ type: 'select', playerId: 'p1', cell: A3 }, 30000)).toBe('cellFilled');
    expect(timeline(g.log.slice(-2))).toEqual([
      ['cellReleased', 18000],
      ['cellReleased', 18000],
    ]);
    expectWellFormedLog(g.log);
  });
});

// =========================================================================================================

describe('replay (§13.1)', () => {
  it.each([
    ['a 4-player game', playLongGame],
    ['a 3-player game in turns', playTurnsGame],
  ])('%s: one state per event; every step and the end equal the live game', (_, play) => {
    const { g, steps } = play();
    const states = replay(g.log);
    expect(states).toHaveLength(g.log.length);
    expect(states.map((s) => s.seq)).toEqual(g.log.map((e) => e.seq));
    for (const { n, state } of steps) expect(states[n - 1]).toEqual(state);
    expect(states.at(-1)).toEqual(g.state);
    expect(g.state.status).toBe('over');
    expect(g.replayMatches()).toBe(true);
  });

  it('the two games between them produce every event type and every release reason', () => {
    const log = [...playLongGame().g.log, ...playTurnsGame().g.log];
    expect([...new Set(log.map((e) => e.type))].sort()).toEqual(Object.keys(ALL_EVENT_TYPES).sort());
    const reasons = new Set(log.flatMap((e) => (e.type === 'cellReleased' ? [e.reason] : [])));
    expect([...reasons].sort()).toEqual(Object.keys(ALL_RELEASE_REASONS).sort());
  });

  it('an empty log replays to no states', () => {
    expect(replay([])).toEqual([]);
  });

  it('evolve refuses a gap or a repeat in seq, and a log that does not start with gameCreated', () => {
    const g = GameDriver.of();
    g.solve('p1', 'A1');
    const [created, started, locked] = g.log;
    const s1 = evolve(null, created!);
    expect(() => evolve(s1, locked!)).toThrow(/seq/); // gameStarted is missing
    expect(() => evolve(s1, { ...started!, seq: 3 })).toThrow(/seq/);
    const s2 = evolve(s1, started!);
    expect(() => evolve(s2, started!)).toThrow(/seq/); // seq 2 again
    expect(() => evolve(null, started!)).toThrow(/gameCreated/);
    expect(() => replay(g.log.slice(1))).toThrow(/gameCreated/);
    expect(() => replay([...g.log.slice(0, 2), ...g.log.slice(3)])).toThrow(/seq/);
  });

  it('evolve refuses a second gameCreated, and a gameCreated that is not seq 1', () => {
    const g = GameDriver.of();
    const [created, started] = g.log;
    const s1 = evolve(null, created!);
    const s2 = evolve(s1, started!);
    expect(() => evolve(s1, created!)).toThrow(/gameCreated/);
    expect(() => evolve(s1, { ...created!, seq: 2 })).toThrow(/gameCreated/); // the next seq, still a restart
    expect(() => evolve(s2, { ...created!, seq: 3 })).toThrow(/gameCreated/);
    expect(() => evolve(null, { ...created!, seq: 2 })).toThrow(/seq/);
    expect(() => evolve(null, { ...created!, seq: 0 })).toThrow(/seq/);
    expect(() => replay([created!, created!])).toThrow(/gameCreated/);
    expect(() => replay([created!, started!, { ...created!, seq: 3 }])).toThrow(/gameCreated/);
    // The states it was given are untouched.
    expect(s2).toEqual(replay(g.log).at(-1));
  });

  it('evolve is pure: it never changes the state or the event it is given', () => {
    const deepFreeze = <T>(o: T): T => {
      if (o && typeof o === 'object' && !Object.isFrozen(o)) {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
      }
      return o;
    };
    const { g } = playTurnsGame();
    const log = structuredClone(g.log);
    let state: GameState | null = null;
    for (const e of log) {
      const before = JSON.stringify(state);
      const next: GameState = evolve(state && deepFreeze(state), deepFreeze(e));
      expect(JSON.stringify(state)).toBe(before);
      expect(next).not.toBe(state);
      state = next;
    }
    expect(state).toEqual(g.state);
  });

  it('the public log (no solution) rebuilds the same game: only the hidden solution differs', () => {
    const { g } = playLongGame();
    const last = replay(g.log.map(toPublicEvent)).at(-1)!;
    expect(last.config.puzzle.solution).toBe('');
    expect({ ...last, config: g.state.config }).toEqual(g.state);
  });
});

// =========================================================================================================

describe('determinism (§6, §13.1)', () => {
  it.each([
    ['a 4-player game', playLongGame],
    ['a 3-player game in turns', playTurnsGame],
  ])('%s: the same actions at the same times give identical events and states', (_, play) => {
    const a = play();
    const b = play();
    expect(b.g.log).toEqual(a.g.log);
    expect(JSON.stringify(b.g.log)).toBe(JSON.stringify(a.g.log));
    expect(b.g.state).toEqual(a.g.state);
  });

  it('replaying the same log twice gives equal states', () => {
    const { g } = playLongGame();
    expect(replay(g.log)).toEqual(replay(g.log));
  });
});

// =========================================================================================================

describe('views (§17.2, §21)', () => {
  it('never carry the solution while the game waits, runs or is frozen: players and spectators alike', () => {
    const g = GameDriver.of({}, { start: false });
    const check = () => {
      for (const viewer of ['p1', 'p2', null]) {
        const v = g.view(viewer);
        expect(v.solution).toBeNull();
        expect(hasSolution(v)).toBe(false);
      }
    };
    check();
    g.act({ type: 'start' }, 0);
    check();
    g.solve('p1', 'A1', 100);
    g.miss('p2', 'A2', 200);
    g.select('p2', 'A5', 300);
    check();
    g.act({ type: 'disconnect', playerId: 'p2' }, 400);
    expect(g.state.status).toBe('paused');
    check();
  });

  it('carry the solution once the game is over, for the replay', () => {
    const g = GameDriver.of();
    solveAll(g, 'p1');
    expect(g.state.status).toBe('over');
    for (const viewer of ['p1', 'p2', null]) {
      const v = g.view(viewer);
      expect(v.solution).toBe(PUZZLE.solution);
      expect(v.result).toEqual(g.state.result);
      expect(v.status).toBe('over');
    }
    // Over by surrender, too.
    const s = GameDriver.of();
    s.playerAct('p2', { type: 'surrender' }, 100);
    expect(s.view('p1').solution).toBe(PUZZLE.solution);
  });

  it('toPublicEvent strips the solution from gameCreated and leaves every other event as it is', () => {
    const g = GameDriver.of();
    g.miss('p2', 'A2');
    solveAll(g, 'p1');
    const created = asType(g.log[0], 'gameCreated');
    const pub = asType(toPublicEvent(created), 'gameCreated');
    expect(pub.config.puzzle).toEqual({ id: PUZZLE.id, givens: PUZZLE.givens, solution: '' });
    expect({ ...pub, config: { ...pub.config, puzzle: created.config.puzzle } }).toEqual(created);
    expect(pub.config).toEqual(publicConfig(created.config));
    expect(created.config.puzzle.solution).toBe(PUZZLE.solution); // the original keeps it
    for (const e of g.log.slice(1)) expect(toPublicEvent(e)).toBe(e);
    expect(hasSolution(g.log)).toBe(true);
    expect(hasSolution(g.log.map(toPublicEvent))).toBe(false);
  });

  it('a spectator view (viewer null) has no "me", no interference block and no keypad', () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p1', 'A1', 0); // 8 points
    g.miss('p3', 'A5', 50); // −7 (A5 after A1); p3 may lock A5 again from 1050 [D2]
    g.select('p2', 'A2', 1100);
    g.select('p3', 'A5', 1100);
    g.playerAct('p1', { type: 'react', emoji: '🔥' }, 1200);
    const v = g.view(null);
    expect(v.me).toBeNull();
    expect(v.interference).toBeNull();
    expect(v.keypad.enabled).toBe(false);
    expect(v.keypad.disabled).toEqual([]); // the wrong digit in A5 belongs to p3's lock, not to a spectator
    expect(v.cooldowns).toEqual([]);
    expect(v.reactionReadyAt).toBe(0);
    // The table itself is all there.
    expect(v.players.map((p) => [p.id, p.score, p.lock?.cell ?? null])).toEqual([
      ['p1', 8, null],
      ['p2', 0, A2],
      ['p3', -7, A5],
    ]);
    // The same moment from a player's seat.
    const p3 = g.view('p3');
    expect(p3.me).toBe('p3');
    expect(p3.interference).not.toBeNull();
    expect(p3.keypad.enabled).toBe(true);
    expect(p3.keypad.disabled).toHaveLength(1);
    expect(g.view('p1').reactionReadyAt).toBe(3200);
    // Someone who is not in the game sees what a spectator sees.
    expect(g.view('stranger')).toEqual(v);
  });

  it('show the turn and the turn model, with the turn as a timer (expiresAt, remainingMs)', () => {
    const g = turns({ players: 3 });
    expect(g.view('p2')).toMatchObject({
      rules: { turnModel: 'turns' },
      turn: { playerId: 'p1', expiresAt: 8000, remainingMs: 8000 },
    });
    g.tickTo(3000);
    expect(g.view('p2').turn).toEqual({ playerId: 'p1', expiresAt: 8000, remainingMs: 5000 });
    g.select('p1', 'A1', 3000);
    // The lock's timer counts now; the turn has none of its own.
    expect(g.view(null).turn).toEqual({ playerId: 'p1', expiresAt: null, remainingMs: 0 });
    expect(g.view(null).players[0]!.lock).toEqual({ cell: A1, expiresAt: 11000, remainingMs: 8000 });
    expect(GameDriver.of().view('p1')).toMatchObject({ rules: { turnModel: 'simultaneous' }, turn: null });
  });

  it('show the live place on every card and who leads; equal scores share a place (§6.8) [D16]', () => {
    const g = GameDriver.of({ players: 3 });
    const cards = (v: GameView) => v.players.map((p) => [p.id, p.place, p.isLeader]);
    // Nobody has scored: everyone shares first place, and everyone leads.
    expect(cards(g.view('p1'))).toEqual([
      ['p1', 1, true],
      ['p2', 1, true],
      ['p3', 1, true],
    ]);
    g.solve('p2', 'A1', 100); // 8
    g.miss('p3', 'A2', 200); // −6.5
    expect(cards(g.view(null))).toEqual([
      ['p1', 2, false],
      ['p2', 1, true],
      ['p3', 3, false],
    ]);
    // Whoever leaves drops below everyone still playing [D36] and leads no more, whatever the score.
    g.playerAct('p2', { type: 'surrender' }, 400);
    expect(cards(g.view('p3'))).toEqual([
      ['p1', 1, true],
      ['p2', 3, false],
      ['p3', 2, false],
    ]);
    // Every viewer sees the same table.
    expect(g.view('p1').players).toEqual(g.view(null).players);
    // Alone there is nobody to lead.
    expect(cards(GameDriver.of({ players: 1 }).view('p1'))).toEqual([['p1', 1, false]]);
  });

  it('show each card’s rating in ranked games only (§6.8)', () => {
    const ranked = GameDriver.of({
      players: [{ id: 'p1', rating: 1350 }, { id: 'p2', rating: 1200 }, { id: 'p3' }],
    });
    expect(ranked.view('p1').players.map((p) => p.rating)).toEqual([1350, 1200, null]);
    const bot = GameDriver.of({
      mode: 'bot',
      players: [
        { id: 'p1', rating: 1350 },
        { id: 'bot', isBot: true, rating: 1400 },
      ],
    });
    expect(bot.view('p1').players.map((p) => [p.rating, p.isBot])).toEqual([
      [null, false],
      [null, true],
    ]);
    expect(
      GameDriver.of({ mode: 'solo', players: [{ id: 'p1', rating: 1350 }] }).view('p1').players[0]!.rating,
    ).toBeNull();
  });

  it('show only my own re-lock waits that still run, each as { cell, until } [D2]', () => {
    const g = GameDriver.of({ players: 3 });
    g.select('p1', 'A1', 0);
    g.select('p1', 'A2', 100); // switch: A1 until 1100
    g.playerAct('p1', { type: 'release' }, 200); // cancel: A2 until 1200
    g.miss('p2', 'A5', 300); // mistake: A5 until 1300
    expect(g.view('p1').cooldowns).toEqual([
      { cell: A1, until: 1100 },
      { cell: A2, until: 1200 },
    ]);
    expect(g.view('p2').cooldowns).toEqual([{ cell: A5, until: 1300 }]);
    expect(g.view('p3').cooldowns).toEqual([]);
    expect(g.view(null).cooldowns).toEqual([]);
    g.tickTo(1100);
    expect(g.view('p1').cooldowns).toEqual([{ cell: A2, until: 1200 }]);
    g.tickTo(1300);
    expect([g.view('p1').cooldowns, g.view('p2').cooldowns]).toEqual([[], []]);
  });

  // Engine bug: the view filters re-lock waits by the clock even while the game is frozen, although the
  // freeze stops them (gameResumed moves them on by pausedMs). The wait vanishes from the screen during the
  // freeze and comes back after the resume, when the select is refused with 'cooldown'.
  it('a re-lock wait stops with the freeze: the view still shows it while the game is frozen (§16.2) [D2, D4]', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 0);
    g.playerAct('p1', { type: 'release' }, 100); // A1 until 1100
    g.act({ type: 'disconnect', playerId: 'p2' }, 500); // frozen with 600 ms of the wait left
    g.tickTo(2000);
    expect(g.view('p1').cooldowns.map((c) => c.cell)).toEqual([A1]);
    g.act({ type: 'reconnect', playerId: 'p2' }, 3000);
    expect(g.view('p1').cooldowns).toEqual([{ cell: A1, until: 3600 }]);
  });

  it('the interference panel: none for a viewer who left or is disconnected; notRunning before the start and after the end [D10, D11]', () => {
    const g = GameDriver.of({ players: 3 }, { start: false });
    const blocked = (viewer: PlayerId) =>
      g.view(viewer).interference?.targets.map((t) => t.blockedBy) ?? null;
    expect(blocked('p1')).toEqual(['notRunning', 'notRunning']);
    g.act({ type: 'start' }, 0);
    expect(blocked('p1')).toEqual(['points', 'points']);
    g.solve('p1', 'A1', 0); // 8 points
    expect(blocked('p1')).toEqual([null, null]);
    g.playerAct('p3', { type: 'surrender' }, 100);
    expect(g.view('p3').interference).toBeNull();
    expect(blocked('p1')).toEqual([null, 'out']);
    g.act({ type: 'disconnect', playerId: 'p2' }, 200); // two still in the game: frozen
    expect(g.state.status).toBe('paused');
    expect(g.view('p2').interference).toBeNull();
    expect(blocked('p1')).toEqual(['disconnected', 'out']);
    // A board filled to the end: the opponent is still in the game, but the game is over.
    const done = GameDriver.of();
    solveAll(done, 'p1');
    expect(done.view('p1').interference?.targets).toEqual([{ playerId: 'p2', blockedBy: 'notRunning' }]);
  });

  it('are copies: changing a view does not change the game', () => {
    const g = turns();
    g.miss('p1', 'A1', 0);
    const before = JSON.stringify(g.state);
    const v = g.view('p1');
    v.grid[A1] = 9;
    v.givens[A1] = true;
    v.owner[A1] = 3;
    v.wrong[A1]!.push({ digit: 9, playerId: 'p2' });
    v.players[0]!.score = 99;
    v.players[0]!.mistakePenalties.push(99);
    v.turn!.playerId = 'p1';
    expect(JSON.stringify(g.state)).toBe(before);
  });
});

// =========================================================================================================

describe('LocalGameHost (§17.2)', () => {
  function setup(o: ConfigOptions = {}, extra: { playerId?: string; autoStart?: boolean; at?: number } = {}) {
    const clock = new ManualClock(extra.at ?? 0);
    const scheduler = new ManualScheduler(clock);
    const host = new LocalGameHost({
      config: makeConfig(o),
      playerId: extra.playerId ?? 'p1',
      clock,
      scheduler,
      autoStart: extra.autoStart,
    });
    const updates: HostUpdate[] = [];
    const unsubscribe = host.subscribe((u) => updates.push(u));
    return { clock, scheduler, host, updates, unsubscribe };
  }

  it('starts on its own at the clock time', () => {
    const { host, updates, scheduler } = setup({}, { at: 700 });
    expect(host.events.map((e) => [e.type, e.t])).toEqual([
      ['gameCreated', 700],
      ['gameStarted', 700],
    ]);
    expect(host.state).toMatchObject({ status: 'running', startedAt: 700 });
    expect(host.getView()).toMatchObject({ me: 'p1', status: 'running', seq: 2 });
    expect(host.playerId).toBe('p1');
    expect(updates).toEqual([]); // it started before anyone subscribed
    expect(scheduler.pending).toBe(0); // nothing is due yet
  });

  it('send() acts as the local player; subscribers get the events and a fresh view', () => {
    const { host, updates, scheduler } = setup();
    scheduler.advance(500);
    host.send({ type: 'select', cell: A1 });
    expect(updates).toHaveLength(1);
    const u = updates[0]!;
    if (u.kind !== 'events') throw new Error('expected events');
    expect(u.events).toEqual([
      { type: 'cellLocked', playerId: 'p1', cell: A1, expiresAt: 8500, remainingMs: 8000, seq: 3, t: 500 },
    ]);
    expect(u.view).toEqual(host.getView());
    expect(u.view).toMatchObject({ me: 'p1', seq: 3, keypad: { enabled: true } });
    expect(u.view.players[0]!.lock).toEqual({ cell: A1, expiresAt: 8500, remainingMs: 8000 });

    host.send({ type: 'place', cell: A1, digit: answer('A1') });
    const v = updates[1]!.view;
    expect(updates[1]).toMatchObject({
      kind: 'events',
      events: [{ type: 'placedCorrect', points: 8, score: 8 }],
    });
    expect(v.grid[A1]).toBe(answer('A1'));
    expect(v.players[0]!.score).toBe(8);
    // The earlier view is a picture of its moment: it did not change.
    expect(u.view.grid[A1]).toBe(0);
    expect(v).not.toBe(u.view);
    expect(host.events.slice(-2)).toEqual([...u.events, ...(updates[1] as { events: GameEvent[] }).events]);
  });

  it('a refused action of the local player comes back as "rejected" with the reason and the view; nothing is logged', () => {
    const { host, updates } = setup();
    host.dispatch({ type: 'select', playerId: 'p2', cell: A1 });
    const n = host.events.length;
    host.send({ type: 'select', cell: A3 });
    host.send({ type: 'select', cell: A1 });
    host.send({ type: 'release' });
    host.send({ type: 'dance' } as unknown as ClientAction);
    expect(updates.slice(1)).toEqual([
      { kind: 'rejected', action: { type: 'select', cell: A3 }, reason: 'cellFilled', view: host.getView() },
      { kind: 'rejected', action: { type: 'select', cell: A1 }, reason: 'cellTaken', view: host.getView() },
      { kind: 'rejected', action: { type: 'release' }, reason: 'noLock', view: host.getView() },
      { kind: 'rejected', action: { type: 'dance' }, reason: 'badAction', view: host.getView() },
    ]);
    expect(host.events).toHaveLength(n);
    expect(host.state.players[0]!.score).toBe(0); // "taken" costs nothing
  });

  it('timers fire through the scheduler at their deadline: a lock times out after 8000 ms', () => {
    const { host, updates, scheduler, clock } = setup();
    host.send({ type: 'select', cell: A1 });
    expect(scheduler.pending).toBe(1);
    scheduler.advance(7999);
    expect(updates).toHaveLength(1);
    scheduler.advance(1);
    expect(clock.now()).toBe(8000);
    expect(updates).toHaveLength(2);
    expect(updates[1]).toMatchObject({
      kind: 'events',
      events: [{ type: 'cellReleased', playerId: 'p1', cell: A1, reason: 'timeout', t: 8000 }],
    });
    expect(updates[1]!.view.players[0]!.lock).toBeNull();
    expect(updates[1]!.view.cooldowns).toEqual([{ cell: A1, until: 9000 }]);
    expect(scheduler.pending).toBe(0);
  });

  it('a timer that is overdue runs before the next action, with its own time, then the refusal comes', () => {
    const { host, updates, clock } = setup();
    host.send({ type: 'select', cell: A1 });
    clock.set(9000); // the scheduler has not fired
    host.send({ type: 'select', cell: A3 });
    expect(updates.slice(1).map((u) => u.kind)).toEqual(['events', 'rejected']);
    expect(updates[1]).toMatchObject({ events: [{ type: 'cellReleased', reason: 'timeout', t: 8000 }] });
    expect(updates[2]).toMatchObject({ reason: 'cellFilled' });
  });

  it('a timer that fires early only re-arms; one that fires late still stamps the deadline', () => {
    const timers = new Map<number, { fn: () => void; ms: number }>();
    let nextId = 1;
    const scheduler: Scheduler = {
      setTimeout: (fn, ms) => {
        timers.set(nextId, { fn, ms });
        return nextId++;
      },
      clearTimeout: (h) => void timers.delete(h as number),
    };
    const fire = () => {
      const [id, t] = [...timers][0]!;
      timers.delete(id);
      t.fn();
    };
    const clock = new ManualClock(0);
    const host = new LocalGameHost({ config: makeConfig(), playerId: 'p1', clock, scheduler });
    const updates: HostUpdate[] = [];
    host.subscribe((u) => updates.push(u));
    host.send({ type: 'select', cell: A1 });
    expect([...timers.values()].map((t) => t.ms)).toEqual([8000]);
    clock.set(5000);
    fire(); // early
    expect(updates).toHaveLength(1);
    expect([...timers.values()].map((t) => t.ms)).toEqual([3000]);
    clock.set(12000);
    fire(); // late
    expect(updates[1]).toMatchObject({ events: [{ type: 'cellReleased', reason: 'timeout', t: 8000 }] });
    expect(timers.size).toBe(0);
  });

  it('keeps a single timer, re-armed after every change', () => {
    const { host, scheduler } = setup({ players: 3 });
    const seen: number[] = [];
    host.send({ type: 'select', cell: A1 });
    seen.push(scheduler.pending);
    host.dispatch({ type: 'select', playerId: 'p2', cell: A2 });
    seen.push(scheduler.pending);
    host.send({ type: 'select', cell: A3 }); // refused
    seen.push(scheduler.pending);
    scheduler.advance(8000); // both locks expire at 8000
    seen.push(scheduler.pending);
    expect(seen).toEqual([1, 1, 1, 0]);
    expect(host.events.slice(-2).map((e) => [e.type, e.t])).toEqual([
      ['cellReleased', 8000],
      ['cellReleased', 8000],
    ]);
  });

  it('dispatch() acts for another player (a bot) and returns the engine result; a bot’s refusal is not a "rejected" update', () => {
    const { host, updates } = setup({ players: [{ id: 'p1' }, { id: 'bot', isBot: true }] });
    const r = host.dispatch({ type: 'select', playerId: 'bot', cell: A1 });
    expect(r.rejected).toBeUndefined();
    expect(r.events).toEqual([expect.objectContaining({ type: 'cellLocked', playerId: 'bot', cell: A1 })]);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.view.me).toBe('p1');
    expect(updates[0]!.view.players[1]).toMatchObject({ id: 'bot', isBot: true, lock: { cell: A1 } });
    const refused = host.dispatch({ type: 'select', playerId: 'bot', cell: A3 });
    expect(refused).toMatchObject({ rejected: 'cellFilled', events: [] });
    expect(updates).toHaveLength(1);
    expect(host.dispatch({ type: 'start' }).rejected).toBe('alreadyStarted');
  });

  it('dispatch() runs system actions: a disconnect freezes a 2-player game, a reconnect resumes it [D4]', () => {
    const { host, updates, scheduler } = setup();
    host.send({ type: 'select', cell: A1 }); // expires 8000
    scheduler.advance(1000);
    host.dispatch({ type: 'disconnect', playerId: 'p2' });
    expect(updates[1]).toMatchObject({
      kind: 'events',
      events: [{ type: 'playerDisconnected', playerId: 'p2', graceEndsAt: 16000 }, { type: 'gamePaused' }],
      view: { status: 'paused', keypad: { enabled: false } },
    });
    scheduler.advance(3000);
    expect(updates).toHaveLength(2); // frozen: the lock does not time out
    host.dispatch({ type: 'reconnect', playerId: 'p2' });
    expect(updates[2]).toMatchObject({
      events: [{ type: 'playerReconnected' }, { type: 'gameResumed', reason: 'reconnect', pausedMs: 3000 }],
    });
    expect(host.state.locks[0]!.expiresAt).toBe(11000);
    scheduler.advance(6999);
    expect(updates).toHaveLength(3);
    scheduler.advance(1);
    expect(updates[3]).toMatchObject({ events: [{ type: 'cellReleased', reason: 'timeout', t: 11000 }] });
  });

  it('the grace period runs out through the scheduler: abandoned, and the game is over [D4]', () => {
    const { host, updates, scheduler } = setup();
    scheduler.advance(1000);
    host.dispatch({ type: 'disconnect', playerId: 'p2' });
    scheduler.advance(14999);
    expect(updates).toHaveLength(1);
    scheduler.advance(1);
    expect(updates[1]).toMatchObject({
      events: [
        { type: 'playerAbandoned', playerId: 'p2', t: 16000 },
        { type: 'gameOver', reason: 'lastPlayerStanding', t: 16000 },
      ],
      view: { status: 'over', solution: PUZZLE.solution },
    });
    expect(scheduler.pending).toBe(0);
  });

  it('the full log keeps the solution; updates never carry it until the game is over', () => {
    const { host, updates, scheduler } = setup();
    expect(asType(host.events[0], 'gameCreated').config.puzzle.solution).toBe(PUZZLE.solution);
    for (const i of EMPTY) {
      scheduler.advance(100);
      host.send({ type: 'select', cell: i });
      host.send({ type: 'place', cell: i, digit: answer(i) });
    }
    expect(host.state.status).toBe('over');
    expect(updates.every((u) => u.kind === 'events')).toBe(true);
    const last = updates.at(-1)!;
    const running = updates.slice(0, -1);
    expect(running.filter((u) => u.view.solution !== null || hasSolution(u))).toEqual([]);
    expect(last).toMatchObject({
      events: [{ type: 'placedCorrect' }, { type: 'gameOver', reason: 'boardComplete' }],
    });
    expect(last.view.solution).toBe(PUZZLE.solution);
    expect(hasSolution(updates.flatMap((u) => (u.kind === 'events' ? u.events : [])))).toBe(false);
    expect(replay(host.events).at(-1)).toEqual(host.state);
  });

  it('unsubscribe stops the updates for that listener only', () => {
    const { host, updates, unsubscribe } = setup();
    const other: HostUpdate[] = [];
    host.subscribe((u) => other.push(u));
    host.send({ type: 'select', cell: A1 });
    unsubscribe();
    unsubscribe(); // twice is harmless
    host.send({ type: 'release' });
    host.send({ type: 'release' }); // refused
    expect(updates).toHaveLength(1);
    expect(other.map((u) => u.kind)).toEqual(['events', 'events', 'rejected']);
  });

  it('close() stops the timers and the updates; dispatch and send throw afterwards', () => {
    const { host, updates, scheduler } = setup();
    host.send({ type: 'select', cell: A1 });
    expect(scheduler.pending).toBe(1);
    host.close();
    expect(scheduler.pending).toBe(0);
    const n = host.events.length;
    scheduler.advance(60000);
    expect(host.events).toHaveLength(n);
    expect(updates).toHaveLength(1);
    expect(() => host.dispatch({ type: 'select', playerId: 'p2', cell: A2 })).toThrow(/closed/);
    expect(() => host.send({ type: 'release' })).toThrow(/closed/);
    expect(() => host.close()).not.toThrow();
    expect(host.events).toHaveLength(n);
  });

  it('autoStart false: waits for dispatch({ type: "start" }); in turns the turn timer starts then', () => {
    const { host, updates, scheduler } = setup({ rules: { turnModel: 'turns' } }, { autoStart: false });
    expect(host.events.map((e) => e.type)).toEqual(['gameCreated']);
    expect(host.state.status).toBe('waiting');
    expect(host.getView().solution).toBeNull();
    expect(scheduler.pending).toBe(0);
    host.send({ type: 'select', cell: A1 });
    expect(updates).toEqual([expect.objectContaining({ kind: 'rejected', reason: 'notStarted' })]);
    scheduler.advance(2000);
    const r = host.dispatch({ type: 'start' });
    expect(r.events.map((e) => e.type)).toEqual(['gameStarted', 'turnStarted']);
    expect(updates[1]).toMatchObject({
      kind: 'events',
      events: [
        { type: 'gameStarted', t: 2000 },
        { type: 'turnStarted', playerId: 'p1', endsAt: 10000, remainingMs: 8000 },
      ],
      view: { status: 'running', turn: { playerId: 'p1', expiresAt: 10000, remainingMs: 8000 } },
    });
    expect(scheduler.pending).toBe(1);
    scheduler.advance(8000);
    expect(updates[2]).toMatchObject({
      events: [{ type: 'turnStarted', playerId: 'p2', t: 10000, endsAt: 18000 }],
    });
  });

  it('in turns the local player may lock only on their turn', () => {
    const { host, updates } = setup({ rules: { turnModel: 'turns' } }, { playerId: 'p2' });
    host.send({ type: 'select', cell: A1 });
    expect(updates).toEqual([expect.objectContaining({ kind: 'rejected', reason: 'notYourTurn' })]);
    host.dispatch({ type: 'select', playerId: 'p1', cell: A1 });
    host.dispatch({ type: 'place', playerId: 'p1', cell: A1, digit: answer('A1') });
    expect(host.getView().turn?.playerId).toBe('p2');
    host.send({ type: 'select', cell: A2 });
    expect(host.getView().players[1]!.lock?.cell).toBe(A2);
  });

  it('throws for a player who is not in the game, and for a config the engine refuses', () => {
    const clock = new ManualClock(0);
    const scheduler = new ManualScheduler(clock);
    expect(() => new LocalGameHost({ config: makeConfig(), playerId: 'p9', clock, scheduler })).toThrow(
      RangeError,
    );
    expect(
      () => new LocalGameHost({ config: makeConfig({ players: 5 }), playerId: 'p1', clock, scheduler }),
    ).toThrow(RangeError);
    expect(scheduler.pending).toBe(0);
  });

  it('a listener that dispatches in response (a bot) keeps the log whole', () => {
    const { host, scheduler } = setup({ players: 3 });
    host.subscribe((u) => {
      if (u.kind === 'events' && u.events.some((e) => e.type === 'cellLocked' && e.playerId === 'p1'))
        host.dispatch({ type: 'react', playerId: 'p2', emoji: '👀' });
    });
    host.send({ type: 'select', cell: A1 });
    scheduler.advance(2000);
    host.send({ type: 'release' });
    scheduler.advance(2000);
    host.send({ type: 'select', cell: A2 });
    expect(host.events.map((e) => e.type).slice(2)).toEqual([
      'cellLocked',
      'reaction',
      'cellReleased',
      'cellLocked',
      'reaction',
    ]);
    expectWellFormedLog(host.events);
    expect(replay(host.events).at(-1)).toEqual(host.state);
  });

  it('implements GameHost: select, place, release, interfere, react and surrender act as the local player', () => {
    const { host, updates, scheduler } = setup({ players: 3 });
    const said = () =>
      updates
        .splice(0)
        .map((u) => (u.kind === 'events' ? u.events.map((e) => e.type) : `rejected: ${u.reason}`));
    host.select(A1);
    host.place(A1, answer('A1')); // 8 points
    expect(said()).toEqual([['cellLocked'], ['placedCorrect']]);
    host.place(A2, answer('A2'));
    expect(said()).toEqual(['rejected: noLock']);
    host.select(A2);
    host.release();
    expect(said()).toEqual([['cellLocked'], ['cellReleased']]);
    host.interfere('p2', 'cats');
    host.react('😂');
    host.react('😂');
    expect(said()).toEqual([['interference'], ['reaction'], 'rejected: tooSoon']);
    scheduler.advance(5000); // the interference ends
    expect(said()).toEqual([['interferenceEnded']]);
    host.surrender();
    expect(said()).toEqual([['playerSurrendered']]);
    // All of it was p1's, and the game goes on for the other two.
    const actors = host.events.flatMap((e) => ('playerId' in e ? [e.playerId] : []));
    expect(new Set(actors)).toEqual(new Set(['p1']));
    expect(host.events.find((e) => e.type === 'interference')).toMatchObject({
      fromId: 'p1',
      targetId: 'p2',
      cost: 2,
    });
    expect(host.getView()).toMatchObject({ status: 'running', me: 'p1', interference: null });
    expect(host.getView().players[0]).toMatchObject({ status: 'surrendered', score: 6 });
    host.select(A5);
    expect(said()).toEqual(['rejected: notActive']);
  });

  it('updates come in seq order, one at a time, even when a listener acts while being told (a queue)', () => {
    const clock = new ManualClock(0);
    const scheduler = new ManualScheduler(clock);
    const host = new LocalGameHost({
      config: makeConfig({ players: [{ id: 'p1' }, { id: 'bot', isBot: true }] }),
      playerId: 'p1',
      clock,
      scheduler,
    });
    // The bot answers each of my locks at once, from inside the notification, before the next listener hears.
    host.subscribe((u) => {
      if (u.kind === 'events' && u.events.some((e) => e.type === 'cellLocked' && e.playerId === 'p1'))
        host.dispatch({ type: 'react', playerId: 'bot', emoji: '👀' });
    });
    const seen: HostUpdate[] = [];
    host.subscribe((u) => seen.push(u));
    host.select(A1);
    scheduler.advance(2000);
    host.release();
    host.select(A2);
    const seqs = seen.map((u) => (u.kind === 'events' ? u.events.map((e) => [e.type, e.seq]) : []));
    expect(seqs).toEqual([
      [['cellLocked', 3]],
      [['reaction', 4]],
      [['cellReleased', 5]],
      [['cellLocked', 6]],
      [['reaction', 7]],
    ]);
    // Each update's view is the picture right after its own events.
    for (const u of seen) if (u.kind === 'events') expect(u.view.seq).toBe(u.events.at(-1)!.seq);
    expectWellFormedLog(host.events);
  });

  it('the clock is set again before anyone hears: a listener sees the timer armed, and one that throws does not stop the game', () => {
    const { host, scheduler, updates } = setup();
    const armed: number[] = [];
    let breakOnRelease = true;
    host.subscribe((u) => {
      armed.push(scheduler.pending);
      if (breakOnRelease && u.kind === 'events' && u.events.some((e) => e.type === 'cellReleased')) {
        breakOnRelease = false;
        throw new Error('a broken screen');
      }
    });
    host.select(A1); // expires 8000
    scheduler.advance(1000);
    host.dispatch({ type: 'select', playerId: 'p2', cell: A2 }); // expires 9000
    expect(armed).toEqual([1, 1]);
    // p1's lock times out from the scheduler; the listener throws while hearing it.
    expect(() => scheduler.advance(7000)).toThrow('a broken screen');
    expect(host.events.at(-1)).toMatchObject({ type: 'cellReleased', playerId: 'p1', t: 8000 });
    expect(scheduler.pending).toBe(1); // p2's lock is still timed
    scheduler.advance(1000);
    expect(host.events.at(-1)).toMatchObject({ type: 'cellReleased', playerId: 'p2', t: 9000 });
    expect(updates.at(-1)).toMatchObject({ events: [{ type: 'cellReleased', playerId: 'p2', t: 9000 }] });
    // A throw from an action's update: the action stands, and the clock is armed for what it started.
    breakOnRelease = true;
    host.dispatch({ type: 'select', playerId: 'p2', cell: A5 }); // expires 17000
    host.select(A1);
    expect(() => host.release()).toThrow('a broken screen');
    expect(host.state.locks.map((l) => l.playerId)).toEqual(['p2']);
    expect(host.events.at(-1)).toMatchObject({ type: 'cellReleased', playerId: 'p1', reason: 'cancel' });
    expect(scheduler.pending).toBe(1);
    scheduler.advance(8000);
    expect(host.events.at(-1)).toMatchObject({
      type: 'cellReleased',
      playerId: 'p2',
      reason: 'timeout',
      t: 17000,
    });
  });

  it('nothing is delivered after close(), not even updates already in the queue', () => {
    const clock = new ManualClock(0);
    const scheduler = new ManualScheduler(clock);
    const host = new LocalGameHost({ config: makeConfig(), playerId: 'p1', clock, scheduler });
    host.subscribe((u) => {
      if (u.kind === 'events' && u.events.some((e) => e.type === 'cellLocked')) {
        host.dispatch({ type: 'react', playerId: 'p2', emoji: '👀' }); // queued behind this update
        host.close();
      }
    });
    const seen: HostUpdate[] = [];
    host.subscribe((u) => seen.push(u));
    host.select(A1);
    expect(seen).toEqual([]);
    expect(host.events.slice(-2).map((e) => e.type)).toEqual(['cellLocked', 'reaction']); // the log has both
    expect(scheduler.pending).toBe(0);
    scheduler.advance(60000);
    expect(seen).toEqual([]);
  });

  it('with an rng the game gets a seed in its first event; the same rng seed gives the same game seed (spec §6)', () => {
    const clock = new ManualClock(0);
    const make = (rng?: Rng) =>
      new LocalGameHost({
        config: makeConfig(),
        playerId: 'p1',
        clock,
        scheduler: new ManualScheduler(clock),
        rng,
      });
    const seedOf = (h: LocalGameHost) => asType(h.events[0], 'gameCreated').config.seed;
    const a = make(createRng(5));
    expect(seedOf(a)).toBe(Math.floor(createRng(5).next() * 2 ** 31));
    expect(a.state.config.seed).toBe(seedOf(a));
    expect(seedOf(make(createRng(5)))).toBe(seedOf(a));
    expect(seedOf(make())).toBeUndefined();
    // The seed is no secret: the public first event keeps it, and only the solution goes.
    const pub = asType(toPublicEvent(a.events[0]!), 'gameCreated');
    expect(pub.config.seed).toBe(seedOf(a));
  });

  it('a clock that goes back does not take the game back in time', () => {
    const { host, clock, updates } = setup();
    clock.set(5000);
    host.select(A1);
    clock.set(2000);
    host.dispatch({ type: 'select', playerId: 'p2', cell: A2 });
    expect(host.events.slice(-2).map((e) => [e.type, e.t])).toEqual([
      ['cellLocked', 5000],
      ['cellLocked', 5000],
    ]);
    expect(updates).toHaveLength(2);
    expectWellFormedLog(host.events);
  });
});
