import { ReduceMotion, useReducedMotion } from 'react-native-reanimated';

import { useSettings } from '../state/settings';
import { tokens } from './tokens.generated';

/** Motion timings of direction C (docs/design/motion.md, tokens.json "motion"). */
export const motion = tokens.motion;

/**
 * Whether to reduce motion (spec §22, CLAUDE.md): the player's setting wins; "system" follows the phone.
 * With it, animations shorten or become static, and an interference becomes a static cover for the same 5 s.
 */
export function useReduceMotion(): boolean {
  const system = useReducedMotion();
  const setting = useSettings((s) => s.reduceMotion);
  return setting === 'on' || (setting === 'system' && system);
}

/** The Reanimated flag for an animation, from the decision above. */
export const reduceMotionFlag = (reduce: boolean): ReduceMotion =>
  reduce ? ReduceMotion.Always : ReduceMotion.Never;
