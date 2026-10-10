import { eloChanges } from '../rating';
import { parseCellName } from '../sudoku/board';
import { answer, GameDriver, makeConfig, solveAll } from '../testing/game';
import { ManualClock } from '../util/clock';
import { ManualScheduler } from '../util/scheduler';
import { LocalGameHost, type HostUpdate } from './host';
import type { GameEvent, PlayerInfo } from './types';

/*
 * Disconnect, grace, freeze and abandonment (spec §16.2, §6.2.7, §6.7, §11.2) [D4, D8, D32].
 * Defaults: 15 s of grace per disconnection, per player; a game with 2 players still in it freezes, a game
 * with 3–4 still in it goes on (the decision counts players still in the game, not seats).
 * gamePaused / gameResumed carry the lock timers as spec §18 lists them: gameResumed.locks is every running
 * lock with its new expiresAt; a lock stopped by an interference runs again with interferenceEnded.locks.
 * Every game starts at t = 0 and the game type is 'fast' (8 s of think time).
 */

const A1 = parseCellName('A1');
const A2 = parseCellName('A2');
const A5 = parseCellName('A5');
const B1 = parseCellName('B1');

const disconnect = (g: GameDriver, playerId: string, at?: number) =>
  g.act({ type: 'disconnect', playerId }, at);
const reconnect = (g: GameDriver, playerId: string, at?: number) =>
  g.act({ type: 'reconnect', playerId }, at);

const rated = (ratings: number[], ratedGames = 30): PlayerInfo[] =>
  ratings.map((rating, k) => ({ id: `p${k + 1}`, name: `P${k + 1}`, rating, ratedGames }));

const gameOver = (events: GameEvent[]) =>
  events.find((e): e is Extract<GameEvent, { type: 'gameOver' }> => e.type === 'gameOver');

// ---------------------------------------------------------------------------------------------------------

