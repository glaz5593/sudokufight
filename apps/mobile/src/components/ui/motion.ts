import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  Easing,
  type SharedValue,
  useSharedValue,
  withTiming,
  type WithTimingConfig,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { motion, reduceMotionFlag } from '../../theme/motion';

/** The curves of motion.md §3, as Reanimated easings. */
type CurveName = 'standard' | 'emphasized' | 'exit' | 'countUp' | 'loop';

export function curve(name: CurveName) {
  const [x1, y1, x2, y2] = motion.easing[name];
  return Easing.bezier(x1, y1, x2, y2);
}

/**
 * A timing that already chose between the full and the reduced variant (motion.md §6: pick the reduced variant
 * explicitly and pass ReduceMotion.Never, so a 200 ms fade still plays).
 */
export function timing(duration: number, easing: CurveName, reduce: boolean): WithTimingConfig {
  return {
    duration: reduce ? motion.duration.reducedFade : duration,
    easing: curve(reduce ? 'standard' : easing),
    reduceMotion: reduceMotionFlag(false),
  };
}

export interface PresenceTimings {
  /** Enter duration in ms (full motion). */
  inMs: number;
  /** Exit duration in ms (full motion). */
  outMs: number;
  reduce: boolean;
}

/**
 * Keeps an overlay mounted while it animates out. `progress` runs 0 → 1 on enter and 1 → 0 on exit; the overlay
 * unmounts when the exit finishes. Reopening during the exit cancels it.
 *
 * `onExited` runs once the overlay has left the screen: its exit finished and the render that drops it was
 * committed (a native Modal's window included). Whatever must not happen under a closing overlay waits for it,
 * e.g. the game screen replaced by the results (bug 9).
 */
export function usePresence(
  visible: boolean,
  { inMs, outMs, reduce }: PresenceTimings,
  onExited?: () => void,
): { mounted: boolean; progress: SharedValue<number> } {
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(0);

  // Opening mounts right away (state derived during render, no extra effect pass).
  if (visible && !mounted) setMounted(true);
  const shown = mounted || visible;

  useEffect(() => {
    if (visible) {
      progress.set(withTiming(1, timing(inMs, 'standard', reduce)));
      return;
    }
    progress.set(
      withTiming(0, timing(outMs, 'exit', reduce), (finished) => {
        if (finished) scheduleOnRN(setMounted, false);
      }),
    );
  }, [visible, inMs, outMs, reduce, progress]);

  const exited = useEffectEvent(() => onExited?.());
  const wasShown = useRef(shown);
  useEffect(() => {
    if (wasShown.current && !shown) exited();
    wasShown.current = shown;
  }, [shown]);

  return { mounted: shown, progress };
}
