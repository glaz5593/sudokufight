import type { Digit } from '@sudoku-fight/engine';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type GestureResponderEvent, Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { color, radius, size, space, text, tokens } from '../../theme';
import { motion } from '../../theme/motion';
import { springs, timing } from './animation';
import type { KeyModel, KeypadModel } from './boardModel';
import { keyLabel } from './labels';

/**
 * The digit row of direction C (components.md §12.1): nine keys, 1–9 from left to right in both languages
 * (always LTR), each with how many of that digit are still to be placed. The model decides which keys work.
 *
 * [D47] "מקלדת מתערבלת": while that interference hits me, `order` says which key stands in each slot. The keys
 * slide there in 200 ms (with reduced motion: a fade), and each still enters the digit printed on it, with its
 * own count and state. `guard` keeps it fair: the row tells it where the fingers are (no key moves under one),
 * and a press that started while the keys were still moving doesn't count.
 */

/** The finger guards of a scrambled keypad [D47] (screens/game/hit/useKeypadShuffle). */
export interface KeypadGuard {
  /** How many fingers are on the keys now (fingersOnKeys, after each touch event): while one is, no key moves. */
  fingers: (count: number) => void;
  /** Whether a press starting now counts: not while the keys are still moving into place, nor just after. */
  settled: () => boolean;
  /** A press that didn't count: its digit is not entered. */
  refused: (digit: Digit) => void;
  /** The keys fade to a new order (reduced motion) instead of sliding. */
  reduce: boolean;
  /** The slide, and the reduced-motion fade, in ms. */
  moveMs: number;
  fadeMs: number;
}

export interface KeypadProps {
  model: KeypadModel;
  /** An armed key: place this digit in my locked cell. */
  onDigit: (digit: Digit) => void;
  /** A key pressed while I hold no lock: nudge the "בחר משבצת" hint (components.md §10). */
  onIdlePress?: (digit: Digit) => void;
  /** Row width; the design's 358 dp by default. */
  width?: number;
  /** [D47] Which digit's key stands in each slot, left to right, while the keys are scrambled; null: 1–9. */
  order?: readonly Digit[] | null;
  /** [D47] The guards of a scrambled keypad. Pass a stable object. */
  guard?: KeypadGuard | null;
  testID?: string;
}

/** A finger's id: a number on both platforms (React Native's types say string). */
export type TouchId = number | string;

/** A finger in a raw touch event: only its id matters here. */
interface TouchPoint {
  identifier?: TouchId;
}

/** The lists of a raw touch event (W3C names; Android sends no targetTouches). */
export interface RowTouches {
  /** The touches this event is about: those that went down, or lifted. */
  changedTouches?: readonly TouchPoint[];
  /** Every finger still on the screen (an ended one is no longer among them). */
  touches?: readonly TouchPoint[];
  /** iOS: the fingers on the view this copy of the event was sent to. */
  targetTouches?: readonly TouchPoint[];
}

const idsOf = (list: readonly TouchPoint[] | undefined): Set<TouchId> =>
  new Set((list ?? []).flatMap((t) => (t.identifier === undefined ? [] : [t.identifier])));

/**
 * [D47] The fingers on the keys after a raw touch event on the row, by touch id. Counted by id, never by adding
 * up `changedTouches.length`: on iOS the touches that go down (or lift) in the same frame come as ONE event
 * with all of them in changedTouches, sent once to each view they landed on, and every copy bubbles up to the
 * row (React Native's RCTSurfaceTouchHandler). So:
 * - a finger joins only if this copy was sent to its view (iOS targetTouches; Android sends one finger per
 *   event, to the view the gesture began on, and no targetTouches): a finger that landed on the board in the
 *   same frame as one on a key is not ours;
 * - a copy that comes twice adds the same id twice, which is still one finger;
 * - an id no longer among the active touches is dropped at every event, so a lift the row never heard can't
 *   leave a phantom finger that holds the keys still (or out of order).
 */
export function fingersOnKeys(
  down: ReadonlySet<TouchId>,
  phase: 'start' | 'end',
  e: RowTouches,
): Set<TouchId> {
  const next = new Set(down);
  const changed = idsOf(e.changedTouches);
  if (phase === 'start') {
    const here = e.targetTouches?.length ? idsOf(e.targetTouches) : null;
    changed.forEach((id) => {
      if (!here || here.has(id)) next.add(id);
    });
  } else {
    changed.forEach((id) => next.delete(id));
  }
  if (e.touches) {
    const active = idsOf(e.touches);
    next.forEach((id) => {
      if (!active.has(id)) next.delete(id);
    });
  }
  return next;
}

