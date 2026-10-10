import { parseCellName } from '../sudoku/board';
import { answer, GameDriver } from '../testing/game';

const A1 = parseCellName('A1');
const A2 = parseCellName('A2');
const A5 = parseCellName('A5');
const A6 = parseCellName('A6');

/** p2 earns points at 0 to pay for an interference; p1 then locks A2 at 1000 (it runs out at 9000). */
function p1HoldsA2(options: Parameters<typeof GameDriver.of>[0] = {}): GameDriver {
  const g = GameDriver.of(options);
  g.solve('p2', 'A1', 0);
  g.select('p1', 'A2', 1000);
  return g;
}

describe('locking a cell (§6.2)', () => {
  it('locks an empty cell for the think time of the game type [D2]', () => {
    for (const [gameType, ms] of [
      ['fast', 8000],
      ['normal', 12000],
      ['hard', 18000],
    ] as const) {
      const g = GameDriver.of({ gameType }, { at: 1000 });
      const [e] = g.select('p1', 'A1');
      expect(e).toMatchObject({
        type: 'cellLocked',
        playerId: 'p1',
        cell: A1,
        expiresAt: 1000 + ms,
        remainingMs: ms,
      });
      expect(g.lock('p1')).toMatchObject({ cell: A1, lockedAt: 1000, expiresAt: 1000 + ms });
    }
  });

  it('refuses a given or a solved cell, and a cell that is not on the board', () => {
    const g = GameDriver.of();
    expect(g.reject({ type: 'select', playerId: 'p1', cell: parseCellName('A3') })).toBe('cellFilled'); // given 4
    g.solve('p1', 'A1');
    expect(g.reject({ type: 'select', playerId: 'p2', cell: A1 })).toBe('cellFilled');
    expect(g.reject({ type: 'select', playerId: 'p1', cell: 81 })).toBe('badCell');
  });

  it('gives each player one lock at most: choosing another cell releases the first', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1');
    const events = g.select('p1', 'A2');
    expect(g.types(events)).toEqual(['cellReleased', 'cellLocked']);
    expect(events[0]).toMatchObject({ cell: A1, reason: 'switch' });
    expect(g.state.locks).toHaveLength(1);
    expect(g.lock('p1')!.cell).toBe(A2);
  });

  it('refuses a cell locked by someone else, without a penalty', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1');
    expect(g.reject({ type: 'select', playerId: 'p2', cell: A1 })).toBe('cellTaken');
    expect(g.score('p2')).toBe(0);
    expect(g.reject({ type: 'select', playerId: 'p1', cell: A1 })).toBe('alreadyHeld');
  });

  it('two players locking the same cell at the same moment: the first one processed wins', () => {
    const g = GameDriver.of({}, { at: 500 });
    g.select('p1', 'A1', 500);
    expect(g.reject({ type: 'select', playerId: 'p2', cell: A1 }, 500)).toBe('cellTaken');
    expect(g.lock('p1')).toBeDefined();
    expect(g.lock('p2')).toBeUndefined();
  });

  it('releases on its own when the think time runs out, without a penalty [D2]', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1');
    expect(g.deadline).toBe(8000);
    expect(g.advance(7999)).toEqual([]);
    const [e] = g.advance(1);
    expect(e).toMatchObject({ type: 'cellReleased', playerId: 'p1', cell: A1, reason: 'timeout', t: 8000 });
    expect(e).not.toHaveProperty('penalty');
    expect(g.score('p1')).toBe(0);
    expect(g.lock('p1')).toBeUndefined();
  });

  it('can charge for a timeout when the rule says so', () => {
    const g = GameDriver.of({ rules: { timeoutPenalty: 1 } });
    g.select('p1', 'A1');
    const [e] = g.advance(8000);
    expect(e).toMatchObject({ reason: 'timeout', penalty: 1, score: -1 });
    expect(g.score('p1')).toBe(-1);
  });

  it('"cancel selection" releases the lock (§6.2.5)', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1');
    const [e] = g.playerAct('p1', { type: 'release' });
    expect(e).toMatchObject({ type: 'cellReleased', cell: A1, reason: 'cancel' });
    expect(g.reject({ type: 'release', playerId: 'p1' })).toBe('noLock');
  });

  describe('after a release for any reason, one second before the same player may lock the same cell again (§6.2.6) [D2]', () => {
    it('waits after every kind of release by default: timeout, cancel, switch, mistake and disconnect', () => {
      expect(GameDriver.of().state.config.rules.relockCooldownAfter).toEqual([
        'cancel',
        'timeout',
        'switch',
        'mistake',
        'disconnect',
      ]);
    });

    /** Each way p1 lets go of A1; returns when it happened. */
    const releaseA1 = {
      timeout: (g: GameDriver) => {
        g.select('p1', 'A1', 0);
        g.tickTo(8000);
        return 8000;
      },
      cancel: (g: GameDriver) => {
        g.select('p1', 'A1', 0);
        g.playerAct('p1', { type: 'release' }, 3000);
        return 3000;
      },
      switch: (g: GameDriver) => {
        g.select('p1', 'A1', 0);
        g.select('p1', 'A2', 3000);
        return 3000;
      },
      mistake: (g: GameDriver) => {
        g.miss('p1', 'A1', 3000);
        return 3000;
      },
    };

    it.each(['timeout', 'cancel', 'switch', 'mistake'] as const)('after %s', (how) => {
      const g = GameDriver.of();
      const at = releaseA1[how](g);
      expect(g.last('cellReleased')).toMatchObject({ playerId: 'p1', cell: A1, reason: how, t: at });
      expect(g.reject({ type: 'select', playerId: 'p1', cell: A1 }, at + 999)).toBe('cooldown');
      // Someone else may take it at once (after a mistake: free for everyone [D3]) …
      g.select('p2', 'A1', at + 999);
      g.playerAct('p2', { type: 'release' }, at + 999);
      // … and the same player may take another cell.
      g.select('p1', 'A5', at + 999);
      g.select('p1', 'A1', at + 1000);
      expect(g.lock('p1')!.cell).toBe(A1);
    });

    it('after a disconnect (3–4 players: the game goes on and the lock is released, §16.2)', () => {
      const g = GameDriver.of({ players: 3 });
      g.select('p1', 'A1', 0);
      const events = g.act({ type: 'disconnect', playerId: 'p1' }, 3000);
      expect(g.types(events)).toEqual(['playerDisconnected', 'cellReleased']);
      expect(events[1]).toMatchObject({ playerId: 'p1', cell: A1, reason: 'disconnect' });
      g.act({ type: 'reconnect', playerId: 'p1' }, 3500);
      expect(g.reject({ type: 'select', playerId: 'p1', cell: A1 }, 3999)).toBe('cooldown');
      g.select('p1', 'A1', 4000);
      expect(g.lock('p1')!.cell).toBe(A1);
    });

    it('is kept per player and cell: switching away and back does not dodge it', () => {
      const g = GameDriver.of();
      g.select('p1', 'A1', 0);
      g.select('p1', 'A2', 1000); // A1 waits until 2000
      expect(g.reject({ type: 'select', playerId: 'p1', cell: A1 }, 1999)).toBe('cooldown');
      expect(g.lock('p1')!.cell).toBe(A2);
      g.select('p1', 'A1', 2000);
      // The wait on A1 is over and gone; A2 now waits.
      expect(g.state.cooldowns).toEqual([{ playerId: 'p1', cell: A2, until: 3000 }]);
    });

    it('stands still while the game is frozen (§16.2)', () => {
      const g = GameDriver.of();
      g.select('p1', 'A1', 0);
      g.playerAct('p1', { type: 'release' }, 3000); // waits until 4000
      g.act({ type: 'disconnect', playerId: 'p2' }, 3500);
      const [, resumed] = g.act({ type: 'reconnect', playerId: 'p2' }, 5500);
      expect(resumed).toMatchObject({ type: 'gameResumed', pausedMs: 2000 });
      expect(g.view('p1').cooldowns).toEqual([{ cell: A1, until: 6000 }]);
      expect(g.reject({ type: 'select', playerId: 'p1', cell: A1 }, 5999)).toBe('cooldown');
      g.select('p1', 'A1', 6000);
      expect(g.replayMatches()).toBe(true);
    });

    it('the view shows me my own waits, until they run out', () => {
      const g = GameDriver.of();
      g.select('p1', 'A1', 0);
      g.playerAct('p1', { type: 'release' }, 3000);
      expect(g.view('p1').cooldowns).toEqual([{ cell: A1, until: 4000 }]);
      expect(g.view('p2').cooldowns).toEqual([]);
      expect(g.view(null).cooldowns).toEqual([]);
      g.tickTo(4000);
      expect(g.view('p1').cooldowns).toEqual([]);
    });

    it('which releases start it, and how long it lasts, are rules [D2]', () => {
      const noWaitAfterMistake = GameDriver.of({
        rules: { relockCooldownAfter: ['cancel', 'timeout', 'switch'] },
      });
      noWaitAfterMistake.miss('p1', 'A1', 1000);
      noWaitAfterMistake.select('p1', 'A1', 1000);
      expect(noWaitAfterMistake.lock('p1')!.cell).toBe(A1);

      const longer = GameDriver.of({ rules: { relockCooldownMs: 2500 } });
      longer.select('p1', 'A1', 0);
      longer.playerAct('p1', { type: 'release' }, 1000);
      expect(longer.reject({ type: 'select', playerId: 'p1', cell: A1 }, 3499)).toBe('cooldown');
      longer.select('p1', 'A1', 3500);

      const none = GameDriver.of({ rules: { relockCooldownMs: 0 } });
      none.select('p1', 'A1', 0);
      none.playerAct('p1', { type: 'release' }, 1000);
      expect(none.state.cooldowns).toEqual([]);
      none.select('p1', 'A1', 1000);
      expect(none.lock('p1')!.cell).toBe(A1);
    });
  });

  describe('the lock timer of a player under interference stops, and runs again after (§6.2.7) [D11]', () => {
    it('interference carries the stopped lock, and interferenceEnded the running one (spec §18 locks[])', () => {
      const g = p1HoldsA2();
      const events = g.playerAct('p2', { type: 'interfere', targetId: 'p1', kind: 'cats' }, 3000);
      expect(g.types(events)).toEqual(['interference']); // no separate pause event
      expect(events[0]).toMatchObject({ targetId: 'p1', endsAt: 8000 });
      expect(g.last('interference')!.locks).toEqual([
        { playerId: 'p1', cell: A2, expiresAt: null, remainingMs: 6000 },
      ]);
      expect(g.lock('p1')).toMatchObject({ cell: A2, expiresAt: null, remainingMs: 6000 });
      expect(g.deadline).toBe(8000); // the interference ends; the lock no longer counts down
      expect(g.tickTo(7999)).toEqual([]);

      const after = g.tickTo(8000);
      expect(g.types(after)).toEqual(['interferenceEnded']); // no separate resume event
      expect(g.last('interferenceEnded')!.locks).toEqual([
        { playerId: 'p1', cell: A2, expiresAt: 14000, remainingMs: 6000 },
      ]);
      expect(g.lock('p1')).toMatchObject({ cell: A2, expiresAt: 14000 });
      expect(g.tickTo(13999)).toEqual([]);
      expect(g.tickTo(14000)).toMatchObject([
        { type: 'cellReleased', playerId: 'p1', reason: 'timeout', t: 14000 },
      ]);
      expect(g.replayMatches()).toBe(true);
    });

    it('a lock taken under interference starts stopped and counts down once it ends', () => {
      const g = GameDriver.of();
      g.solve('p2', 'A1', 0);
      g.playerAct('p2', { type: 'interfere', targetId: 'p1', kind: 'warp' }, 1000); // until 6000
      expect(g.last('interference')!.locks).toEqual([]); // p1 held nothing to stop
      const [e] = g.select('p1', 'A2', 2000);
      expect(e).toMatchObject({ type: 'cellLocked', expiresAt: null, remainingMs: 8000 });
      expect(g.deadline).toBe(6000);
      const after = g.tickTo(6000);
      expect(g.types(after)).toEqual(['interferenceEnded']);
      expect(g.last('interferenceEnded')!.locks).toEqual([
        { playerId: 'p1', cell: A2, expiresAt: 14000, remainingMs: 8000 },
      ]);
      expect(g.tickTo(14000)).toMatchObject([{ type: 'cellReleased', reason: 'timeout', t: 14000 }]);
      expect(g.replayMatches()).toBe(true);
    });

    it('a target without a lock: both events carry no lock', () => {
      const g = GameDriver.of();
      g.solve('p2', 'A1', 0);
      g.playerAct('p2', { type: 'interfere', targetId: 'p1', kind: 'fireworks' }, 1000);
      expect(g.last('interference')!.locks).toEqual([]);
      g.tickTo(6000);
      expect(g.last('interferenceEnded')!.locks).toEqual([]);
    });

    it("only the target's lock stops: the sender's and everyone else's keep running", () => {
      const g = GameDriver.of({ players: 3 });
      g.solve('p2', 'A1', 0);
      g.select('p1', 'A2', 1000); // 9000
      g.select('p2', 'A5', 1000); // 9000
      g.select('p3', 'A6', 2000); // 10000
      g.playerAct('p2', { type: 'interfere', targetId: 'p1', kind: 'cats' }, 3000); // until 8000
      expect(g.last('interference')!.locks).toEqual([
        { playerId: 'p1', cell: A2, expiresAt: null, remainingMs: 6000 },
      ]);
      expect(g.lock('p2')).toMatchObject({ cell: A5, expiresAt: 9000 });
      expect(g.lock('p3')).toMatchObject({ cell: A6, expiresAt: 10000 });
      const out = g.tickTo(10000);
      expect(g.types(out)).toEqual(['interferenceEnded', 'cellReleased', 'cellReleased']);
      expect(out.slice(1)).toMatchObject([
        { playerId: 'p2', cell: A5, reason: 'timeout', t: 9000 },
        { playerId: 'p3', cell: A6, reason: 'timeout', t: 10000 },
      ]);
      expect(g.lock('p1')).toMatchObject({ cell: A2, expiresAt: 14000 });
    });

    it('switching cells under interference: the new lock starts stopped; cancelling leaves nothing to restart', () => {
      const g = p1HoldsA2();
      g.playerAct('p2', { type: 'interfere', targetId: 'p1', kind: 'cats' }, 3000); // until 8000
      const events = g.select('p1', 'A5', 4000);
      expect(g.types(events)).toEqual(['cellReleased', 'cellLocked']);
      expect(events[0]).toMatchObject({ cell: A2, reason: 'switch' });
      expect(events[1]).toMatchObject({ cell: A5, expiresAt: null, remainingMs: 8000 });
      g.tickTo(8000);
      expect(g.last('interferenceEnded')!.locks).toEqual([
        { playerId: 'p1', cell: A5, expiresAt: 16000, remainingMs: 8000 },
      ]);
      expect(g.replayMatches()).toBe(true);

      const h = p1HoldsA2();
      h.playerAct('p2', { type: 'interfere', targetId: 'p1', kind: 'cats' }, 3000);
      h.playerAct('p1', { type: 'release' }, 4000);
      expect(h.tickTo(8000)).toMatchObject([{ type: 'interferenceEnded', locks: [] }]);
      expect(h.replayMatches()).toBe(true);
    });

    it('the think time of a correct move leaves out the time the lock stood still', () => {
      const g = p1HoldsA2();
      g.playerAct('p2', { type: 'interfere', targetId: 'p1', kind: 'cats' }, 3000); // until 8000
      g.tickTo(8000); // runs again until 14000
      const [e] = g.place('p1', 'A2', answer('A2'), 10000);
      expect(e).toMatchObject({ type: 'placedCorrect', thinkMs: 4000 }); // 1000–3000 and 8000–10000
    });

    it('keeps the lock timer running under interference when the rule is off', () => {
      const g = p1HoldsA2({ rules: { pauseLockWhileInterfered: false } });
      const events = g.playerAct('p2', { type: 'interfere', targetId: 'p1', kind: 'cats' }, 3000);
      expect(g.types(events)).toEqual(['interference']);
      expect(g.last('interference')!.locks).toEqual([]);
      expect(g.lock('p1')!.expiresAt).toBe(9000);
      const after = g.tickTo(9000);
      expect(g.types(after)).toEqual(['interferenceEnded', 'cellReleased']);
      expect(after[0]).toMatchObject({ locks: [] });
      expect(after[1]).toMatchObject({ reason: 'timeout', t: 9000 });

      // A lock taken under interference runs at once.
      const h = GameDriver.of({ rules: { pauseLockWhileInterfered: false } });
      h.solve('p2', 'A1', 0);
      h.playerAct('p2', { type: 'interfere', targetId: 'p1', kind: 'warp' }, 1000);
      expect(h.select('p1', 'A2', 2000)).toMatchObject([{ type: 'cellLocked', expiresAt: 10000 }]);
    });
  });

  describe('a frozen game stops every lock timer and keeps the locks (§6.2.7, §16.2) [D4]', () => {
    it('gameResumed carries every running lock with its new expiry (spec §18 locks[])', () => {
      const g = GameDriver.of();
      g.select('p1', 'A1', 1000); // 9000
      g.select('p2', 'A2', 2000); // 10000
      expect(g.types(g.act({ type: 'disconnect', playerId: 'p2' }, 3000))).toEqual([
        'playerDisconnected',
        'gamePaused',
      ]);
      expect(g.state.locks).toHaveLength(2);
      expect(g.deadline).toBe(18000); // only the grace period counts
      expect(g.tickTo(11000)).toEqual([]); // past both expiries: nothing runs out

      const events = g.act({ type: 'reconnect', playerId: 'p2' }, 12000);
      expect(g.types(events)).toEqual(['playerReconnected', 'gameResumed']);
      const resumed = g.last('gameResumed')!;
      expect(resumed).toMatchObject({ reason: 'reconnect', pausedMs: 9000 });
      expect(resumed.locks).toHaveLength(2);
      expect(resumed.locks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ playerId: 'p1', cell: A1, expiresAt: 18000 }),
          expect.objectContaining({ playerId: 'p2', cell: A2, expiresAt: 19000 }),
        ]),
      );
      expect(g.lock('p1')).toMatchObject({ cell: A1, expiresAt: 18000 });
      expect(g.lock('p2')).toMatchObject({ cell: A2, expiresAt: 19000 });

      // The think time leaves out the freeze: 1000–3000 and 12000–13000.
      expect(g.place('p1', 'A1', answer('A1'), 13000)).toMatchObject([
        { type: 'placedCorrect', thinkMs: 3000 },
      ]);
      expect(g.tickTo(18999)).toEqual([]);
      expect(g.tickTo(19000)).toMatchObject([{ type: 'cellReleased', playerId: 'p2', reason: 'timeout' }]);
      expect(g.replayMatches()).toBe(true);
    });

    it('a lock stopped by an interference stays stopped through the freeze, and runs when the moved interference ends', () => {
      const g = p1HoldsA2();
      g.playerAct('p2', { type: 'interfere', targetId: 'p1', kind: 'cats' }, 3000); // until 8000; 6000 left on A2
      g.act({ type: 'disconnect', playerId: 'p2' }, 4000);
      g.act({ type: 'reconnect', playerId: 'p2' }, 6000);
      expect(g.last('gameResumed')).toMatchObject({ pausedMs: 2000, locks: [] }); // nothing was running
      expect(g.lock('p1')).toMatchObject({ expiresAt: null, remainingMs: 6000 });
      expect(g.deadline).toBe(10000); // the interference moved on by the pause
      expect(g.tickTo(10000)).toMatchObject([
        {
          type: 'interferenceEnded',
          locks: [{ playerId: 'p1', cell: A2, expiresAt: 16000, remainingMs: 6000 }],
        },
      ]);
      expect(g.tickTo(15999)).toEqual([]);
      expect(g.tickTo(16000)).toMatchObject([{ type: 'cellReleased', playerId: 'p1', reason: 'timeout' }]);
      expect(g.replayMatches()).toBe(true);
    });

    it('the view shows a stopped lock with the time it has left: under interference, and while frozen', () => {
      const g = p1HoldsA2();
      expect(g.view('p2').players[0]!.lock).toMatchObject({ cell: A2, expiresAt: 9000 });
      g.playerAct('p2', { type: 'interfere', targetId: 'p1', kind: 'cats' }, 3000);
      expect(g.view('p2').players[0]!.lock).toEqual({ cell: A2, expiresAt: null, remainingMs: 6000 });
      g.tickTo(8000);
      expect(g.view('p2').players[0]!.lock).toMatchObject({ cell: A2, expiresAt: 14000 });

      g.act({ type: 'disconnect', playerId: 'p2' }, 10000);
      expect(g.view('p1').players[0]!.lock).toEqual({ cell: A2, expiresAt: null, remainingMs: 4000 });
      g.tickTo(11000);
      expect(g.view('p1').players[0]!.lock).toEqual({ cell: A2, expiresAt: null, remainingMs: 4000 });
      g.act({ type: 'reconnect', playerId: 'p2' }, 12000);
      expect(g.view('p1').players[0]!.lock).toMatchObject({ cell: A2, expiresAt: 16000 });
    });
  });

  it('every lock is in the replay', () => {
    const g = GameDriver.of();
    g.select('p1', 'A1');
    g.select('p2', 'A2');
    g.advance(9000);
    expect(g.replayMatches()).toBe(true);
  });
});
