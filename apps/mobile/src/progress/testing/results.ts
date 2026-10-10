/* Test-only: practice results as the queue keeps them. */
import type { PracticeResult } from '@sudoku-fight/protocol';

export const practiceResult = (id: string, over: Partial<PracticeResult> = {}): PracticeResult => ({
  id,
  mode: 'bot',
  gameType: 'fast',
  outcome: 'win',
  correct: 10,
  endedAt: 1_000,
  ...over,
});
