import { isGameType } from '@sudoku-fight/engine';
import type { PracticeOutcome, PracticeResult } from '@sudoku-fight/protocol';

import type { KeyValueStore } from '../auth/types';

/**
 * Practice XP waiting for the server [D41] (spec §15: "כשאין חיבור, ה־XP נשמר בתור במכשיר ונשלח לשרת כשהשחקן
 * מחובר"): one PracticeResult per finished practice, kept in the phone's key-value store so it survives a
 * restart, until the server has taken it. Each result belongs to the account that played it (its Firebase
 * uid), so a phone that changes hands never credits one player with another's practice.
 *
 * - Dedupe: a result's id is the practice game's id; adding it twice keeps one.
 * - Order: oldest first, so the server sees the games as they were played.
 * - Size: at most `maxSize` results; past it the oldest go (a phone offline for months loses its oldest XP,
 *   never the app's memory).
 *
 * Every call runs after the previous one (one chain), so reads see every write before them.
 */

export const PRACTICE_QUEUE_KEY = 'progress.practiceQueue';
export const PRACTICE_QUEUE_MAX = 1000;

export interface QueuedResult {
  /** The Firebase uid of the player who played it. */
  owner: string;
  result: PracticeResult;
}

export interface PracticeQueue {
  /** Adds a finished practice; false when a result with its id is already queued. */
  add(owner: string, result: PracticeResult): Promise<boolean>;
  /** The oldest `limit` results of `owner`. */
  pending(owner: string, limit: number): Promise<PracticeResult[]>;
  /** Removes `owner`'s results with these ids (the server took them, or refused them for good). */
  remove(owner: string, ids: readonly string[]): Promise<void>;
  /** How many results wait; for one owner when given. */
  size(owner?: string): Promise<number>;
}

const OUTCOMES: readonly PracticeOutcome[] = ['win', 'loss', 'tie', 'completed', 'ended'];
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isPracticeResult(v: unknown): v is PracticeResult {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    r.id !== '' &&
    (r.mode === 'solo' || r.mode === 'bot') &&
    isGameType(r.gameType) &&
    OUTCOMES.includes(r.outcome as PracticeOutcome) &&
    isNum(r.correct) &&
    r.correct >= 0 &&
    isNum(r.endedAt)
  );
}

function isQueued(v: unknown): v is QueuedResult {
  if (typeof v !== 'object' || v === null) return false;
  const q = v as Record<string, unknown>;
  return typeof q.owner === 'string' && q.owner !== '' && isPracticeResult(q.result);
}

export function createPracticeQueue(
  storage: KeyValueStore,
  { key = PRACTICE_QUEUE_KEY, maxSize = PRACTICE_QUEUE_MAX }: { key?: string; maxSize?: number } = {},
): PracticeQueue {
  let items: QueuedResult[] | null = null;
  let tail: Promise<unknown> = Promise.resolve();

  /** Runs `task` after every call before it. */
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  }

  async function load(): Promise<QueuedResult[]> {
    if (items) return items;
    try {
      const raw = await storage.getItem(key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      items = Array.isArray(parsed) ? parsed.filter(isQueued) : [];
    } catch {
      items = [];
    }
    return items;
  }

  async function save(next: QueuedResult[]): Promise<void> {
    items = next;
    await storage.setItem(key, JSON.stringify(next));
  }

  const sameResult = (owner: string, id: string) => (q: QueuedResult) =>
    q.owner === owner && q.result.id === id;

  return {
    add: (owner, result) =>
      serial(async () => {
        const all = await load();
        if (all.some(sameResult(owner, result.id))) return false;
        const next = [...all, { owner, result: { ...result } }];
        await save(next.length > maxSize ? next.slice(next.length - maxSize) : next);
        return true;
      }),
    pending: (owner, limit) =>
      serial(async () =>
        (await load())
          .filter((q) => q.owner === owner)
          .slice(0, Math.max(0, limit))
          .map((q) => q.result),
      ),
    remove: (owner, ids) =>
      serial(async () => {
        if (ids.length === 0) return;
        const gone = new Set(ids);
        const all = await load();
        const next = all.filter((q) => !(q.owner === owner && gone.has(q.result.id)));
        if (next.length !== all.length) await save(next);
      }),
    size: (owner) =>
      serial(async () => {
        const all = await load();
        return owner === undefined ? all.length : all.filter((q) => q.owner === owner).length;
      }),
  };
}
