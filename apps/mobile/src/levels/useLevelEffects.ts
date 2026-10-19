import type { HostUpdate } from '@sudoku-fight/engine';
import { useEffect, useEffectEvent } from 'react';

import type { EffectSource } from '../game/useGameEffects';
import { type LevelEffect, levelEffectsOf } from './levelEffects';

/**
 * Calls `onEffects` for every update of a tap stage's session that has something to show (levelEffectsOf),
 * straight from the host, like useGameEffects: two updates in one render are never merged into one.
 */
export function useLevelEffects(
  session: EffectSource | null,
  onEffects: (effects: LevelEffect[], update: HostUpdate) => void,
): void {
  const handle = useEffectEvent((update: HostUpdate, myId: string) => {
    const effects = levelEffectsOf(update, myId);
    if (effects.length) onEffects(effects, update);
  });
  useEffect(() => {
    if (!session) return;
    return session.subscribe((update) => handle(update, session.playerId));
  }, [session]);
}
