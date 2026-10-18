import { canInterfere, canReact } from '../bot/brain';
import { parseCellName } from '../sudoku/board';
import { answer, GameDriver, makeConfig, PUZZLE, wrongDigit } from '../testing/game';
import { ManualClock } from '../util/clock';
import { ManualScheduler } from '../util/scheduler';
import { abandonmentAt } from './engine';
import { evolve } from './evolve';
import { type HostUpdate, LocalGameHost } from './host';
import { defaultRules, GAME_MODES, type Rules } from './rules';
import type { GameEvent, GameState, PlayerInfo } from './types';
import { replay } from './view';

/*
 * The soft phase of a lost connection [D42] (Moshe, 2026-10-15; spec §16.2): for rules.softGraceMs (10 s) the
 * player is only marked; the game goes on as usual for everyone. Then the hard phase of [D4] (15 s of grace, a
 * freeze in 2 players, a release in 3–4). Moves made offline come back as `offlineMove` after the return, each
 * decided on the board as it is when it arrives: lost with no penalty if the cell is no longer free for him.
 * Every game starts at t = 0, 'fast' (8 s of think time). On the opening board A1 is worth 8, A2 7.5.
 */

const A1 = parseCellName('A1');
const A2 = parseCellName('A2');
const A5 = parseCellName('A5');
const B1 = parseCellName('B1');

const soft = (g: GameDriver, playerId: string, at?: number) => g.disconnect(playerId, { soft: true, at });

const rated = (ratings: number[], ratedGames = 30): PlayerInfo[] =>
  ratings.map((rating, k) => ({ id: `p${k + 1}`, name: `P${k + 1}`, rating, ratedGames }));

/** PUZZLE solved but for `cells` (by name): a board near its end. */
function nearlySolved(cells: string[]) {
  const blank = new Set(cells.map(parseCellName));
  const givens = [...PUZZLE.solution].map((d, i) => (blank.has(i) ? '0' : d)).join('');
  return { id: 'near', givens, solution: PUZZLE.solution };
}

const gameOver = (events: GameEvent[]) =>
  events.find((e): e is Extract<GameEvent, { type: 'gameOver' }> => e.type === 'gameOver');

// ---------------------------------------------------------------------------------------------------------

describe('the soft-phase rules [D42]', () => {
  it.each(GAME_MODES)(
    '%s: 10 s soft, then the 15 s grace; 8 offline moves within 5 s; no hits on him',
    (mode) => {
      const rules = defaultRules(mode, 'fast');
      expect(rules).toMatchObject({
        softGraceMs: 10000,
        graceMs: 15000,
        offlineMovesMax: 8,
        offlineMovesWindowMs: 5000,
        interfereSoftOffline: false,
      });
    },
  );
});

