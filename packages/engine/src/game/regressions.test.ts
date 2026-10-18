import { parseCellName } from '../sudoku/board';
import { answer, EMPTY, cellNameOf, GameDriver, makeConfig, solveAll, wrongDigit } from '../testing/game';
import { ManualClock } from '../util/clock';
import { createRng, type Rng } from '../util/random';
import { ManualScheduler } from '../util/scheduler';
import { applyAction, createGame, nextDeadline, tick } from './engine';
import { evolve } from './evolve';
import { type HostUpdate, LocalGameHost } from './host';
import { DEFAULT_RATING_RULES, defaultRules, type RatingRules, type Rules } from './rules';
import type { Action, GameEvent, GameState, PlayerInfo } from './types';

/*
 * Regressions of the stage-2 engine changes (docs/01-SPEC.md v1.2, docs/02-WORK-PLAN.md stage 2): one describe
 * per change, numbered as in the change list. Each test pins behaviour the engine lacked before that change.
 *
 * Every game is 'fast' (8 s think time, 8 s turn pick time), 15 s grace, 5 s interferences, 1 s immunity and a
 * 1 s re-lock wait, starting at t = 0 unless said otherwise.
 * Points on PUZZLE's opening board: A1 is worth 8; A2 is worth 7.5 (X 4, Y 4), and 6.5 once A1 is solved.
 */

const A1 = parseCellName('A1');
const A2 = parseCellName('A2');
const A3 = parseCellName('A3'); // a given
const A5 = parseCellName('A5');
const B1 = parseCellName('B1');

const disconnect = (g: GameDriver, playerId: string, at?: number) =>
  g.act({ type: 'disconnect', playerId }, at);
const reconnect = (g: GameDriver, playerId: string, at?: number) =>
  g.act({ type: 'reconnect', playerId }, at);
const surrender = (g: GameDriver, playerId: string, at?: number) =>
  g.playerAct(playerId, { type: 'surrender' }, at);
const interfere = (g: GameDriver, from: string, to: string, at?: number) =>
  g.playerAct(from, { type: 'interfere', targetId: to, kind: 'cats' }, at);
const refuseSelect = (g: GameDriver, playerId: string, cell: string | number, at?: number) =>
  g.reject({ type: 'select', playerId, cell: typeof cell === 'string' ? parseCellName(cell) : cell }, at);
const rated = (ratings: number[], ratedGames = 30): PlayerInfo[] =>
  ratings.map((rating, k) => ({ id: `p${k + 1}`, name: `P${k + 1}`, rating, ratedGames }));
const ranking = (g: GameDriver) =>
  g.state.result!.ranking.map((r) => [r.playerId, r.place, r.score, r.status]);
const award = (g: GameDriver, kind: string) => g.state.result!.awards.find((a) => a.kind === kind);
const seqsOf = (updates: HostUpdate[]) =>
  updates.flatMap((u) => (u.kind === 'events' ? u.events.map((e) => e.seq) : []));

// ---------------------------------------------------------------------------------------------------------

