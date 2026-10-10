import { GAME_TYPES, type GameType } from '@sudoku-fight/engine';
import {
  type Leaderboard,
  type LeaderboardEntry,
  LEADERBOARD_TABS,
  type LeaderboardTab,
  PODIUM_SIZE,
} from '@sudoku-fight/protocol';
import type { TFunction } from 'i18next';

import { countryName, ltr } from '../../components/player';

/**
 * The leaderboard as a pure view model (spec §14.2; Leaderboard.dc.html): which tab, the podium of the first
 * three and the rows after it, my pinned row, and the words screen readers hear. The ranks, the ratings and
 * which key a tab ranks by are the server's; nothing here ranks anyone.
 */

export type ProgressT = TFunction<'progress'>;

export { LEADERBOARD_TABS };
export type { LeaderboardTab };

export const isGameTypeTab = (tab: LeaderboardTab): tab is GameType => GAME_TYPES.includes(tab as GameType);

/** Option A (spec §11.1): a game-type tab shows the 2 / 3 / 4 picker; the server says so by its `players`. */
export const TABLE_SIZES = [2, 3, 4] as const;
export type TableSize = (typeof TABLE_SIZES)[number];

export function showsPlayersPicker(tab: LeaderboardTab, board: Leaderboard | null): boolean {
  return isGameTypeTab(tab) && board !== null && board.players !== null;
}

export interface PodiumSplit {
  /** The first three, best first (empty when the page does not start at the top). */
  podium: LeaderboardEntry[];
  /** Everyone after them. */
  rows: LeaderboardEntry[];
}

/** The podium is the first three of a board that starts at rank 1; the rest are rows. */
export function splitPodium(entries: readonly LeaderboardEntry[]): PodiumSplit {
  if (entries[0]?.rank !== 1) return { podium: [], rows: [...entries] };
  return { podium: entries.slice(0, PODIUM_SIZE), rows: entries.slice(PODIUM_SIZE) };
}

/** A page appended to the ones before it; a player already shown is not shown twice (ranks moved meanwhile). */
export function appendPage(board: Leaderboard, page: Leaderboard): Leaderboard {
  const seen = new Set(board.entries.map((e) => e.id));
  return {
    ...page,
    entries: [...board.entries, ...page.entries.filter((e) => !seen.has(e.id))],
    // My row and the friends come with every page: the newest win.
    me: page.me ?? board.me,
    friends: page.friends ?? board.friends,
  };
}

/** "#214", isolated so the sign stays before the number in Hebrew (CLAUDE.md). */
export const rankText = (rank: number): string => ltr(`#${rank}`);

/** The rating as rows show it: a whole number. */
export const ratingText = (rating: number): string => String(Math.round(rating));

/** The league's words ("ליגת זהב"), or "בדירוג זמני" while every key is provisional (spec §11.3). */
export function leagueWords(entry: Pick<LeaderboardEntry, 'league'>, t: ProgressT): string {
  return entry.league
    ? t('player:league.name', { league: t(`player:league.${entry.league}`) })
    : t('common.provisional');
}

/** One row (or podium column) for screen readers: "מקום 4, PandaPro, קוריאה הדרומית, ליגת אגדה, דירוג 1418". */
export function entryLabel(entry: LeaderboardEntry, t: ProgressT, language: string, isMe: boolean): string {
  const sep = t('player:listSep');
  const rating = t('player:rating.label', { value: ratingText(entry.rating) });
  return [
    t('leaderboard.rankLabel', { rank: entry.rank }),
    isMe ? t('leaderboard.meName', { name: entry.displayName }) : entry.displayName,
    entry.country ? countryName(entry.country, language) : null,
    leagueWords(entry, t),
    t('common.level', { level: entry.level }),
    entry.provisional ? t('player:rating.provisionalLabel', { label: rating }) : rating,
  ]
    .filter((x): x is string => !!x)
    .join(sep);
}

/** The line under the tabs: what this tab ranks by. */
export function captionOf(tab: LeaderboardTab, board: Leaderboard | null, t: ProgressT): string {
  if (tab === 'general') return t('leaderboard.caption.general');
  if (tab === 'friends') return t('leaderboard.caption.friends');
  const type = t(`home:gameTypes.${tab}.name`);
  const players = board?.players ?? null;
  return players === null
    ? t('leaderboard.caption.type', { type })
    : t('leaderboard.caption.typePlayers', { type, players: t('common.players', { count: players }) });
}
