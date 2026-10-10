import { eloChanges, type GameView } from '@sudoku-fight/engine';
import type { RatingEntry } from '@sudoku-fight/protocol';

/**
 * "שינוי דירוג משוער −15" on the surrender confirm (spec §6.6: with 2 players surrender is an immediate loss;
 * the Surrender board; components.md §14.1 Body): what my rating would lose if I gave up now, by the engine's
 * own formula (eloChanges, spec §11.2), from the ratings the game's view carries and my games in this rating
 * key (my first 10 count double). Nothing is decided here: the server rates the game; this only tells the
 * player what to expect.
 *
 * Null (the body then just says it is a loss) when it can't be told honestly: not a ranked 2-player game, a
 * rating missing from the view, or no entry for this game's key in my account.
 */
export function surrenderRatingDelta(
  view: Pick<GameView, 'mode' | 'gameType' | 'players' | 'me'>,
  myRatings: readonly RatingEntry[] | null | undefined,
): number | null {
  if (view.mode !== 'ranked' || view.players.length !== 2 || view.me === null) return null;
  const me = view.players.find((p) => p.id === view.me);
  const them = view.players.find((p) => p.id !== view.me);
  if (!me || !them || me.rating === null || them.rating === null) return null;
  const entry = ratingEntryOf(myRatings, view.gameType, view.players.length);
  if (!entry) return null;
  const [mine] = eloChanges([
    { id: me.id, rating: me.rating, games: entry.games, place: 2 },
    { id: them.id, rating: them.rating, games: entry.games, place: 1 },
  ]);
  return mine ? mine.delta : null;
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
