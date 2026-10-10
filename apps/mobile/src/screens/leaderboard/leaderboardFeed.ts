import type { Leaderboard } from '@sudoku-fight/protocol';

import { isProgressApiError, isProgressOffline, type ProgressApi } from '../../api/progressApi';
import { supportCodeOf } from '../../components/ui/stateModel';
import { appendPage, type LeaderboardTab, type TableSize } from './leaderboardModel';

/**
 * The leaderboard's data (spec §14.2): a tab's first page, more pages by the server's cursor as the list
 * scrolls, and a fresh start on pull-to-refresh. Each tab (and, under option A, each table size) keeps what it
 * read for the screen's life, so switching back shows it at once while it is read again. Offline, what was
 * read stays, with the status saying so.
 */

export type FeedStatus = 'loading' | 'ok' | 'offline' | 'error' | 'signedOut';

export interface FeedSnapshot {
  tab: LeaderboardTab;
  /** The table size asked for (option A); null: the server's choice. */
  players: TableSize | null;
  /** Every page read so far; null before the first one came. */
  board: Leaderboard | null;
  status: FeedStatus;
  /** Why the last read failed, for support (spec §16.3: "unavailable-503"); null when it did not. */
  code: string | null;
}

const keyOf = (tab: LeaderboardTab, players: TableSize | null) => `${tab}:${players ?? ''}`;

function statusOf(error: unknown): FeedStatus {
  if (isProgressApiError(error) && (error.code === 'signedOut' || error.code === 'notRegistered'))
    return 'signedOut';
  return isProgressOffline(error) ? 'offline' : 'error';
}

export class LeaderboardFeed {
  private readonly boards = new Map<string, Leaderboard>();

  /** `api` null: nobody signed in. */
  constructor(private readonly api: ProgressApi | null) {}

  /** What this tab already has (shown while it is read again). */
  peek(tab: LeaderboardTab, players: TableSize | null): FeedSnapshot {
    return {
      tab,
      players,
      board: this.boards.get(keyOf(tab, players)) ?? null,
      status: 'loading',
      code: null,
    };
  }

  /** The first page of a tab, read again (a tab opened, a pull-to-refresh, "try again"). */
  async first(tab: LeaderboardTab, players: TableSize | null): Promise<FeedSnapshot> {
    const key = keyOf(tab, players);
    if (!this.api)
      return { tab, players, board: this.boards.get(key) ?? null, status: 'signedOut', code: null };
    try {
      const board = await this.api.leaderboard({ tab, players });
      this.boards.set(key, board);
      // The server's own choice of size (option A) is that size's board too.
      if (players === null && board.players !== null) this.boards.set(keyOf(tab, board.players), board);
      return { tab, players, board, status: 'ok', code: null };
    } catch (error) {
      return {
        tab,
        players,
        board: this.boards.get(key) ?? null,
        status: statusOf(error),
        code: supportCodeOf(error),
      };
    }
  }

  /** The next page, appended; nothing when the last one came. */
  async more(tab: LeaderboardTab, players: TableSize | null): Promise<FeedSnapshot> {
    const key = keyOf(tab, players);
    const board = this.boards.get(key) ?? null;
    if (!this.api || !board?.nextCursor)
      return { tab, players, board, status: this.api ? 'ok' : 'signedOut', code: null };
    try {
      const page = await this.api.leaderboard({
        tab,
        players: players ?? board.players,
        cursor: board.nextCursor,
      });
      const next = appendPage(board, page);
      this.boards.set(key, next);
      return { tab, players, board: next, status: 'ok', code: null };
    } catch (error) {
      return { tab, players, board, status: statusOf(error), code: supportCodeOf(error) };
    }
  }
}
