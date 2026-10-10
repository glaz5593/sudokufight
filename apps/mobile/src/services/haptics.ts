import * as Haptics from 'expo-haptics';
import { AppState } from 'react-native';

import { useSettings } from '../state/settings';
import { tokens } from '../theme/tokens.generated';

/**
 * Haptics (docs/design/motion.md §7, spec §22 "צליל ורטט"), on expo-haptics.
 *
 * - Off while the "רטט" setting is off (persisted in `useSettings`), and while the app is in the background.
 * - At most one haptic per 80 ms (`motion.limits.hapticMinGap`). Haptics asked for in the same JS turn are
 *   merged and the strongest wins: Error > Heavy > Success > Warning > Medium > Light > Selection. Inside the
 *   80 ms gap, a weaker or equal haptic is dropped; a stronger one still fires, so an Error is never lost.
 * - Errors never reach the caller (some devices have no vibrator). They are logged in development.
 *
 * Screens don't call this directly: they call `cue()` from ./feedback, which plays the sound and the haptic.
 */

/** The haptics the app uses. `launch` is two medium knocks 90 ms apart (motion.md §7, "IMPACT M"). */
export type HapticPattern =
  'selection' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'launch';

export const HAPTIC_PATTERNS: readonly HapticPattern[] = [
  'selection',
  'light',
  'medium',
  'heavy',
  'success',
  'warning',
  'error',
  'launch',
];

/** Strength, for "the strongest wins" (motion.md §7). */
export const HAPTIC_STRENGTH: Readonly<Record<HapticPattern, number>> = {
  selection: 0,
  light: 1,
  medium: 2,
  launch: 2,
  warning: 3,
  success: 4,
  heavy: 5,
  error: 6,
};

export const HAPTIC_MIN_GAP_MS: number = tokens.motion.limits.hapticMinGap;
export const LAUNCH_SECOND_KNOCK_MS = 90;

export interface HapticsService {
  /** Asks for a haptic. It fires at the end of the current JS turn, unless a rule above drops it. */
  fire(pattern: HapticPattern): void;
  /** Forgets the last haptic and anything pending (tests, a new screen). */
  reset(): void;
}

export interface HapticsOptions {
  /** Milliseconds clock for the 80 ms gap. Defaults to Date.now. */
  now?: () => number;
}

function report(error: unknown): void {
  if (__DEV__) console.warn('[haptics]', error);
}

function allowed(): boolean {
  const state: unknown = AppState.currentState;
  return useSettings.getState().haptics && state !== 'background' && state !== 'inactive';
}

function call(run: () => Promise<void>): void {
  try {
    run().catch(report);
  } catch (error) {
    report(error);
  }
}

const impact = (style: Haptics.ImpactFeedbackStyle) => call(() => Haptics.impactAsync(style));
const notify = (type: Haptics.NotificationFeedbackType) => call(() => Haptics.notificationAsync(type));

/** A fresh haptics service. The app uses the `haptics` singleton below; tests make their own. */
export function createHaptics({ now = Date.now }: HapticsOptions = {}): HapticsService {
  let pending: HapticPattern | null = null;
  let last: { at: number; pattern: HapticPattern } | null = null;
  let generation = 0;

  function run(pattern: HapticPattern): void {
    switch (pattern) {
      case 'selection':
        return call(() => Haptics.selectionAsync());
      case 'light':
        return impact(Haptics.ImpactFeedbackStyle.Light);
      case 'medium':
        return impact(Haptics.ImpactFeedbackStyle.Medium);
      case 'heavy':
        return impact(Haptics.ImpactFeedbackStyle.Heavy);
      case 'success':
        return notify(Haptics.NotificationFeedbackType.Success);
      case 'warning':
        return notify(Haptics.NotificationFeedbackType.Warning);
      case 'error':
        return notify(Haptics.NotificationFeedbackType.Error);
      case 'launch': {
        impact(Haptics.ImpactFeedbackStyle.Medium);
        const mine = generation;
        setTimeout(() => {
          if (mine !== generation || !allowed()) return;
          last = { at: now(), pattern: 'medium' };
          impact(Haptics.ImpactFeedbackStyle.Medium);
        }, LAUNCH_SECOND_KNOCK_MS);
        return;
      }
    }
  }

  function flush(mine: number): void {
    if (mine !== generation) return; // reset() since: a newer flush owns `pending`
    const pattern = pending;
    pending = null;
    if (pattern === null || !allowed()) return;
    const at = now();
    if (last && at - last.at < HAPTIC_MIN_GAP_MS && HAPTIC_STRENGTH[pattern] <= HAPTIC_STRENGTH[last.pattern])
      return;
    last = { at, pattern };
    run(pattern);
  }

  function fire(pattern: HapticPattern): void {
    if (!allowed()) return;
    if (pending === null) {
      pending = pattern;
      const mine = generation;
      // A resolved promise, not queueMicrotask: Jest's fake timers leave promises alone.
      void Promise.resolve().then(() => flush(mine));
    } else if (HAPTIC_STRENGTH[pattern] > HAPTIC_STRENGTH[pending]) {
      pending = pattern;
    }
  }

  function reset(): void {
    generation++;
    pending = null;
    last = null;
  }

  return { fire, reset };
}

/** The app's haptics service. */
export const haptics: HapticsService = createHaptics();
