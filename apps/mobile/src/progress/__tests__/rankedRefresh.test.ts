import { ManualClock, ManualScheduler } from '@sudoku-fight/engine';
import type { Me, RatingEntry } from '@sudoku-fight/protocol';

import type { RankedEnd } from '../../game/rankedEnd';
import { RankedRefresh, REMEMBERED_ENDS } from '../rankedRefresh';

/**
 * After a ranked game (Moshe's device test of 1.0.0: the rating followed only after a restart): the game's own
 * rating at once, then GET /v1/me on a backoff until the server counts the game, then my progress and card once.
 * Timers on a manual scheduler, the server as a Me the test moves on.
 */

const CONFIRM = [1500, 3000, 6000, 12_000, 24_000];
const UNRATED = [1500, 6000];

const entry = (games: number, rating = 1200): RatingEntry => ({
  key: 'fast',
  rating,
  games,
  provisional: games < 10,
  peak: rating,
});

function rig() {
  const clock = new ManualClock(1_000_000);
  const scheduler = new ManualScheduler(clock);
  const server = { me: meWith(entry(4)) as Me | null };
  const reads: number[] = [];
  const progress: number[] = [];
  const shown: RankedEnd[] = [];
  const refresh = new RankedRefresh({
    fetchMe: async () => {
      reads.push(clock.now());
      return server.me;
    },
    refreshProgress: async () => {
      progress.push(clock.now());
    },
    showResult: (end) => shown.push(end),
    timers: scheduler,
    confirmDelaysMs: CONFIRM,
    unratedDelaysMs: UNRATED,
  });
  const start = clock.now();
  /** Moves time on `ms` at a time, letting each read finish before the next timer. */
  const pass = async (ms: number, step = 100) => {
    for (let done = 0; done < ms; done += step) {
      scheduler.advance(Math.min(step, ms - done));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    }
  };
  /** Times since the start, in ms. */
  const at = (times: number[]) => times.map((t) => t - start);
  return { clock, scheduler, server, reads, progress, shown, refresh, pass, at };
}

function meWith(...ratings: RatingEntry[]): Me {
  return {
    id: 'user-1',
    displayName: 'Moshe',
    avatarId: 'sun',
    country: 'IL',
    email: null,
    emailVerified: true,
    createdAt: 1,
    displayNameChangedAt: null,
    nextRenameAt: null,
    ratings,
  };
}

const END: RankedEnd = {
  gameId: 'game-1',
  playerId: 'user-1',
  key: 'fast',
  gamesBefore: 4,
  provisionalGames: 10,
  change: { playerId: 'user-1', before: 1200, after: 1232, delta: 32, provisional: true },
  expectsStored: true,
  left: false,
  waitMs: 0,
};