describe('disconnect in a 2-player game: the game freezes (§16.2) [D4]', () => {
  it('announces the disconnection with a 15-second grace and pauses the game', () => {
    const g = GameDriver.of();
    const events = disconnect(g, 'p2', 4000);
    expect(g.types(events)).toEqual(['playerDisconnected', 'gamePaused']);
    expect(events[0]).toMatchObject({ playerId: 'p2', graceEndsAt: 19000, t: 4000 });
    expect(events[1]).toMatchObject({ reason: 'disconnect', t: 4000 });
    expect(g.state.status).toBe('paused');
    expect(g.state.pausedAt).toBe(4000);
    expect(g.player('p2')).toMatchObject({ connected: false, graceEndsAt: 19000, status: 'active' });
    expect(g.player('p1')).toMatchObject({ connected: true, graceEndsAt: null });
  });

  it('keeps the locks and stops their timers and the interference timer; they move on by the pause on resume [D11]', () => {
    const g = GameDriver.of();
    g.solve('p1', 'A1', 0); // 8 points, to pay for an interference
    g.select('p1', 'A2', 1000); // expires at 9000
    const hit = g.playerAct('p1', { type: 'interfere', targetId: 'p2', kind: 'cats' }, 2000);
    expect(hit[0]).toMatchObject({ type: 'interference', cost: 2, endsAt: 7000, score: 6, locks: [] }); // p2 holds none yet
    const [locked] = g.select('p2', 'B1', 2500); // under interference: starts stopped
    expect(locked).toMatchObject({ expiresAt: null, remainingMs: 8000 });

    const paused = disconnect(g, 'p2', 4000);
    expect(g.types(paused)).toEqual(['playerDisconnected', 'gamePaused']); // no cellReleased: locks are kept
    expect(g.lock('p1')).toMatchObject({ cell: A2, expiresAt: 9000 });
    expect(g.lock('p2')).toMatchObject({ cell: B1, expiresAt: null, remainingMs: 8000 });

    // Neither the lock (9000) nor the interference (7000) runs out while the game is frozen.
    expect(g.deadline).toBe(19000);
    expect(g.tickTo(10000)).toEqual([]);
    expect(g.lock('p1')).toBeDefined();
    expect(g.player('p2').hitBy).not.toBeNull();

    const resumed = reconnect(g, 'p2', 10000);
    expect(g.types(resumed)).toEqual(['playerReconnected', 'gameResumed']);
    expect(resumed[0]).toMatchObject({ playerId: 'p2', t: 10000 });
    expect(resumed[1]).toMatchObject({ reason: 'reconnect', pausedMs: 6000, t: 10000 });
    // §18 locks[]: every running lock with its new expiry. p2's lock is still stopped by the interference.
    expect(resumed[1]).toMatchObject({ locks: [{ playerId: 'p1', cell: A2, expiresAt: 15000 }] });
    expect(g.state.status).toBe('running');
    expect(g.state.pausedAt).toBeNull();
    expect(g.lock('p1')!.expiresAt).toBe(15000); // 9000 + 6000
    expect(g.player('p2').hitBy!.endsAt).toBe(13000); // 7000 + 6000
    expect(g.lock('p2')).toMatchObject({ expiresAt: null, remainingMs: 8000 });

    expect(g.deadline).toBe(13000);
    const ended = g.tickTo(13000);
    // No separate lock event: interferenceEnded carries the target's lock, running again with its full time.
    expect(g.types(ended)).toEqual(['interferenceEnded']);
    expect(ended[0]).toMatchObject({ targetId: 'p2', t: 13000 });
    expect(ended[0]).toMatchObject({
      locks: [{ playerId: 'p2', cell: B1, expiresAt: 21000, remainingMs: 8000 }],
    });
    expect(g.lock('p2')).toMatchObject({ cell: B1, expiresAt: 21000 });
    expect(g.player('p2').immuneUntil).toBe(14000);

    expect(g.tickTo(14999)).toEqual([]);
    expect(g.tickTo(15000)[0]).toMatchObject({
      type: 'cellReleased',
      playerId: 'p1',
      cell: A2,
      reason: 'timeout',
    });
    expect(g.tickTo(20999)).toEqual([]);
    expect(g.tickTo(21000)[0]).toMatchObject({
      type: 'cellReleased',
      playerId: 'p2',
      cell: B1,
      reason: 'timeout',
    });
    expect(g.replayMatches()).toBe(true);
  });

  it('moves the second of immunity and the re-lock wait on by the pause too [D2, D11]', () => {
    const g = GameDriver.of();
    g.solve('p1', 'A1', 0); // 8
    g.playerAct('p1', { type: 'interfere', targetId: 'p2', kind: 'warp' }, 1000); // 6 left, ends at 6000
    g.select('p1', 'A2', 6000); // the interference ends first: p2 immune until 7000
    expect(g.player('p2').immuneUntil).toBe(7000);
    g.playerAct('p1', { type: 'release' }, 6200); // no re-lock of A2 before 7200
    disconnect(g, 'p2', 6500);
    const [, resumed] = reconnect(g, 'p2', 9500);
    expect(resumed).toMatchObject({ type: 'gameResumed', pausedMs: 3000 });
    expect(g.player('p2').immuneUntil).toBe(10000);
    expect(g.state.cooldowns).toEqual([{ playerId: 'p1', cell: A2, until: 10200 }]);

    expect(g.reject({ type: 'interfere', playerId: 'p1', targetId: 'p2', kind: 'cats' }, 9999)).toBe(
      'targetBusy',
    );
    const [second] = g.playerAct('p1', { type: 'interfere', targetId: 'p2', kind: 'cats' }, 10000);
    expect(second).toMatchObject({ cost: 4, score: 2, endsAt: 15000 });
    expect(g.reject({ type: 'select', playerId: 'p1', cell: A2 }, 10199)).toBe('cooldown');
    g.select('p1', 'A2', 10200);
    expect(g.lock('p1')!.cell).toBe(A2);
  });

  it('does not stretch an immunity that was already over when the game froze', () => {
    const g = GameDriver.of();
    g.solve('p1', 'A1', 0);
    g.playerAct('p1', { type: 'interfere', targetId: 'p2', kind: 'cats' }, 1000); // ends 6000, immune until 7000
    g.tickTo(6000);
    disconnect(g, 'p2', 8000);
    reconnect(g, 'p2', 9000);
    expect(g.player('p2').immuneUntil).toBe(7000);
    expect(g.types(g.playerAct('p1', { type: 'interfere', targetId: 'p2', kind: 'cats' }, 9000))).toEqual([
      'interference',
    ]);
  });

  it('think time leaves the pause out: the move counts only the time the lock was running', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 1000); // expires 9000
    disconnect(g, 'p2', 2000);
    reconnect(g, 'p2', 7000); // 5 s pause: expires 14000
    expect(g.lock('p1')!.expiresAt).toBe(14000);
    const [placed] = g.place('p1', 'A1', answer('A1'), 8000);
    expect(placed).toMatchObject({ type: 'placedCorrect', thinkMs: 2000 }); // 1000 before + 1000 after the pause
  });

  it('refuses select, place, release and interfere while paused, but allows reactions', () => {
    const g = GameDriver.of();
    g.solve('p1', 'A1', 0); // points, so that 'paused' is the only reason to refuse the interference
    g.select('p1', 'A2', 500);
    disconnect(g, 'p2', 1000);
    expect(g.reject({ type: 'select', playerId: 'p1', cell: A5 })).toBe('paused');
    expect(g.reject({ type: 'place', playerId: 'p1', cell: A2, digit: answer('A2') })).toBe('paused');
    expect(g.reject({ type: 'release', playerId: 'p1' })).toBe('paused');
    expect(g.reject({ type: 'interfere', playerId: 'p1', targetId: 'p2', kind: 'fireworks' })).toBe('paused');
    expect(g.lock('p1')).toMatchObject({ cell: A2 }); // nothing of the refusals stuck
    expect(g.score('p1')).toBe(8);

    const [reaction] = g.playerAct('p1', { type: 'react', emoji: '😱' }, 2000);
    expect(reaction).toMatchObject({ type: 'reaction', playerId: 'p1', emoji: '😱', t: 2000 });
    // The reaction rate limit still holds while paused [D19].
    expect(g.reject({ type: 'react', playerId: 'p1', emoji: '🔥' }, 3999)).toBe('tooSoon');
    g.playerAct('p1', { type: 'react', emoji: '🔥' }, 4000);
    expect(g.state.status).toBe('paused');
  });

  it('refuses every action of the disconnected player (disconnected)', () => {
    const g = GameDriver.of();
    g.select('p2', 'A2', 0);
    disconnect(g, 'p2', 1000);
    expect(g.reject({ type: 'select', playerId: 'p2', cell: A5 })).toBe('disconnected');
    expect(g.reject({ type: 'place', playerId: 'p2', cell: A2, digit: answer('A2') })).toBe('disconnected');
    expect(g.reject({ type: 'release', playerId: 'p2' })).toBe('disconnected');
    expect(g.reject({ type: 'interfere', playerId: 'p2', targetId: 'p1', kind: 'cats' })).toBe(
      'disconnected',
    );
    expect(g.reject({ type: 'react', playerId: 'p2', emoji: '😂' })).toBe('disconnected');
    expect(g.reject({ type: 'surrender', playerId: 'p2' })).toBe('disconnected');
  });

  it('reconnecting within the grace resumes the game where it stopped (the full sync is the state)', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 0);
    disconnect(g, 'p2', 1000);
    const events = reconnect(g, 'p2', 15999);
    expect(g.types(events)).toEqual(['playerReconnected', 'gameResumed']);
    expect(events[1]).toMatchObject({
      reason: 'reconnect',
      pausedMs: 14999,
      locks: [{ playerId: 'p1', cell: A1, expiresAt: 8000 + 14999 }],
    });
    expect(g.player('p2')).toMatchObject({ connected: true, graceEndsAt: null, status: 'active' });
    expect(g.lock('p1')!.expiresAt).toBe(8000 + 14999);
    // Back to normal: both can play again.
    g.select('p2', 'A2', 16000);
    const [placed] = g.place('p1', 'A1', answer('A1'), 16000);
    expect(placed).toMatchObject({ type: 'placedCorrect', thinkMs: 1001 }); // 0–1000 and 15999–16000
    expect(g.deadline).toBe(24000);
    expect(g.replayMatches()).toBe(true);
  });

  it('the grace clock is not frozen with the game: it runs out 15 s after the disconnection', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 0); // would expire at 8000, but the game is frozen
    disconnect(g, 'p2', 1000);
    expect(g.deadline).toBe(16000);
    expect(g.tickTo(15999)).toEqual([]);
    expect(g.player('p2').graceEndsAt).toBe(16000);
    expect(g.types(g.tickTo(16000))).toEqual(['playerAbandoned', 'gameOver']);
  });

  it('each disconnection gets a fresh 15 s', () => {
    const g = GameDriver.of();
    disconnect(g, 'p2', 1000);
    expect(reconnect(g, 'p2', 5000)[1]).toMatchObject({ type: 'gameResumed', pausedMs: 4000, locks: [] }); // no locks
    const [again] = disconnect(g, 'p2', 10000);
    expect(again).toMatchObject({ type: 'playerDisconnected', graceEndsAt: 25000 });
    expect(g.tickTo(24999)).toEqual([]);
    expect(g.last('playerAbandoned')).toBeUndefined();
    expect(g.tickTo(25000).map((e) => e.type)).toContain('playerAbandoned');
  });

  it('reconnecting at the very moment the grace ends is too late', () => {
    const g = GameDriver.of();
    disconnect(g, 'p2', 1000);
    expect(g.reject({ type: 'reconnect', playerId: 'p2' }, 16000)).toBe('gameOver');
    expect(g.types(g.log.slice(-2))).toEqual(['playerAbandoned', 'gameOver']);
  });
});

