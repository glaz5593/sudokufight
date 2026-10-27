import type { PlayerStats } from '@sudoku-fight/protocol';
import type { TFunction } from 'i18next';

import { ltr } from '../../components/player';
import { percent } from '../../i18n/compose';

/**
 * The history header's numbers (History.dc.html: "86 משחקים · 57% ניצחונות" and the "רצף 3" chip). The design's
 * numbers are the Profile's: my ranked games from my player card (games, win %, current win streak [D28]), as
 * Home shows them (spec §4.3). The practices on this phone move no rating, so they are counted apart
 * ("· 12 אימונים") and never mixed into the win %. Before my card has come (signed out, or not loaded yet),
 * the practices are all there is: their count, and the win % and streak against bots (Home's numbers then).
 * Pure: the numbers are the server's card and the practice store's.
 */

export type HistoryT = TFunction<'history'>;

/** The practice store's numbers (home/practiceStats): null until read, or without a decided game. */
export interface PracticeNumbers {
  gamesPlayed: number | null;
  winRate: number | null;
  streak: number | null;
}

export interface HistorySummary {
  /** 'ranked': my card's numbers; 'practice': no card yet, the practices on this phone. */
  source: 'ranked' | 'practice';
  games: number;
  /** 0–1; null without a decided game. */
  winRate: number | null;
  /** The current win streak; null without a decided game. */
  streak: number | null;
  /** With 'ranked': the practices on this phone, counted apart; null when unknown (or with 'practice'). */
  practices: number | null;
}

export function historySummaryOf(
  ranked: PlayerStats | null,
  practice: PracticeNumbers,
): HistorySummary | null {
  if (ranked)
    return {
      source: 'ranked',
      games: ranked.games,
      winRate: ranked.games > 0 ? ranked.winRate : null,
      streak: ranked.games > 0 ? ranked.streak : null,
      practices: practice.gamesPlayed,
    };
  if (practice.gamesPlayed === null) return null;
  return {
    source: 'practice',
    games: practice.gamesPlayed,
    winRate: practice.winRate,
    streak: practice.streak,
    practices: null,
  };
}

/**
 * A share as a whole percent in the language's pattern (common:number.percent, D108), isolated so "%" stays on
 * its side in Hebrew: "⁦57%⁩".
 */
export const percentText = (rate: number, t: TFunction): string =>
  ltr(percent(Math.round(Math.min(1, Math.max(0, rate)) * 100), t));

/** The line under the title: "86 משחקים · 57% ניצחונות · 12 אימונים", or "12 אימונים · 50% ניצחונות". */
export function summaryLine(s: HistorySummary, t: HistoryT): string {
  const parts =
    s.source === 'ranked'
      ? [
          t('summary.games', { count: s.games }),
          s.winRate === null ? null : t('summary.winRate', { rate: percentText(s.winRate, t) }),
          s.practices ? t('summary.practices', { count: s.practices }) : null,
        ]
      : [
          t('summary.practices', { count: s.games }),
          s.winRate === null ? null : t('summary.winRate', { rate: percentText(s.winRate, t) }),
        ];
  return parts.filter((p): p is string => p !== null).join(t('player:sep'));
}

/** The streak chip shows from one win in a row. */
export const showsStreak = (s: HistorySummary): boolean => s.streak !== null && s.streak > 0;
