import type { MyProgress, PlayerCard } from '@sudoku-fight/protocol';
import Storage from 'expo-sqlite/kv-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { readMyProgress, readPlayerCard } from '../api/progressGuards';

/**
 * My progress as the app keeps it (spec §11.3, §15; work plan stage 12): XP, level and league
 * (GET /v1/me/progress, or the answer to the practice results), and my own player card (GET /v1/players/:id:
 * the ratings with their trends, the stats Home shows). Saved in the phone's key-value store with the account
 * it belongs to (the Firebase uid), so Home, the progress tab and my card open offline on the last numbers
 * (spec §16), and another account never sees them.
 *
 * `pending`: practice results still waiting for the server [D41], for the "waiting to sync" note.
 */

export type ProgressStatus = 'idle' | 'loading' | 'ok' | 'offline' | 'error';

export interface ProgressState {
  /** The Firebase uid these numbers belong to; null when there are none. */
  owner: string | null;
  progress: MyProgress | null;
  card: PlayerCard | null;
  /** When the server last sent them (epoch ms). */
  updatedAt: number | null;
  /** The last refresh: still loading, done, or failed (offline: the numbers are the saved ones). */
  status: ProgressStatus;
  /** Practice results of `owner` not sent yet. */
  pending: number;
}

type Saved = Pick<ProgressState, 'owner' | 'progress' | 'card' | 'updatedAt'>;

const EMPTY: ProgressState = {
  owner: null,
  progress: null,
  card: null,
  updatedAt: null,
  status: 'idle',
  pending: 0,
};

/** What came back from storage, each part checked (an old or broken save is dropped). */
function sanitize(saved: unknown): Partial<Saved> {
  if (typeof saved !== 'object' || saved === null) return {};
  const s = saved as Record<string, unknown>;
  if (typeof s.owner !== 'string' || s.owner === '') return {};
  return {
    owner: s.owner,
    progress: s.progress === null ? null : readMyProgress(s.progress),
    card: s.card === null ? null : readPlayerCard(s.card),
    updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : null,
  };
}

export const useProgress = create<ProgressState>()(
  persist(() => ({ ...EMPTY }), {
    name: 'progress',
    version: 1,
    storage: createJSONStorage(() => Storage),
    partialize: ({ owner, progress, card, updatedAt }): Saved => ({ owner, progress, card, updatedAt }),
    merge: (saved, current) => ({ ...current, ...sanitize(saved) }),
  }),
);

/** The store for `owner`: a different owner starts from nothing. */
function ownedBy(owner: string): Partial<ProgressState> {
  const s = useProgress.getState();
  return s.owner === owner ? {} : { ...EMPTY, owner };
}

/** New progress from the server (GET /v1/me/progress, or the practice results' answer). */
export function adoptProgress(owner: string, progress: MyProgress, now: number): void {
  useProgress.setState({ ...ownedBy(owner), owner, progress, updatedAt: now, status: 'ok' });
}

/** My card from the server. */
export function adoptCard(owner: string, card: PlayerCard, now: number): void {
  useProgress.setState({ ...ownedBy(owner), owner, card, updatedAt: now });
}

export function setProgressStatus(owner: string, status: ProgressStatus): void {
  useProgress.setState({ ...ownedBy(owner), owner, status });
}

export function setPending(owner: string, pending: number): void {
  useProgress.setState({ ...ownedBy(owner), owner, pending });
}

/** Sign-out, or another account: nothing of the last one stays. */
export function forgetProgress(): void {
  useProgress.setState({ ...EMPTY });
}

/** The saved numbers when they are `owner`'s, else none. */
export function progressOf(state: ProgressState, owner: string | null): MyProgress | null {
  return owner !== null && state.owner === owner ? state.progress : null;
}

export function cardOf(state: ProgressState, owner: string | null): PlayerCard | null {
  return owner !== null && state.owner === owner ? state.card : null;
}
