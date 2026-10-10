import { useEffect, useRef } from 'react';
import {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { easing, NEVER_REDUCE } from '../../../components/player/anim';
import { timing } from '../../../components/ui/motion';
import { motion } from '../../../theme/motion';
import { metrics } from './metrics';

/**
 * The motion of the connection UI (motion.md §4.8, §4.9). Each hook takes the reduced-motion decision
 * (useReduceMotion) and picks its reduced variant itself (motion.md §6): the information stays, the movement
 * goes. Countdowns are information, so their rings and bars drain with reduced motion too (in the components).
 */

export type EnterKind = 'fade' | 'scale' | 'drop';

/**
 * In on mount, 240 ms `standard`: a fade, a fade from 96 % (a centred card, components.md §14.2) or a 12 dp
 * drop (a banner, motion.md `toast`). Reduced motion: a 200 ms fade.
 */
export function useEnter(reduce: boolean, kind: EnterKind = 'fade') {
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.set(withTiming(1, timing(motion.duration.stateChange, 'standard', reduce)));
  }, [shown, reduce]);
  return useAnimatedStyle(() => {
    const v = shown.get();
    if (reduce || kind === 'fade') return { opacity: v };
    if (kind === 'scale') {
      return { opacity: v, transform: [{ scale: metrics.enterScale + (1 - metrics.enterScale) * v }] };
    }
    return { opacity: v, transform: [{ translateY: (v - 1) * metrics.bannerDrop }] };
  });
}

/**
 * A countdown's number as it changes (motion.md `countdown.tick`): 1.22 → 1 while 0.5 → 1 opaque, 320 ms.
 * Reduced motion: no scale, only the fade (200 ms). Never on the first render.
 */
export function useTick(value: number, reduce: boolean) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const last = useRef(value);
  useEffect(() => {
    if (last.current === value) return;
    last.current = value;
    const config = {
      duration: reduce ? motion.duration.reducedFade : metrics.tick.ms,
      easing: easing.standard,
      reduceMotion: NEVER_REDUCE,
    };
    opacity.set(metrics.tick.opacity);
    opacity.set(withTiming(1, config));
    if (!reduce) {
      scale.set(metrics.tick.from);
      scale.set(withTiming(1, config));
    }
  }, [value, reduce, opacity, scale]);
  return useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ scale: scale.get() }] }));
}

/**
 * A word that lands (motion.md §2: round 1's `sf-slam` → C): 1.4 → 1 on the `slam` spring as it fades in.
 * Reduced motion: a 200 ms fade.
 */
export function useSlam(reduce: boolean) {
  const shown = useSharedValue(0);
  const scale = useSharedValue(reduce ? 1 : metrics.slamFrom);
  useEffect(() => {
    shown.set(withTiming(1, timing(motion.duration.stateChange, 'standard', reduce)));
    if (reduce) {
      scale.set(1);
      return;
    }
    scale.set(withSpring(1, { ...motion.spring.slam, reduceMotion: NEVER_REDUCE }));
  }, [reduce, shown, scale]);
  return useAnimatedStyle(() => ({ opacity: shown.get(), transform: [{ scale: scale.get() }] }));
}

/**
 * A waiting dot or a "…" (motion.md `self.lost`, `opp.disconnecting`): opacity 1 ↔ 0.35 every 1200 ms while
 * `active`, started `delayMs` late so a row of dots blinks in turn. It is a functional loop (waiting). Reduced
 * motion: static.
 */
export function usePulse(active: boolean, reduce: boolean, delayMs = 0, low = 0.35) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!active || reduce) {
      cancelAnimation(opacity);
      opacity.set(1);
      return;
    }
    const half = { duration: motion.loop.statusBlink / 2, easing: easing.loop, reduceMotion: NEVER_REDUCE };
    opacity.set(withDelay(delayMs, withRepeat(withTiming(low, half), -1, true), NEVER_REDUCE));
    return () => cancelAnimation(opacity);
  }, [active, reduce, delayMs, low, opacity]);
  return useAnimatedStyle(() => ({ opacity: opacity.get() }));
}

/**
 * A countdown's share left, drawn as it runs out: set to `remainingMs / totalMs` on each update and drained
 * linearly to 0 over `remainingMs` (motion.md §6: timers come from the server's clock). Stopped at 0 and with
 * `paused`. It is information, so it keeps moving with reduced motion.
 */
export function useDrain(remainingMs: number, totalMs: number, paused = false) {
  const share = useSharedValue(totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0);
  useEffect(() => {
    const start = totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0;
    cancelAnimation(share);
    share.set(start);
    if (!paused && remainingMs > 0) {
      share.set(withTiming(0, { duration: remainingMs, easing: easing.linear, reduceMotion: NEVER_REDUCE }));
    }
  }, [remainingMs, totalMs, paused, share]);
  return share;
}
