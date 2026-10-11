import { useEffect, useMemo } from 'react';

import { useMyCard } from '../../progress/hooks';
import { usePracticeStats } from '../home/practiceStats';
import { type HistorySummary, historySummaryOf } from './historySummary';

/**
 * The history header's numbers on the phone: my saved player card (the ranked games), and the practices saved
 * here, counted again as the tab opens (a practice may have ended since Home counted them).
 */
export function useHistorySummary(): HistorySummary | null {
  const stats = useMyCard()?.stats ?? null;
  const gamesPlayed = usePracticeStats((s) => s.gamesPlayed);
  const winRate = usePracticeStats((s) => s.winRate);
  const streak = usePracticeStats((s) => s.streak);
  useEffect(() => {
    void usePracticeStats.getState().refresh();
  }, []);
  return useMemo(
    () => historySummaryOf(stats, { gamesPlayed, winRate, streak }),
    [stats, gamesPlayed, winRate, streak],
  );
}