describe('abandonment in a 2-player game (§16.2, §6.7, §11.2) [D8, D32]', () => {
  it('not back in 15 s: the lock is released, the player abandons, and the one who stayed wins', () => {
    const g = GameDriver.of({ players: rated([1287, 1305]) });
    g.solve('p2', 'A1', 0); // the one who leaves is ahead on points
    g.select('p2', 'A2', 1000);
    g.select('p1', 'B1', 1000);
    disconnect(g, 'p2', 2000);

    // The host ticks late: everything still happens at the end of the grace (§6.7).
    const events = g.tickTo(30000);
    expect(g.types(events)).toEqual(['cellReleased', 'playerAbandoned', 'gameOver']);
    expect(events[0]).toMatchObject({ playerId: 'p2', cell: A2, reason: 'abandon', t: 17000 });
    expect(events[1]).toMatchObject({ playerId: 'p2', t: 17000 });
    const over = gameOver(events)!;
    expect(over).toMatchObject({ reason: 'lastPlayerStanding', durationMs: 17000, t: 17000 });
    expect(over.ranking).toEqual([
      { playerId: 'p1', seat: 0, place: 1, score: 0, mistakes: 0, correct: 0, status: 'active' },
      { playerId: 'p2', seat: 1, place: 2, score: 8, mistakes: 0, correct: 1, status: 'abandoned' },
    ]);
    // A full win for the one who stayed [D8]: 1287 vs 1305 → +17 (spec §11.2), and a regular loss [D32].
    expect(over.ratingChanges).toEqual([
      { playerId: 'p1', before: 1287, after: 1304, delta: 17, provisional: false },
      { playerId: 'p2', before: 1305, after: 1288, delta: -17, provisional: false },
    ]);
    expect(g.state.status).toBe('over');
    expect(g.state.locks).toEqual([]);
    expect(g.player('p2')).toMatchObject({
      status: 'abandoned',
      connected: false,
      graceEndsAt: null,
      outOrder: 1,
    });
    expect(g.deadline).toBeNull();
    expect(g.types(g.log)).not.toContain('gameResumed');
    expect(g.replayMatches()).toBe(true);
  });

  it('a provisional winner gets the doubled K: +34 (spec §11.2)', () => {
    const g = GameDriver.of({
      players: [
        { id: 'p1', rating: 1287, ratedGames: 3 },
        { id: 'p2', rating: 1305, ratedGames: 30 },
      ],
    });
    disconnect(g, 'p2', 0);
    const over = gameOver(g.tickTo(15000))!;
    expect(over.ratingChanges[0]).toEqual({
      playerId: 'p1',
      before: 1287,
      after: 1321,
      delta: 34,
      provisional: true,
    });
  });

  it('the [D8] alternative (a partial win) lives in the rating module, fed by the same ranking', () => {
    const g = GameDriver.of({ players: rated([1287, 1305]) });
    disconnect(g, 'p2', 0);
    const over = gameOver(g.tickTo(15000))!;
    const input = over.ranking.map((r) => ({
      id: r.playerId,
      rating: r.seat === 0 ? 1287 : 1305,
      games: 30,
      place: r.place,
      abandoned: r.status === 'abandoned',
    }));
    expect(eloChanges(input).map((c) => c.delta)).toEqual(over.ratingChanges.map((c) => c.delta));
    // A half win: 32 × (0.5 − 0.474) ≈ +1 instead of +17.
    expect(eloChanges(input, { abandonWinScore: 0.5 })[0]!.delta).toBe(1);
  });

  it('the abandoned player cannot come back: the game is over', () => {
    const g = GameDriver.of();
    disconnect(g, 'p2', 0);
    g.tickTo(15000);
    expect(g.reject({ type: 'reconnect', playerId: 'p2' })).toBe('gameOver');
    expect(g.reject({ type: 'disconnect', playerId: 'p1' })).toBe('gameOver');
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('disconnect in a 3–4-player game: the game goes on (§16.2) [D4]', () => {
  it('releases the lock of the disconnected player (reason disconnect) and does not pause', () => {
    const g = GameDriver.of({ players: 3 });
    g.select('p2', 'A2', 1000);
    const events = disconnect(g, 'p2', 2000);
    expect(g.types(events)).toEqual(['playerDisconnected', 'cellReleased']);
    expect(events[0]).toMatchObject({ playerId: 'p2', graceEndsAt: 17000 });
    expect(events[1]).toMatchObject({ playerId: 'p2', cell: A2, reason: 'disconnect', t: 2000 });
    expect(g.state.status).toBe('running');
    expect(g.state.pausedAt).toBeNull();
    expect(g.lock('p2')).toBeUndefined();
  });

  it('the others keep playing and their timers keep running', () => {
    const g = GameDriver.of({ players: 3 });
    g.select('p2', 'A2', 1000);
    disconnect(g, 'p2', 2000);
    g.select('p3', 'A2', 2000); // the released cell is free at once (the re-lock wait binds only p2)
    expect(g.lock('p3')).toMatchObject({ cell: A2, expiresAt: 10000 });
    g.solve('p1', 'A1', 3000);
    expect(g.player('p1').correct).toBe(1);
    expect(g.deadline).toBe(10000); // p3's lock, before p2's grace (17000)
    expect(g.tickTo(10000)[0]).toMatchObject({ type: 'cellReleased', playerId: 'p3', reason: 'timeout' });
    expect(g.deadline).toBe(17000);
  });

  it('nobody can interfere with a disconnected player (§7.2)', () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p1', 'A1', 0);
    disconnect(g, 'p2', 1000);
    expect(g.reject({ type: 'interfere', playerId: 'p1', targetId: 'p2', kind: 'cats' })).toBe(
      'targetDisconnected',
    );
    expect(g.view('p1').interference!.targets).toEqual([
      { playerId: 'p2', blockedBy: 'disconnected' },
      { playerId: 'p3', blockedBy: null },
    ]);
    g.playerAct('p1', { type: 'interfere', targetId: 'p3', kind: 'cats' }); // the others still can be
    expect(g.player('p3').hitBy).toMatchObject({ fromId: 'p1', kind: 'cats' });
  });

  it("refuses the disconnected player's own actions (disconnected)", () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p2', 'A1', 0);
    disconnect(g, 'p2', 1000);
    expect(g.reject({ type: 'select', playerId: 'p2', cell: A2 })).toBe('disconnected');
    expect(g.reject({ type: 'place', playerId: 'p2', cell: A2, digit: answer('A2') })).toBe('disconnected');
    expect(g.reject({ type: 'release', playerId: 'p2' })).toBe('disconnected');
    expect(g.reject({ type: 'interfere', playerId: 'p2', targetId: 'p1', kind: 'warp' })).toBe(
      'disconnected',
    );
    expect(g.reject({ type: 'react', playerId: 'p2', emoji: '👀' })).toBe('disconnected');
    expect(g.reject({ type: 'surrender', playerId: 'p2' })).toBe('disconnected');
  });

  it('an interference already on the disconnected player runs its course', () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p1', 'A1', 0);
    g.playerAct('p1', { type: 'interfere', targetId: 'p2', kind: 'fireworks' }, 1000); // ends 6000
    disconnect(g, 'p2', 2000);
    expect(g.tickTo(6000)[0]).toMatchObject({ type: 'interferenceEnded', targetId: 'p2', t: 6000 });
  });

  it('reconnecting brings the player back in, with no gameResumed; the released cell has the usual re-lock wait (§6.2.6) [D2]', () => {
    const g = GameDriver.of({ players: 3 });
    g.select('p2', 'A2', 1000);
    disconnect(g, 'p2', 2000);
    expect(g.state.cooldowns).toEqual([{ playerId: 'p2', cell: A2, until: 3000 }]);
    const events = reconnect(g, 'p2', 2500);
    expect(g.types(events)).toEqual(['playerReconnected']);
    expect(g.player('p2')).toMatchObject({ connected: true, graceEndsAt: null });
    // "After a release for any reason": a release by disconnection too, for the same player and cell only.
    expect(g.view('p2').cooldowns).toEqual([{ cell: A2, until: 3000 }]);
    expect(g.reject({ type: 'select', playerId: 'p2', cell: A2 }, 2999)).toBe('cooldown');
    g.select('p2', 'A5', 2999); // another cell is free at once
    g.select('p2', 'A2', 3000);
    expect(g.lock('p2')).toMatchObject({ cell: A2, expiresAt: 11000 });
    expect(g.deadline).toBe(11000);
    expect(g.replayMatches()).toBe(true);
  });

  it('every player sees the same grace end (spec §16.2: graceEndsAt)', () => {
    const g = GameDriver.of({ players: 3 });
    disconnect(g, 'p3', 4000);
    for (const viewer of ['p1', 'p2', 'p3', null]) {
      const card = g.view(viewer).players.find((p) => p.id === 'p3')!;
      expect(card).toMatchObject({ connected: false, graceEndsAt: 19000, status: 'active', lock: null });
    }
  });

  it("the disconnected player's own view: no interference panel and no keypad until they are back", () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p2', 'A1', 0); // 8 points: enough for an interference
    g.select('p2', 'A2', 500);
    expect(g.view('p2')).toMatchObject({
      interference: { nextCost: 2, missingPoints: 0 },
      keypad: { enabled: true },
    });
    disconnect(g, 'p2', 1000);
    const mine = g.view('p2');
    expect(mine.interference).toBeNull();
    expect(mine.keypad.enabled).toBe(false);
    expect(mine.players[1]).toMatchObject({ connected: false, lock: null });
    // The others still see their own panel, with p2 out of reach.
    expect(g.view('p1').interference!.targets).toEqual([
      { playerId: 'p2', blockedBy: 'disconnected' },
      { playerId: 'p3', blockedBy: 'points' },
    ]);
    reconnect(g, 'p2', 2000);
    expect(g.view('p2').interference).toMatchObject({ nextCost: 2, missingPoints: 0 });
  });
});