describe('a connection that drops: the soft phase (§16.2) [D42]', () => {
  it('2 players: only playerConnectionLost; the game runs on, he is still connected, every lock keeps running', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 0); // until 8000
    g.select('p2', 'A2', 500); // until 8500
    const events = soft(g, 'p2', 1000);
    expect(events).toEqual([
      { type: 'playerConnectionLost', playerId: 'p2', softEndsAt: 11000, seq: expect.any(Number), t: 1000 },
    ]);
    expect(g.state.status).toBe('running');
    expect(g.player('p2')).toMatchObject({ connected: true, graceEndsAt: null, softEndsAt: 11000 });
    expect(g.state.locks.map((l) => [l.playerId, l.expiresAt])).toEqual([
      ['p1', 8000],
      ['p2', 8500],
    ]);
    expect(g.deadline).toBe(8000);
    expect(abandonmentAt(g.state, 'p2')).toBe(26000);
    expect(abandonmentAt(g.state, 'p1')).toBeNull();
    // Everyone's view marks him; nothing else.
    for (const viewer of ['p1', 'p2'])
      expect(g.view(viewer).players.map((p) => p.softEndsAt)).toEqual([null, 11000]);
  });

  it('meanwhile the others play freely, his lock runs out as usual, and his own actions are refused', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 0);
    g.select('p2', 'A2', 500); // until 8500
    soft(g, 'p2', 1000);
    expect(g.types(g.place('p1', 'A1', answer('A1'), 2000))).toEqual(['placedCorrect']);
    expect(g.types(g.select('p1', 'A5', 3000))).toEqual(['cellLocked']);
    for (const action of [
      { type: 'select', cell: B1 },
      { type: 'place', cell: A2, digit: answer('A2') },
      { type: 'release' },
      { type: 'interfere', targetId: 'p1', kind: 'cats' },
      { type: 'react', emoji: '😂' },
      { type: 'surrender' },
      { type: 'offlineMove', cell: B1, digit: answer('B1'), thinkMs: 1000 },
    ] as const)
      expect([action.type, g.reject({ ...action, playerId: 'p2' }, 4000)]).toEqual([
        action.type,
        'disconnected',
      ]);
    const timeout = g.tickTo(8500);
    expect(timeout).toMatchObject([
      { type: 'cellReleased', playerId: 'p2', cell: A2, reason: 'timeout', t: 8500 },
    ]);
    expect(g.state.status).toBe('running');
  });

  it('nextDeadline includes the end of the soft phase', () => {
    const g = GameDriver.of();
    soft(g, 'p2', 1000);
    expect(g.deadline).toBe(11000);
  });

  it('back before it ends: playerReconnected only, never a freeze; the offline window opens', () => {
    const g = GameDriver.of();
    soft(g, 'p2', 1000);
    const back = g.reconnect('p2', 6000);
    expect(back).toEqual([{ type: 'playerReconnected', playerId: 'p2', seq: expect.any(Number), t: 6000 }]);
    expect('softEndsAt' in g.player('p2')).toBe(false); // the key is gone, not null
    expect(g.player('p2').offlineWindow).toEqual({ until: 11000, left: 8 });
    for (const type of ['gamePaused', 'gameResumed', 'playerDisconnected'] as const)
      expect(g.last(type)).toBeUndefined();
    expect(g.deadline).toBeNull();
    expect(g.advance(60000)).toEqual([]); // nothing left to run out
    expect(g.view('p1').players[1]!.softEndsAt).toBeNull();
    expect(g.replayMatches()).toBe(true);
  });

  it('not back, 2 players: at its end the hard phase (grace from then, a freeze); abandonment 25 s after the drop', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 0); // until 8000: runs out inside the soft phase, as usual
    soft(g, 'p2', 1000);
    const hard = g.tickTo(11000);
    expect(g.types(hard)).toEqual(['cellReleased', 'playerDisconnected', 'gamePaused']);
    expect(hard[0]).toMatchObject({ playerId: 'p1', reason: 'timeout', t: 8000 });
    expect(hard[1]).toMatchObject({ playerId: 'p2', graceEndsAt: 26000, t: 11000 });
    expect(hard[2]).toMatchObject({ reason: 'disconnect', t: 11000 });
    expect(g.player('p2')).toMatchObject({ connected: false, graceEndsAt: 26000 });
    expect('softEndsAt' in g.player('p2')).toBe(false);
    expect(abandonmentAt(g.state, 'p2')).toBe(26000);
    expect(g.deadline).toBe(26000);
    expect(g.tickTo(25999)).toEqual([]);
    const end = g.tickTo(26000);
    expect(g.types(end)).toEqual(['playerAbandoned', 'gameOver']);
    expect(gameOver(end)!.ranking.map((r) => [r.playerId, r.place, r.status])).toEqual([
      ['p1', 1, 'active'],
      ['p2', 2, 'abandoned'],
    ]);
    expect(abandonmentAt(g.state, 'p2')).toBeNull();
    expect(g.replayMatches()).toBe(true);
  });

  it('not back, 3–4 players: at its end his lock is released (disconnect), the game goes on, abandonment at 25 s', () => {
    const g = GameDriver.of({ players: 3, rules: { thinkTimeMs: 30000 } });
    g.select('p3', 'A1', 0); // until 30000
    soft(g, 'p3', 1000);
    g.select('p1', 'A2', 2000);
    const hard = g.tickTo(11000);
    expect(g.types(hard)).toEqual(['playerDisconnected', 'cellReleased']);
    expect(hard[1]).toMatchObject({ playerId: 'p3', cell: A1, reason: 'disconnect', t: 11000 });
    expect(g.state.status).toBe('running');
    expect(g.lock('p1')).toMatchObject({ cell: A2, expiresAt: 32000 });
    expect(g.types(g.tickTo(26000))).toEqual(['playerAbandoned']);
    expect(g.last('playerAbandoned')!.t - 1000).toBe(25000);
  });

  it('back exactly at its end is already the hard phase: the timers run first', () => {
    const g = GameDriver.of();
    soft(g, 'p2', 1000);
    const events = g.reconnect('p2', 11000);
    expect(g.types(events)).toEqual(['playerDisconnected', 'gamePaused', 'playerReconnected', 'gameResumed']);
    expect(events[3]).toMatchObject({ pausedMs: 0 });
    const h = GameDriver.of();
    soft(h, 'p2', 1000);
    expect(h.types(h.reconnect('p2', 10999))).toEqual(['playerReconnected']);
  });

  it('a deliberate leave (no soft) is hard at once, as before; with softGraceMs 0 a drop is hard at once too', () => {
    const g = GameDriver.of();
    const leave = g.disconnect('p2', { at: 1000 });
    expect(g.types(leave)).toEqual(['playerDisconnected', 'gamePaused']);
    expect(leave[0]).toMatchObject({ graceEndsAt: 16000 });

    const off = GameDriver.of({ rules: { softGraceMs: 0 } });
    const drop = soft(off, 'p2', 1000);
    expect(off.types(drop)).toEqual(['playerDisconnected', 'gamePaused']);
    expect(drop[0]).toMatchObject({ graceEndsAt: 16000 });
    expect('softEndsAt' in off.player('p2')).toBe(false);
    off.reconnect('p2', 2000);
    expect('offlineWindow' in off.player('p2')).toBe(false); // offline play is off with the soft phase
  });

  it('a second drop report is refused; a deliberate leave hardens the soft phase now', () => {
    const g = GameDriver.of();
    soft(g, 'p2', 1000);
    expect(g.reject({ type: 'disconnect', playerId: 'p2', soft: true }, 2000)).toBe('alreadyDisconnected');
    const hard = g.disconnect('p2', { at: 3000 });
    expect(g.types(hard)).toEqual(['playerDisconnected', 'gamePaused']);
    expect(hard[0]).toMatchObject({ graceEndsAt: 18000, t: 3000 });
    expect('softEndsAt' in g.player('p2')).toBe(false);
    expect(g.reject({ type: 'disconnect', playerId: 'p2', soft: true }, 4000)).toBe('alreadyDisconnected');
    expect(g.reject({ type: 'disconnect', playerId: 'p2' }, 4000)).toBe('alreadyDisconnected');
    expect(g.reject({ type: 'reconnect', playerId: 'p1' }, 4000)).toBe('alreadyConnected');
    expect(g.deadline).toBe(18000);
  });
});

