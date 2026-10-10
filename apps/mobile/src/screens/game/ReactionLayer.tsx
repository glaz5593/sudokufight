import type { PlayerId } from '@sudoku-fight/engine';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { space, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import type { Point } from './geometry';
import { unmutedFloats } from './reactions/model';

/**
 * The reactions' floats (spec §8; motion.md §4.5 `reaction.float`, components.md §8.2): the emoji at 36 rises
 * 74 dp from its sender's avatar over 1.6 s, popping 0.3 → 1.3 → 1 with a small wiggle, and fades out at the
 * top. It starts on the card, at the top of the screen, and only goes up, so it never covers the board. At
 * most 3 on screen (the screen keeps the newest). Reduced motion: it appears at the card and fades in place
 * (120 in, 1200 hold, 280 out).
 *
 * One layer above the cards, never touchable, hidden from screen readers (the live region says who reacted).
 * A float whose sender I muted is not drawn, even one already in the air (spec §8, D19).
 */

export interface ReactionFloat {
  /** The reaction event's seq. */
  id: number;
  emoji: string;
  /** The sender's avatar centre, in the screen's coordinates. */
  from: Point;
  /** The sender: their floats go when I mute them. */
  playerId?: PlayerId;
}

/** At most this many at once (D19, tokens motion.limits). */
export const MAX_REACTIONS = tokens.motion.limits.maxReactionsOnScreen;
/** How long a float lives, either way (1600 ms). */
export const REACTION_MS = motion.duration.reactionFloat;

/** The floats on screen with a new one: the newest three at most (the oldest gives way). */
export const withFloat = (list: readonly ReactionFloat[], next: ReactionFloat): ReactionFloat[] =>
  [...list, next].slice(-MAX_REACTIONS);

/** The emoji's size and how far it rises (motion.md §4.5: 36 px, 74 px; Game-2P `sf-react` starts 12 px low). */
const EMOJI = space[13] - space[2];
const RISE = space[15] + space[8] + space[1];
const START_DROP = space[6];
const BOX = space[14];
/** Reduced motion: 120 in, 1200 hold, 280 out = 1600 (motion.md §4.5). */
const REDUCED = { in: 120, hold: 1200, out: 280 } as const;

/** The keyframes of `sf-react`, as fractions of the 1600 ms (motion.md §4.5). */
const STOPS = [0, 0.18, 0.38, 0.58, 1];
const Y = [START_DROP, -space[3], -space[8], -space[8] * 2, -RISE];
const SCALE = [0.3, 1.3, 1, 1, 0.9];
const TURN = [0, 0, -6, 6, 0];
const OPACITY = [0, 1, 1, 1, 0];

const linear = { easing: Easing.linear, reduceMotion: ReduceMotion.Never };
const standard = Easing.bezier(...motion.easing.standard);
const exit = Easing.bezier(...motion.easing.exit);

export interface ReactionLayerProps {
  floats: readonly ReactionFloat[];
  /** The players I muted in this game: their floats are not shown. */
  muted?: readonly PlayerId[];
}

const NOBODY: readonly PlayerId[] = [];

export function ReactionLayer({ floats, muted = NOBODY }: ReactionLayerProps) {
  const reduce = useReduceMotion();
  const shown = unmutedFloats(floats, muted);
  return (
    <View
      pointerEvents="none"
      style={styles.layer}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="reaction-layer"
    >
      {shown.map((f) => (
        <Float key={f.id} float={f} reduce={reduce} />
      ))}
    </View>
  );
}

function Float({ float, reduce }: { float: ReactionFloat; reduce: boolean }) {
  const progress = useSharedValue(0);
  const fade = useSharedValue(0);

  useEffect(() => {
    if (reduce) {
      fade.set(
        withSequence(
          withTiming(1, { duration: REDUCED.in, easing: standard, reduceMotion: ReduceMotion.Never }),
          withDelay(
            REDUCED.hold,
            withTiming(0, { duration: REDUCED.out, easing: exit, reduceMotion: ReduceMotion.Never }),
          ),
        ),
      );
      return;
    }
    progress.set(withTiming(1, { duration: REACTION_MS, ...linear }));
  }, [reduce, progress, fade]);

  const style = useAnimatedStyle(() => {
    const base = [{ translateX: float.from.x - BOX / 2 }, { translateY: float.from.y - BOX / 2 }];
    if (reduce) return { opacity: fade.get(), transform: base };
    const t = progress.get();
    return {
      opacity: interpolate(t, STOPS, OPACITY),
      transform: [
        ...base,
        { translateY: interpolate(t, STOPS, Y) },
        { scale: interpolate(t, STOPS, SCALE) },
        { rotate: `${interpolate(t, STOPS, TURN)}deg` },
      ],
    };
  });

  return (
    <Animated.View style={[styles.box, style]} testID={`reaction-${float.id}`}>
      <Text style={styles.emoji} allowFontScaling={false}>
        {float.emoji}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // LTR, so `left` and translateX are physical, like the rects from onLayout.
  layer: { ...StyleSheet.absoluteFill, direction: 'ltr' },
  box: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: BOX,
    height: BOX,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: EMOJI, lineHeight: BOX, textAlign: 'center' },
});
