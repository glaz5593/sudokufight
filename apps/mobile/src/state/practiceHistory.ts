import { create } from 'zustand';

import type { PracticeGameRecord, PracticeRepo } from '../game/practiceRepo';
import { practiceStorageOrNull } from '../game/storage';

/**
 * The practices saved on this phone [D25], newest first, for the home screen's recent list. Interrupted games
 * are listed too. Screens call refresh() when they come into view; the database is the source, nothing here
 * is persisted.
 */
export interface PracticeHistoryState {
  recent: PracticeGameRecord[];
  /** 'unavailable': the database could not open (the list stays empty). */
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  refresh(limit?: number): Promise<void>;
}

export const RECENT_LIMIT = 20;

export function createPracticeHistory(repo: () => Promise<PracticeRepo | null> = practiceStorageOrNull) {
  return create<PracticeHistoryState>()((set) => {
    let latest = 0;
    return {
      recent: [],
      status: 'idle',
      async refresh(limit = RECENT_LIMIT) {
        const mine = ++latest;
        set({ status: 'loading' });
        let recent: PracticeGameRecord[] | null = null;
        try {
          const r = await repo();
          recent = r ? await r.listRecent(limit) : null;
        } catch (error) {
          console.warn('[practice] could not read the saved games', error);
        }
        if (mine !== latest) return; // a newer refresh answers
        set(recent ? { recent, status: 'ready' } : { status: 'unavailable' });
      },
    };
  });
}

export const usePracticeHistory = createPracticeHistory();
