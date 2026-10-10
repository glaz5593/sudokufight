import type { GameResult, PlayerId } from '@sudoku-fight/engine';

/**
 * How a game with opponents ended for one player (spec §6.7, §12): first alone (win), first with someone
 * (tie), or behind (loss). The places are the engine's (GameResult.ranking); nothing is decided here.
 */
export type Outcome = 'win' | 'loss' | 'tie';

/** Null for a game without opponents (solo practice), or for a player the ranking does not have. */
export function outcomeOf(result: Pick<GameResult, 'ranking'>, playerId: PlayerId): Outcome | null {
  if (result.ranking.length < 2) return null;
  const me = result.ranking.find((r) => r.playerId === playerId);
  if (!me) return null;
  if (me.place !== 1) return 'loss';
  return result.ranking.filter((r) => r.place === 1).length > 1 ? 'tie' : 'win';
}

export const isOutcome = (v: unknown): v is Outcome => v === 'win' || v === 'loss' || v === 'tie';