describe('interferences and the soft phase (§7.2) [D42]', () => {
  it('nobody can hit a player in the soft phase (targetDisconnected), and the panel says so', () => {
    const g = GameDriver.of();
    g.solve('p1', 'A1', 0); // 8, to pay for one
    soft(g, 'p2', 1000);
    expect(g.reject({ type: 'interfere', playerId: 'p1', targetId: 'p2', kind: 'cats' }, 1500)).toBe(
      'targetDisconnected',
    );
    expect(g.score('p1')).toBe(8);
    expect(g.view('p1').interference!.targets).toEqual([{ playerId: 'p2', blockedBy: 'disconnected' }]);
    expect(canInterfere(g.state, 'p1', 'p2', 1500)).toBe(false); // a bot reads the same rule
    g.reconnect('p2', 2000);
    expect(g.view('p1').interference!.targets).toEqual([{ playerId: 'p2', blockedBy: null }]);
  });

  it('interfereSoftOffline: true allows it', () => {
    const g = GameDriver.of({ rules: { interfereSoftOffline: true } });
    g.solve('p1', 'A1', 0);
    soft(g, 'p2', 1000);
    expect(g.view('p1').interference!.targets).toEqual([{ playerId: 'p2', blockedBy: null }]);
    expect(canInterfere(g.state, 'p1', 'p2', 1500)).toBe(true);
    expect(g.types(g.playerAct('p1', { type: 'interfere', targetId: 'p2', kind: 'cats' }, 1500))).toEqual([
      'interference',
    ]);
  });

  it('my own panel while my connection is lost: nothing can be sent (notRunning), busy and out still show', () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p1', 'A1', 0); // 8
    g.playerAct('p1', { type: 'interfere', targetId: 'p3', kind: 'cats' }, 500); // 6 left; p3 busy until 6500
    soft(g, 'p1', 1000);
    expect(g.view('p1').interference!.targets).toEqual([
      { playerId: 'p2', blockedBy: 'notRunning' },
      { playerId: 'p3', blockedBy: 'busy', busyUntil: 6500 },
    ]);
    expect(g.view('p1').players[0]!.softEndsAt).toBe(11000);
    expect(canInterfere(g.state, 'p1', 'p2', 1000)).toBe(false);
    expect(canReact(g.state, 'p1', 5000)).toBe(false);
  });
});

describe('the soft phase never freezes (§16.2) [D4, D42]', () => {
  it('a frozen game resumes while someone else is only in the soft phase; his hard phase freezes it again', () => {
    const g = GameDriver.of();
    g.disconnect('p2', { at: 1000 }); // frozen
    soft(g, 'p1', 2000);
    const back = g.reconnect('p2', 3000);
    expect(g.types(back)).toEqual(['playerReconnected', 'gameResumed']);
    expect(g.state.status).toBe('running');
    expect(g.types(g.tickTo(12000))).toEqual(['playerDisconnected', 'gamePaused']);
  });

  it('a surrender that leaves 2 players, one of them in the soft phase, does not freeze the game', () => {
    const g = GameDriver.of({ players: 3 });
    soft(g, 'p3', 1000);
    expect(g.types(g.playerAct('p2', { type: 'surrender' }, 2000))).toEqual(['playerSurrendered']);
    expect(g.state.status).toBe('running');
    expect(g.types(g.tickTo(11000))).toEqual(['playerDisconnected', 'gamePaused']);
  });

  it('2 players frozen by the opponent, then my connection drops: my soft phase runs in the freeze, and the game resumes only when both are back', () => {
    const g = GameDriver.of();
    g.disconnect('p2', { at: 1000 }); // frozen; grace until 16000
    soft(g, 'p1', 2000);
    expect(g.deadline).toBe(12000); // the soft phase is not frozen
    const mine = g.tickTo(12000);
    expect(mine).toMatchObject([
      { type: 'playerDisconnected', playerId: 'p1', graceEndsAt: 27000, t: 12000 },
    ]);
    expect(g.types(g.reconnect('p2', 13000))).toEqual(['playerReconnected']); // I am still away
    expect(g.state.status).toBe('paused');
    const both = g.reconnect('p1', 14000);
    expect(g.types(both)).toEqual(['playerReconnected', 'gameResumed']);
    expect(both[1]).toMatchObject({ pausedMs: 13000 });
    expect(g.replayMatches()).toBe(true);
  });
});

