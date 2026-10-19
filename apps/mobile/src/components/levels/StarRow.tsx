import type { Stars } from '@sudoku-fight/engine';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { color, space } from '../../theme';
import { motion, reduceMotionFlag, useReduceMotion } from '../../theme/motion';
import { curve } from '../ui/motion';

/**
 * A stage's stars (components.md §19.5): 0–3 of 3, the earned ones filled gold (`color.star.filled`), the rest
 * outlined (`color.star.empty`). They count from the start side, so the row follows the app's direction (right
 * first in Hebrew). The row is one picture for screen readers ("שני כוכבים מתוך שלושה"), or hidden when the
 * element around it says the stars already (a map node, a gate row).
 *
 * `reveal` (the result, motion.md `level.stars.reveal`): the earned stars pop in one by one, 200 ms after the
 * result appears, 420 ms each with a 150 ms stagger (0.6 → 1.12 → 1). Reduced Motion: all at once.
 */

/** The star's outline in the 24 grid (the brief's star). */
export const STAR_PATH = 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3z';

/** The sizes of the boards: a chip or a node (11), the panel and sheets (16), "מוכן?" (28), the result (40). */
export const STAR_SIZES = { chip: 11, panel: 16, ready: 28, result: 40 } as const;

/** When the first earned star starts, and the stagger between them (motion.md `level.stars.reveal`). */
export const REVEAL = { delayMs: 200, staggerMs: 150, popMs: 420, from: 0.6, over: 1.12 } as const;

export interface StarProps {
  filled: boolean;
  size: number;
  testID?: string;
}

/** One star: filled gold, or the empty outline. Decorative. */
export function Star({ filled, size, testID }: StarProps) {
  const tint = filled ? color.star.filled : color.star.empty;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      <Path
        d={STAR_PATH}
        fill={filled ? tint : 'none'}
        stroke={tint}
        strokeWidth={size >= STAR_SIZES.ready ? 1.5 : 2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export interface StarRowProps {
  stars: Stars;
  size: number;
  /** The screen-reader label of the row; null hides it (the element around it says the stars). */
  label: string | null;
  /** Pop the earned stars in one by one (the result). */
  reveal?: boolean;
  /** Between the stars: 2 on a node (the board), more on the result. */
  gap?: number;
  testID?: string;
}

export function StarRow({ stars, size, label, reveal = false, gap, testID = 'star-row' }: StarRowProps) {
  const reduce = useReduceMotion();
  const between = gap ?? (size >= STAR_SIZES.result ? space[6] : space[1]);
  return (
    <View
      style={[styles.row, { gap: between }]}
      accessible={label !== null}
      accessibilityRole={label !== null ? 'image' : undefined}
      accessibilityLabel={label ?? undefined}
      accessibilityElementsHidden={label === null}
      importantForAccessibility={label === null ? 'no-hide-descendants' : 'auto'}
      testID={testID}
    >
      {[0, 1, 2].map((i) => {
        const filled = i < stars;
        return filled && reveal && !reduce ? (
          <RevealStar key={i} index={i} size={size} testID={`${testID}-${i}`} />
        ) : (
          <View key={i} testID={`${testID}-${i}`}>
            <Star filled={filled} size={size} testID={`${testID}-${i}-${filled ? 'filled' : 'empty'}`} />
          </View>
        );
      })}
    </View>
  );
}

/** An earned star of the result, popping in at its turn (the empty outline waits under it). */
function RevealStar({ index, size, testID }: { index: number; size: number; testID: string }) {
  const reduce = useReduceMotion();
  const scale = useSharedValue<number>(REVEAL.from);
  const opacity = useSharedValue(0);
  useEffect(() => {
    const delay = REVEAL.delayMs + index * REVEAL.staggerMs;
    const grow = REVEAL.popMs * 0.7;
    // `reduce` is false here (StarRow draws the earned stars still under Reduced Motion); the timings say so too.
    opacity.set(
      withDelay(
        delay,
        withTiming(1, { duration: grow, easing: curve('standard'), reduceMotion: NEVER }),
        NEVER,
      ),
    );
    scale.set(
      withDelay(
        delay,
        withSequence(
          withTiming(REVEAL.over, { duration: grow, easing: curve('emphasized'), reduceMotion: NEVER }),
          withTiming(1, { duration: REVEAL.popMs - grow, easing: curve('standard'), reduceMotion: NEVER }),
        ),
        NEVER,
      ),
    );
    return () => {
      cancelAnimation(scale);
      cancelAnimation(opacity);
    };
  }, [index, reduce, scale, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ scale: scale.get() }] }));
  return (
    <View testID={testID}>
      <Star filled={false} size={size} />
      <Animated.View style={[StyleSheet.absoluteFill, style]} testID={`${testID}-pop`}>
        <Star filled size={size} testID={`${testID}-filled`} />
      </Animated.View>
    </View>
  );
}

/** Our own decision (useReduceMotion) is made by hand: Reanimated must not add the phone's on top. */
const NEVER = reduceMotionFlag(false);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});

/** The star reveal's whole length for `stars` earned (the result waits it out before its confetti). */
export const revealMs = (stars: number): number =>
  stars <= 0 ? 0 : REVEAL.delayMs + (stars - 1) * REVEAL.staggerMs + REVEAL.popMs;

/** motion.md's numbers, for the tests and the result's timeline. */
export const STAR_MOTION = { confettiAtMs: 700, confettiMs: motion.sequence.victory.confetti } as const;