describe('abandonment in a 3–4-player game (§16.2, §6.7) [D32]', () => {
  it('abandons at the end of the grace; the game goes on; the player is ranked after everyone still playing', () => {
    const g = GameDriver.of({ players: rated([1200, 1200, 1200]) });
    g.solve('p2', 'A1', 0); // the one who leaves has the most points
    disconnect(g, 'p2', 1000);
    // An action after the grace runs the abandonment first, at its own time.
    const events = g.select('p1', 'A5', 20000);
    expect(g.types(events)).toEqual(['playerAbandoned', 'cellLocked']);
    expect(events.map((e) => e.t)).toEqual([16000, 20000]);
    expect(g.state.status).toBe('running');
    expect(g.player('p2')).toMatchObject({
      status: 'abandoned',
      connected: false,
      graceEndsAt: null,
      outOrder: 1,
    });
    expect(g.view('p1').players[1]).toMatchObject({
      status: 'abandoned',
      connected: false,
      graceEndsAt: null,
    });

    expect(g.reject({ type: 'reconnect', playerId: 'p2' })).toBe('notActive');
    expect(g.reject({ type: 'disconnect', playerId: 'p2' })).toBe('notActive');
    expect(g.reject({ type: 'select', playerId: 'p2', cell: A2 })).toBe('notActive');
    expect(g.reject({ type: 'interfere', playerId: 'p1', targetId: 'p2', kind: 'cats' })).toBe('targetOut');

    // p3 surrenders later: only p1 is left, and the game ends (p1's lock goes with the game).
    const end = g.playerAct('p3', { type: 'surrender' }, 21000);
    expect(g.types(end)).toEqual(['playerSurrendered', 'gameOver']);
    const over = gameOver(end)!;
    expect(over.reason).toBe('lastPlayerStanding');
    expect(over.ranking.map((r) => [r.playerId, r.place, r.status, r.score])).toEqual([
      ['p1', 1, 'active', 0],
      ['p3', 2, 'surrendered', 0], // went out later
      ['p2', 3, 'abandoned', 8], // went out first
    ]);
    // K_pair = 32 / 2 = 16 with equal ratings: +16, 0, −16.
    expect(over.ratingChanges.map((c) => [c.playerId, c.delta])).toEqual([
      ['p1', 16],
      ['p3', 0],
      ['p2', -16],
    ]);
    expect(g.replayMatches()).toBe(true);
  });

  it('the cards show the live place: a disconnected leader still leads; once abandoned, last and not the leader (§6.7, §6.8)', () => {
    const g = GameDriver.of({ players: 3 });
    g.solve('p2', 'A1', 0); // 8: p2 leads
    disconnect(g, 'p2', 1000);
    const places = () => g.view('p1').players.map((p) => [p.id, p.place, p.isLeader]);
    expect(places()).toEqual([
      ['p1', 2, false],
      ['p2', 1, true], // still in the game while away
      ['p3', 2, false],
    ]);
    g.tickTo(16000);
    expect(places()).toEqual([
      ['p1', 1, true], // equal score and mistakes: a shared lead [D16]
      ['p2', 3, false],
      ['p3', 1, true],
    ]);
  });

  it('abandonment with a lock: the lock was already released at the disconnection', () => {
    const g = GameDriver.of({ players: 3 });
    g.select('p3', 'A2', 0);
    disconnect(g, 'p3', 1000);
    expect(g.types(g.tickTo(16000))).toEqual(['playerAbandoned']);
  });

  it('4 players: the board completes with the abandoned player last, whatever their score', () => {
    const g = GameDriver.of({ players: 4 });
    g.solve('p4', 'A1', 0);
    disconnect(g, 'p4', 1000);
    expect(g.types(g.tickTo(16000))).toEqual(['playerAbandoned']);
    solveAll(g, 'p1');
    const over = g.last('gameOver')!;
    expect(over.reason).toBe('boardComplete');
    expect(over.ranking.map((r) => [r.playerId, r.place, r.status])).toEqual([
      ['p1', 1, 'active'],
      ['p2', 2, 'active'],
      ['p3', 2, 'active'], // equal score and mistakes: a shared place [D16]
      ['p4', 4, 'abandoned'],
    ]);
    expect(over.ranking[3]!.score).toBe(8);
  });

  it('when only one player is left the game ends (lastPlayerStanding)', () => {
    const g = GameDriver.of({ players: 3 });
    disconnect(g, 'p2', 1000);
    disconnect(g, 'p3', 2000);
    // p2 is gone: two players are left and one of them is away, so the game freezes [D4].
    expect(g.types(g.tickTo(16000))).toEqual(['playerAbandoned', 'gamePaused']);
    const last = g.tickTo(17000);
    expect(g.types(last)).toEqual(['playerAbandoned', 'gameOver']);
    const over = gameOver(last)!;
    expect(over).toMatchObject({ reason: 'lastPlayerStanding', t: 17000 });
    expect(over.ranking.map((r) => [r.playerId, r.place])).toEqual([
      ['p1', 1],
      ['p3', 2],
      ['p2', 3],
    ]);
  });

  it('two graces ending at the same moment: seat order decides who went out first (current behaviour)', () => {
    const g = GameDriver.of({ players: 3 });
    disconnect(g, 'p2', 1000);
    disconnect(g, 'p3', 1000);
    const events = g.tickTo(16000);
    expect(events.map((e) => [e.type, 'playerId' in e ? e.playerId : null])).toEqual([
      ['playerAbandoned', 'p2'],
      ['gamePaused', null], // two left, one of them away [D4]
      ['playerAbandoned', 'p3'],
      ['gameOver', null],
    ]);
    expect(gameOver(events)!.ranking.map((r) => [r.playerId, r.place])).toEqual([
      ['p1', 1],
      ['p3', 2],
      ['p2', 3],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('the freeze counts the players still in the game, not the seats (§16.2) [D4]', () => {
  it('after a surrender leaves 2 players in a 3-seat game, a disconnection freezes it like a 2-player game', () => {
    const g = GameDriver.of({ players: 3 });
    g.playerAct('p2', { type: 'surrender' }, 500);
    g.select('p1', 'A1', 500); // expires 8500
    g.select('p3', 'A2', 500);
    const events = disconnect(g, 'p3', 1000);
    expect(g.types(events)).toEqual(['playerDisconnected', 'gamePaused']); // the lock is kept
    expect(g.state).toMatchObject({ status: 'paused', pausedAt: 1000 });
    expect(g.lock('p3')).toMatchObject({ cell: A2 });
    // p1 cannot gain from the disconnection.
    expect(g.reject({ type: 'place', playerId: 'p1', cell: A1, digit: answer('A1') }, 2000)).toBe('paused');
    expect(g.deadline).toBe(16000);
    const back = reconnect(g, 'p3', 4000);
    expect(g.types(back)).toEqual(['playerReconnected', 'gameResumed']);
    expect(back[1]).toMatchObject({
      pausedMs: 3000,
      locks: [
        { playerId: 'p1', cell: A1, expiresAt: 11500 },
        { playerId: 'p3', cell: A2, expiresAt: 11500 },
      ],
    });
  });

  it('after a surrender, the one who stays away abandons at the end of the grace and the other wins', () => {
    const g = GameDriver.of({ players: 3 });
    g.playerAct('p2', { type: 'surrender' }, 500);
    disconnect(g, 'p3', 1000);
    expect(g.reject({ type: 'select', playerId: 'p1', cell: A1 }, 2000)).toBe('paused');
    const over = gameOver(g.tickTo(16000))!;
    expect(over).toMatchObject({ reason: 'lastPlayerStanding', t: 16000 });
    expect(over.ranking.map((r) => [r.playerId, r.place, r.status])).toEqual([
      ['p1', 1, 'active'],
      ['p3', 2, 'abandoned'], // went out later
      ['p2', 3, 'surrendered'], // went out first
    ]);
    expect(g.types(g.log)).not.toContain('gameResumed');
  });

  it('after an abandonment leaves 2 players in a 3-seat game, the next disconnection freezes it', () => {
    const g = GameDriver.of({ players: 3 });
    disconnect(g, 'p3', 0);
    expect(g.types(g.tickTo(15000))).toEqual(['playerAbandoned']);
    expect(g.state.status).toBe('running');
    expect(g.types(disconnect(g, 'p2', 16000))).toEqual(['playerDisconnected', 'gamePaused']);
    expect(g.types(reconnect(g, 'p2', 17000))).toEqual(['playerReconnected', 'gameResumed']);
  });

  it.each([
    // [seats, surrendered before the disconnection, freezeUpToPlayers, frozen]
    [4, 1, 2, false], // 3 still in the game
    [4, 2, 2, true], // 2 still in the game
    [4, 1, 3, true],
    [3, 1, 1, false],
  ])(
    '%i seats, %i surrendered, freezeUpToPlayers %i → frozen: %s',
    (players, out, freezeUpToPlayers, frozen) => {
      const g = GameDriver.of({ players, rules: { freezeUpToPlayers } });
      for (let k = 0; k < out; k++) g.playerAct(`p${k + 1}`, { type: 'surrender' }, 100);
      const away = `p${players}`;
      g.select(away, 'A2', 200);
      const events = disconnect(g, away, 1000);
      expect(g.types(events)).toEqual(
        frozen ? ['playerDisconnected', 'gamePaused'] : ['playerDisconnected', 'cellReleased'],
      );
      expect(g.state.status).toBe(frozen ? 'paused' : 'running');
    },
  );

  it('a surrender that leaves 2 players while one of them is already away freezes the game too', () => {
    const g = GameDriver.of({ players: 3 });
    g.select('p1', 'A1', 0); // expires 8000
    disconnect(g, 'p3', 1000); // 3 still in the game: it goes on
    const events = g.playerAct('p2', { type: 'surrender' }, 2000);
    // Now a 2-player game with one player away: p1 must not gain from the disconnection (§16.2).
    expect(g.types(events)).toEqual(['playerSurrendered', 'gamePaused']);
    expect(g.state).toMatchObject({ status: 'paused', pausedAt: 2000 });
    expect(g.reject({ type: 'place', playerId: 'p1', cell: A1, digit: answer('A1') }, 3000)).toBe('paused');
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('alternative rules for disconnections [D4]', () => {
  it('freezeUpToPlayers: 0: a 2-player game goes on, like a 3–4-player one', () => {
    const g = GameDriver.of({ rules: { freezeUpToPlayers: 0 } });
    g.select('p1', 'A1', 0);
    g.select('p2', 'A2', 0);
    const events = disconnect(g, 'p2', 1000);
    expect(g.types(events)).toEqual(['playerDisconnected', 'cellReleased']);
    expect(events[1]).toMatchObject({ playerId: 'p2', cell: A2, reason: 'disconnect' });
    expect(g.state.status).toBe('running');
    expect(g.tickTo(8000)[0]).toMatchObject({ type: 'cellReleased', playerId: 'p1', reason: 'timeout' });
    g.solve('p1', 'A2', 9000);
    const over = gameOver(g.tickTo(16000))!;
    expect(over.reason).toBe('lastPlayerStanding');
    expect(over.ranking[0]).toMatchObject({ playerId: 'p1', place: 1 });
  });

  it.each([
    [3, 2, false],
    [4, 2, false],
    [3, 3, true],
    [4, 3, false],
    [3, 4, true],
    [4, 4, true],
    [2, 1, false],
  ])('%i players with freezeUpToPlayers: %i → frozen: %s', (players, freezeUpToPlayers, frozen) => {
    const g = GameDriver.of({ players, rules: { freezeUpToPlayers } });
    g.select('p2', 'A2', 0);
    const events = disconnect(g, 'p2', 1000);
    expect(g.types(events)).toEqual(
      frozen ? ['playerDisconnected', 'gamePaused'] : ['playerDisconnected', 'cellReleased'],
    );
    expect(g.state.status).toBe(frozen ? 'paused' : 'running');
  });

  it('a frozen 3-player game: locks kept, everyone waits, and it resumes when the absent player abandons', () => {
    const g = GameDriver.of({ players: 3, rules: { freezeUpToPlayers: 4 } });
    g.select('p1', 'A1', 0); // expires 8000
    g.select('p3', 'A2', 0);
    disconnect(g, 'p3', 1000);
    expect(g.reject({ type: 'select', playerId: 'p2', cell: A5 })).toBe('paused');
    expect(g.view('p1').interference!.targets).toEqual([
      { playerId: 'p2', blockedBy: 'notRunning' }, // frozen
      { playerId: 'p3', blockedBy: 'disconnected' },
    ]);
    expect(g.deadline).toBe(16000);
    const events = g.tickTo(16000);
    expect(g.types(events)).toEqual(['cellReleased', 'playerAbandoned', 'gameResumed']);
    expect(events[0]).toMatchObject({ playerId: 'p3', cell: A2, reason: 'abandon' });
    // p3's lock went with the abandonment: only p1's is in locks[].
    expect(events[2]).toMatchObject({
      reason: 'abandon',
      pausedMs: 15000,
      locks: [{ playerId: 'p1', cell: A1, expiresAt: 23000 }],
    });
    expect(g.state.status).toBe('running');
    expect(g.lock('p1')!.expiresAt).toBe(23000);
    expect(g.deadline).toBe(23000);
  });

  it('a frozen 3-player game resumes only when nobody still in it is away', () => {
    const g = GameDriver.of({ players: 3, rules: { freezeUpToPlayers: 4 } });
    disconnect(g, 'p2', 1000);
    expect(g.types(disconnect(g, 'p3', 2000))).toEqual(['playerDisconnected']); // already paused
    expect(g.types(g.tickTo(16000))).toEqual(['playerAbandoned']); // p3 is still away: no resume
    expect(g.state.status).toBe('paused');
    const events = reconnect(g, 'p3', 16500);
    expect(g.types(events)).toEqual(['playerReconnected', 'gameResumed']);
    expect(events[1]).toMatchObject({ reason: 'reconnect', pausedMs: 15500 });
  });

  it('graceMs: a longer grace', () => {
    const g = GameDriver.of({ rules: { graceMs: 30000 } });
    const [e] = disconnect(g, 'p2', 1000);
    expect(e).toMatchObject({ graceEndsAt: 31000 });
    expect(g.deadline).toBe(31000);
    expect(g.tickTo(30999)).toEqual([]);
    expect(g.types(g.tickTo(31000))).toEqual(['playerAbandoned', 'gameOver']);
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('connection edge cases (§16.2)', () => {
  it('disconnecting twice is refused (alreadyDisconnected)', () => {
    const g = GameDriver.of();
    disconnect(g, 'p2', 1000);
    expect(g.reject({ type: 'disconnect', playerId: 'p2' }, 2000)).toBe('alreadyDisconnected');
    expect(g.player('p2').graceEndsAt).toBe(16000); // the grace is not restarted
  });

  it('reconnecting while connected is refused (alreadyConnected)', () => {
    const g = GameDriver.of();
    expect(g.reject({ type: 'reconnect', playerId: 'p1' })).toBe('alreadyConnected');
    disconnect(g, 'p2', 1000);
    reconnect(g, 'p2', 2000);
    expect(g.reject({ type: 'reconnect', playerId: 'p2' })).toBe('alreadyConnected');
  });

  it('an unknown player is refused (unknownPlayer)', () => {
    const g = GameDriver.of();
    expect(g.reject({ type: 'disconnect', playerId: 'nobody' })).toBe('unknownPlayer');
    expect(g.reject({ type: 'reconnect', playerId: 'nobody' })).toBe('unknownPlayer');
    disconnect(g, 'p2', 1000);
    expect(g.reject({ type: 'select', playerId: 'nobody', cell: A1 })).toBe('unknownPlayer');
  });

  it('a connection report stamped earlier than the last event counts at that event: time never runs backwards', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 5000); // expires 13000
    const [lost] = disconnect(g, 'p2', 4000);
    expect(lost).toMatchObject({ type: 'playerDisconnected', t: 5000, graceEndsAt: 20000 });
    expect(g.state.pausedAt).toBe(5000);
    const back = reconnect(g, 'p2', 4500);
    expect(back[1]).toMatchObject({ type: 'gameResumed', t: 5000, pausedMs: 0 });
    expect(back[1]).toMatchObject({ locks: [{ playerId: 'p1', cell: A1, expiresAt: 13000 }] });
    expect(g.replayMatches()).toBe(true);
  });

  it('before the start and after the end, connection reports are refused', () => {
    const waiting = GameDriver.of({}, { start: false });
    expect(waiting.reject({ type: 'disconnect', playerId: 'p1' })).toBe('notStarted');
    const over = GameDriver.of();
    over.playerAct('p1', { type: 'surrender' });
    expect(over.reject({ type: 'disconnect', playerId: 'p2' })).toBe('gameOver');
    expect(over.reject({ type: 'reconnect', playerId: 'p2' })).toBe('gameOver');
  });

  it('a player who surrendered cannot disconnect or reconnect (notActive)', () => {
    const g = GameDriver.of({ players: 3 });
    g.playerAct('p3', { type: 'surrender' }, 1000);
    expect(g.reject({ type: 'disconnect', playerId: 'p3' })).toBe('notActive');
    expect(g.reject({ type: 'reconnect', playerId: 'p3' })).toBe('notActive');
  });

  describe('both players of a 2-player game disconnect', () => {
    const bothAway = () => {
      const g = GameDriver.of({ players: rated([1200, 1200]) });
      g.select('p1', 'A1', 0);
      const first = disconnect(g, 'p1', 1000);
      expect(g.types(first)).toEqual(['playerDisconnected', 'gamePaused']);
      const second = disconnect(g, 'p2', 3000);
      expect(g.types(second)).toEqual(['playerDisconnected']); // already paused: no second gamePaused
      expect(second[0]).toMatchObject({ graceEndsAt: 18000 });
      expect(g.state).toMatchObject({ status: 'paused', pausedAt: 1000 });
      expect(g.deadline).toBe(16000); // each has a grace of their own
      return g;
    };

    it('the game stays paused while either is away', () => {
      const g = bothAway();
      expect(g.types(reconnect(g, 'p2', 5000))).toEqual(['playerReconnected']);
      expect(g.state.status).toBe('paused');
      expect(g.reject({ type: 'select', playerId: 'p2', cell: A2 })).toBe('paused');
    });

    it('both come back: it resumes when the second does', () => {
      const g = bothAway();
      expect(g.types(reconnect(g, 'p1', 10000))).toEqual(['playerReconnected']);
      const events = reconnect(g, 'p2', 12000);
      expect(g.types(events)).toEqual(['playerReconnected', 'gameResumed']);
      expect(events[1]).toMatchObject({
        pausedMs: 11000,
        locks: [{ playerId: 'p1', cell: A1, expiresAt: 19000 }],
      });
      expect(g.lock('p1')!.expiresAt).toBe(19000); // 8000 + 11000
    });

    it('neither comes back: the first grace to run out ends the game, and the other player wins although still away (current behaviour)', () => {
      const g = bothAway();
      const events = g.tickTo(30000);
      expect(g.types(events)).toEqual(['cellReleased', 'playerAbandoned', 'gameOver']);
      expect(events[0]).toMatchObject({ playerId: 'p1', reason: 'abandon', t: 16000 });
      const over = gameOver(events)!;
      expect(over).toMatchObject({ reason: 'lastPlayerStanding', t: 16000 });
      expect(over.ranking.map((r) => [r.playerId, r.place, r.status])).toEqual([
        ['p2', 1, 'active'],
        ['p1', 2, 'abandoned'],
      ]);
      expect(over.ratingChanges.map((c) => [c.playerId, c.delta])).toEqual([
        ['p2', 16],
        ['p1', -16],
      ]);
      expect(g.player('p2')).toMatchObject({ status: 'active', connected: false });
      expect(g.types(g.log).filter((t) => t === 'playerAbandoned')).toHaveLength(1);
    });

    it('only the second comes back: the first still abandons and the one who came back wins', () => {
      const g = bothAway();
      reconnect(g, 'p2', 5000);
      const over = gameOver(g.tickTo(16000))!;
      expect(over.ranking[0]).toMatchObject({ playerId: 'p2', place: 1 });
    });
  });

  it('surrendering while the opponent is disconnected ends the game; the absent opponent wins', () => {
    const g = GameDriver.of({ players: rated([1200, 1200]) });
    g.select('p1', 'A1', 0);
    disconnect(g, 'p2', 1000);
    const events = g.playerAct('p1', { type: 'surrender' }, 5000);
    expect(g.types(events)).toEqual(['cellReleased', 'playerSurrendered', 'gameOver']);
    expect(events[0]).toMatchObject({ playerId: 'p1', cell: A1, reason: 'surrender' });
    const over = gameOver(events)!;
    expect(over).toMatchObject({ reason: 'lastPlayerStanding', durationMs: 5000 });
    expect(over.ranking.map((r) => [r.playerId, r.place, r.status])).toEqual([
      ['p2', 1, 'active'],
      ['p1', 2, 'surrendered'],
    ]);
    expect(over.ratingChanges.map((c) => [c.playerId, c.delta])).toEqual([
      ['p2', 16],
      ['p1', -16],
    ]);
    expect(g.deadline).toBeNull(); // the pending grace no longer matters
    expect(g.reject({ type: 'reconnect', playerId: 'p2' })).toBe('gameOver');
  });

  it('nextDeadline: only the grace while paused; the earliest timer while the game goes on', () => {
    const two = GameDriver.of();
    two.solve('p1', 'A1', 0);
    two.select('p1', 'A2', 1000); // 9000
    two.playerAct('p1', { type: 'interfere', targetId: 'p2', kind: 'cats' }, 1000); // 6000
    expect(two.deadline).toBe(6000);
    disconnect(two, 'p2', 2000);
    expect(two.deadline).toBe(17000);
    reconnect(two, 'p2', 3000);
    expect(two.deadline).toBe(7000); // 6000 + 1000 of pause

    const three = GameDriver.of({ players: 3 });
    disconnect(three, 'p2', 1000);
    expect(three.deadline).toBe(16000);
    three.select('p1', 'A1', 2000); // 10000
    expect(three.deadline).toBe(10000);
    three.tickTo(10000);
    expect(three.deadline).toBe(16000);
  });

  it("the view while frozen: the opponent's card shows the grace, my keypad is off, my lock is kept", () => {
    const g = GameDriver.of();
    g.select('p1', 'A1', 0);
    disconnect(g, 'p2', 2000);
    const mine = g.view('p1');
    expect(mine).toMatchObject({ status: 'paused', pausedAt: 2000 });
    expect(mine.keypad.enabled).toBe(false);
    expect(mine.players[0]!.lock).toMatchObject({ cell: A1 });
    expect(mine.players[1]).toMatchObject({ connected: false, graceEndsAt: 17000 });
    expect(mine.interference!.targets).toEqual([{ playerId: 'p2', blockedBy: 'disconnected' }]);
    // The disconnected player's own view: nothing to send while away.
    expect(g.view('p2').interference).toBeNull();
    reconnect(g, 'p2', 3000);
    expect(g.view('p1').keypad.enabled).toBe(true);
  });

  it('the view while frozen shows every timer stopped at the time it had left when the game froze (§6.2.7)', () => {
    const g = GameDriver.of();
    g.solve('p1', 'A1', 0); // 8 points
    g.select('p1', 'A2', 1000); // expires 9000
    g.playerAct('p1', { type: 'interfere', targetId: 'p2', kind: 'cats' }, 2000); // ends 7000
    g.playerAct('p1', { type: 'release' }, 3500); // re-lock wait on A2 until 4500
    g.select('p1', 'A5', 3500); // expires 11500
    disconnect(g, 'p2', 4000);
    g.now = 6000; // the screen asks later: the stopped timers do not move
    const frozen = g.view('p1');
    expect(frozen.players[0]!.lock).toEqual({ cell: A5, expiresAt: null, remainingMs: 7500 });
    expect(frozen.players[1]!.hitBy).toEqual({
      fromId: 'p1',
      kind: 'cats',
      expiresAt: null,
      remainingMs: 3000,
    });
    expect(g.view('p2').players[1]!.hitBy).toEqual(frozen.players[1]!.hitBy); // the target sees the same

    reconnect(g, 'p2', 6000); // a 2-second pause
    const running = g.view('p1');
    expect(running.players[0]!.lock).toMatchObject({ cell: A5, expiresAt: 13500 });
    expect(running.players[1]!.hitBy).toEqual({
      fromId: 'p1',
      kind: 'cats',
      expiresAt: 9000,
      remainingMs: 3000,
    });
    expect(running.cooldowns).toEqual([{ cell: A2, until: 6500 }]); // the 500 ms left of the wait, after the pause
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('turns model and disconnections (§6.1, §16.2) [D1, D4]', () => {
  it('2 players: the turn timer is frozen too', () => {
    const g = GameDriver.of({ rules: { turnModel: 'turns' } });
    expect(g.state.turn).toEqual({ playerId: 'p1', endsAt: 8000, stoppedMs: null });
    disconnect(g, 'p2', 2000);
    expect(g.deadline).toBe(17000);
    g.now = 4000;
    expect(g.view('p1').turn).toEqual({ playerId: 'p1', expiresAt: null, remainingMs: 6000 }); // stopped at the freeze
    reconnect(g, 'p2', 5000);
    expect(g.state.turn).toEqual({ playerId: 'p1', endsAt: 11000, stoppedMs: null });
    expect(g.view('p1').turn).toEqual({ playerId: 'p1', expiresAt: 11000, remainingMs: 6000 });
    expect(g.tickTo(10999)).toEqual([]);
    expect(g.tickTo(11000)[0]).toMatchObject({
      type: 'turnStarted',
      playerId: 'p2',
      endsAt: 19000,
      remainingMs: 8000,
    });
  });

  it('3 players: the disconnected player loses the turn and the lock, and is skipped while away', () => {
    const g = GameDriver.of({ players: 3, rules: { turnModel: 'turns', graceMs: 60000 } });
    g.select('p1', 'A1', 1000);
    const events = disconnect(g, 'p1', 2000);
    expect(g.types(events)).toEqual(['playerDisconnected', 'cellReleased', 'turnStarted']);
    expect(events[1]).toMatchObject({ reason: 'disconnect' });
    expect(events[2]).toMatchObject({ playerId: 'p2', endsAt: 10000, remainingMs: 8000, t: 2000 });
    expect(g.tickTo(10000)[0]).toMatchObject({ type: 'turnStarted', playerId: 'p3', endsAt: 18000 });
    expect(g.tickTo(18000)[0]).toMatchObject({ type: 'turnStarted', playerId: 'p2' }); // p1 skipped
    expect(g.types(reconnect(g, 'p1', 20000))).toEqual(['playerReconnected']);
    expect(g.tickTo(26000)[0]).toMatchObject({ type: 'turnStarted', playerId: 'p3' });
    expect(g.tickTo(34000)[0]).toMatchObject({ type: 'turnStarted', playerId: 'p1' }); // back in the wheel
  });

  it('4 players: the turn of the one who disconnects goes to the next seat after them, not back to seat 0', () => {
    const g = GameDriver.of({ players: 4, rules: { turnModel: 'turns', graceMs: 60000 } });
    expect(g.tickTo(8000)).toEqual([
      expect.objectContaining({ type: 'turnStarted', playerId: 'p2', endsAt: 16000 }),
    ]);
    g.select('p2', 'A1', 9000);
    const events = disconnect(g, 'p2', 10000);
    expect(g.types(events)).toEqual(['playerDisconnected', 'cellReleased', 'turnStarted']);
    expect(events[2]).toMatchObject({ playerId: 'p3', endsAt: 18000, remainingMs: 8000, t: 10000 });
    expect(g.state.turn).toEqual({ playerId: 'p3', endsAt: 18000, stoppedMs: null });
    // The disconnection of someone whose turn it is not leaves the turn alone.
    expect(g.types(disconnect(g, 'p1', 11000))).toEqual(['playerDisconnected']);
    expect(g.tickTo(18000)).toEqual([expect.objectContaining({ type: 'turnStarted', playerId: 'p4' })]);
    expect(g.tickTo(26000)).toEqual([expect.objectContaining({ type: 'turnStarted', playerId: 'p3' })]); // p1, p2 away
  });

  it('3 players, everyone disconnects: the turn is cleared, the graces still run out and the game ends', () => {
    const g = GameDriver.of({ players: 3, rules: { turnModel: 'turns' } });
    expect(g.types(disconnect(g, 'p1', 1000))).toEqual(['playerDisconnected', 'turnStarted']); // to p2
    expect(g.types(disconnect(g, 'p2', 2000))).toEqual(['playerDisconnected', 'turnStarted']); // to p3
    const last = disconnect(g, 'p3', 3000); // nobody left to pass the turn to
    expect(g.types(last)).toEqual(['playerDisconnected', 'turnCleared']);
    expect(last[1]).toMatchObject({ t: 3000 });
    expect(g.state.turn).toBeNull();
    expect(g.view(null).turn).toBeNull();
    expect(g.deadline).toBe(16000); // only the graces: no turn timer left to loop on
    const events = g.tickTo(20000);
    expect(
      events.filter((e) => e.type === 'playerAbandoned').map((e) => [e.t, 'playerId' in e && e.playerId]),
    ).toEqual([
      [16000, 'p1'],
      [17000, 'p2'],
    ]);
    expect(g.types(events)).not.toContain('turnStarted');
    expect(gameOver(events)!.ranking[0]).toMatchObject({ playerId: 'p3', place: 1 });
    expect(g.replayMatches()).toBe(true);
  });

  it('everyone away: the first one back gets the turn with its full time, and the rotation goes on from them', () => {
    const g = GameDriver.of({ players: 3, rules: { turnModel: 'turns' } });
    disconnect(g, 'p1', 1000);
    disconnect(g, 'p2', 2000);
    disconnect(g, 'p3', 3000);
    expect(g.tickTo(9000)).toEqual([]); // no turn runs out meanwhile
    const back = reconnect(g, 'p2', 9000);
    expect(g.types(back)).toEqual(['playerReconnected', 'turnStarted']);
    expect(back[1]).toMatchObject({ playerId: 'p2', endsAt: 17000, remainingMs: 8000, t: 9000 });
    expect(g.types(reconnect(g, 'p1', 10000))).toEqual(['playerReconnected']); // the turn is already p2's
    expect(g.tickTo(17000)).toEqual([
      expect.objectContaining({ type: 'turnStarted', playerId: 'p1', endsAt: 25000 }),
    ]);
    expect(g.types(g.tickTo(18000))).toEqual(['playerAbandoned']); // p3; the turn stays with p1
    expect(g.state.turn).toEqual({ playerId: 'p1', endsAt: 25000, stoppedMs: null });
    expect(g.replayMatches()).toBe(true);
  });

  it('2 players: a turn stopped by an interference waits for the freeze and then for the interference, keeping its time [D11]', () => {
    const g = GameDriver.of({ rules: { turnModel: 'turns' } });
    g.solve('p1', 'A1', 0); // the turn passes to p2
    g.solve('p2', 'A2', 1000); // back to p1 until 9000; p2 now has points to pay for an interference
    const [hit] = g.playerAct('p2', { type: 'interfere', targetId: 'p1', kind: 'cats' }, 2000); // ends 7000
    expect(hit).toMatchObject({ type: 'interference', endsAt: 7000, locks: [] });
    expect(g.state.turn).toEqual({ playerId: 'p1', endsAt: null, stoppedMs: 7000 });

    disconnect(g, 'p2', 3000);
    g.now = 5000;
    expect(g.view('p1').turn).toEqual({ playerId: 'p1', expiresAt: null, remainingMs: 7000 });
    const back = reconnect(g, 'p2', 6000);
    expect(back[1]).toMatchObject({ type: 'gameResumed', pausedMs: 3000, locks: [] });
    expect(g.state.turn).toEqual({ playerId: 'p1', endsAt: null, stoppedMs: 7000 }); // still under interference
    expect(g.player('p1').hitBy!.endsAt).toBe(10000);

    expect(g.deadline).toBe(10000);
    expect(g.types(g.tickTo(10000))).toEqual(['interferenceEnded']);
    expect(g.state.turn).toEqual({ playerId: 'p1', endsAt: 17000, stoppedMs: null });
    expect(g.tickTo(16999)).toEqual([]);
    expect(g.tickTo(17000)).toEqual([
      expect.objectContaining({ type: 'turnStarted', playerId: 'p2', endsAt: 25000 }),
    ]);
    expect(g.replayMatches()).toBe(true);
  });

  it('a frozen game: when the turn holder leaves during the freeze, the turn goes to the next seat after them', () => {
    const g = GameDriver.of({ players: 4, rules: { turnModel: 'turns', freezeUpToPlayers: 4 } });
    g.tickTo(8000); // p2's turn until 16000
    expect(g.types(disconnect(g, 'p4', 9000))).toEqual(['playerDisconnected', 'gamePaused']);
    g.playerAct('p2', { type: 'surrender' }, 10000); // the holder leaves while the game is frozen
    reconnect(g, 'p4', 12000); // a 3-second pause
    // The turn moves on after p2, to p3, with its full time once the game runs again.
    expect(g.state.turn).toEqual({ playerId: 'p3', endsAt: 20000, stoppedMs: null });
  });
});

// ---------------------------------------------------------------------------------------------------------

describe('LocalGameHost with disconnections (§17.2)', () => {
  it('schedules the end of the grace while frozen and reports the abandonment', () => {
    const clock = new ManualClock(0);
    const scheduler = new ManualScheduler(clock);
    const host = new LocalGameHost({ config: makeConfig(), playerId: 'p1', clock, scheduler });
    const updates: HostUpdate[] = [];
    host.subscribe((u) => updates.push(u));
    host.send({ type: 'select', cell: A1 });
    clock.set(1000);
    host.dispatch({ type: 'disconnect', playerId: 'p2' });
    expect(host.getView()).toMatchObject({ status: 'paused' });
    host.send({ type: 'select', cell: A2 });
    expect(updates[updates.length - 1]).toMatchObject({ kind: 'rejected', reason: 'paused' });
    scheduler.advance(14999); // to 15999: the lock (8000) does not run out while frozen
    expect(host.state.locks).toHaveLength(1);
    scheduler.advance(1); // 16000
    const last = updates[updates.length - 1]!;
    expect(last.kind).toBe('events');
    if (last.kind === 'events')
      expect(last.events.map((e) => e.type)).toEqual(['playerAbandoned', 'gameOver']);
    expect(host.getView().result).toMatchObject({ reason: 'lastPlayerStanding' });
    host.close();
  });

  it('the local player drops and comes back: their view while away, then the timers re-armed after the pause', () => {
    const clock = new ManualClock(0);
    const scheduler = new ManualScheduler(clock);
    const host = new LocalGameHost({ config: makeConfig(), playerId: 'p1', clock, scheduler });
    const updates: HostUpdate[] = [];
    host.subscribe((u) => updates.push(u));
    host.select(A1); // expires 8000
    clock.set(1000);
    host.dispatch({ type: 'disconnect', playerId: 'p1' });
    const away = host.getView();
    expect(away).toMatchObject({ status: 'paused', interference: null, keypad: { enabled: false } });
    expect(away.players[0]).toMatchObject({ connected: false, graceEndsAt: 16000 });
    expect(away.players[0]!.lock).toEqual({ cell: A1, expiresAt: null, remainingMs: 7000 });
    host.place(A1, answer('A1'));
    expect(updates[updates.length - 1]).toMatchObject({ kind: 'rejected', reason: 'disconnected' });

    scheduler.advance(4000); // 5000: nothing runs out while frozen
    host.dispatch({ type: 'reconnect', playerId: 'p1' });
    expect(updates[updates.length - 1]).toMatchObject({
      kind: 'events',
      events: [
        { type: 'playerReconnected', playerId: 'p1', t: 5000 },
        { type: 'gameResumed', pausedMs: 4000, locks: [{ playerId: 'p1', cell: A1, expiresAt: 12000 }] },
      ],
      view: { status: 'running', keypad: { enabled: true } },
    });
    scheduler.advance(6999); // 11999
    expect(host.state.locks).toHaveLength(1);
    scheduler.advance(1); // 12000: the lock runs out at its moved deadline
    expect(updates[updates.length - 1]).toMatchObject({
      kind: 'events',
      events: [{ type: 'cellReleased', playerId: 'p1', cell: A1, reason: 'timeout', t: 12000 }],
    });
    host.close();
  });
});