describe("the 'turns' model and the soft phase [D1, D42]", () => {
  it('a player in the soft phase is skipped when the turn moves on; a turn he already holds runs out as usual', () => {
    const g = GameDriver.of({ players: 3, rules: { turnModel: 'turns' } }); // p1's turn until 8000
    soft(g, 'p2', 1000);
    expect(g.tickTo(8000)).toMatchObject([{ type: 'turnStarted', playerId: 'p3', endsAt: 16000 }]);
    g.reconnect('p2', 9000); // in the rotation again
    soft(g, 'p3', 10000);
    expect(g.state.turn).toMatchObject({ playerId: 'p3', endsAt: 16000 });
    expect(g.reject({ type: 'select', playerId: 'p3', cell: A1 }, 11000)).toBe('disconnected');
    expect(g.tickTo(16000)).toMatchObject([{ type: 'turnStarted', playerId: 'p1', endsAt: 24000 }]);
    expect(g.replayMatches()).toBe(true);
  });
});

describe('leaving clears it; the reducer rebuilds it (§13.1) [D42]', () => {
  it('a surrender clears the offline window; the end of the game clears the soft phase for everyone', () => {
    const g = GameDriver.of({ players: 3 });
    soft(g, 'p2', 1000);
    g.reconnect('p2', 2000);
    expect(g.player('p2').offlineWindow).toEqual({ until: 7000, left: 8 });
    g.playerAct('p2', { type: 'surrender' }, 3000);
    expect('offlineWindow' in g.player('p2')).toBe(false);
    soft(g, 'p3', 4000);
    g.playerAct('p1', { type: 'surrender' }, 5000); // p3 is the last one standing
    expect(g.state.status).toBe('over');
    expect('softEndsAt' in g.player('p3')).toBe(false);
    expect(g.deadline).toBeNull();
    expect(abandonmentAt(g.state, 'p3')).toBeNull();
  });

  it('an abandonment after the soft phase leaves neither key behind', () => {
    const g = GameDriver.of({ players: 3 });
    soft(g, 'p3', 1000);
    g.tickTo(26000);
    expect(g.player('p3')).toMatchObject({ status: 'abandoned', graceEndsAt: null });
    expect(['softEndsAt' in g.player('p3'), 'offlineWindow' in g.player('p3')]).toEqual([false, false]);
  });

  it('an offline window that ran out leaves the state with the next event; a new drop ends it at once', () => {
    const g = GameDriver.of();
    soft(g, 'p2', 1000);
    g.reconnect('p2', 2000); // until 7000
    g.select('p1', 'A1', 7000);
    expect(g.player('p2').offlineWindow).toEqual({ until: 7000, left: 8 }); // still open at 7000
    g.select('p1', 'A2', 7001);
    expect('offlineWindow' in g.player('p2')).toBe(false);
    soft(g, 'p2', 8000);
    g.reconnect('p2', 9000);
    soft(g, 'p2', 9500);
    expect('offlineWindow' in g.player('p2')).toBe(false);
  });

  it('replay rebuilds every state exactly, and evolve never touches the state or the event it is given', () => {
    const g = GameDriver.of({ players: 3 });
    g.select('p2', 'B1', 0);
    soft(g, 'p2', 1000);
    g.solve('p1', 'A1', 1500);
    g.reconnect('p2', 3000);
    g.offlineMove('p2', 'A2', { at: 3100 });
    g.offlineMove('p2', 'A5', { digit: wrongDigit('A5'), at: 3200 });
    soft(g, 'p3', 4000);
    g.tickTo(14000); // p3 hard
    soft(g, 'p2', 15000);
    g.tickTo(40000); // p2 hard, then both abandon: p1 is the last one standing
    expect(g.state.status).toBe('over');
    expect(g.replayMatches()).toBe(true);

    const deepFreeze = <T>(o: T): T => {
      if (o && typeof o === 'object' && !Object.isFrozen(o)) {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
      }
      return o;
    };
    let state: GameState | null = null;
    for (const e of structuredClone(g.log)) {
      const before = JSON.stringify(state);
      const next: GameState = evolve(state && deepFreeze(state), deepFreeze(e));
      expect(JSON.stringify(state)).toBe(before);
      state = next;
    }
    expect(state).toEqual(g.state);
    const states = replay(g.log);
    const lost = g.log.findIndex((e) => e.type === 'playerConnectionLost');
    expect(states[lost]!.players[1]!.softEndsAt).toBe(11000);
    const back = g.log.findIndex((e) => e.type === 'playerReconnected');
    expect(states[back]!.players[1]!.offlineWindow).toEqual({ until: 8000, left: 8 });
    // Then: B1 let go (switch), A2 locked, A2 placed: one move used.
    expect(states[back + 2]!.players[1]!.offlineWindow).toEqual({ until: 8000, left: 8 });
    expect(states[back + 3]!.players[1]!.offlineWindow).toEqual({ until: 8000, left: 7 });
  });

  it('a game whose stored rules predate the soft phase replays and plays as it was: every drop is hard', () => {
    const config = makeConfig();
    const old = {
      ...config,
      rules: Object.fromEntries(
        Object.entries(config.rules).filter(
          ([k]) =>
            !['softGraceMs', 'offlineMovesMax', 'offlineMovesWindowMs', 'interfereSoftOffline'].includes(k),
        ),
      ) as unknown as Rules,
    };
    const g = new GameDriver(old);
    expect(g.types(soft(g, 'p2', 1000))).toEqual(['playerDisconnected', 'gamePaused']);
    g.reconnect('p2', 2000);
    expect('offlineWindow' in g.player('p2')).toBe(false);
    expect(g.reject({ type: 'offlineMove', playerId: 'p2', cell: A1, digit: answer('A1'), thinkMs: 0 })).toBe(
      'offlineClosed',
    );
    expect(g.replayMatches()).toBe(true);
  });
});

