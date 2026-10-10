import type { HostUpdate, PlayerId } from '@sudoku-fight/engine';
import { useEffect, useEffectEvent } from 'react';

import { effectsOf, type MatchEffect, matchEffectsOf, type UiEffect } from './effects';
import type { PracticeSession } from './session';

/** What the effect hooks need of a session: its updates, and who "me" is. */
export type EffectSource = Pick<PracticeSession, 'subscribe' | 'playerId'>;

/** Subscribes to every update of `session` and hands over the effects `map` finds in it, if any. */
function useEffectsOf<E>(
  session: EffectSource | null,
  map: (update: HostUpdate, myId: PlayerId) => E[],
  onEffects: (effects: E[], update: HostUpdate) => void,
): void {
  const handle = useEffectEvent((update: HostUpdate, myId: string) => {
    const effects = map(update, myId);
    if (effects.length) onEffects(effects, update);
  });
  useEffect(() => {
    if (!session) return;
    return session.subscribe((update) => handle(update, session.playerId));
  }, [session]);
}

/**
 * Calls `onEffects` for every update of the session that has something to show (spec §6.4, §6.5), straight
 * from the host: unlike the store's `lastUpdate`, two updates in one render are never merged into one.
 */
export function useGameEffects(
  session: EffectSource | null,
  onEffects: (effects: UiEffect[], update: HostUpdate) => void,
): void {
  useEffectsOf(session, effectsOf, onEffects);
}

/**
 * The same for what happens between the players (spec §7, §8): reactions and interferences. Its own hook, so a
 * screen without opponents (and useGameEffects' callers) never hears of them.
 */
export function useMatchEffects(
  session: EffectSource | null,
  onEffects: (effects: MatchEffect[], update: HostUpdate) => void,
): void {
  useEffectsOf(session, matchEffectsOf, onEffects);
}
