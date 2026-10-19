import { MAX_PRACTICE_RESULTS, type MyProgress } from '@sudoku-fight/protocol';

import { createProgressApi, type ProgressApi } from '../../api/progressApi';
import { bodyOf, myProgress, practiceServer } from '../../api/testing/fakeProgress';
import { memoryStorage } from '../../auth/testing/testAuth';
import { createPracticeQueue, type PracticeQueue } from '../practiceQueue';
import { FOLLOW_UP_MS, PracticeSync } from '../practiceSync';
import { practiceResult as result } from '../testing/results';

/**
 * Practice XP sync [D41] (spec §15): the queue goes to POST /v1/me/practice-results when someone is signed in
 * and the server answers; offline it stays, with a backoff; a resend is a duplicate on the server, never
 * twice. Driven with a fake fetch, a manual timer and fixed jitter.
 */

interface Timer {
  ms: number;
  fire: () => void;
}

function rig({
  owner = 'uid-1' as string | null,
  batches,
}: { owner?: string | null; batches?: number } = {}) {
  const server = practiceServer(() => myProgress({ xp: 100 + server.taken.size }));
  const queue: PracticeQueue = createPracticeQueue(memoryStorage());
  const timers: Timer[] = [];
  const progress: [string, MyProgress][] = [];
  const pending: [string, number][] = [];
  const who = { owner };
  const api: ProgressApi = createProgressApi({
    baseUrl: 'https://game.example',
    getToken: async () => 'tok',
    fetch: server.fetch,
    timeoutMs: 1000,
  });
  /** Whose API each flush asked for. */
  const apiOf: string[] = [];
  const sync = new PracticeSync({
    queue,
    owner: () => who.owner,
    api: (o) => {
      apiOf.push(o);
      return who.owner ? api : null;
    },
    onProgress: (o, p) => progress.push([o, p]),
    onPending: (o, n) => pending.push([o, n]),
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
    random: () => 0.5,
    maxBatchesPerFlush: batches,
  });
  /** Fires the scheduled retry and waits for its flush. */
  const fireRetry = async () => {
    const timer = timers.shift();
    if (!timer) throw new Error('no retry scheduled');
    timer.fire();
    await settle();
  };
  return { server, queue, timers, progress, pending, who, sync, apiOf, fireRetry };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

const sentIds = (r: ReturnType<typeof rig>) =>
  r.server.fetch.calls.map((c) => (bodyOf(c) as { results: { id: string }[] }).results.map((x) => x.id));

describe('PracticeSync', () => {
  it('a finished practice is queued and sent; the answer is the new progress', async () => {
    const r = rig();
    await expect(r.sync.enqueue(result('practice-1'))).resolves.toBe(true);
    await settle();
    expect(sentIds(r)).toEqual([['practice-1']]);
    expect(r.server.fetch.calls[0]!.url).toBe('https://game.example/v1/me/practice-results');
    expect(r.progress).toEqual([['uid-1', myProgress({ xp: 101 })]]);
    await expect(r.queue.size('uid-1')).resolves.toBe(0);
    expect(r.pending.at(-1)).toEqual(['uid-1', 0]);
    // The API of the flush's player (bound to their token: never another account's mid-flush).
    expect(r.apiOf).toEqual(['uid-1']);
  });

  it('dedupes: the same game queued twice goes once, and a resend counts once on the server', async () => {
    const r = rig();
    r.server.state.offline = true;
    await r.sync.enqueue(result('a'));
    await expect(r.sync.enqueue(result('a'))).resolves.toBe(false);
    await settle();
    await expect(r.queue.size('uid-1')).resolves.toBe(1);
    r.server.state.offline = false;
    await r.fireRetry();
    expect(r.server.taken).toEqual(new Set(['a']));
    // The answer was lost after the server took it (the app died): the result goes again, as a duplicate.
    await r.queue.add('uid-1', result('a'));
    await r.sync.flush();
    expect(r.server.taken.size).toBe(1);
    await expect(r.queue.size('uid-1')).resolves.toBe(0);
  });

  it('offline: keeps everything and backs off (5 s, 10 s, …), then sends by itself', async () => {
    const r = rig();
    r.server.state.offline = true;
    await r.sync.enqueue(result('a'));
    await settle();
    expect(r.timers.map((t) => t.ms)).toEqual([3750]);
    expect(r.sync.waiting).toBe(true);
    // While it waits, a trigger sends nothing.
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'waiting', pending: 1 });
    expect(r.server.fetch.calls).toHaveLength(1);

    await r.fireRetry();
    expect(r.timers.map((t) => t.ms)).toEqual([7500]);
    r.server.state.offline = false;
    await r.fireRetry();
    expect(r.server.taken).toEqual(new Set(['a']));
    expect(r.timers).toHaveLength(0);
    expect(r.sync.waiting).toBe(false);
  });

  it('429: waits the server’s Retry-After', async () => {
    const r = rig();
    r.server.state.status = 429;
    r.server.state.retryAfter = '42';
    await r.sync.enqueue(result('a'));
    await settle();
    expect(r.timers.map((t) => t.ms)).toEqual([42_000]);
    await expect(r.queue.size('uid-1')).resolves.toBe(1);
  });

  it('a server error keeps the results too', async () => {
    const r = rig();
    r.server.state.status = 500;
    await r.sync.enqueue(result('a'));
    await settle();
    await expect(r.queue.size('uid-1')).resolves.toBe(1);
    expect(r.timers).toHaveLength(1);
  });

  it('a malformed batch is sent one by one: only the result at fault is dropped', async () => {
    const r = rig();
    r.server.state.offline = true;
    for (const id of ['a', 'bad', 'c']) await r.sync.enqueue(result(id));
    await settle();
    r.server.state.offline = false;
    r.server.state.refuse = 'bad';
    await r.fireRetry();
    expect(r.server.taken).toEqual(new Set(['a', 'c']));
    await expect(r.queue.size('uid-1')).resolves.toBe(0);
    expect(sentIds(r).slice(-4)).toEqual([['a', 'bad', 'c'], ['a'], ['bad'], ['c']]);
  });

  it(`sends ${MAX_PRACTICE_RESULTS} at a time, oldest first; more than a flush's worth goes on after a pause`, async () => {
    const r = rig({ batches: 1 });
    r.server.state.offline = true;
    for (let i = 0; i < MAX_PRACTICE_RESULTS + 3; i++) await r.queue.add('uid-1', result(`p${i}`));
    r.server.state.offline = false;
    await expect(r.sync.flush()).resolves.toMatchObject({
      status: 'more',
      sent: MAX_PRACTICE_RESULTS,
      pending: 3,
    });
    expect(sentIds(r)[0]).toHaveLength(MAX_PRACTICE_RESULTS);
    expect(sentIds(r)[0]![0]).toBe('p0');
    expect(r.timers.map((t) => t.ms)).toEqual([FOLLOW_UP_MS]);
    await r.fireRetry();
    expect(r.server.taken.size).toBe(MAX_PRACTICE_RESULTS + 3);
  });

  it('signed out: nothing is queued and nothing is sent', async () => {
    const r = rig({ owner: null });
    await expect(r.sync.enqueue(result('a'))).resolves.toBe(false);
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'signedOut' });
    await expect(r.queue.size()).resolves.toBe(0);
    expect(r.server.fetch.calls).toHaveLength(0);
  });

  it('each account sends its own; another sign-in starts without the last one’s backoff', async () => {
    const r = rig();
    r.server.state.offline = true;
    await r.sync.enqueue(result('mine'));
    await settle();
    expect(r.sync.waiting).toBe(true);
    r.server.state.offline = false;
    r.who.owner = 'uid-2';
    await r.queue.add('uid-2', result('theirs'));
    await expect(r.sync.flush()).resolves.toMatchObject({ status: 'done', sent: 1 });
    expect(r.server.taken).toEqual(new Set(['theirs']));
    await expect(r.queue.size('uid-1')).resolves.toBe(1);
  });

  it('a result added while a flush runs goes in the same run or right after it', async () => {
    const r = rig();
    const first = r.sync.enqueue(result('a'));
    const second = r.sync.enqueue(result('b'));
    await Promise.all([first, second]);
    await settle();
    expect(r.server.taken).toEqual(new Set(['a', 'b']));
  });
});
