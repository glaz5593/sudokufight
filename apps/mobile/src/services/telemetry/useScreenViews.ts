import { useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';

import { track } from '../analytics';
import { screenOf } from './screens';

/**
 * Spec §27.1: a `screen_view { screen }` each time the player enters a screen, from the root layout. The
 * screen is the route's pattern (screens.ts); the same screen twice in a row is reported once, and the
 * development routes (/dev/*) not at all.
 */
export function useScreenViews(): void {
  const screen = screenOf(useSegments() as readonly string[]);
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (screen === null || screen === last.current) return;
    last.current = screen;
    track('screen_view', { screen });
  }, [screen]);
}
