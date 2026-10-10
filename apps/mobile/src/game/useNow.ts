import type { Clock } from '@sudoku-fight/engine';
import { useEffect, useState } from 'react';

import { systemClock } from './clock';

export interface UseNowOptions {
  /** Stop ticking (e.g. the game is over, or nothing counts down); the last time stays. */
  enabled?: boolean;
  /** The game's clock (PracticeSession.clock); the phone's by default. */
  clock?: Clock;
}

/**
 * The current time, re-rendering every `intervalMs` (250 by default) while mounted: for countdowns, the
 * screens recompute boardModel / cardModel with it. The view's deadlines are in the game clock's time.
 */
export function useNow(
  intervalMs = 250,
  { enabled = true, clock = systemClock }: UseNowOptions = {},
): number {
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(clock.now());
    // Catch up at once after a pause or a change of clock, then keep ticking.
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, Math.max(16, intervalMs));
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [intervalMs, enabled, clock]);
  return now;
}
