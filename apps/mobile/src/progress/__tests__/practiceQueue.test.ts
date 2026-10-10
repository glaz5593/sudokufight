import { memoryStorage } from '../../auth/testing/testAuth';
import { createPracticeQueue, isPracticeResult, PRACTICE_QUEUE_KEY } from '../practiceQueue';
import { practiceResult as result } from '../testing/results';

/** The practice XP queue on the phone [D41]: kept across restarts, one per game, per account, oldest first. */

describe('the practice queue', () => {
  it('keeps one result per game id (a second add is a duplicate)', async () => {
    const queue = createPracticeQueue(memoryStorage());
    await expect(queue.add('uid-1', result('a'))).resolves.toBe(true);
    await expect(queue.add('uid-1', result('a', { correct: 99 }))).resolves.toBe(false);
    await expect(queue.pending('uid-1', 10)).resolves.toEqual([result('a')]);
  });

  it('gives the oldest first, `limit` at a time, and removes what was sent', async () => {
    const queue = createPracticeQueue(memoryStorage());
    for (const id of ['a', 'b', 'c']) await queue.add('uid-1', result(id));
    expect((await queue.pending('uid-1', 2)).map((r) => r.id)).toEqual(['a', 'b']);
    await queue.remove('uid-1', ['a', 'b']);
    expect((await queue.pending('uid-1', 2)).map((r) => r.id)).toEqual(['c']);
    await expect(queue.size()).resolves.toBe(1);
  });

  it('keeps each account to itself', async () => {
    const queue = createPracticeQueue(memoryStorage());
    await queue.add('uid-1', result('a'));
    await queue.add('uid-2', result('a'));
    await queue.add('uid-2', result('b'));
    expect((await queue.pending('uid-1', 10)).map((r) => r.id)).toEqual(['a']);
    await queue.remove('uid-2', ['a']);
    await expect(queue.size('uid-1')).resolves.toBe(1);
    await expect(queue.size('uid-2')).resolves.toBe(1);
  });

  it('survives a restart (the key-value store), and drops what it cannot read', async () => {
    const storage = memoryStorage();
    await createPracticeQueue(storage).add('uid-1', result('a'));
    expect((await createPracticeQueue(storage).pending('uid-1', 10)).map((r) => r.id)).toEqual(['a']);

    const saved = JSON.parse(storage.data.get(PRACTICE_QUEUE_KEY)!) as unknown[];
    storage.data.set(
      PRACTICE_QUEUE_KEY,
      JSON.stringify([...saved, { owner: 'uid-1', result: { id: 'x' } }, 5]),
    );
    expect((await createPracticeQueue(storage).pending('uid-1', 10)).map((r) => r.id)).toEqual(['a']);

    storage.data.set(PRACTICE_QUEUE_KEY, '{not json');
    await expect(createPracticeQueue(storage).size()).resolves.toBe(0);
  });

  it('holds at most maxSize: the oldest go first', async () => {
    const queue = createPracticeQueue(memoryStorage(), { maxSize: 2 });
    for (const id of ['a', 'b', 'c']) await queue.add('uid-1', result(id));
    expect((await queue.pending('uid-1', 10)).map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('runs calls in order, even when they are not awaited', async () => {
    const queue = createPracticeQueue(memoryStorage());
    const adds = ['a', 'b', 'c', 'a'].map((id) => queue.add('uid-1', result(id)));
    const removed = queue.remove('uid-1', ['b']);
    await expect(Promise.all(adds)).resolves.toEqual([true, true, true, false]);
    await removed;
    expect((await queue.pending('uid-1', 10)).map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('checks a result', () => {
    expect(isPracticeResult(result('a'))).toBe(true);
    expect(isPracticeResult(result('a', { mode: 'ranked' as 'bot' }))).toBe(false);
    expect(isPracticeResult(result('a', { correct: -1 }))).toBe(false);
    expect(isPracticeResult(result('', {}))).toBe(false);
    expect(isPracticeResult(result('a', { outcome: 'draw' as 'win' }))).toBe(false);
  });
});
