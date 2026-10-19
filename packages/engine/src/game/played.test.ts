import { answer, GameDriver } from '../testing/game';
import { loggedMs, playedMs } from './played';
import { replay, toView } from './view';

/**
 * [D65, extended by Moshe 2026-10-18] The game's clock leaves out the phone's own freezes (the app out of the
 * foreground in solo and bot practice, and in the stages): the duration, the HUD's clock and a saved game's time
 * are the time played. A disconnect's freeze (online) counts, as it always did.
 */

const solo = () => GameDriver.of({ mode: 'solo', players: 1 }, { at: 1000 });

describe('the time played [D65]', () => {
  it('a solo practice frozen for a minute: the duration leaves the minute out', () => {
    const g = solo();
    g.solve('p1', 'A1', 5000);
    g.act({ type: 'pause' }, 11_000);
    // Frozen: the clock stands still at the freeze.
    expect(playedMs(g.state, 40_000)).toBe(10_000);
    g.act({ type: 'resume' }, 71_000);
    expect(g.state.frozenMs).toBe(60_000);
    expect(playedMs(g.state, 71_000)).toBe(10_000);
    expect(playedMs(g.state, 75_000)).toBe(14_000);
    g.act({ type: 'surrender', playerId: 'p1' }, 75_000);
    expect(g.state.result).toMatchObject({ reason: 'practiceEnded', durationMs: 14_000 });
    // The saved log tells the same.
    expect(replay(g.log).at(-1)).toEqual(g.state);
  });

  it('two freezes add up; ending while frozen stops the clock at the freeze', () => {
    const g = solo();
    g.act({ type: 'pause' }, 3000);
    g.act({ type: 'resume' }, 13_000);
    g.select('p1', 'A1', 14_000);
    g.act({ type: 'pause' }, 15_000);
    g.act({ type: 'resume' }, 45_000);
    expect(g.state.frozenMs).toBe(40_000);
    g.place('p1', 'A1', answer('A1'), 46_000);
    g.act({ type: 'pause' }, 50_000);
    g.act({ type: 'surrender', playerId: 'p1' }, 90_000);
    expect(g.state.result!.durationMs).toBe(50_000 - 1000 - 40_000);
  });

  it('the view carries the freeze, so the screen reads the same clock', () => {
    const g = solo();
    expect(toView(g.state, 'p1', 2000)).not.toHaveProperty('frozenMs');
    expect(toView(g.state, 'p1', 2000)).not.toHaveProperty('pausedBy');
    g.act({ type: 'pause' }, 4000);
    const frozen = toView(g.state, 'p1', 9000);
    expect(frozen).toMatchObject({ status: 'paused', pausedBy: 'background', pausedAt: 4000 });
    expect(playedMs(frozen, 9000)).toBe(3000);
    g.act({ type: 'resume' }, 10_000);
    const back = toView(g.state, 'p1', 12_000);
    expect(back).toMatchObject({ status: 'running', frozenMs: 6000 });
    expect(back).not.toHaveProperty('pausedBy');
    expect(playedMs(back, 12_000)).toBe(5000);
  });

  it('a disconnect’s freeze still counts (online games are unchanged)', () => {
    const g = GameDriver.of({ mode: 'ranked', players: 2 }, { at: 0 });
    g.disconnect('p2', { at: 2000 });
    g.reconnect('p2', 7000);
    expect(g.state).not.toHaveProperty('frozenMs');
    g.act({ type: 'surrender', playerId: 'p1' }, 9000);
    expect(g.state.result!.durationMs).toBe(9000);
  });

  it('an interrupted log’s time: its clock to the last event, or since the creation when it never started', () => {
    const g = solo();
    g.act({ type: 'pause' }, 6000);
    g.act({ type: 'resume' }, 66_000);
    g.select('p1', 'A1', 70_000);
    expect(loggedMs(g.state)).toBe(9000);
    const waiting = GameDriver.of({ mode: 'solo', players: 1 }, { start: false, at: 500 });
    expect(loggedMs({ ...waiting.state, lastEventAt: 2500 })).toBe(2000);
    expect(playedMs(waiting.state, 2500)).toBe(0);
  });
});
