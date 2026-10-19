import { create } from 'zustand';

import { useAuth } from '../auth/authStore';
import { useOwner } from '../progress/hooks';
import type { LevelsProgress, LevelsRepo, LevelsSummary } from './levelsRepo';
import { openLevelsStorage } from './levelsStorage';

/**
 * Staged practice's progress for the screens (1.0.2): the "משחק חדש" row and my card ("שלבים: 87 · ★ 214"),
 * and each level's best for the map. Read from levels.db only, never from the levels' data file (Home must not
 * load it: startupGraph.test.ts), and not persisted: levels.db is already on the phone. The numbers belong to
 * one owner (the Firebase uid); another account starts from nothing.
 */

export type LevelsStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface LevelsState {
  /** The Firebase uid these numbers belong to; null when there are none. */
  owner: string | null;
  summary: LevelsSummary | null;
  /** Each level's best, by id (the engine's LevelRecords). */
  progress: LevelsProgress;
  /** The chapters a gate opened once, for isLevelOpen. */
  openedChapters: number[];
  status: LevelsStatus;
}

const EMPTY: LevelsState = {
  owner: null,
  summary: null,
  progress: {},
  openedChapters: [],
  status: 'idle',
};

export const useLevels = create<LevelsState>()(() => ({ ...EMPTY }));

/** The signed-in player with an account (as currentOwner in progress/appProgress.ts), or null. */
function signedInOwner(): string | null {
  const { status, user } = useAuth.getState();
  return status === 'ready' && user ? user.uid : null;
}

/** Bumped by every forget: a read that started before it is not taken. */
let generation = 0;
/** Reads, numbered as they start; the newest one whose answer was taken. */
let reads = 0;
let taken = 0;

/** Another account, or signed out: nothing of the last one stays. */
export function forgetLevels(): void {
  generation++;
  useLevels.setState({ ...EMPTY });
}

export interface RefreshLevelsOptions {
  /** Whose numbers; the signed-in player by default. */
  owner?: string | null;
  /** levels.db; the phone's by default. */
  repo?: () => Promise<LevelsRepo>;
}

/**
 * Reads the numbers again (a level's end, the map's focus, a sync that merged the server's levels). Resolves
 * when done; never throws. An answer older than one already taken, or from before a forget, is dropped.
 */
export async function refreshLevels({
  owner = signedInOwner(),
  repo = openLevelsStorage,
}: RefreshLevelsOptions = {}): Promise<void> {
  if (!owner) {
    if (useLevels.getState().owner !== null) forgetLevels();
    return;
  }
  if (useLevels.getState().owner !== owner) forgetLevels();
  const read = ++reads;
  const at = generation;
  useLevels.setState({ owner, status: 'loading' });
  try {
    const db = await repo();
    const [summary, progress, openedChapters] = await Promise.all([
      db.summary(owner),
      db.progress(owner),
      db.openedGates(owner),
    ]);
    if (at !== generation || read <= taken) return;
    taken = read;
    useLevels.setState({ owner, summary, progress, openedChapters, status: 'ready' });
  } catch (error) {
    if (__DEV__) console.log('[levels] could not read the progress', error);
    if (at === generation && read > taken) useLevels.setState({ status: 'unavailable' });
  }
}

/** The summary when it is `owner`'s, else none. */
export function levelsSummaryOf(state: LevelsState, owner: string | null): LevelsSummary | null {
  return owner !== null && state.owner === owner ? state.summary : null;
}

/** "שלבים: 87 · ★ 214": the signed-in player's summary, once read (refreshLevels). */
export function useLevelsSummary(): LevelsSummary | null {
  const owner = useOwner();
  return useLevels((s) => levelsSummaryOf(s, owner));
}

/** The signed-in player's bests by level, once read; null before. */
export function useLevelsProgress(): LevelsProgress | null {
  const owner = useOwner();
  return useLevels((s) => (owner !== null && s.owner === owner && s.summary !== null ? s.progress : null));
}

const NONE: readonly number[] = [];

/** The chapters the signed-in player's gates opened once. */
export function useOpenedChapters(): readonly number[] {
  const owner = useOwner();
  return useLevels((s) => (owner !== null && s.owner === owner ? s.openedChapters : NONE));
}
