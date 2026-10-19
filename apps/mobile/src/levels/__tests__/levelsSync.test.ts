import { type FindLevelOver, levelIdOf } from '@sudoku-fight/engine';
import type { LevelBest, MyProgress } from '@sudoku-fight/protocol';

import type { AccountFetch } from '../../api/accountApi';
import { createProgressApi } from '../../api/progressApi';
import { bodyOf, levelsServer } from '../../api/testing/fakeProgress';
import { memoryDb, type SqlJsDb } from '../../game/testing/sqlJsDb';
import { LEVELS_DATA } from '../levelsConfig';
import { type FinishedLevel, type LevelsRepo, openLevelsRepo } from '../levelsRepo';
import { LevelsSync } from '../levelsSync';

/**
 * The levels' bests to the account and back [D57] (dev-plan §2ו, §3.1): GET and merge first, then only what
 * changed; owed XP collected once a day; an old server (404) waits hours, not seconds; unknown levels wait
 * too; a refused row is found and never sent again; 429 and offline wait; signed out sends nothing. Driven
 * with the fake levels server (the real one: apps/server/test/appLevels.contract.test.ts), a manual timer and
 * a clock.
 */

const T0 = Date.UTC(2026, 9, 18, 9);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface Timer {
  ms: number;
  fire: () => void;
}

const find = (n: number): FinishedLevel => ({
  id: levelIdOf(n),
  rev: 1,
  kind: 'find',
  chapter: Math.ceil(n / 10),
  stars: { by: 'timeMs', three: 5000, two: 10000, one: 20000 },
});
const foundIn = (elapsedMs: number): FindLevelOver => ({
  reason: 'targetReached',
  elapsedMs,
  penaltyMs: 0,
  spots: 1,
  found: 0,
  stars: 0,
});

const dbs: SqlJsDb[] = [];
afterEach(() => dbs.splice(0).forEach((d) => d.close()));

async function rig({
  owner = 'uid-1' as string | null,
  initial = [] as LevelBest[],
  random = 0.5,
}: { owner?: string | null; initial?: LevelBest[]; random?: number } = {}) {
  const server = levelsServer(initial);
  const db = await memoryDb();
  dbs.push(db);
  const repo: LevelsRepo = await openLevelsRepo(db);
  const timers: Timer[] = [];
  const clock = { now: T0 };
  const who = { owner };
  /** While set, a PUT (a GET) waits for it (a request in flight). */
  const hold = { put: null as Promise<void> | null, get: null as Promise<void> | null };
  const fetch: AccountFetch = async (url, init) => {
    if (init.method === 'PUT' && hold.put) await hold.put;
    if (init.method === 'GET' && hold.get) await hold.get;
    return server.fetch(url, init);
  };
  const api = createProgressApi({
    baseUrl: 'https://game.example',
    getToken: async () => 'tok',
    fetch,
    timeoutMs: 1000,
  });
  const progress: [string, MyProgress][] = [];
  const merged: string[] = [];
  const rejected: LevelBest[][] = [];
  /** Whose API each flush asked for. */
  const apiOf: string[] = [];
  const sync = new LevelsSync({
    repo: async () => repo,
    owner: () => who.owner,
    api: (o) => {
      apiOf.push(o);
      return who.owner ? api : null;
    },
    now: () => clock.now,
    timers: {
      setTimeout: (fire, ms) => {
        const timer = { ms, fire };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (handle) => {
        const i = timers.indexOf(handle as Timer);
        if (i >= 0) timers.splice(i, 1);
      },
    },
    random: () => random,
    onProgress: (o, p) => progress.push([o, p]),
    onMerged: (o) => merged.push(o),
    onRejected: (_o, levels) => rejected.push([...levels]),
  });
  let at = T0;
  /** A finished attempt at level `n` (★★★ in 4 s, ★★ in 7 s, ★ in 15 s) for `owner`. */
  const play = (n: number, ms = 4000, o = who.owner ?? 'uid-1') => {
    at += 60_000;
    return repo.recordAttempt({
      owner: o,
      level: find(n),
      end: foundIn(ms),
      startedAt: at - ms,
      endedAt: at,
    });
  };
  const calls = () => server.fetch.calls.map((c) => c.init.method);
  const puts = () => server.fetch.calls.filter((c) => c.init.method === 'PUT').map((c) => bodyOf(c));
  const fireRetry = async () => {
    const timer = timers.shift();
    if (!timer) throw new Error('no retry scheduled');
    timer.fire();
    await settle();
  };
  return {
    server,
    repo,
    timers,
    clock,
    who,
    hold,
    sync,
    progress,
    merged,
    rejected,
    apiOf,
    play,
    calls,
    puts,
    fireRetry,
  };
}

const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
};