function KeypadView({
  model,
  onDigit,
  onIdlePress,
  width = size.board,
  order = null,
  guard = null,
  testID = 'keypad',
}: KeypadProps) {
  // keypad.arm / keypad.idle: the whole row fades between .55 and 1 in 240 ms (opacity only, so reduced motion too).
  const target = model.enabled ? 1 : tokens.opacity.keypadIdle;
  const opacity = useSharedValue(target);
  useEffect(() => {
    opacity.set(withTiming(target, timing(motion.duration.stateChange)));
  }, [opacity, target]);
  const rowStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  // One slot is a key and its gap: a key that stands n slots from its own place moves n of them.
  const pitch = (width + size.keypadGap) / 9;
  // [D47] The fingers on the keys, by touch id (fingersOnKeys): the guard hears how many after every event.
  const fingers = useRef<ReadonlySet<TouchId>>(new Set());
  const touched = (phase: 'start' | 'end', e: GestureResponderEvent) => {
    fingers.current = fingersOnKeys(fingers.current, phase, e.nativeEvent);
    guard?.fingers(fingers.current.size);
  };
  const down = guard ? (e: GestureResponderEvent) => touched('start', e) : undefined;
  const up = guard ? (e: GestureResponderEvent) => touched('end', e) : undefined;

  return (
    <Animated.View
      style={[styles.row, { width }, rowStyle]}
      onTouchStart={down}
      onTouchEnd={up}
      onTouchCancel={up}
      testID={testID}
    >
      {model.keys.map((key) => (
        <Key
          key={key.digit}
          model={key}
          onDigit={onDigit}
          onIdlePress={onIdlePress}
          shift={(slotIn(order, key.digit) - (key.digit - 1)) * pitch}
          guard={guard}
        />
      ))}
    </Animated.View>
  );
}

/** The slot a digit's key stands in (0 = the left end): its own (digit − 1) unless the keys are scrambled. */
const slotIn = (order: readonly Digit[] | null, digit: Digit): number => {
  const slot = order ? order.indexOf(digit) : -1;
  return slot >= 0 ? slot : digit - 1;
};

const sameOrder = (a: readonly Digit[] | null | undefined, b: readonly Digit[] | null | undefined): boolean =>
  (a ?? null) === (b ?? null) || (!!a && !!b && a.length === b.length && a.every((d, k) => b[k] === d));

/** Two keys that draw the same: the game screen makes a new model on every countdown tick (4 a second). */
export const sameKey = (a: KeyModel, b: KeyModel): boolean =>
  a === b ||
  (a.digit === b.digit && a.remaining === b.remaining && a.state === b.state && a.disabled === b.disabled);

/**
 * Memoised (spec §22, 55 fps): a lock's countdown re-renders the game screen 4 times a second, and the keys
 * don't change with it. Pass stable `onDigit` / `onIdlePress` functions (and `guard`).
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
    sameOrder(a.order, b.order) &&
    a.guard === b.guard &&
    a.testID === b.testID,
);

interface KeyProps {
  model: KeyModel;
  onDigit: (digit: Digit) => void;
  onIdlePress?: (digit: Digit) => void;
  /** How far the key stands from its own place, dp (0 unless the keys are scrambled [D47]). */
  shift: number;
  guard: KeypadGuard | null;
}

/** One key; only the key whose count, state or place changed redraws (a placed digit changes one count). */
const Key = memo(
  KeyView,
  (a, b) =>
    sameKey(a.model, b.model) &&
    a.onDigit === b.onDigit &&
    a.onIdlePress === b.onIdlePress &&
    a.shift === b.shift &&
    a.guard === b.guard,
);

function KeyView({ model, onDigit, onIdlePress, shift, guard }: KeyProps) {
  const { t } = useTranslation('board');
  const { digit, state } = model;
  const armed = state === 'armed';
  const tried = state === 'tried';

  // key.press: down 3 dp in 80 ms, back up on the `press` spring (motion.md §4.1; the same under reduced motion).
  const down = useSharedValue(0);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ translateY: down.get() }] }));

  // [D47] Where the key stands: it slides there or, with reduced motion, fades out and back in there.
  const x = useSharedValue(shift);
  const seen = useSharedValue(1);
  const reduce = guard?.reduce ?? false;
  const moveMs = guard?.moveMs ?? 0;
  const fadeMs = guard?.fadeMs ?? 0;
  useEffect(() => {
    if (x.get() === shift) return;
    if (reduce) {
      // Out, moved while unseen, back in. The variant is already chosen: the phone's own Reduce Motion must not
      // skip the delay (withDelay, unlike timing(), follows it unless told Never), or the keys jump in sight.
      const half = fadeMs / 2;
      seen.set(withSequence(ReduceMotion.Never, withTiming(0, timing(half)), withTiming(1, timing(half))));
      x.set(withDelay(half, withTiming(shift, timing(0)), ReduceMotion.Never));
    } else {
      x.set(withTiming(shift, timing(moveMs)));
    }
  }, [shift, reduce, moveMs, fadeMs, x, seen]);
  const placeStyle = useAnimatedStyle(() => ({
    opacity: seen.get(),
    transform: [{ translateX: x.get() }],
  }));
  // A press that started while the keys were still moving doesn't count (it is never sent).
  const voided = useRef(false);

  const act = armed
    ? () => onDigit(digit)
    : state === 'idle' && onIdlePress
      ? () => onIdlePress(digit)
      : undefined;
  const onPress =
    act && guard
      ? () => {
          if (voided.current) guard.refused(digit);
          else act();
        }
      : act;
  const sink = armed
    ? () =>
        down.set(withTiming(tokens.elevation.keyPressed.translateY, timing(motion.duration.tapFeedbackMin)))
    : undefined;
  const onPressIn =
    act && guard
      ? () => {
          voided.current = !guard.settled();
          sink?.();
        }
      : sink;

  return (
    <Animated.View style={[styles.slot, placeStyle]} testID={`key-${digit}-place`}>
      <Pressable
        style={styles.slot}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={armed ? () => down.set(withSpring(0, springs.press)) : undefined}
        // An idle key still takes the tap (to nudge the hint) but reads as disabled.
        disabled={act ? undefined : true}
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
    </Animated.View>
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