describe('the leave guards judge an abandonment at the FIRST loss event (§11.2) [D32, D42]', () => {
  it('the snapshot is taken when the connection drops, kept through the hard phase, cleared on the return', () => {
    const g = GameDriver.of({ players: rated([1287, 1305]) });
    g.solve('p2', 'A1', 0); // 8
    soft(g, 'p2', 1000);
    expect(g.player('p2').leaveStandings).toEqual([
      [0, 0],
      [8, 1],
    ]);
    g.reconnect('p2', 2000);
    expect('leaveStandings' in g.player('p2')).toBe(false);

    soft(g, 'p2', 3000); // p2 ahead, p1 has not moved
    g.solve('p1', 'A2', 4000); // 6.5
    g.solve('p1', 'A5', 5000); // p1 is ahead now, and has moved
    g.tickTo(13000); // the hard phase
    expect(g.player('p2')).toMatchObject({ connected: false, graceEndsAt: 28000 });
    expect(g.player('p2').leaveStandings).toEqual([
      [0, 0],
      [8, 1],
    ]);
    const over = gameOver(g.tickTo(28000))!;
    // Judged at the drop: the leaver was ahead and p1 had not moved, so neither rating moves.
    expect(over.ratingChanges.map((c) => [c.playerId, c.delta])).toEqual([
      ['p1', 0],
      ['p2', 0],
    ]);
    expect(g.replayMatches()).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('moves made offline, sent on the return (offlineMove) [D42]', () => {
  /** p2's connection drops at 1000 and is back at `back`: the window is open until back + 5000. */
  function dropAndReturn(o: Parameters<typeof GameDriver.of>[0] = {}, back = 2000) {
    const g = GameDriver.of(o);
    soft(g, 'p2', 1000);
    g.reconnect('p2', back);
    return g;
  }

  it('on a free cell: locked, then placed with offline: true; scored on the board as it is now', () => {
    const g = GameDriver.of();
    soft(g, 'p2', 1000);
    g.solve('p1', 'A1', 1500); // meanwhile: A2 is now worth 6.5, not the 7.5 it was when p2 chose it
    g.reconnect('p2', 2000);
    const events = g.offlineMove('p2', 'A2', { thinkMs: 3000, at: 2100 });
    expect(g.types(events)).toEqual(['cellLocked', 'placedCorrect']);
    expect(events[0]).toMatchObject({ playerId: 'p2', cell: A2, expiresAt: 10100, remainingMs: 8000 });
    expect(events[1]).toMatchObject({
      playerId: 'p2',
      cell: A2,
      digit: answer('A2'),
      points: 6.5,
      score: 6.5,
      thinkMs: 3000,
      offline: true,
    });
    expect(g.player('p2')).toMatchObject({ correct: 1, thinkMsTotal: 3000, offlineWindow: { left: 7 } });
    expect(g.lock('p2')).toBeUndefined();
    expect(g.replayMatches()).toBe(true);
  });

  it('a wrong digit: placedWrong with offline: true, the usual penalty, and the cell released [D3]', () => {
    const g = dropAndReturn();
    const digit = wrongDigit('A1');
    const events = g.offlineMove('p2', 'A1', { digit, at: 2100 });
    expect(g.types(events)).toEqual(['cellLocked', 'placedWrong', 'cellReleased']);
    expect(events[1]).toMatchObject({ digit, penalty: 8, mistakes: 1, score: -8, offline: true });
    expect(events[2]).toMatchObject({ reason: 'mistake' });
    expect(g.player('p2')).toMatchObject({ mistakePenalties: [8], offlineWindow: { left: 7 } });
  });

  it('a placed digit online carries no offline flag', () => {
    const g = GameDriver.of();
    const [, placed] = g.solve('p1', 'A1', 0);
    expect('offline' in placed!).toBe(false);
  });

  it('lost with no trace and no penalty when the cell is no longer free for him: taken, filled, tried, complete', () => {
    const g = GameDriver.of();
    soft(g, 'p2', 1000);
    g.solve('p1', 'A2', 1100); // filled
    g.miss('p1', 'A5', 1200); // tried in A5 (for everyone [D12])
    g.select('p1', 'A1', 1300); // p1 holds A1 when p2's move arrives
    g.reconnect('p2', 2000);
    const before = { ...g.player('p2') };
    expect(g.reject({ type: 'offlineMove', playerId: 'p2', cell: A1, digit: answer('A1'), thinkMs: 1 })).toBe(
      'cellTaken',
    );
    expect(g.reject({ type: 'offlineMove', playerId: 'p2', cell: A2, digit: answer('A2'), thinkMs: 1 })).toBe(
      'cellFilled',
    );
    expect(
      g.reject({ type: 'offlineMove', playerId: 'p2', cell: A5, digit: wrongDigit('A5'), thinkMs: 1 }),
    ).toBe('digitTried');
    expect(g.player('p2')).toEqual(before); // score, mistakes and the window as they were
    expect(g.player('p2').offlineWindow).toEqual({ until: 7000, left: 8 });

    const near = GameDriver.of({ puzzle: nearlySolved(['A1', 'A2']) });
    soft(near, 'p2', 1000);
    near.reconnect('p2', 2000);
    // All nine 9s are on the board (A9 is a given here).
    expect(near.reject({ type: 'offlineMove', playerId: 'p2', cell: A1, digit: 9, thinkMs: 1 })).toBe(
      'digitComplete',
    );
  });

  it("[D12] 'mistaker': a digit someone else tried is his to try; his own wrong try stays refused", () => {
    const g = dropAndReturn({ rules: { wrongDigitDisabledFor: 'mistaker' } });
    const wrong = wrongDigit('A5');
    g.miss('p1', 'A5', 2050);
    expect(g.types(g.offlineMove('p2', 'A5', { digit: wrong, at: 2100 }))).toEqual([
      'cellLocked',
      'placedWrong',
      'cellReleased',
    ]);
    expect(g.reject({ type: 'offlineMove', playerId: 'p2', cell: A5, digit: wrong, thinkMs: 1 }, 2200)).toBe(
      'digitTried',
    );
  });

  it('on the cell he still holds it is placed at once; holding another, that one is let go first (switch)', () => {
    const g = GameDriver.of();
    g.select('p2', 'A1', 0);
    soft(g, 'p2', 1000);
    g.reconnect('p2', 2000);
    expect(g.types(g.offlineMove('p2', 'A1', { thinkMs: 1500, at: 2100 }))).toEqual(['placedCorrect']);

    const h = GameDriver.of();
    h.select('p2', 'B1', 0);
    soft(h, 'p2', 1000);
    h.reconnect('p2', 2000);
    const events = h.offlineMove('p2', 'A1', { at: 2100 });
    expect(h.types(events)).toEqual(['cellReleased', 'cellLocked', 'placedCorrect']);
    expect(events[0]).toMatchObject({ playerId: 'p2', cell: B1, reason: 'switch' });
  });

  it('his own re-lock wait does not hold it back: on his phone he never let the cell go', () => {
    const g = GameDriver.of();
    g.select('p2', 'A1', 0);
    g.playerAct('p2', { type: 'release' }, 500); // no re-lock of A1 before 1500
    soft(g, 'p2', 600);
    g.reconnect('p2', 700);
    expect(g.state.cooldowns).toEqual([{ playerId: 'p2', cell: A1, until: 1500 }]);
    expect(g.reject({ type: 'select', playerId: 'p2', cell: A1 }, 800)).toBe('cooldown');
    expect(g.types(g.offlineMove('p2', 'A1', { at: 800 }))).toEqual(['cellLocked', 'placedCorrect']);
  });

  it('only in the window after a return: none without one, none after it, at most offlineMovesMax; each return opens a new one', () => {
    const none = GameDriver.of();
    expect(none.reject({ type: 'offlineMove', playerId: 'p2', cell: A1, digit: 8, thinkMs: 1 }, 500)).toBe(
      'offlineClosed',
    );

    const late = dropAndReturn(); // open until 7000, inclusive
    expect(late.reject({ type: 'offlineMove', playerId: 'p2', cell: A1, digit: 8, thinkMs: 1 }, 7001)).toBe(
      'offlineClosed',
    );
    const inTime = dropAndReturn();
    expect(inTime.types(inTime.offlineMove('p2', 'A1', { at: 7000 }))).toEqual([
      'cellLocked',
      'placedCorrect',
    ]);

    const g = dropAndReturn({ rules: { offlineMovesMax: 2 } });
    g.offlineMove('p2', 'A1', { at: 2100 });
    g.offlineMove('p2', 'A2', { digit: wrongDigit('A2'), at: 2200 }); // a wrong one counts too
    expect('offlineWindow' in g.player('p2')).toBe(false);
    expect(g.reject({ type: 'offlineMove', playerId: 'p2', cell: A5, digit: answer('A5'), thinkMs: 1 })).toBe(
      'offlineClosed',
    );
    soft(g, 'p2', 3000);
    g.reconnect('p2', 4000);
    expect(g.player('p2').offlineWindow).toEqual({ until: 9000, left: 2 });
    expect(g.types(g.offlineMove('p2', 'A5', { at: 4100 }))).toEqual(['cellLocked', 'placedCorrect']);
  });

  it('the think time he claims is clamped to [0, thinkTimeMs], and counts like any (thinkMsTotal, fastest)', () => {
    const puzzle = nearlySolved(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
    const g = GameDriver.of({ puzzle });
    soft(g, 'p2', 1000);
    g.reconnect('p2', 2000);
    const claims = [-500, 99999, 100, 100, 100, Number.NaN];
    const placed = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map((cell, k) =>
      g.offlineMove('p2', cell, { thinkMs: claims[k], at: 2100 + k }).find((e) => e.type === 'placedCorrect'),
    );
    expect(placed.map((e) => e?.type === 'placedCorrect' && e.thinkMs)).toEqual([
      0, 8000, 100, 100, 100, 8000,
    ]);
    expect(g.player('p2').thinkMsTotal).toBe(16300);
    // The last cell made offline completes the board.
    const over = g.last('gameOver')!;
    expect(over).toMatchObject({ reason: 'boardComplete' });
    expect(over.stats.find((s) => s.playerId === 'p2')!.avgThinkMs).toBe(Math.round(16300 / 6));
    expect(over.awards.find((a) => a.kind === 'fastest')).toMatchObject({ playerIds: ['p2'] });
    expect(g.replayMatches()).toBe(true);
  });

  it("refused in 'turns' (notYourTurn), while frozen (paused), and after the end (gameOver)", () => {
    const turns = dropAndReturn({ rules: { turnModel: 'turns' } });
    expect(turns.reject({ type: 'offlineMove', playerId: 'p2', cell: A1, digit: 8, thinkMs: 1 })).toBe(
      'notYourTurn',
    );

    const frozen = GameDriver.of({ players: 2 });
    soft(frozen, 'p2', 1000);
    frozen.reconnect('p2', 2000);
    frozen.disconnect('p1', { at: 2500 });
    expect(frozen.reject({ type: 'offlineMove', playerId: 'p2', cell: A1, digit: 8, thinkMs: 1 })).toBe(
      'paused',
    );

    const over = dropAndReturn();
    over.playerAct('p1', { type: 'surrender' }, 2500);
    expect(over.reject({ type: 'offlineMove', playerId: 'p2', cell: A1, digit: 8, thinkMs: 1 })).toBe(
      'gameOver',
    );
  });

  it('both away at once (one network): back during the freeze, the moves wait, and the whole window runs from the resume', () => {
    const g = GameDriver.of();
    soft(g, 'p2', 1000);
    soft(g, 'p1', 1500);
    g.tickTo(11500); // p2 hard at 11000 (the freeze), p1 hard at 11500
    expect(g.state.status).toBe('paused');
    // p2 is back first; p1 is still away, so the game stays frozen and a move now would be refused.
    expect(g.types(g.reconnect('p2', 12000))).toEqual(['playerReconnected']);
    expect(g.player('p2').offlineWindow).toEqual({ until: 17000, left: 8 });
    expect(
      g.reject({ type: 'offlineMove', playerId: 'p2', cell: A1, digit: answer('A1'), thinkMs: 1 }, 12100),
    ).toBe('paused');
    // An event in the freeze after p2's five seconds would have ended: the window stands still.
    g.playerAct('p2', { type: 'react', emoji: '😂' }, 18000);
    expect(g.player('p2').offlineWindow).toEqual({ until: 17000, left: 8 });

    // p1 is back 8 s later: the game goes on, and p2 has his five seconds (and his eight moves) from now.
    expect(g.types(g.reconnect('p1', 20000))).toEqual(['playerReconnected', 'gameResumed']);
    expect(g.player('p2').offlineWindow).toEqual({ until: 25000, left: 8 });
    expect(g.player('p1').offlineWindow).toEqual({ until: 25000, left: 8 });
    expect(g.types(g.offlineMove('p2', 'A1', { at: 20100 }))).toEqual(['cellLocked', 'placedCorrect']);
    expect(g.player('p2')).toMatchObject({ correct: 1, offlineWindow: { until: 25000, left: 7 } });
    expect(
      g.reject({ type: 'offlineMove', playerId: 'p2', cell: A2, digit: answer('A2'), thinkMs: 1 }, 25001),
    ).toBe('offlineClosed');
    expect(g.replayMatches()).toBe(true);
  });

  it('a window opened before a freeze keeps what was left of it, from the resume', () => {
    const g = GameDriver.of();
    soft(g, 'p2', 1000);
    g.reconnect('p2', 2000); // open until 7000
    g.disconnect('p1', { at: 3000 }); // a deliberate leave: frozen at once, with 4 s of the window left
    expect(g.state.status).toBe('paused');
    g.reconnect('p1', 10000); // 7 s later
    expect(g.player('p2').offlineWindow).toEqual({ until: 14000, left: 8 });
    expect(g.types(g.offlineMove('p2', 'A1', { at: 13900 }))).toEqual(['cellLocked', 'placedCorrect']);
    expect(g.replayMatches()).toBe(true);
  });

  it('bad cell and bad digit are the usual refusals', () => {
    const g = dropAndReturn();
    expect(g.reject({ type: 'offlineMove', playerId: 'p2', cell: 81, digit: 8, thinkMs: 1 })).toBe('badCell');
    expect(g.reject({ type: 'offlineMove', playerId: 'p2', cell: A1, digit: 0 as never, thinkMs: 1 })).toBe(
      'badDigit',
    );
  });

  it('under interference the new lock starts stopped [D11], and the digit is still placed', () => {
    const g = GameDriver.of();
    g.solve('p1', 'A1', 0); // 8
    soft(g, 'p2', 1000);
    g.reconnect('p2', 2000);
    g.playerAct('p1', { type: 'interfere', targetId: 'p2', kind: 'cats' }, 2050);
    const events = g.offlineMove('p2', 'A2', { at: 2100 });
    expect(g.types(events)).toEqual(['cellLocked', 'placedCorrect']);
    expect(events[0]).toMatchObject({ expiresAt: null, remainingMs: 8000 });
  });
});

describe('abandonmentAt: when a seat may be given up [D4, D42]', () => {
  it('the grace end, or the soft end plus the grace, or null', () => {
    const g = GameDriver.of({ players: 3 });
    expect(abandonmentAt(g.state, 'p2')).toBeNull();
    expect(abandonmentAt(g.state, 'nobody')).toBeNull();
    soft(g, 'p2', 1000);
    g.disconnect('p3', { at: 2000 });
    expect([abandonmentAt(g.state, 'p2'), abandonmentAt(g.state, 'p3')]).toEqual([26000, 17000]);
    g.tickTo(11000);
    expect(abandonmentAt(g.state, 'p2')).toBe(26000);
  });
});

describe('LocalGameHost with the soft phase (§17.2) [D42]', () => {
  it('schedules the end of the soft phase; a drop and a return within it never freeze the game', () => {
    const clock = new ManualClock(0);
    const scheduler = new ManualScheduler(clock);
    const host = new LocalGameHost({ config: makeConfig(), playerId: 'p1', clock, scheduler });
    const types: string[] = [];
    const refused: string[] = [];
    host.subscribe((u: HostUpdate) => {
      if (u.kind === 'events') types.push(...u.events.map((e) => e.type));
      else refused.push(u.reason);
    });
    // The local player never had a return: a move made offline is refused, and nothing happens.
    host.send({ type: 'offlineMove', cell: A1, digit: answer('A1'), thinkMs: 0 });
    expect(refused).toEqual(['offlineClosed']);
    clock.set(1000);
    host.dispatch({ type: 'disconnect', playerId: 'p2', soft: true });
    scheduler.advance(8000);
    host.dispatch({ type: 'reconnect', playerId: 'p2' });
    expect(types).toEqual(['playerConnectionLost', 'playerReconnected']);
    host.dispatch({ type: 'disconnect', playerId: 'p2', soft: true }); // at 9000: soft until 19000
    scheduler.advance(10000);
    expect(types.slice(2)).toEqual(['playerConnectionLost', 'playerDisconnected', 'gamePaused']);
    expect(host.state.players[1]!.graceEndsAt).toBe(34000);
    host.close();
  });
});