describe('1. the re-lock wait follows a release for any reason (§6.2.6) [D2]', () => {
  it('defaults to cancel, timeout, switch, mistake and disconnect', () => {
    expect(defaultRules('ranked', 'fast').relockCooldownAfter).toEqual([
      'cancel',
      'timeout',
      'switch',
      'mistake',
      'disconnect',
    ]);
  });

  it('after a mistake the same player waits exactly 1000 ms for the same cell; nobody else waits', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 0);
    const events = g.place('p1', 'A1', wrongDigit('A1'), 1000);
    expect(g.types(events)).toEqual(['placedWrong', 'cellReleased']);
    expect(events[1]).toMatchObject({ reason: 'mistake', t: 1000 });
    expect(g.view('p1').cooldowns).toEqual([{ cell: A1, until: 2000 }]);
    expect(g.view('p2').cooldowns).toEqual([]);
    expect(refuseSelect(g, 'p1', 'A1', 1999)).toBe('cooldown');
    expect(g.select('p1', 'A1', 2000)[0]).toMatchObject({ type: 'cellLocked', cell: A1, expiresAt: 10000 });
  });

  it('after a disconnect (3 players, the game goes on) the player who comes back waits 1000 ms too', () => {
    const g = GameDriver.of({ players: 3 });
    g.select('p2', 'A1', 0);
    const out = disconnect(g, 'p2', 1000);
    expect(g.types(out)).toEqual(['playerDisconnected', 'cellReleased']);
    expect(out[1]).toMatchObject({ reason: 'disconnect', t: 1000 });
    reconnect(g, 'p2', 1500);
    expect(refuseSelect(g, 'p2', 'A1', 1999)).toBe('cooldown');
    g.select('p2', 'A1', 2000);
    expect(g.lock('p2')).toMatchObject({ cell: A1, expiresAt: 10000 });
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('2. lock timers travel on interference, interferenceEnded and gameResumed (§6.2.7, §18) [D11]', () => {
  it('interference carries the stopped lock; interferenceEnded carries it running again; no lockPaused/lockResumed', () => {
    const g = GameDriver.of();
    g.solve('p2', 'A1', 0); // 8 points
    g.select('p1', 'A2', 500); // runs out at 8500
    const sent = interfere(g, 'p2', 'p1', 1000);
    expect(g.types(sent)).toEqual(['interference']);
    expect(sent[0]).toMatchObject({ fromId: 'p2', targetId: 'p1', cost: 2, endsAt: 6000, score: 6, t: 1000 });
    expect(g.last('interference')!.locks).toEqual([
      { playerId: 'p1', cell: A2, expiresAt: null, remainingMs: 7500 },
    ]);
    expect(g.lock('p1')).toMatchObject({ cell: A2, expiresAt: null, remainingMs: 7500 });
    expect(g.deadline).toBe(6000);

    const ended = g.tickTo(6000);
    expect(g.types(ended)).toEqual(['interferenceEnded']);
    expect(ended[0]).toMatchObject({ fromId: 'p2', targetId: 'p1', kind: 'cats', t: 6000 });
    expect(g.last('interferenceEnded')!.locks).toEqual([
      { playerId: 'p1', cell: A2, expiresAt: 13500, remainingMs: 7500 },
    ]);
    expect(g.lock('p1')).toMatchObject({ expiresAt: 13500 });
    expect(g.tickTo(13499)).toEqual([]);
    expect(g.tickTo(13500)[0]).toMatchObject({ type: 'cellReleased', playerId: 'p1', reason: 'timeout' });

    const types: string[] = g.types();
    expect(types).not.toContain('lockPaused');
    expect(types).not.toContain('lockResumed');
    expect(g.replayMatches()).toBe(true);
  });

  it('no lock: interference carries none; a lock made under interference starts stopped and ends up in interferenceEnded', () => {
    const g = GameDriver.of();
    g.solve('p2', 'A1', 0);
    interfere(g, 'p2', 'p1', 1000);
    expect(g.last('interference')!.locks).toEqual([]);
    expect(g.select('p1', 'A2', 2000)[0]).toMatchObject({
      type: 'cellLocked',
      expiresAt: null,
      remainingMs: 8000,
    });
    expect(g.types(g.tickTo(6000))).toEqual(['interferenceEnded']);
    expect(g.last('interferenceEnded')!.locks).toEqual([
      { playerId: 'p1', cell: A2, expiresAt: 14000, remainingMs: 8000 },
    ]);
    expect(g.replayMatches()).toBe(true);
  });

  it('gameResumed lists every running lock with its new expiry and leaves out a stopped one', () => {
    const g = GameDriver.of();
    g.solve('p1', 'A1', 0); // 8 points
    g.select('p1', 'A2', 500); // runs out at 8500
    g.select('p2', 'B1', 600); // runs out at 8600
    interfere(g, 'p1', 'p2', 1000); // p2's lock stops with 7600 left; the interference ends at 6000
    expect(g.types(disconnect(g, 'p2', 2000))).toEqual(['playerDisconnected', 'gamePaused']);
    const back = reconnect(g, 'p2', 5000);
    expect(g.types(back)).toEqual(['playerReconnected', 'gameResumed']);
    const resumed = g.last('gameResumed')!;
    expect(resumed).toMatchObject({ reason: 'reconnect', pausedMs: 3000, t: 5000 });
    expect(resumed.locks.map((l) => [l.playerId, l.cell, l.expiresAt])).toEqual([['p1', A2, 11500]]);
    expect(g.lock('p1')!.expiresAt).toBe(11500);
    expect(g.lock('p2')).toMatchObject({ expiresAt: null, remainingMs: 7600 });
    expect(g.player('p2').hitBy!.endsAt).toBe(9000);

    expect(g.types(g.tickTo(9000))).toEqual(['interferenceEnded']);
    expect(g.last('interferenceEnded')!.locks).toEqual([
      { playerId: 'p2', cell: B1, expiresAt: 16600, remainingMs: 7600 },
    ]);
    expect(g.replayMatches()).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('3. the turns model (§6.1) [D1]', () => {
  const turns = (o: { players?: number; rules?: Partial<Rules> } = {}) =>
    GameDriver.of({ players: o.players ?? 2, rules: { turnModel: 'turns', ...o.rules } });

  it('turnStarted carries remainingMs', () => {
    const g = turns();
    expect(g.last('turnStarted')).toMatchObject({ playerId: 'p1', endsAt: 8000, remainingMs: 8000, t: 0 });
    expect(g.state.turn).toEqual({ playerId: 'p1', endsAt: 8000, stoppedMs: null });
  });

  it('the turn timer stops while its holder is under interference and runs on when it ends', () => {
    const g = turns({ rules: { interferenceNeedsScore: false } });
    expect(g.types(interfere(g, 'p2', 'p1', 1000))).toEqual(['interference']);
    expect(g.state.turn).toEqual({ playerId: 'p1', endsAt: null, stoppedMs: 7000 });
    expect(g.deadline).toBe(6000);
    expect(g.types(g.tickTo(6000))).toEqual(['interferenceEnded']);
    expect(g.state.turn).toEqual({ playerId: 'p1', endsAt: 13000, stoppedMs: null });
    expect(g.tickTo(12999)).toEqual([]);
    const next = g.tickTo(13000);
    expect(g.types(next)).toEqual(['turnStarted']);
    expect(next[0]).toMatchObject({ playerId: 'p2', endsAt: 21000, remainingMs: 8000 });
    expect(g.replayMatches()).toBe(true);
  });

  it('a turn handed to a player under interference starts stopped (endsAt null) with its full time', () => {
    const g = turns({ rules: { interferenceNeedsScore: false } });
    interfere(g, 'p1', 'p2', 1000); // p2 under interference until 6000
    g.select('p1', 'A1', 1500);
    const placed = g.place('p1', 'A1', answer('A1'), 2000);
    expect(g.types(placed)).toEqual(['placedCorrect', 'turnStarted']);
    expect(placed[1]).toMatchObject({ playerId: 'p2', endsAt: null, remainingMs: 8000 });
    expect(g.state.turn).toEqual({ playerId: 'p2', endsAt: null, stoppedMs: 8000 });
    g.tickTo(6000);
    expect(g.state.turn).toEqual({ playerId: 'p2', endsAt: 14000, stoppedMs: null });
    expect(g.replayMatches()).toBe(true);
  });

  it('nobody can take the turn: turnCleared, and the grace ends the game instead of the timers looping', () => {
    const g = turns({ rules: { freezeUpToPlayers: 0 } });
    expect(g.types(disconnect(g, 'p2', 1000))).toEqual(['playerDisconnected']);
    expect(g.types(disconnect(g, 'p1', 2000))).toEqual(['playerDisconnected', 'turnCleared']);
    expect(g.state.turn).toBeNull();
    expect(g.deadline).toBe(16000); // p2's grace
    const end = g.tickTo(20000);
    expect(end.map((e) => [e.type, e.t])).toEqual([
      ['playerAbandoned', 16000],
      ['gameOver', 16000],
    ]);
    expect(g.state.result!.reason).toBe('lastPlayerStanding');
  });

  it('the first player back gets a cleared turn', () => {
    const g = turns({ players: 3 });
    disconnect(g, 'p2', 1000);
    disconnect(g, 'p3', 1500);
    g.select('p1', 'A1', 2000);
    expect(g.types(disconnect(g, 'p1', 3000))).toEqual(['playerDisconnected', 'cellReleased', 'turnCleared']);
    expect(g.state.turn).toBeNull();
    const back = reconnect(g, 'p2', 4000);
    expect(g.types(back)).toEqual(['playerReconnected', 'turnStarted']);
    expect(back[1]).toMatchObject({ playerId: 'p2', endsAt: 12000, remainingMs: 8000 });
    g.select('p2', 'A2', 4100);
    expect(g.lock('p2')!.cell).toBe(A2);
  });

  it('a turn that starts during a freeze has its full pick time after the resume', () => {
    const g = turns({ players: 3, rules: { freezeUpToPlayers: 3 } });
    disconnect(g, 'p3', 1000);
    expect(g.state.status).toBe('paused');
    surrender(g, 'p1', 3000); // the holder leaves while frozen
    reconnect(g, 'p3', 6000); // pausedMs 5000
    expect(g.last('gameResumed')).toMatchObject({ pausedMs: 5000 });
    expect(g.state.turn).toEqual({ playerId: 'p2', endsAt: 14000, stoppedMs: null });
    expect(g.tickTo(13999)).toEqual([]);
    expect(g.tickTo(14000)[0]).toMatchObject({ type: 'turnStarted', playerId: 'p3', endsAt: 22000 });
    expect(g.replayMatches()).toBe(true);
  });

  // ENGINE BUG: repairTurn returns while the game is frozen, so the turn of a holder who surrenders during a
  // freeze is not handed on; at the resume it goes to the first seat that can take it (p1), not to the next seat
  // after the holder (p3). passTurn's "counts from the freeze" branch is never reached.
  it('the holder surrendering during a freeze (4 players) passes the turn to the next seat after them', () => {
    const g = turns({ players: 4, rules: { freezeUpToPlayers: 4 } });
    g.tickTo(8000); // → p2, until 16000
    expect(g.types(disconnect(g, 'p4', 9000))).toEqual(['playerDisconnected', 'gamePaused']);
    surrender(g, 'p2', 10000);
    reconnect(g, 'p4', 11000); // pausedMs 2000
    // A full 8 s from the freeze (9000 + 8000), moved on by the pause: 19000. Engine: { p1, 19000 }.
    expect(g.state.turn).toEqual({ playerId: 'p3', endsAt: 19000, stoppedMs: null });
  });

  it("notYourTurn is checked before the cell: a given, someone's lock or a bad cell all say notYourTurn", () => {
    const g = turns();
    expect(refuseSelect(g, 'p2', 'A3', 0)).toBe('notYourTurn'); // a given
    g.select('p1', 'A1', 100);
    expect(refuseSelect(g, 'p2', 'A1', 200)).toBe('notYourTurn'); // p1's lock
    expect(refuseSelect(g, 'p2', 81, 300)).toBe('notYourTurn');
    expect(refuseSelect(g, 'p1', 81, 300)).toBe('badCell'); // the holder gets the cell checks
    expect(refuseSelect(g, 'p1', 'A1', 300)).toBe('alreadyHeld');
  });

  it('the holder surrendering (4 players) passes the turn to the next seat after them', () => {
    const g = turns({ players: 4 });
    g.tickTo(8000); // → p2
    g.tickTo(16000); // → p3, until 24000
    expect(g.state.turn).toMatchObject({ playerId: 'p3', endsAt: 24000 });
    const out = surrender(g, 'p3', 17000);
    expect(g.types(out)).toEqual(['playerSurrendered', 'turnStarted']);
    expect(out[1]).toMatchObject({ playerId: 'p4', endsAt: 25000, remainingMs: 8000 });
  });

  it('the holder disconnecting (4 players, the game goes on) passes the turn to the next seat after them', () => {
    const g = turns({ players: 4 });
    g.tickTo(16000); // → p3, until 24000
    const out = disconnect(g, 'p3', 17000);
    expect(g.types(out)).toEqual(['playerDisconnected', 'turnStarted']);
    expect(out[1]).toMatchObject({ playerId: 'p4', endsAt: 25000 });
  });

  it('the holder abandoning a frozen game (4 players, freezeUpToPlayers 4) passes the turn to the next seat after them', () => {
    const g = turns({ players: 4, rules: { freezeUpToPlayers: 4 } });
    g.tickTo(16000); // → p3, until 24000
    expect(g.types(disconnect(g, 'p3', 17000))).toEqual(['playerDisconnected', 'gamePaused']);
    const out = g.tickTo(32000); // p3's grace ends
    expect(g.types(out)).toEqual(['playerAbandoned', 'gameResumed', 'turnStarted']);
    expect(out[2]).toMatchObject({ playerId: 'p4', endsAt: 40000 });
    expect(g.replayMatches()).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('4. the freeze counts players still in the game, not seats (§16.2) [D4]', () => {
  it('3 seats, one surrendered: a disconnect freezes the two left, locks kept', () => {
    const g = GameDriver.of({ players: 3 });
    surrender(g, 'p3', 500);
    g.select('p1', 'A1', 600); // 8600
    g.select('p2', 'A2', 700); // 8700
    expect(g.types(disconnect(g, 'p2', 1000))).toEqual(['playerDisconnected', 'gamePaused']);
    expect(g.state.status).toBe('paused');
    expect(g.lock('p2')).toMatchObject({ cell: A2, expiresAt: 8700 });
    expect(g.types(reconnect(g, 'p2', 3000))).toEqual(['playerReconnected', 'gameResumed']);
    expect(g.last('gameResumed')!.locks.map((l) => [l.playerId, l.expiresAt])).toEqual([
      ['p1', 10600],
      ['p2', 10700],
    ]);
  });

  it('4 seats with freezeUpToPlayers 3: one out leaves 3 in the game, so a disconnect freezes', () => {
    const g = GameDriver.of({ players: 4, rules: { freezeUpToPlayers: 3 } });
    surrender(g, 'p4', 500);
    expect(g.types(disconnect(g, 'p1', 1000))).toEqual(['playerDisconnected', 'gamePaused']);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('5. ending a practice (§6.6)', () => {
  it('against bots: the human surrendering ends it as practiceEnded, even with two bots left', () => {
    const g = GameDriver.of({
      mode: 'bot',
      players: [{ id: 'me' }, { id: 'b1', isBot: true }, { id: 'b2', isBot: true }],
    });
    const out = surrender(g, 'me', 1000);
    expect(g.types(out)).toEqual(['playerSurrendered', 'gameOver']);
    expect(g.state.result).toMatchObject({ reason: 'practiceEnded', ratingChanges: [] });
  });

  it('against one bot: practiceEnded for the human, as in solo; a bot leaving is an ordinary lastPlayerStanding', () => {
    const players: PlayerInfo[] = [{ id: 'me' }, { id: 'bot', isBot: true }];
    const human = GameDriver.of({ mode: 'bot', players });
    surrender(human, 'me', 1000);
    expect(human.state.result).toMatchObject({ reason: 'practiceEnded', ratingChanges: [] });
    const solo = GameDriver.of({ players: 1 });
    surrender(solo, 'p1', 1000);
    expect(solo.state.result).toMatchObject({ reason: 'practiceEnded', ratingChanges: [], awards: [] });
    const bot = GameDriver.of({ mode: 'bot', players });
    surrender(bot, 'bot', 1000);
    expect(bot.state.result!.reason).toBe('lastPlayerStanding');
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('6. time never runs backwards (§6, §18)', () => {
  it('an action at an earlier now happens at the last event time', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 5000);
    expect(g.state.lastEventAt).toBe(5000);
    const [locked] = g.select('p2', 'A2', 3000); // a clock stepped back
    expect(locked).toMatchObject({ type: 'cellLocked', playerId: 'p2', t: 5000, expiresAt: 13000 });
    expect(g.lock('p2')!.expiresAt).toBe(13000);
    const times = g.log.map((e) => e.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(g.replayMatches()).toBe(true);
  });

  it('a reaction at an earlier now counts from the last event time, so the 2 s wait holds', () => {
    const g = GameDriver.of();
    g.playerAct('p1', { type: 'react', emoji: '🔥' }, 5000);
    expect(g.playerAct('p2', { type: 'react', emoji: '😎' }, 3000)[0]).toMatchObject({ t: 5000 });
    expect(g.player('p2').lastReactionAt).toBe(5000);
    expect(g.reject({ type: 'react', playerId: 'p2', emoji: '😎' }, 6999)).toBe('tooSoon');
  });

  it('tick at an earlier now does nothing', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 5000);
    const r = tick(g.state, 1000);
    expect(r.events).toEqual([]);
    expect(r.state).toBe(g.state);
    expect(r.state.lastEventAt).toBe(5000);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('7. an unknown action is refused (§18)', () => {
  const bogus = { type: 'bogus', playerId: 'p1' } as unknown as Action;

  it('badAction, before the game status checks, and the timers that were due still run', () => {
    const g = GameDriver.of({}, { start: false });
    expect(g.reject(bogus, 0)).toBe('badAction'); // not started yet
    g.act({ type: 'start' }, 0);
    expect(g.reject(bogus, 100)).toBe('badAction');
    g.select('p1', 'A1', 200); // runs out at 8200
    const r = applyAction(g.state, bogus, 8200);
    expect(r.rejected).toBe('badAction');
    expect(r.events.map((e) => [e.type, e.t])).toEqual([['cellReleased', 8200]]);
    surrender(g, 'p1', 300);
    expect(g.reject(bogus, 400)).toBe('badAction'); // over
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('8. gameOver clears every interference (§12)', () => {
  it('an interference running at the end is gone from the state and the view, and nothing ticks after', () => {
    const g = GameDriver.of();
    g.solve('p2', 'A1', 0);
    interfere(g, 'p2', 'p1', 1000); // until 6000
    surrender(g, 'p1', 2000);
    expect(g.state.status).toBe('over');
    expect(g.player('p1').hitBy).toBeNull();
    expect(g.view('p1').players[0]!.hitBy).toBeNull();
    expect(g.deadline).toBeNull();
    expect(g.tickTo(10000)).toEqual([]);
    expect(g.replayMatches()).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('9. Comeback counts only players still in the game (§12)', () => {
  it('the gap to a player who surrendered stops counting: 14.5 behind, never 20.5, so no Comeback', () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p1', 'A1', 0); // 8
    g.solve('p1', 'A2', 100); // 6.5 → 14.5
    expect(g.score('p1')).toBe(14.5);
    expect(g.player('p2').maxDeficit).toBe(14.5);
    surrender(g, 'p1', 200);
    g.miss('p2', 'B1', 1000); // B1 is worth 6 after A1 and A2
    expect(g.score('p2')).toBe(-6);
    expect(g.player('p2').maxDeficit).toBe(14.5); // 6 behind p3, the only opponent still in
    surrender(g, 'p3', 4000);
    expect(g.state.result!.ranking[0]).toMatchObject({ playerId: 'p2', place: 1 });
    expect(award(g, 'comeback')).toBeUndefined();
  });

  it('a player who left stops collecting deficit', () => {
    const g = GameDriver.of({ players: 3 });
    surrender(g, 'p3', 0);
    g.solve('p1', 'A1', 100); // 8
    expect(g.player('p3').maxDeficit).toBe(0);
    expect(g.player('p2').maxDeficit).toBe(8);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('10. Fewest mistakes and Fastest go only to players still in the game at the end (§12)', () => {
  it('Fewest mistakes: whoever surrendered with none does not win it', () => {
    const g = GameDriver.of({ players: 3 });
    surrender(g, 'p3', 0); // 0 mistakes, out
    g.miss('p1', 'A1', 100); // 1 mistake
    g.miss('p2', 'B1', 200);
    g.miss('p2', 'B1', 1200); // 2 mistakes
    surrender(g, 'p2', 1300);
    expect(award(g, 'fewestMistakes')).toEqual({ kind: 'fewestMistakes', playerIds: ['p1'], value: 1 });
  });

  it('Fastest: five instant moves and then surrender do not win it', () => {
    const g = GameDriver.of({ players: 3 });
    const cells = EMPTY.slice(0, 10).map(cellNameOf);
    cells.slice(0, 5).forEach((cell, k) => g.solve('p3', cell, 10 * k)); // think time 0
    surrender(g, 'p3', 100);
    cells.slice(5).forEach((cell, k) => {
      g.select('p1', cell, 1000 + 2000 * k);
      g.place('p1', cell, answer(cell), 2000 + 2000 * k); // think time 1000
    });
    surrender(g, 'p2', 20000);
    expect(g.state.result!.stats.map((s) => [s.playerId, s.correct, s.avgThinkMs])).toEqual([
      ['p1', 5, 1000],
      ['p2', 0, null],
      ['p3', 5, 0],
    ]);
    expect(award(g, 'fastest')).toEqual({ kind: 'fastest', playerIds: ['p1'], value: 1000 });
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('11. rules.surrenderRanking (§6.6, §6.7) [D36]', () => {
  /** p3 scores 8 and surrenders, p1 errs (−6.5), p2 surrenders with 0: p1 is the last one standing. */
  function play(surrenderRanking?: Rules['surrenderRanking']): GameDriver {
    const g = GameDriver.of({ players: 3, rules: surrenderRanking ? { surrenderRanking } : {} });
    g.solve('p3', 'A1', 1000);
    surrender(g, 'p3', 2000);
    g.miss('p1', 'A2', 3000);
    surrender(g, 'p2', 4000);
    expect(g.state.result!.reason).toBe('lastPlayerStanding');
    return g;
  }

  it("'exitOrder' (default): whoever surrendered ranks below everyone still in the game, by the order of leaving", () => {
    expect(defaultRules('ranked', 'fast').surrenderRanking).toBe('exitOrder');
    expect(ranking(play())).toEqual([
      ['p1', 1, -6.5, 'active'],
      ['p2', 2, 0, 'surrendered'],
      ['p3', 3, 8, 'surrendered'],
    ]);
  });

  it("'byScore': whoever surrendered stays in the table with their score", () => {
    expect(ranking(play('byScore'))).toEqual([
      ['p3', 1, 8, 'surrendered'],
      ['p2', 2, 0, 'surrendered'],
      ['p1', 3, -6.5, 'active'],
    ]);
  });

  it("'byScore': an abandonment still ranks last, whatever the score", () => {
    const g = GameDriver.of({ players: 4, rules: { surrenderRanking: 'byScore' } });
    g.solve('p4', 'A1', 0); // 8
    disconnect(g, 'p4', 100); // 4 players: the game goes on; abandoned at 15100
    g.solve('p3', 'A2', 200); // 6.5
    surrender(g, 'p3', 300);
    g.miss('p1', 'B1', 400); // −6
    g.tickTo(15100);
    expect(g.player('p4').status).toBe('abandoned');
    surrender(g, 'p2', 16000);
    expect(ranking(g)).toEqual([
      ['p3', 1, 6.5, 'surrendered'],
      ['p2', 2, 0, 'surrendered'],
      ['p1', 3, -6, 'active'],
      ['p4', 4, 8, 'abandoned'],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('12. rating settings live in rules.rating (§11.2) [D7, D8, D23, D31, D32]', () => {
  const withRating = (o: Partial<RatingRules>): Partial<Rules> => ({
    rating: { ...DEFAULT_RATING_RULES, ...o },
  });
  /** Both players have moved and p2 trails, 6.5 – 8, so no leave guard holds (§11.2). */
  const bothMoved = (rules: Partial<Rules>, ratedGames = 30) => {
    const g = GameDriver.of({ players: rated([1200, 1200], ratedGames), rules });
    g.solve('p1', 'A1', 200);
    g.solve('p2', 'A2', 500);
    return g;
  };
  /** Two players; p2 surrenders at 1000. */
  const deltas = (rules: Partial<Rules>, ratedGames = 30) => {
    const g = bothMoved(rules, ratedGames);
    surrender(g, 'p2', 1000);
    return g.state.result!.ratingChanges.map((c) => [c.playerId, c.delta, c.provisional]);
  };

  it('the defaults', () => {
    expect(defaultRules('ranked', 'fast').rating).toEqual({
      option: 'B',
      k: 32,
      provisionalGames: 10,
      provisionalFactor: 2,
      abandonWinScore: 1,
      initialRating: 1200,
      abandonPenalty: 0,
      leaverGuard: true,
      stayerGuard: true,
      abandonJudgedAt: 'disconnect',
    });
    expect(makeConfig()).not.toHaveProperty('ratingOption');
  });

  it('k reaches Elo: 32 → ±16, 16 → ±8 between equals', () => {
    expect(deltas({})).toEqual([
      ['p1', 16, false],
      ['p2', -16, false],
    ]);
    expect(deltas(withRating({ k: 16 }))).toEqual([
      ['p1', 8, false],
      ['p2', -8, false],
    ]);
  });

  it('provisionalGames and provisionalFactor reach Elo', () => {
    expect(deltas({}, 3)).toEqual([
      ['p1', 32, true],
      ['p2', -32, true],
    ]);
    expect(deltas(withRating({ provisionalGames: 3 }), 3)).toEqual([
      ['p1', 16, false],
      ['p2', -16, false],
    ]);
    expect(deltas(withRating({ provisionalFactor: 3 }), 3)).toEqual([
      ['p1', 48, true],
      ['p2', -48, true],
    ]);
  });

  /** p2 disconnects at 1000 and abandons at 16000. */
  const abandoned = (rules: Partial<Rules>) => {
    const g = bothMoved(rules);
    disconnect(g, 'p2', 1000);
    g.tickTo(16000);
    return g.state.result!.ratingChanges.map((c) => [c.playerId, c.before, c.delta, c.after]);
  };

  it('abandonWinScore [D8]: 0.75 makes a win by abandonment +8; the leaver still loses 16', () => {
    expect(abandoned({})).toEqual([
      ['p1', 1200, 16, 1216],
      ['p2', 1200, -16, 1184],
    ]);
    expect(abandoned(withRating({ abandonWinScore: 0.75 }))).toEqual([
      ['p1', 1200, 8, 1208],
      ['p2', 1200, -16, 1184],
    ]);
  });

  it('abandonPenalty [D32]: 5 more comes off the leaver only', () => {
    expect(abandoned(withRating({ abandonPenalty: 5 }))).toEqual([
      ['p1', 1200, 16, 1216],
      ['p2', 1200, -21, 1179],
    ]);
  });

  it('the leave guards reach Elo, and switch off [D32, Moshe 2026-10-15]', () => {
    /** p2 leads 8 – 6.5 and surrenders. */
    const ahead = (rules: Partial<Rules>) => {
      const g = GameDriver.of({ players: rated([1200, 1200]), rules });
      g.solve('p2', 'A1', 200);
      g.solve('p1', 'A2', 500);
      surrender(g, 'p2', 1000);
      return g.state.result!.ratingChanges.map((c) => [c.playerId, c.delta]);
    };
    expect(ahead({})).toEqual([
      ['p1', 0],
      ['p2', 0],
    ]);
    expect(ahead(withRating({ leaverGuard: false, stayerGuard: false }))).toEqual([
      ['p1', 16],
      ['p2', -16],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('13. rules.scoreY (§6.4) [D13]', () => {
  const scoreA2 = (rules: Partial<Rules>) => {
    const g = GameDriver.of({ rules });
    g.select('p1', 'A2', 0);
    return g.place('p1', 'A2', answer('A2'), 100)[0];
  };

  it("'sorted' (default): a tie at the top makes Y = X → A2 is X 4, Y 4 → 7.5", () => {
    expect(defaultRules('ranked', 'fast').scoreY).toBe('sorted');
    expect(scoreA2({})).toMatchObject({
      type: 'placedCorrect',
      points: 7.5,
      breakdown: { row: 4, col: 4, box: 3, num: 4, X: 4, Y: 4, points: 7.5 },
      score: 7.5,
    });
  });

  it("'distinct': Y is the second distinct value → A2 is X 4, Y 3 → 8", () => {
    expect(scoreA2({ scoreY: 'distinct' })).toMatchObject({
      type: 'placedCorrect',
      points: 8,
      breakdown: { row: 4, col: 4, box: 3, num: 4, X: 4, Y: 3, points: 8 },
      score: 8,
    });
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('14. the view (§6.8, §17.2)', () => {
  it('each card has its live place and whether it leads', () => {
    const g = GameDriver.of({ players: 3 });
    const cards = () => g.view(null).players.map((p) => [p.id, p.place, p.isLeader]);
    expect(cards()).toEqual([
      ['p1', 1, true],
      ['p2', 1, true],
      ['p3', 1, true],
    ]);
    g.solve('p1', 'A1', 0); // 8
    g.miss('p2', 'A2', 100); // −6.5
    expect(cards()).toEqual([
      ['p1', 1, true],
      ['p2', 3, false],
      ['p3', 2, false],
    ]);
    surrender(g, 'p1', 200); // out: last, whatever the score
    expect(cards()).toEqual([
      ['p1', 3, false],
      ['p2', 2, false],
      ['p3', 1, true],
    ]);
    const solo = GameDriver.of({ players: 1 });
    expect(solo.view('p1').players[0]).toMatchObject({ place: 1, isLeader: false });
  });

  it('each card has its rating in ranked games only', () => {
    expect(
      GameDriver.of({ players: rated([1300, 1250]) })
        .view('p1')
        .players.map((p) => p.rating),
    ).toEqual([1300, 1250]);
    expect(
      GameDriver.of()
        .view('p1')
        .players.map((p) => p.rating),
    ).toEqual([null, null]);
    expect(
      GameDriver.of({ mode: 'bot', players: rated([1300, 1250]) })
        .view('p1')
        .players.map((p) => p.rating),
    ).toEqual([null, null]);
  });

  it('lock and hitBy are timers: running, then stopped while frozen with the time left at the freeze', () => {
    const g = GameDriver.of();
    g.solve('p1', 'A1', 0); // 8 points
    g.select('p1', 'A2', 500); // runs out at 8500
    interfere(g, 'p1', 'p2', 1000); // until 6000
    g.tickTo(2000);
    let v = g.view('p1');
    expect(v.players[0]!.lock).toMatchObject({ cell: A2, expiresAt: 8500 });
    expect(v.players[1]!.hitBy).toEqual({ fromId: 'p1', kind: 'cats', expiresAt: 6000, remainingMs: 4000 });

    disconnect(g, 'p2', 2000); // frozen at 2000
    g.tickTo(4000);
    v = g.view('p1');
    expect(v.pausedAt).toBe(2000);
    expect(v.players[0]!.lock).toEqual({ cell: A2, expiresAt: null, remainingMs: 6500 });
    expect(v.players[1]!.hitBy).toEqual({ fromId: 'p1', kind: 'cats', expiresAt: null, remainingMs: 4000 });

    reconnect(g, 'p2', 9000); // pausedMs 7000
    v = g.view('p1');
    expect(v.players[0]!.lock).toMatchObject({ cell: A2, expiresAt: 15500 });
    expect(v.players[1]!.hitBy).toEqual({ fromId: 'p1', kind: 'cats', expiresAt: 13000, remainingMs: 4000 });
  });

  it('under interference: the lock shows expiresAt null and the time left, the interference its own timer', () => {
    const g = GameDriver.of();
    g.solve('p2', 'A1', 0);
    g.select('p1', 'A2', 500);
    interfere(g, 'p2', 'p1', 1000); // until 6000
    expect(g.view('p2').players[0]).toMatchObject({
      lock: { cell: A2, expiresAt: null, remainingMs: 7500 },
      hitBy: { fromId: 'p2', kind: 'cats', expiresAt: 6000, remainingMs: 5000 },
    });
    expect(g.view('p2').players[0]!.hitBy).not.toHaveProperty('endsAt');
  });

  it("'turns': the turn is a timer, stopped while frozen and while its holder is under interference", () => {
    const frozen = GameDriver.of({ rules: { turnModel: 'turns' } });
    frozen.tickTo(3000);
    expect(frozen.view('p1').turn).toEqual({ playerId: 'p1', expiresAt: 8000, remainingMs: 5000 });
    disconnect(frozen, 'p2', 3000);
    frozen.tickTo(5000);
    expect(frozen.view('p1').turn).toEqual({ playerId: 'p1', expiresAt: null, remainingMs: 5000 });

    const hit = GameDriver.of({ rules: { turnModel: 'turns', interferenceNeedsScore: false } });
    interfere(hit, 'p2', 'p1', 1000);
    hit.tickTo(2000);
    expect(hit.view('p1').turn).toEqual({ playerId: 'p1', expiresAt: null, remainingMs: 7000 });
  });

  it('cooldowns lists every re-lock wait of mine still running', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 0);
    g.select('p1', 'A2', 100); // A1: until 1100
    g.select('p1', 'A5', 200); // A2: until 1200
    expect(g.view('p1').cooldowns).toEqual([
      { cell: A1, until: 1100 },
      { cell: A2, until: 1200 },
    ]);
    g.tickTo(1150);
    expect(g.view('p1').cooldowns).toEqual([{ cell: A2, until: 1200 }]);
    expect(g.view('p2').cooldowns).toEqual([]);
    expect(g.view(null).cooldowns).toEqual([]);
    expect(g.lock('p1')!.cell).toBe(A5);
  });

  it('interference is null for a viewer who is disconnected or out of the game', () => {
    const g = GameDriver.of({ players: 3 });
    expect(g.view('p1').interference).not.toBeNull();
    disconnect(g, 'p1', 100);
    expect(g.view('p1').interference).toBeNull();
    reconnect(g, 'p1', 200);
    expect(g.view('p1').interference).not.toBeNull();
    surrender(g, 'p1', 300);
    expect(g.state.status).toBe('running');
    expect(g.view('p1').interference).toBeNull();
    expect(g.view(null).interference).toBeNull();
  });

  it("a target is 'notRunning' while the game waits, is frozen or is over", () => {
    const waiting = GameDriver.of({}, { start: false });
    expect(waiting.view('p1').interference!.targets).toEqual([{ playerId: 'p2', blockedBy: 'notRunning' }]);

    const frozen = GameDriver.of({ players: 3, rules: { freezeUpToPlayers: 3 } });
    frozen.solve('p1', 'A1', 0);
    disconnect(frozen, 'p3', 100);
    expect(frozen.state.status).toBe('paused');
    expect(frozen.view('p1').interference!.targets).toEqual([
      { playerId: 'p2', blockedBy: 'notRunning' },
      { playerId: 'p3', blockedBy: 'disconnected' },
    ]);

    const over = GameDriver.of();
    solveAll(over, 'p1');
    expect(over.state.result!.reason).toBe('boardComplete');
    expect(over.view('p1').interference!.targets).toEqual([{ playerId: 'p2', blockedBy: 'notRunning' }]);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('15. createGame(config, deps) (§6, §17)', () => {
  it('takes the time from the injected clock, or a plain number', () => {
    const created = createGame(makeConfig(), { clock: new ManualClock(5000) });
    expect(created.state.createdAt).toBe(5000);
    expect(created.state.lastEventAt).toBe(5000);
    expect(created.events).toEqual([{ type: 'gameCreated', config: makeConfig(), seq: 1, t: 5000 }]);
    expect(created.state.config.seed).toBeUndefined();
    expect(createGame(makeConfig(), 777).state.createdAt).toBe(777);
  });

  it('draws a seed from the injected RNG when the config has none, and keeps a given one', () => {
    let calls = 0;
    const half: Rng = {
      next: () => {
        calls++;
        return 0.5;
      },
    };
    const config = makeConfig();
    const drawn = createGame(config, { clock: new ManualClock(0), rng: half });
    expect(drawn.state.config.seed).toBe(2 ** 30);
    expect(drawn.events[0]).toMatchObject({ type: 'gameCreated', config: { seed: 2 ** 30 } });
    expect(calls).toBe(1);
    expect(config.seed).toBeUndefined(); // the caller's config is untouched

    const seeded = createGame({ ...config, seed: 7 }, { clock: new ManualClock(0), rng: half });
    expect(seeded.state.config.seed).toBe(7);
    expect(calls).toBe(1);

    expect(createGame(config, { clock: new ManualClock(0), rng: createRng(42) }).state.config.seed).toBe(
      1290860478,
    );
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('16. evolve guards gameCreated (§13.1, §18)', () => {
  it('throws on a second gameCreated and on a gameCreated that is not seq 1', () => {
    const [created] = createGame(makeConfig(), 0).events as [GameEvent];
    const state = evolve(null, created);
    expect(state.seq).toBe(1);
    expect(() => evolve(state, { ...created, seq: 2 })).toThrow('gameCreated in the middle of a game');
    expect(() => evolve(null, { ...created, seq: 5 })).toThrow('gameCreated must be seq 1, got 5');
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('17. LocalGameHost behind the GameHost interface (§17.2, §18)', () => {
  function setup() {
    const clock = new ManualClock(0);
    const scheduler = new ManualScheduler(clock);
    const host = new LocalGameHost({
      // Interferences on, so `interfere` goes through too: a bot game has none by default [D44].
      config: makeConfig({
        mode: 'bot',
        players: [{ id: 'me' }, { id: 'bot', isBot: true }],
        rules: { interferences: true },
      }),
      playerId: 'me',
      clock,
      scheduler,
    });
    return { clock, scheduler, host };
  }

  it('plays a game through the GameHost methods, plus send and dispatch', () => {
    const { clock, host } = setup();
    const updates: HostUpdate[] = [];
    const off = host.subscribe((u) => updates.push(u));
    host.select(A1);
    expect(host.getView().players[0]!.lock).toMatchObject({ cell: A1, expiresAt: 8000 });
    host.place(A1, answer('A1'));
    expect(host.getView().players[0]!.score).toBe(8);
    clock.set(500);
    host.select(A2);
    host.release();
    expect(host.getView().players[0]!.lock).toBeNull();
    expect(host.getView().cooldowns).toEqual([{ cell: A2, until: 1500 }]);
    host.interfere('bot', 'cats');
    expect(host.getView().players[1]!.hitBy).toEqual({
      fromId: 'me',
      kind: 'cats',
      expiresAt: 5500,
      remainingMs: 5000,
    });
    expect(host.getView().players[0]!.score).toBe(6);
    host.react('🔥');
    host.select(A3); // a given
    expect(updates.map((u) => u.kind)).toEqual([
      'events',
      'events',
      'events',
      'events',
      'events',
      'events',
      'rejected',
    ]);
    expect(updates.at(-1)).toMatchObject({
      kind: 'rejected',
      action: { type: 'select', cell: A3 },
      reason: 'cellFilled',
    });
    // Beyond the interface: send (my actions) and dispatch (the bot's); a refused dispatch goes to the caller only.
    host.send({ type: 'select', cell: A5 });
    expect(host.dispatch({ type: 'select', playerId: 'bot', cell: A5 }).rejected).toBe('cellTaken');
    expect(host.dispatch({ type: 'select', playerId: 'bot', cell: B1 }).events.map((e) => e.type)).toEqual([
      'cellLocked',
    ]);
    expect(updates.slice(7).map((u) => u.kind)).toEqual(['events', 'events']);
    host.surrender();
    expect(host.getView()).toMatchObject({ status: 'over', result: { reason: 'practiceEnded' } });
    off();
    host.close();
  });

  it('a listener that dispatches while being notified does not make the others hear updates out of seq order', () => {
    const { host } = setup();
    host.subscribe((u) => {
      if (u.kind === 'events' && u.events.some((e) => e.type === 'cellLocked' && e.playerId === 'me'))
        host.dispatch({ type: 'react', playerId: 'bot', emoji: '😱' });
    });
    const ui: HostUpdate[] = [];
    host.subscribe((u) => ui.push(u));
    host.select(A1);
    expect(seqsOf(ui)).toEqual([3, 4]);
    expect(ui.map((u) => u.view.seq)).toEqual([3, 4]);
    expect(ui.at(-1)!.view.seq).toBe(host.getView().seq);
    host.close();
  });

  it('a listener that throws does not stop the game clock: the timer is armed before listeners hear', () => {
    const { host, clock, scheduler } = setup();
    host.select(A1); // runs out at 8000
    clock.set(1000);
    host.dispatch({ type: 'select', playerId: 'bot', cell: A2 }); // runs out at 9000
    let thrown = false;
    host.subscribe(() => {
      if (!thrown) {
        thrown = true;
        throw new Error('a broken screen');
      }
    });
    expect(() => scheduler.advance(7000)).toThrow('a broken screen'); // at 8000
    expect(host.state.locks.map((l) => l.playerId)).toEqual(['bot']);
    expect(scheduler.pending).toBe(1);
    scheduler.advance(5000); // to 13000
    expect(host.state.locks).toEqual([]);
    host.close();
  });

  it('nothing is delivered after close(), not even to the other listeners of the same update', () => {
    const { host, scheduler } = setup();
    const seen: string[] = [];
    host.subscribe((u) => {
      seen.push(`first ${seqsOf([u]).join()}`);
      host.dispatch({ type: 'react', playerId: 'bot', emoji: '😱' }); // queued behind this update
      host.close();
    });
    host.subscribe((u) => seen.push(`second ${seqsOf([u]).join()}`));
    host.select(A1);
    expect(seen).toEqual(['first 3']);
    expect(host.state.seq).toBe(4);
    expect(scheduler.pending).toBe(0);
    scheduler.advance(20000);
    expect(host.state.locks.map((l) => l.playerId)).toEqual(['me']); // no tick after close
    expect(() => host.release()).toThrow('The game host is closed');
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('18. a due timer that changes nothing is a bug, not a loop', () => {
  it('throws at once, naming the timer', () => {
    // A turn deadline in a game without turns: nothing handles it.
    const g = GameDriver.of();
    const broken: GameState = { ...g.state, turn: { playerId: 'p1', endsAt: 5000, stoppedMs: null } };
    expect(nextDeadline(broken)).toBe(5000);
    expect(tick(broken, 4999).events).toEqual([]);
    expect(() => tick(broken, 6000)).toThrow('A due turnExpire at 5000 changed nothing');
    expect(() => applyAction(broken, { type: 'react', playerId: 'p1', emoji: '🔥' }, 6000)).toThrow(
      'A due turnExpire at 5000 changed nothing',
    );
  });
});

// ---------------------------------------------------------------------------------------------------------
// Fixes from the second review of the reworked engine.

describe('19. second review', () => {
  it('a release during a freeze keeps the other waits, which move on with the resume (§6.2.6, §16.2) [D2, D4]', () => {
    const g = GameDriver.of({ players: 3, rules: { freezeUpToPlayers: 3 } });
    g.select('p1', 'A1', 0);
    g.playerAct('p1', { type: 'release' }, 500); // wait on A1 until 1500
    g.select('p3', 'B1', 600);
    disconnect(g, 'p2', 1000); // frozen with 500 ms of the wait left
    surrender(g, 'p3', 3000); // releases B1 during the freeze
    expect(g.state.cooldowns).toEqual([{ playerId: 'p1', cell: A1, until: 1500 }]);
    reconnect(g, 'p2', 4000); // paused 3000 ms
    expect(g.state.cooldowns).toEqual([{ playerId: 'p1', cell: A1, until: 4500 }]);
    expect(refuseSelect(g, 'p1', 'A1', 4499)).toBe('cooldown');
    g.select('p1', 'A1', 4500);
    expect(g.replayMatches()).toBe(true);
  });

  it('a long catch-up of unplayed turns is not mistaken for a loop (§6.1) [D1]', () => {
    const g = GameDriver.of({ rules: { turnModel: 'turns' } });
    const day = 24 * 60 * 60 * 1000;
    const events = g.tickTo(day); // a phone that slept for a day
    expect(events.length).toBe(Math.floor(day / 8000));
    expect(events.every((e) => e.type === 'turnStarted')).toBe(true);
    // The game still works afterwards.
    expect(g.state.turn).toMatchObject({ endsAt: (Math.floor(day / 8000) + 1) * 8000 });
  });

  it('the turn, think and interference times must be positive', () => {
    expect(() => createGame(makeConfig({ rules: { turnPickMs: 0 } }), 0)).toThrow(RangeError);
    expect(() => createGame(makeConfig({ rules: { thinkTimeMs: -1 } }), 0)).toThrow(RangeError);
    expect(() => createGame(makeConfig({ rules: { interferenceMs: 0 } }), 0)).toThrow(RangeError);
  });

  it('[D8] a partial win by abandonment is about 2 players; a 3-player game rates by place only', () => {
    const run = (abandonWinScore: number) => {
      const g = GameDriver.of({
        players: rated([1200, 1200, 1200]),
        rules: { rating: { ...DEFAULT_RATING_RULES, abandonWinScore } },
      });
      g.solve('p1', 'A1', 0);
      disconnect(g, 'p3', 1000);
      g.tickTo(16000); // p3 abandons
      surrender(g, 'p2', 17000);
      return g.state.result!.ratingChanges.map((c) => c.delta);
    };
    expect(run(0.5)).toEqual(run(1));
    const twoPlayers = (abandonWinScore: number) => {
      const g = GameDriver.of({
        players: rated([1200, 1200]),
        rules: { rating: { ...DEFAULT_RATING_RULES, abandonWinScore } },
      });
      g.solve('p1', 'A1', 200);
      g.solve('p2', 'A2', 500); // both moved, the leaver behind: no leave guard holds (§11.2)
      disconnect(g, 'p2', 1000);
      g.tickTo(16000);
      return g.state.result!.ratingChanges[0]!.delta;
    };
    expect(twoPlayers(1)).toBe(16);
    expect(twoPlayers(0.75)).toBe(8);
  });

  it("[D36] 'byScore': the leader mark goes to the best player still in the game", () => {
    const g = GameDriver.of({ players: 3, rules: { surrenderRanking: 'byScore' } });
    g.solve('p1', 'A1', 0); // 8
    surrender(g, 'p1', 100);
    g.solve('p2', 'A2', 200); // 6.5
    const v = g.view('p2');
    expect(v.players.map((p) => [p.id, p.place, p.isLeader])).toEqual([
      ['p1', 1, false],
      ['p2', 2, true],
      ['p3', 3, false],
    ]);
  });

  it('a running timer shows the time left now; gameResumed gives each lock the time it had at the freeze', () => {
    const g = GameDriver.of();
    g.select('p1', 'A2', 500); // runs out at 8500
    g.now = 3000;
    expect(g.view('p1').players[0]!.lock).toEqual({ cell: A2, expiresAt: 8500, remainingMs: 5500 });
    disconnect(g, 'p2', 4500); // 4000 ms left
    const resumed = reconnect(g, 'p2', 6000).find((e) => e.type === 'gameResumed');
    expect(resumed).toMatchObject({
      pausedMs: 1500,
      locks: [{ playerId: 'p1', cell: A2, expiresAt: 10000, remainingMs: 4000 }],
    });
  });

  it("a busy target says until when; the others don't carry the field", () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p1', 'A1', 0);
    interfere(g, 'p1', 'p2', 1000); // until 6000, immune until 7000
    const targets = g.view('p1').interference!.targets;
    expect(targets).toEqual([
      { playerId: 'p2', blockedBy: 'busy', busyUntil: 7000 },
      { playerId: 'p3', blockedBy: null },
    ]);
    g.tickTo(6500);
    expect(g.view('p1').interference!.targets[0]).toEqual({
      playerId: 'p2',
      blockedBy: 'busy',
      busyUntil: 7000,
    });
  });

  it('a listener that throws does not cost the other listeners their updates; the error reaches the caller', () => {
    const clock = new ManualClock(0);
    const host = new LocalGameHost({
      config: makeConfig({ mode: 'bot', players: [{ id: 'me' }, { id: 'bot', isBot: true }] }),
      playerId: 'me',
      clock,
      scheduler: new ManualScheduler(clock),
    });
    const seen: string[] = [];
    let broken = true;
    host.subscribe(() => {
      if (broken) {
        broken = false;
        throw new Error('broken screen');
      }
    });
    host.subscribe((u) =>
      seen.push(u.kind === 'events' ? u.events.map((e) => e.type).join('+') : `rejected:${u.reason}`),
    );
    expect(() => host.select(A1)).toThrow('broken screen');
    expect(seen).toEqual(['cellLocked']);
    host.select(A3); // a given
    expect(seen).toEqual(['cellLocked', 'rejected:cellFilled']);
  });

  it('a screen that edits the result in its view does not touch the game', () => {
    const g = GameDriver.of();
    g.solve('p1', 'A1', 0);
    surrender(g, 'p2', 1000);
    const v = g.view('p1');
    v.result!.ranking.reverse();
    v.players[0]!.bestMove!.points = 99;
    expect(g.state.result!.ranking[0]!.playerId).toBe('p1');
    expect(g.state.players[0]!.bestMove!.points).toBe(8);
  });
});
