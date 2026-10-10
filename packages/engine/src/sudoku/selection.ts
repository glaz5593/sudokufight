import { pick, type Rng } from '../util/random';

/**
 * Choosing a puzzle without repeats (spec §20, original §32).
 *
 * - Pick a puzzle that none of the participants has played (in the current cycle, below).
 * - If there is none, pick the one forgotten the longest: the puzzle whose latest play by any participant
 *   is the oldest.
 * - When a player has played more than `resetShare` (80%) of a game type's pool, their history in that type
 *   starts over. Computed from the history itself: plays are walked in time order and the set of distinct
 *   puzzles is cleared each time it passes the threshold, so no stored flag is needed.
 */

export interface PlayRecord {
  puzzleId: string;
  playedAt: number;
}

export const DEFAULT_RESET_SHARE = 0.8;

/** The plays of one player that still count: the current cycle, limited to `pool`. */
export function currentCycle(
  history: readonly PlayRecord[],
  pool: readonly string[],
  resetShare = DEFAULT_RESET_SHARE,
): PlayRecord[] {
  const inPool = new Set(pool);
  const plays = history.filter((p) => inPool.has(p.puzzleId)).sort((a, b) => a.playedAt - b.playedAt);
  let cycle: PlayRecord[] = [];
  let distinct = new Set<string>();
  for (const p of plays) {
    cycle.push(p);
    distinct.add(p.puzzleId);
    if (distinct.size > resetShare * inPool.size) {
      cycle = [];
      distinct = new Set();
    }
  }
  return cycle;
}

export interface SelectOptions {
  rng: Rng;
  resetShare?: number;
}

/**
 * The puzzle for a game. `pool` holds the ids of the game type's puzzles; `histories` holds one list of plays
 * per participant (all game types are fine: only `pool` counts).
 */
export function selectPuzzle(
  pool: readonly string[],
  histories: readonly (readonly PlayRecord[])[],
  { rng, resetShare = DEFAULT_RESET_SHARE }: SelectOptions,
): string {
  if (!pool.length) throw new RangeError('The puzzle pool is empty');
  const played = new Set<string>();
  for (const h of histories) for (const p of currentCycle(h, pool, resetShare)) played.add(p.puzzleId);
  const fresh = pool.filter((id) => !played.has(id));
  if (fresh.length) return pick(rng, fresh);

  // Everything was played by someone: take the one whose latest play is the oldest.
  const lastPlayed = new Map<string, number>();
  for (const h of histories)
    for (const p of h)
      if (p.playedAt > (lastPlayed.get(p.puzzleId) ?? -Infinity)) lastPlayed.set(p.puzzleId, p.playedAt);
  let oldest = Infinity;
  for (const id of pool) oldest = Math.min(oldest, lastPlayed.get(id) ?? -Infinity);
  return pick(
    rng,
    pool.filter((id) => (lastPlayed.get(id) ?? -Infinity) === oldest),
  );
}
