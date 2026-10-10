import { GAME_TYPES } from '@sudoku-fight/engine';
import { create } from 'zustand';

import type { PracticeGameRecord, PracticeRepo } from '../../game/practiceRepo';
import { practiceStorageOrNull } from '../../game/storage';

/**
 * The numbers of the home player card that come from the games saved on this phone [D25] (spec §4.3): games
 * played, win rate and streak. Every saved practice records one puzzle play, and plays are never deleted, so
 * the games are counted from them. Win rate and streak come from the practices against a bot, the only games
 * with a winner until ranked games arrive (stage 9).
 */

// ---------------------------------------------------------------------------------------------------------
// Win rate and streak [D28: the streak is a win streak]

/**
 * An interrupted game (the app went away mid-game) has no result. By default it counts for nothing: it is
 * left out of the win rate, and neither extends nor breaks the streak. Set to true to count it as a loss.
 * A setting, easy to change.
 */
export const INTERRUPTED_COUNTS_AS_LOSS = false;

export interface WinStats {
  /** Games with a result (won, lost or tied). */
  decided: number;
  wins: number;
  /** wins / decided, 0–1; null without a decided game. */
  winRate: number | null;
  /** Wins in a row, counted back from the newest decided game; null without a decided game. */
  streak: number | null;
}

/**
 * Win rate and current win streak (spec §4.3, §15, D28) from saved games with opponents. A tie is a decided
 * game that is not a win: it counts in the win rate and ends a streak. Order does not matter: the games are
 * taken newest first by their start (ties keep the order given, which is the repository's, newest first).
 */
export function winStats(
  games: readonly Pick<PracticeGameRecord, 'status' | 'outcome' | 'startedAt'>[],
  { interruptedIsLoss = INTERRUPTED_COUNTS_AS_LOSS }: { interruptedIsLoss?: boolean } = {},
): WinStats {
  const results = [...games]
    .sort((a, b) => b.startedAt - a.startedAt)
    .flatMap((g) => {
      if (g.status === 'finished' && g.outcome) return [g.outcome];
      if (g.status === 'interrupted' && interruptedIsLoss) return ['loss' as const];
      return [];
    });
  const wins = results.filter((r) => r === 'win').length;
  if (!results.length) return { decided: 0, wins: 0, winRate: null, streak: null };
  const firstOther = results.findIndex((r) => r !== 'win');
  return {
    decided: results.length,
    wins,
    winRate: wins / results.length,
    streak: firstOther === -1 ? results.length : firstOther,
  };
}

// ---------------------------------------------------------------------------------------------------------
// The store

export interface PracticeStatsState {
  /** Null until read, or when the database could not open. */
  gamesPlayed: number | null;
  /** From the practices against a bot; null until read, or without any decided one. */
  winRate: number | null;
  streak: number | null;
  refresh(): Promise<void>;
}

export async function countGamesPlayed(repo: PracticeRepo): Promise<number> {
  let total = 0;
  for (const type of GAME_TYPES) total += (await repo.playHistory(type)).length;
  return total;
}

export function createPracticeStats(repo: () => Promise<PracticeRepo | null> = practiceStorageOrNull) {
  return create<PracticeStatsState>()((set) => {
    let latest = 0;
    return {
      gamesPlayed: null,
      winRate: null,
      streak: null,
      async refresh() {
        const mine = ++latest;
        let next: Pick<PracticeStatsState, 'gamesPlayed' | 'winRate' | 'streak'> = {
          gamesPlayed: null,
          winRate: null,
          streak: null,
        };
        try {
          const r = await repo();
          if (r) {
            const { winRate, streak } = winStats(await r.listByMode('bot'));
            next = { gamesPlayed: await countGamesPlayed(r), winRate, streak };
          }
        } catch (error) {
          console.warn('[practice] could not count the saved games', error);
        }
        if (mine === latest) set(next);
      },
    };
  });
}

export const usePracticeStats = createPracticeStats();
