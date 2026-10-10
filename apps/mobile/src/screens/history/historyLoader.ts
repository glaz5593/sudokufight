import type { GameResult } from '@sudoku-fight/engine';
import type { HistoryGame } from '@sudoku-fight/protocol';

import { supportCodeOf } from '../../components/ui/stateModel';
import type { PracticeGameRecord, PracticeRepo } from '../../game/practiceRepo';
import { HISTORY_OFFLINE_CODES, type HistoryApi, isHistoryApiError } from './historyApi';
import {
  type HistoryEntry,
  type HistoryFilter,
  mergeEntries,
  PAGE_SIZE,
  practiceEntry,
  rankedEntry,
} from './historyModel';

/**
 * The history's data (spec §14.1): ranked games from the server and practices from the phone, merged newest
 * first, 20 more at a time. Each list is read only as far as the cards on screen need: to show the first n of
 * the merge, each source must have n (or be done), since whatever a source has not read yet is older than
 * everything it has. Offline, or signed out, the practices still show, with a note (spec §16).
 */

export type RankedStatus = 'ok' | 'signedOut' | 'offline' | 'error';

export interface HistorySnapshot {
  filter: HistoryFilter;
  entries: HistoryEntry[];
  /** More cards can come ("עוד משחקים"). */
  hasMore: boolean;
  ranked: RankedStatus;
  /** Why the ranked games could not be read, for support (spec §16.3: "unavailable-503"); null when they could. */
  rankedCode: string | null;
  /** False when the practice database could not be read. */
  practiceOk: boolean;
}

export interface HistoryDeps {
  /** The practice database, or null when it can't open. */
  practice: () => Promise<PracticeRepo | null>;
  /** The server's history; null when nobody is signed in. */
  ranked: HistoryApi | null;
}

export class HistoryLoader {
  private rankedGames: HistoryGame[] = [];
  private cursor: string | null = null;
  private rankedDone: boolean;
  private rankedStatus: RankedStatus;
  private rankedCode: string | null = null;

  private practice: PracticeGameRecord[] = [];
  private practiceDone = false;
  private practiceOk = true;
  /** The saved results of finished games against a bot (the bot's score on the card), by game id. */
  private results = new Map<string, GameResult | null>();

  private filter: HistoryFilter = 'all';
  private count = PAGE_SIZE;

  constructor(private readonly deps: HistoryDeps) {
    this.rankedDone = deps.ranked === null;
    this.rankedStatus = deps.ranked === null ? 'signedOut' : 'ok';
  }

  /** The first page of a filter. */
  async show(filter: HistoryFilter): Promise<HistorySnapshot> {
    this.filter = filter;
    this.count = PAGE_SIZE;
    await this.fill();
    return this.snapshot();
  }

  /** 20 more cards. */
  async more(): Promise<HistorySnapshot> {
    this.count += PAGE_SIZE;
    await this.fill();
    return this.snapshot();
  }

  /** Starts over: reads both sources again (after "try again", or a game just played). */
  async reload(): Promise<HistorySnapshot> {
    this.rankedGames = [];
    this.cursor = null;
    this.rankedDone = this.deps.ranked === null;
    this.rankedStatus = this.deps.ranked === null ? 'signedOut' : 'ok';
    this.rankedCode = null;
    this.practice = [];
    this.practiceDone = false;
    this.practiceOk = true;
    return this.show(this.filter);
  }

  private async fill(): Promise<void> {
    const wantRanked = this.filter !== 'practice';
    const wantPractice = this.filter !== 'ranked';
    await Promise.all([wantRanked ? this.fillRanked() : null, wantPractice ? this.fillPractice() : null]);
  }

  private async fillRanked(): Promise<void> {
    const api = this.deps.ranked;
    while (api && !this.rankedDone && this.rankedGames.length < this.count) {
      try {
        const page = await api.myGames(this.cursor);
        this.rankedGames.push(...page.games);
        this.cursor = page.nextCursor;
        this.rankedDone = page.nextCursor === null;
      } catch (error) {
        this.rankedDone = true;
        this.rankedCode = supportCodeOf(error);
        this.rankedStatus = !isHistoryApiError(error)
          ? 'error'
          : HISTORY_OFFLINE_CODES.includes(error.code) || error.code === 'unexpected'
            ? 'offline'
            : error.code === 'signedOut' || error.code === 'unauthorized' || error.code === 'notRegistered'
              ? 'signedOut'
              : 'error';
      }
    }
  }

  private async fillPractice(): Promise<void> {
    if (this.practiceDone || this.practice.length >= this.count) return;
    try {
      const repo = await this.deps.practice();
      if (!repo) {
        this.practiceOk = false;
        this.practiceDone = true;
        return;
      }
      // One more than needed: whether there are more.
      const limit = this.count + 1;
      this.practice = await repo.listRecent(limit);
      this.practiceDone = this.practice.length < limit;
      for (const r of this.practice) {
        if (r.mode === 'solo' || r.status !== 'finished' || this.results.has(r.id)) continue;
        this.results.set(r.id, (await repo.getGame(r.id))?.result ?? null);
      }
    } catch (error) {
      console.warn('[history] could not read the practice games', error);
      this.practiceOk = false;
      this.practiceDone = true;
    }
  }

  snapshot(): HistorySnapshot {
    const ranked = this.rankedGames.map(rankedEntry);
    const practice = this.practice.map((r) => practiceEntry(r, this.results.get(r.id) ?? null));
    const merged = mergeEntries(ranked, practice, this.filter, this.count + 1);
    const sourcesLeft =
      (this.filter !== 'practice' && !this.rankedDone) || (this.filter !== 'ranked' && !this.practiceDone);
    return {
      filter: this.filter,
      entries: merged.slice(0, this.count),
      hasMore: merged.length > this.count || sourcesLeft,
      ranked: this.rankedStatus,
      rankedCode: this.rankedStatus === 'ok' ? null : this.rankedCode,
      practiceOk: this.practiceOk,
    };
  }
}
