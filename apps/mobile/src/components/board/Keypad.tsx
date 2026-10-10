import type { Digit } from '@sudoku-fight/engine';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { color, radius, size, space, text, tokens } from '../../theme';
import { motion } from '../../theme/motion';
import { springs, timing } from './animation';
import type { KeyModel, KeypadModel } from './boardModel';
import { keyLabel } from './labels';

/**
 * The digit row of direction C (components.md §12.1): nine keys, 1–9 from left to right in both languages
 * (always LTR), each with how many of that digit are still to be placed. The model decides which keys work.
 */

export interface KeypadProps {
  model: KeypadModel;
  /** An armed key: place this digit in my locked cell. */
  onDigit: (digit: Digit) => void;
  /** A key pressed while I hold no lock: nudge the "בחר משבצת" hint (components.md §10). */
  onIdlePress?: (digit: Digit) => void;
  /** Row width; the design's 358 dp by default. */
  width?: number;
  testID?: string;
}

function KeypadView({ model, onDigit, onIdlePress, width = size.board, testID = 'keypad' }: KeypadProps) {
  // keypad.arm / keypad.idle: the whole row fades between .55 and 1 in 240 ms (opacity only, so reduced motion too).
  const target = model.enabled ? 1 : tokens.opacity.keypadIdle;
  const opacity = useSharedValue(target);
  useEffect(() => {
    opacity.set(withTiming(target, timing(motion.duration.stateChange)));
  }, [opacity, target]);
  const rowStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  return (
    <Animated.View style={[styles.row, { width }, rowStyle]} testID={testID}>
      {model.keys.map((key) => (
        <Key key={key.digit} model={key} onDigit={onDigit} onIdlePress={onIdlePress} />
      ))}
    </Animated.View>
  );
}

/** Two keys that draw the same: the game screen makes a new model on every countdown tick (4 a second). */
export const sameKey = (a: KeyModel, b: KeyModel): boolean =>
  a === b ||
  (a.digit === b.digit && a.remaining === b.remaining && a.state === b.state && a.disabled === b.disabled);

/**
 * Memoised (spec §22, 55 fps): a lock's countdown re-renders the game screen 4 times a second, and the keys
 * don't change with it. Pass stable `onDigit` / `onIdlePress` functions.
 */
export const Keypad = memo(
  KeypadView,
  (a, b) =>
    a.model.enabled === b.model.enabled &&
    a.model.keys.length === b.model.keys.length &&
    a.model.keys.every((key, k) => sameKey(key, b.model.keys[k]!)) &&
    a.onDigit === b.onDigit &&
    a.onIdlePress === b.onIdlePress &&
    a.width === b.width &&
    a.testID === b.testID,
);

interface KeyProps {
  model: KeyModel;
  onDigit: (digit: Digit) => void;
  onIdlePress?: (digit: Digit) => void;
}

/** One key; only the key whose count or state changed redraws (a placed digit changes one count). */
const Key = memo(
  KeyView,
  (a, b) => sameKey(a.model, b.model) && a.onDigit === b.onDigit && a.onIdlePress === b.onIdlePress,
);

function KeyView({ model, onDigit, onIdlePress }: KeyProps) {
  const { t } = useTranslation('board');
  const { digit, state } = model;
  const armed = state === 'armed';
  const tried = state === 'tried';

  // key.press: down 3 dp in 80 ms, back up on the `press` spring (motion.md §4.1; the same under reduced motion).
  const down = useSharedValue(0);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ translateY: down.get() }] }));

  const onPress = armed
    ? () => onDigit(digit)
    : state === 'idle' && onIdlePress
      ? () => onIdlePress(digit)
      : undefined;

  return (
    <Pressable
      style={styles.slot}
      onPress={onPress}
      onPressIn={
        armed
          ? () =>
              down.set(
                withTiming(tokens.elevation.keyPressed.translateY, timing(motion.duration.tapFeedbackMin)),
              )
          : undefined
      }
      onPressOut={armed ? () => down.set(withSpring(0, springs.press)) : undefined}
      // An idle key still takes the tap (to nudge the hint) but reads as disabled.
      disabled={onPress ? undefined : true}
      // The 4 dp gaps belong to the keys: about 40 × 64 (tokens.json size.touch, components.md §17.1).
      hitSlop={size.keypadGap / 2}
      accessibilityRole="button"
      accessibilityLabel={keyLabel(model, t)}
      accessibilityState={{ disabled: model.disabled }}
      testID={`key-${digit}`}
    >
      {({ pressed }) => (
        <Animated.View
          style={[
            styles.key,
            {
              borderColor: state === 'idle' ? color.keypad.keyBorderIdle : color.keypad.keyBorder,
              opacity:
                state === 'complete' ? tokens.opacity.keyExhausted : tried ? tokens.opacity.keypadIdle : 1,
            },
            pressed && armed ? styles.pressed : null,
            pressStyle,
          ]}
        >
          <Text
            style={[text('keyDigit'), styles.teko, tried ? styles.tried : { color: color.keypad.keyText }]}
            testID={`key-${digit}-digit`}
          >
            {digit}
          </Text>
          <Text style={[text('keyCount'), { color: color.keypad.keyCount }]} testID={`key-${digit}-count`}>
            {model.remaining}
          </Text>
        </Animated.View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Always LTR: 1 on the left, in Hebrew too.
  row: { direction: 'ltr', flexDirection: 'row', gap: size.keypadGap, height: size.keypadKey },
  slot: { flex: 1 },
  key: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // Digit over count (C draws 5 dp; the 4 dp grid's step).
    gap: space[2],
    backgroundColor: color.keypad.keyBg,
    borderWidth: tokens.border.hairline,
    borderRadius: radius.key,
  },
  pressed: {
    backgroundColor: color.keypad.keyPressedBg,
    borderColor: color.keypad.keyPressedBorder,
  },
  // Teko is centred by line height, not by Android's font padding (components.md §0.4).
  teko: { includeFontPadding: false },
  // [D12] A digit already tried wrongly in this cell: red and struck through.
  tried: {
    color: color.danger,
    textDecorationLine: 'line-through',
    textDecorationColor: color.danger,
  },
});
