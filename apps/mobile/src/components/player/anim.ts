import { useEffect, useRef, useState } from 'react';
import {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { motion } from '../../theme/motion';

/** Easing curves and springs of motion.md §3, ready for Reanimated. */
export const easing = {
  standard: Easing.bezier(...motion.easing.standard),
  loop: Easing.bezier(...motion.easing.loop),
  exit: Easing.bezier(...motion.easing.exit),
  linear: Easing.linear,
};
export const springs = {
  pop: { ...motion.spring.pop },
  settle: { ...motion.spring.settle },
};
/** Our own reduced-motion decision (useReduceMotion) is applied by hand, so Reanimated must not add its own. */
export const NEVER_REDUCE = ReduceMotion.Never;

/** motion.md `countUp`, cubic-bezier(.33, 1, .68, 1): the ease-out cubic curve. */
const countUpCurve = (x: number): number => 1 - (1 - x) ** 3;

/**
 * The score as it counts to a new value (motion.md `score.count`): 650 ms, in 0.5 steps, and a new value
 * mid-count starts from what is on screen. With reduced motion it jumps straight to the value.
 */
export function useCountUp(target: number, reduce: boolean, durationMs: number = motion.duration.scoreCount) {
  const [shown, setShown] = useState(target);
  const onScreen = useRef(target);
  useEffect(() => {
    if (reduce) {
      onScreen.current = target;
      return;
    }
    const from = onScreen.current;
    if (from === target) return;
    const start = Date.now();
    let frame = 0;
    const step = () => {
      const p = Math.min(1, (Date.now() - start) / durationMs);
      const v = p >= 1 ? target : Math.round((from + (target - from) * countUpCurve(p)) * 2) / 2;
      onScreen.current = v;
      setShown(v);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, reduce, durationMs]);
  return reduce ? target : shown;
}

/**
 * A functional blink (motion.md `lock.urgent`, the "…" of "חושב…"): opacity 1 ↔ `low` on a loop while
 * `active`. Static with reduced motion.
 */
export function useBlink(active: boolean, reduce: boolean, periodMs: number, low = 0.35) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!active || reduce) {
      cancelAnimation(opacity);
      opacity.set(1);
      return;
    }
    opacity.set(
      withRepeat(
        withTiming(low, { duration: periodMs / 2, easing: easing.loop, reduceMotion: NEVER_REDUCE }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(opacity);
  }, [active, reduce, periodMs, low, opacity]);
  return useAnimatedStyle(() => ({ opacity: opacity.get() }));
}

const SHAKE_PX = [-5, 5, -3, 3, 0] as const;

/**
 * One 300 ms shake when `key` changes (motion.md `hint.nudge`); never on the first render. With reduced
 * motion it does not move, and `flash` is true for the same 300 ms instead.
 */
export function useShake(key: number | undefined, reduce: boolean) {
  const x = useSharedValue(0);
  const [flash, setFlash] = useState(false);
  const first = useRef(key);
  useEffect(() => {
    if (key === undefined || key === first.current) return;
    first.current = key;
    const total = motion.duration.wrongShake;
    if (reduce) {
      const on = setTimeout(() => setFlash(true), 0);
      const off = setTimeout(() => setFlash(false), total);
      return () => {
        clearTimeout(on);
        clearTimeout(off);
      };
    }
    const each = total / SHAKE_PX.length;
    x.set(
      withSequence(
        ...SHAKE_PX.map((px) =>
          withTiming(px, { duration: each, easing: easing.loop, reduceMotion: NEVER_REDUCE }),
        ),
      ),
    );
  }, [key, reduce, x]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  return { style, flash };
}
