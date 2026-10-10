import type { MyProgress, PlayerCard } from '@sudoku-fight/protocol';

import { useAuth } from '../auth/authStore';
import { cardOf, progressOf, useProgress } from './progressStore';

/** The signed-in player with an account (Firebase uid), or null. */
export function useOwner(): string | null {
  return useAuth((s) => (s.status === 'ready' && s.user ? s.user.uid : null));
}

/** My saved progress (XP, level, league), when it is the signed-in player's. */
export function useMyProgress(): MyProgress | null {
  const owner = useOwner();
  return useProgress((s) => progressOf(s, owner));
}

/** My saved player card, when it is the signed-in player's. */
export function useMyCard(): PlayerCard | null {
  const owner = useOwner();
  return useProgress((s) => cardOf(s, owner));
}

/** My level (the progress's, else the card's); null before either has come. */
export function useMyLevel(): number | null {
  const owner = useOwner();
  return useProgress((s) => progressOf(s, owner)?.level ?? cardOf(s, owner)?.level ?? null);
}
