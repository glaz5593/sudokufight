import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { decimalSeparator } from '../../i18n/compose';
import { color } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { easing, NEVER_REDUCE, springs } from './anim';
import { CountUpText } from './CountUpText';
import { scoreFormat, signedText } from './format';
import { metrics } from './metrics';

/** The last change to a score, for the delta slot next to it (components.md §3.4). A new `id` replays it. */
export interface ScoreDelta {
  id: number | string;
  value: number;
  /** gain: a correct move · penalty: a mistake (red) · cost: an interference I sent (muted, not a penalty). */
  kind: 'gain' | 'penalty' | 'cost';
}

export interface ScoreNumberProps {
  score: number;
  /** The seat's ring colour. */
  tint: string;
  textStyle: TextStyle;
  /** A new delta (by id) plays its effect on the number: a bump for a gain, a red tint for a penalty. */
  delta?: ScoreDelta | null;
  testID?: string;
}

/**
 * A card's score (motion.md §4.2–4.3): counts to the new value over 650 ms in 0.5 steps, bumps 1 → 1.08 → 1 on
 * a gain, and starts red after a penalty, returning to the seat colour while it counts down. Reduced motion:
 * the final number at once, no bump, and a red tint for 300 ms.
 *
 * The count, the bump and the tint all run on the UI thread (CountUpText, motion.md §6): no frame of them
 * renders in React. Screen readers hear the final score in the card's summary, never the count.
 */
export function ScoreNumber({ score, tint, textStyle, delta = null, testID }: ScoreNumberProps) {
  const { t } = useTranslation('player');
  const decimal = decimalSeparator(t);
  // The count's worklet, with the language's separator in it (made once: its animated props stay set up).
  const format = useMemo(() => scoreFormat(decimal), [decimal]);
  const reduce = useReduceMotion();
  const red = useSharedValue(0);
  const scale = useSharedValue(1);
  const lastId = useRef(delta?.id);
  const id = delta?.id;
  const kind = delta?.kind;

  useEffect(() => {
    if (id === undefined || id === lastId.current) return;
    lastId.current = id;
    if (kind === 'penalty') {
      red.set(1);
      red.set(
        reduce
          ? withDelay(motion.duration.wrongShake, withTiming(0, { duration: 0, reduceMotion: NEVER_REDUCE }))
          : withTiming(0, {
              duration: motion.duration.scoreCount,
              easing: easing.standard,
              reduceMotion: NEVER_REDUCE,
            }),
      );
    } else if (kind === 'gain' && !reduce) {
      scale.set(
        withSequence(
          withTiming(metrics.scoreBump, {
            duration: motion.duration.tapFeedbackMax,
            reduceMotion: NEVER_REDUCE,
          }),
          withSpring(1, { ...springs.pop, reduceMotion: NEVER_REDUCE }),
        ),
      );
    }
  }, [id, kind, reduce, red, scale]);

  const anim = useAnimatedStyle(() => ({
    color: interpolateColor(red.get(), [0, 1], [tint, color.danger]),
    transform: [{ scale: scale.get() }],
  }));

  return <CountUpText value={score} format={format} style={[textStyle, anim]} testID={testID} />;
}

export interface DeltaLabelProps {
  delta: ScoreDelta | null | undefined;
  tint: string;
  textStyle: TextStyle;
  /** The compact card's gain floats up from the score (not with reduced motion). */
  rise?: boolean;
  /** Keep it on screen (the design-system page draws it as in Dir-C-Game). */
  persistent?: boolean;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * "+3.5" next to the score (motion.md `delta.label`): fades in, holds 2400 ms, fades out over 240 ms. Gains
 * in the seat colour, penalties in red, an interference's cost muted.
 */
export function DeltaLabel({
  delta,
  tint,
  textStyle,
  rise = false,
  persistent = false,
  style,
  testID,
}: DeltaLabelProps) {
  const { t } = useTranslation('player');
  const reduce = useReduceMotion();
  const opacity = useSharedValue(persistent && delta ? 1 : 0);
  const y = useSharedValue(0);
  const id = delta?.id;

  useEffect(() => {
    if (id === undefined) {
      opacity.set(0);
      return;
    }
    y.set(0);
    if (persistent) {
      opacity.set(1);
      return;
    }
    const fadeIn = motion.duration.reducedFade;
    opacity.set(0);
    opacity.set(
      withSequence(
        withTiming(1, { duration: fadeIn, easing: easing.standard, reduceMotion: NEVER_REDUCE }),
        withDelay(
          motion.duration.deltaHold,
          withTiming(0, {
            duration: motion.duration.stateChange,
            easing: easing.exit,
            reduceMotion: NEVER_REDUCE,
          }),
        ),
      ),
    );
    if (rise && !reduce) {
      y.set(
        withTiming(-metrics.gainRise, {
          duration: fadeIn + motion.duration.deltaHold,
          easing: easing.standard,
          reduceMotion: NEVER_REDUCE,
        }),
      );
    }
  }, [id, persistent, rise, reduce, opacity, y]);

  const anim = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ translateY: y.get() }] }));
  if (!delta) return null;
  const fg = delta.kind === 'gain' ? tint : delta.kind === 'penalty' ? color.danger : color.textMuted;
  return (
    <Animated.Text
      style={[textStyle, { color: fg }, style, anim]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {signedText(delta.value, decimalSeparator(t))}
    </Animated.Text>
  );
}
