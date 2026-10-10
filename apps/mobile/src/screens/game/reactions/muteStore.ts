import type { PlayerId } from '@sudoku-fight/engine';
import { create } from 'zustand';

/**
 * Who I muted in the game on screen (spec §8, D19: "אפשר להשתיק יריב דרך התפריט של הכרטיס שלו"). Muting is for
 * one game: the list belongs to a game id, and a mute in another game starts a fresh list. Not persisted.
 * A muted player's reactions are neither shown nor played (reactionPlan, unmutedFloats).
 */
export interface ReactionMutesState {
  /** The game the list belongs to. */
  gameId: string | null;
  /** The muted players of that game, in the order they were muted. */
  muted: readonly PlayerId[];
  /** Mutes or unmutes `playerId` in `gameId`; returns whether they are muted now. */
  toggle(gameId: string, playerId: PlayerId): boolean;
  setMuted(gameId: string, playerId: PlayerId, muted: boolean): void;
  /** Forgets every mute (a new game does this by itself). */
  reset(): void;
}

const NONE: readonly PlayerId[] = [];

/** The list of `gameId` in a state: empty when the state belongs to another game. */
export const mutedIn = (
  s: Pick<ReactionMutesState, 'gameId' | 'muted'>,
  gameId: string,
): readonly PlayerId[] => (s.gameId === gameId ? s.muted : NONE);

export const useReactionMutes = create<ReactionMutesState>()((set, get) => {
  const setMuted = (gameId: string, playerId: PlayerId, muted: boolean) => {
    const list = mutedIn(get(), gameId);
    if (list.includes(playerId) === muted) {
      if (get().gameId !== gameId) set({ gameId, muted: list });
      return;
    }
    set({ gameId, muted: muted ? [...list, playerId] : list.filter((id) => id !== playerId) });
  };
  return {
    gameId: null,
    muted: NONE,
    toggle(gameId, playerId) {
      const next = !mutedIn(get(), gameId).includes(playerId);
      setMuted(gameId, playerId, next);
      return next;
    },
    setMuted,
    reset: () => set({ gameId: null, muted: NONE }),
  };
});

/** The players I muted in `gameId` (a stable array between changes, so it can sit in a dependency list). */
export function useMutedPlayers(gameId: string): readonly PlayerId[] {
  return useReactionMutes((s) => mutedIn(s, gameId));
}

/** Whether `playerId` is muted in `gameId` now, outside React (an effect handler, a test). */
export const isReactionMuted = (gameId: string, playerId: PlayerId): boolean =>
  mutedIn(useReactionMutes.getState(), gameId).includes(playerId);
