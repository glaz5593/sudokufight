import {
  Easing,
  ReduceMotion,
  type WithSpringConfig,
  type WithTimingConfig,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { motion } from '../../theme/motion';

/**
 * Motion helpers of the board area (docs/design/motion.md §3, §4.1–4.3). The reduced variants are picked
 * explicitly by the components (motion.md §6), so every animation here runs with ReduceMotion.Never: the
 * system setting must not skip a variant that was already chosen for it.
 */

type Curve = readonly [number, number, number, number];
const bezier = ([x1, y1, x2, y2]: Curve) => Easing.bezier(x1, y1, x2, y2);

export const easing = {
  standard: bezier(motion.easing.standard),
  exit: bezier(motion.easing.exit),
  loop: bezier(motion.easing.loop),
};

export const timing = (duration: number, curve: keyof typeof easing = 'standard'): WithTimingConfig => ({
  duration,
  easing: easing[curve],
  reduceMotion: ReduceMotion.Never,
});

const spring = (s: { mass: number; stiffness: number; damping: number }): WithSpringConfig => ({
  mass: s.mass,
  stiffness: s.stiffness,
  damping: s.damping,
  reduceMotion: ReduceMotion.Never,
});

/** `pop`: digit pop, pill and avatar pop-in. `press`: a key coming back up. */
export const springs = { pop: spring(motion.spring.pop), press: spring(motion.spring.press) };

/**
 * The cell shake of a wrong digit or a "taken" cell (motion.md `cell.shake`, `cell.denied`): translateX through
 * 0, −5, +5, −3, +3, 0 at every 20% of 300 ms (round 1 Game-2P `deny`). Motion keyframes, not layout sizes.
 */
export const SHAKE_KEYFRAMES = [-5, 5, -3, 3, 0] as const;

export function shake() {
  const step = motion.duration.wrongShake / SHAKE_KEYFRAMES.length;
  const [first, ...rest] = SHAKE_KEYFRAMES.map((x) => withTiming(x, timing(step, 'loop')));
  return withSequence(first!, ...rest);
}

/** The scale a pill or avatar pops in from, and a correct digit pops from (motion.md §4.1, §4.2). */
export const POP_FROM = 0.6;

/** The low point of the urgent blink of my lock's pill (motion.md `lock.urgent`: opacity 1 ↔ 0.35). */
export const URGENT_BLINK_LOW = 0.35;

/** The pending ring: my tap, not yet confirmed, at half strength (components.md §11.3 #9). */
export const PENDING_RING_OPACITY = 0.5;

/** A wrong digit shrinks toward the corner mark before it fades (motion.md `wrong.digit`). */
export const WRONG_DIGIT_SHRINK = 0.5;