describe('RankedRefresh', () => {
  it('shows the result at once, reads until the server counts the game, then the progress once', async () => {
    const r = rig();
    r.refresh.gameEnded(END);
    expect(r.shown).toEqual([END]);
    expect(r.reads).toEqual([]);
    await r.pass(1500);
    expect(r.at(r.reads)).toEqual([1500]);
    expect(r.progress).toEqual([]);
    // Not stored yet: the next read after 3 s more.
    await r.pass(2900);
    expect(r.reads).toHaveLength(1);
    r.server.me = meWith(entry(5, 1232));
    await r.pass(100);
    expect(r.at(r.reads)).toEqual([1500, 4500]);
    expect(r.at(r.progress)).toEqual([4500]);
    expect(r.refresh.following).toBeNull();
    // Done: no more reads.
    await r.pass(60_000, 1000);
    expect(r.reads).toHaveLength(2);
    expect(r.progress).toHaveLength(1);
    expect(r.scheduler.pending).toBe(0);
  });

  it('never stored: one read per delay, then the progress once (the shown rating lapses by its TTL)', async () => {
    const r = rig();
    r.refresh.gameEnded(END);
    await r.pass(60_000, 500);
    expect(r.at(r.reads)).toEqual([1500, 4500, 10_500, 22_500, 46_500]);
    expect(r.at(r.progress)).toEqual([46_500]);
    expect(r.scheduler.pending).toBe(0);
  });

  it('offline (no answer) keeps the schedule', async () => {
    const r = rig();
    r.server.me = null;
    r.refresh.gameEnded(END);
    await r.pass(5000);
    expect(r.at(r.reads)).toEqual([1500, 4500]);
    r.server.me = meWith(entry(5, 1232));
    await r.pass(6000);
    expect(r.at(r.reads)).toEqual([1500, 4500, 10_500]);
    expect(r.at(r.progress)).toEqual([10_500]);
  });

  it('a read that throws is a read without an answer', async () => {
    const clock = new ManualClock(0);
    const scheduler = new ManualScheduler(clock);
    let calls = 0;
    const refresh = new RankedRefresh({
      fetchMe: async () => {
        calls++;
        throw new Error('boom');
      },
      refreshProgress: async () => undefined,
      showResult: () => undefined,
      timers: scheduler,
      confirmDelaysMs: [10, 10],
      unratedDelaysMs: [],
    });
    refresh.gameEnded(END);
    for (let i = 0; i < 5; i++) {
      scheduler.advance(10);
      for (let k = 0; k < 5; k++) await Promise.resolve();
    }
    expect(calls).toBe(2);
    expect(refresh.following).toBeNull();
  });

  it('the same game ends once; a newer game replaces the wait for the older one', async () => {
    const r = rig();
    r.refresh.gameEnded(END);
    r.refresh.gameEnded(END);
    expect(r.shown).toHaveLength(1);
    await r.pass(1500);
    expect(r.reads).toHaveLength(1);

    const next: RankedEnd = { ...END, gameId: 'game-2', gamesBefore: 4 };
    r.refresh.gameEnded(next);
    expect(r.refresh.following).toBe(next);
    expect(r.shown).toEqual([END, next]);
    // The older game's next read (at 4.5 s) never comes; the newer one reads 1.5 s after its end.
    r.server.me = meWith(entry(5, 1232));
    await r.pass(1500);
    expect(r.at(r.reads)).toEqual([1500, 3000]);
    expect(r.at(r.progress)).toEqual([3000]);
    // The first game's end again (a late report): already seen.
    r.refresh.gameEnded(END);
    expect(r.refresh.following).toBeNull();
    expect(r.scheduler.pending).toBe(0);
  });

  it('a game left while it ran: the first read after the grace; its end, if the player came back, replaces it', async () => {
    const r = rig();
    const left: RankedEnd = { ...END, change: null, left: true, waitMs: 17_000 };
    r.refresh.gameEnded(left);
    expect(r.shown).toEqual([]);
    await r.pass(18_000, 500);
    expect(r.reads).toEqual([]);
    await r.pass(500, 500);
    expect(r.at(r.reads)).toEqual([18_500]);

    // Back in time, and the game ended normally: its end is followed instead.
    r.refresh.gameEnded(END);
    expect(r.refresh.following).toBe(END);
    expect(r.shown).toEqual([END]);
    r.server.me = meWith(entry(5, 1232));
    await r.pass(1500);
    expect(r.at(r.progress)).toEqual([20_000]);
    // Leaving it after its end says nothing new.
    r.refresh.gameEnded(left);
    expect(r.refresh.following).toBeNull();
  });

  it('a ranked game that moved no rating of mine: no result to show, the account and progress at each wait', async () => {
    const r = rig();
    r.refresh.gameEnded({ ...END, change: null, expectsStored: false });
    expect(r.shown).toEqual([]);
    await r.pass(10_000, 500);
    expect(r.at(r.reads)).toEqual([1500, 7500]);
    expect(r.at(r.progress)).toEqual([1500, 7500]);
    expect(r.refresh.following).toBeNull();
    expect(r.scheduler.pending).toBe(0);
  });

  it('stop() cancels the wait (sign-out, another account) and forgets the ends seen', async () => {
    const r = rig();
    r.refresh.gameEnded(END);
    r.refresh.stop();
    expect(r.scheduler.pending).toBe(0);
    await r.pass(60_000, 1000);
    expect(r.reads).toEqual([]);
    // A read that was out when it stopped is let go.
    r.refresh.gameEnded(END);
    expect(r.shown).toHaveLength(2);
    await r.pass(1400);
    r.scheduler.advance(100);
    r.refresh.stop();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(r.reads).toHaveLength(1);
    expect(r.progress).toEqual([]);
  });

  it(`remembers the last ${REMEMBERED_ENDS} ends`, () => {
    const r = rig();
    for (let k = 0; k <= REMEMBERED_ENDS; k++) r.refresh.gameEnded({ ...END, gameId: `g${k}`, change: null });
    r.refresh.gameEnded({ ...END, gameId: `g${REMEMBERED_ENDS}` });
    expect(r.shown).toEqual([]);
    // The oldest is forgotten: its end would be followed again.
    r.refresh.gameEnded({ ...END, gameId: 'g0' });
    expect(r.shown).toHaveLength(1);
  });

  it('a showResult that throws stops nothing', async () => {
    const clock = new ManualClock(0);
    const scheduler = new ManualScheduler(clock);
    const logs: string[] = [];
    const refresh = new RankedRefresh({
      fetchMe: async () => meWith(entry(5)),
      refreshProgress: async () => undefined,
      showResult: () => {
        throw new Error('no store');
      },
      timers: scheduler,
      confirmDelaysMs: [10],
      unratedDelaysMs: [],
      log: (m) => logs.push(m),
    });
    refresh.gameEnded(END);
    scheduler.advance(10);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(refresh.following).toBeNull();
    expect(logs[0]).toMatch(/could not show the result/);
    expect(logs[1]).toMatch(/stored in fast/);
  });
});
