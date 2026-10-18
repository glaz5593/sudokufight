import { eloChanges, type GameView } from '@sudoku-fight/engine';
import type { RatingEntry } from '@sudoku-fight/protocol';

/** Why a surrender now would cost me no rating (guard (a) of spec §11.2), as the engine's view says. */
export type SurrenderGuard = NonNullable<GameView['leaveGuards']>[number]['reason'];

/**
 * What the surrender confirm says about my rating: the estimated change (≤ 0), and, when it is 0 because a
 * leave guard holds, why.
 */
export interface SurrenderEstimate {
  delta: number;
  guard: SurrenderGuard | null;
}

/**
 * "שינוי דירוג משוער −15" on the surrender confirm (spec §6.6: with 2 players surrender is an immediate loss;
 * the Surrender board; components.md §14.1 Body): what my rating would lose if I gave up now.
 *
 * - The engine's view lists the opponents I would lose nothing to (GameView.leaveGuards, spec §11.2: I have
 *   not placed a digit yet, or I am not behind). Against one of them: { delta: 0, guard }, even without a
 *   rating entry in my account, since nothing is lost either way.
 * - Otherwise the engine's own formula (eloChanges, spec §11.2) from the ratings the view carries and my games
 *   in this rating key (my first 10 count double), with guard null.
 *
 * Nothing is decided here: the server rates the game; this only tells the player what to expect.
 *
 * Null (the body then just says it is a loss) when it can't be told honestly: not a ranked 2-player game, a
 * game with no ratings (a development room: no rating to speak of), or, unguarded, no entry for this game's
 * key in my account.
 */
export function surrenderRatingEstimate(
  view: Pick<GameView, 'mode' | 'gameType' | 'players' | 'me' | 'leaveGuards'>,
  myRatings: readonly RatingEntry[] | null | undefined,
): SurrenderEstimate | null {
  if (view.mode !== 'ranked' || view.players.length !== 2 || view.me === null) return null;
  const me = view.players.find((p) => p.id === view.me);
  const them = view.players.find((p) => p.id !== view.me);
  if (!me || !them || me.rating === null || them.rating === null) return null;
  // `?.`: null outside ranked games, and missing from a view an older engine drew.
  const guard = view.leaveGuards?.find((g) => g.opponentId === them.id);
  if (guard) return { delta: 0, guard: guard.reason };
  const entry = ratingEntryOf(myRatings, view.gameType, view.players.length);
  if (!entry) return null;
  const [mine] = eloChanges([
    { id: me.id, rating: me.rating, games: entry.games, place: 2 },
    { id: them.id, rating: them.rating, games: entry.games, place: 1 },
  ]);
  return mine ? { delta: mine.delta, guard: null } : null;
}

/**
 * 3–4 players: true when a surrender now would cost me no rating against ANY opponent still in the game
 * (every one of them is in GameView.leaveGuards). False in a game with no ratings (a development room).
 */
export function surrenderCostsNothing(
  view: Pick<GameView, 'mode' | 'players' | 'me' | 'leaveGuards'>,
): boolean {
  if (view.mode !== 'ranked' || view.me === null || !view.leaveGuards) return false;
  if (view.players.some((p) => p.rating === null)) return false;
  const guarded = new Set(view.leaveGuards.map((g) => g.opponentId));
  const others = view.players.filter((p) => p.id !== view.me && p.status === 'active');
  return others.length > 0 && others.every((p) => guarded.has(p.id));
}

/** My rating entry for this game: the per-table key ("normal-2p", RATING_OPTION A) first, else the type's. */
function ratingEntryOf(
  ratings: readonly RatingEntry[] | null | undefined,
  gameType: string,
  players: number,
): RatingEntry | null {
  if (!ratings) return null;
  return (
    ratings.find((r) => r.key === `${gameType}-${players}p`) ??
    ratings.find((r) => r.key === gameType) ??
    null
  );
}
