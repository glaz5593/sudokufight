import type { ComponentProps } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import Animated from 'react-native-reanimated';

import { motion, useReduceMotion } from '../../theme/motion';
import { type NumberFormat, useCountUpProps } from './anim';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export interface CountUpTextProps {
  value: number;
  /** A worklet (scoreText, or one of the caller's own): it formats every frame of the count. */
  format: NumberFormat;
  /** 650 ms by default (motion.md `score.count`). */
  durationMs?: number;
  /** A text style, and animated styles on top of it (a score's colour and bump). */
  style?: ComponentProps<typeof AnimatedTextInput>['style'];
  testID?: string;
}

/**
 * A number that counts to its new value on the UI thread (motion.md §6 "Count-up text"): Reanimated's animated
 * text, a read-only TextInput whose `text` is an animated prop. React renders it once per new value, never per
 * frame of the count, so a 650 ms count costs the JS thread nothing (spec §22: 55 fps). Reduced motion: the new
 * value at once.
 *
 * Display only: it takes no touch, focus, selection or keyboard, and screen readers skip it, so a count is
 * never announced frame by frame. What contains it says the final value (a card's summary, the rating's label).
 */
export function CountUpText({
  value,
  format,
  durationMs = motion.duration.scoreCount,
  style,
  testID,
}: CountUpTextProps) {
  const reduce = useReduceMotion();
  const animatedProps = useCountUpProps(value, reduce, format, durationMs);
  return (
    <AnimatedTextInput
      animatedProps={animatedProps}
      editable={false}
      focusable={false}
      caretHidden
      contextMenuHidden
      scrollEnabled={false}
      showSoftInputOnFocus={false}
      underlineColorAndroid="transparent"
      accessible={false}
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.input, style]}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  // A TextInput's own frame (Android's padding, the field's border) gone: it lays out as the text it shows.
  // The text style's own padding (a score's paddingTop) still applies over `padding: 0`.
  input: { padding: 0, margin: 0, borderWidth: 0, pointerEvents: 'none' },
});