describe('LevelsSync', () => {
  it('LEVELS_DATA.sync off: no request at all, and the rows wait [D57]', async () => {
    const r = await rig();
    await r.play(1);
    LEVELS_DATA.sync = false;
    try {
      await expect(r.sync.flush()).resolves.toMatchObject({ status: 'disabled', sent: 0 });
    } finally {
      LEVELS_DATA.sync = true;
    }
    expect(r.server.fetch.calls).toHaveLength(0);
    expect(r.timers).toHaveLength(0);
    expect(await r.repo.dirty('uid-1')).toHaveLength(1);
    // On again: they go.
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'done', sent: 1 });
  });

  it('the first flush of a run GETs and merges: a new phone gets its levels back, then sends the rest', async () => {
    const r = await rig({ initial: [{ id: 'L001', stars: 2, plays: 5 }] });
    await r.play(1, 4000);
    await r.play(2, 7000);
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'done', sent: 2 });
    expect(r.calls()).toEqual(['GET', 'PUT']);
    expect(r.server.fetch.calls[0]!.url).toBe('https://game.example/v1/me/levels');
    // The server's plays (5) with my stars (3); L002 is mine alone.
    expect(r.puts()).toEqual([
      {
        levels: [
          { id: 'L001', stars: 3, plays: 5 },
          { id: 'L002', stars: 2, plays: 1 },
        ],
      },
    ]);
    expect((await r.repo.progress('uid-1')).L001).toMatchObject({ stars: 3, plays: 5 });
    expect(r.merged).toEqual(['uid-1']);
    // Only once a run.
    await r.play(3);
    await r.sync.flush();
    expect(r.calls()).toEqual(['GET', 'PUT', 'PUT']);
  });

  it('the dirty rows go, become synced, and the answer is my new progress', async () => {
    const r = await rig();
    await r.play(1, 4000);
    await r.play(2, 15_000);
    await expect(r.sync.flush()).resolves.toEqual({ status: 'done', sent: 2, rejected: 0, xp: 40 });
    expect(await r.repo.dirty('uid-1')).toEqual([]);
    expect(r.progress.at(-1)).toEqual(['uid-1', expect.objectContaining({ xp: 40 })]);
    expect(r.server.stored.get('L002')).toEqual({ id: 'L002', stars: 1, plays: 1 });
    // Nothing changed: nothing to send.
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'done', sent: 0 });
    expect(r.puts()).toHaveLength(1);
  });

  it('a row played while its PUT is out stays dirty for the next one', async () => {
    const r = await rig();
    await r.play(1, 15_000);
    let release!: () => void;
    r.hold.put = new Promise((resolve) => (release = resolve));
    const flushing = r.sync.flush();
    await settle();
    await r.play(1, 4000);
    r.hold.put = null;
    release();
    await flushing;
    // The first answer did not mark it (it changed since it was sent): the next PUT carries it as it is now.
    expect(r.puts()).toEqual([
      { levels: [{ id: 'L001', stars: 1, plays: 1 }] },
      { levels: [{ id: 'L001', stars: 3, plays: 2 }] },
    ]);
    expect(r.server.stored.get('L001')).toEqual({ id: 'L001', stars: 3, plays: 2 });
    expect(await r.repo.dirty('uid-1')).toEqual([]);
  });

  it('offline: keeps everything and backs off, 5 s then 10 s, then sends by itself', async () => {
    const r = await rig({ random: 0.999_999 });
    await r.play(1);
    r.server.state.mode = 'offline';
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'offline' });
    expect(r.timers.map((t) => t.ms)).toEqual([5000]);
    // While it waits, a trigger sends nothing.
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'waiting' });
    expect(r.server.fetch.calls).toHaveLength(1);
    await r.fireRetry();
    expect(r.timers.map((t) => t.ms)).toEqual([10_000]);
    r.server.state.mode = 'modern';
    await r.fireRetry();
    expect(r.server.stored.has('L001')).toBe(true);
    expect(r.timers).toHaveLength(0);
    expect(r.sync.waiting).toBe(false);
  });

  it('an old server (404 notFound): unsupported, the rows kept, no retry for 6 hours, then asked again', async () => {
    const r = await rig();
    await r.play(1);
    r.server.state.mode = 'old';
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'unsupported' });
    expect(r.timers).toHaveLength(0);
    expect(await r.repo.dirty('uid-1')).toHaveLength(1);
    // A level's end, the foreground: nothing within the 6 hours.
    r.clock.now += LEVELS_DATA.unsupportedRetryMs - 1;
    await r.play(2);
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'unsupported' });
    expect(r.server.fetch.calls).toHaveLength(1);
    // After them, the server was updated meanwhile: everything goes.
    r.server.state.mode = 'modern';
    r.clock.now += 1;
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'done', sent: 2 });
    expect(r.calls()).toEqual(['GET', 'GET', 'PUT']);
  });

  it('XP still owed (the daily cap): one empty PUT on the first flush of a new UTC day', async () => {
    const r = await rig({ initial: [{ id: 'L001', stars: 3, plays: 1 }] });
    r.server.state.capFull = true;
    await r.sync.flush();
    expect(r.sync.owedXp('uid-1')).toBe(30);
    await r.sync.flush();
    await r.sync.flush();
    // The run's first day: one try (the cap is still full), not one per flush.
    const putsToday = r.puts().length;
    expect(r.puts()).toEqual([{ levels: [] }]);

    r.clock.now += DAY;
    r.server.state.capFull = false;
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'done', sent: 0, xp: 30 });
    await r.sync.flush();
    expect(r.puts().slice(putsToday)).toEqual([{ levels: [] }]);
    expect(r.sync.owedXp('uid-1')).toBe(0);
    expect(r.progress.at(-1)?.[1].xp).toBe(30);
  });

  it('levels the server does not know (a newer app): unsupported, kept dirty, and sent again later', async () => {
    const r = await rig();
    r.server.state.maxLevel = 10;
    await r.play(1);
    await r.play(11);
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'unsupported', sent: 1 });
    expect(await r.repo.dirty('uid-1')).toEqual([{ id: 'L011', stars: 3, plays: 1 }]);
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'unsupported', sent: 0 });
    expect(r.puts()).toHaveLength(1);
    // A newer server, hours later.
    r.server.state.maxLevel = 300;
    r.clock.now += LEVELS_DATA.unsupportedRetryMs;
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'done', sent: 1 });
    expect(r.puts().at(-1)).toEqual({ levels: [{ id: 'L011', stars: 3, plays: 1 }] });
  });

  it('a malformed batch is split until the row at fault, which is reported and never sent again', async () => {
    const r = await rig();
    for (const n of [1, 2, 3]) await r.play(n);
    r.server.state.refuse.add('L002');
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'done', sent: 2, rejected: 1 });
    expect(r.puts().map((p) => (p as { levels: LevelBest[] }).levels.map((l) => l.id))).toEqual([
      ['L001', 'L002', 'L003'],
      ['L001', 'L002'],
      ['L001'],
      ['L002'],
      ['L003'],
    ]);
    expect(r.rejected).toEqual([[{ id: 'L002', stars: 3, plays: 1 }]]);
    expect([...r.server.stored.keys()]).toEqual(['L001', 'L003']);
    await r.sync.flush();
    expect(r.puts()).toHaveLength(5);
  });

  it('a row the server took but did not keep is not sent again in the same flush (no loop)', async () => {
    const r = await rig();
    await r.play(1);
    await r.play(2);
    r.server.state.drop.add('L002');
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'done', sent: 2 });
    expect(r.puts()).toHaveLength(1);
    expect(r.timers).toHaveLength(0);
    // Still dirty (the server lacks it): the next trigger tries it again, once.
    expect(await r.repo.dirty('uid-1')).toEqual([{ id: 'L002', stars: 3, plays: 1 }]);
    r.server.state.drop.clear();
    await r.sync.flush();
    expect(r.puts().at(-1)).toEqual({ levels: [{ id: 'L002', stars: 3, plays: 1 }] });
    expect(await r.repo.dirty('uid-1')).toEqual([]);
  });

  it('429: waits the server’s Retry-After', async () => {
    const r = await rig();
    await r.play(1);
    r.server.state.status = 429;
    r.server.state.retryAfter = '42';
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'offline' });
    expect(r.timers.map((t) => t.ms)).toEqual([42_000]);
    expect(await r.repo.dirty('uid-1')).toHaveLength(1);
  });

  it('signed out, or no account: sends nothing and keeps the rows', async () => {
    const r = await rig({ owner: null });
    await r.play(1, 4000, 'uid-1');
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'signedOut' });
    expect(r.server.fetch.calls).toHaveLength(0);

    r.who.owner = 'uid-1';
    r.server.state.status = 404;
    r.server.state.error = 'notRegistered';
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'signedOut' });
    expect(r.timers).toHaveLength(0);
    expect(await r.repo.dirty('uid-1')).toHaveLength(1);
  });

  it('another player signs in during the GET (a shared phone): its answer is not used, no PUT goes', async () => {
    const r = await rig({ initial: [{ id: 'L007', stars: 3, plays: 2 }] });
    await r.play(1);
    let release!: () => void;
    r.hold.get = new Promise((resolve) => (release = resolve));
    const flushing = r.sync.flush();
    await settle();
    r.who.owner = 'uid-2';
    r.hold.get = null;
    release();
    await expect(flushing).resolves.toMatchObject({ status: 'signedOut', sent: 0, xp: 0 });
    // The flush was the first player's: their API, and nothing sent after the switch.
    expect(r.apiOf).toEqual(['uid-1']);
    expect(r.calls()).toEqual(['GET']);
    // Nothing of the answer landed in the first player's rows; their own row still waits for them.
    expect((await r.repo.progress('uid-1')).L007).toBeUndefined();
    expect(await r.repo.dirty('uid-1')).toHaveLength(1);
    expect(r.merged).toEqual([]);
    expect(r.progress).toEqual([]);
    // The next flush is the new player's, with their API and their own GET.
    await r.sync.flush();
    expect(r.apiOf).toEqual(['uid-1', 'uid-2']);
    expect(r.calls().slice(0, 2)).toEqual(['GET', 'GET']);
    // The first player's row never went with the new player's flush.
    expect(JSON.stringify(r.puts())).not.toContain('L001');
  });

  it('another player signs in during the PUT: its answer is not used; the rows wait for their player', async () => {
    const r = await rig();
    await r.play(1);
    let release!: () => void;
    r.hold.put = new Promise((resolve) => (release = resolve));
    const flushing = r.sync.flush();
    await settle();
    r.who.owner = 'uid-2';
    r.hold.put = null;
    release();
    await expect(flushing).resolves.toMatchObject({ status: 'signedOut', sent: 0 });
    expect(r.calls()).toEqual(['GET', 'PUT']);
    expect(await r.repo.dirty('uid-1')).toHaveLength(1);
    expect(r.progress).toEqual([]);
    // Back, the first player's flush sends it again (the server keeps the max: nothing changes there).
    r.who.owner = 'uid-1';
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'done', sent: 1 });
    expect(await r.repo.dirty('uid-1')).toEqual([]);
  });

  it('another player signed in: the last one’s backoff is not theirs, and each gets their own GET', async () => {
    const r = await rig();
    await r.play(1);
    r.server.state.mode = 'offline';
    await r.sync.flush();
    expect(r.sync.waiting).toBe(true);
    r.server.state.mode = 'modern';
    r.who.owner = 'uid-2';
    await r.play(5, 7000, 'uid-2');
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'done', sent: 1 });
    expect(r.sync.waiting).toBe(false);
    expect(r.puts()).toEqual([{ levels: [{ id: 'L005', stars: 2, plays: 1 }] }]);
    expect(r.calls()).toEqual(['GET', 'GET', 'PUT']);
  });
});
