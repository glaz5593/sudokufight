import { type ReactNode, useEffect, useState } from 'react';
import { BackHandler, I18nManager, Pressable, type Role, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { color, tokens } from '../../../theme';
import { motion } from '../../../theme/motion';
import { type Placement, POPOVER } from './model';

/**
 * The popover of my reactions picker and of an opponent's card menu (components.md §8.2): a small surface under
 * a card, with an arrow pointing up at what opened it. It opens with a pop (200 ms `pop` spring from 0.6,
 * motion.md `reactions.strip`) and closes with a 120 ms fade (`reaction.pick`). Reduced motion: it fades in
 * over 140 ms, no scale. An outside tap, Android back and the iOS escape gesture close it; screen readers stay
 * inside it (the outside is one button, "סגירה").
 *
 * The layer covers the screen it is drawn in (the game screen's root, the coordinates of `placement`) and is
 * LTR, so `left` / `right` are physical like the measured rects; the content takes the app's direction.
 */

/** The scale a popover and its emoji pop from (DS-Motion `sf-pop`). */
export const POP_FROM = 0.6;
/** Reduced motion: the popover fades in over 140 ms (motion.md §4.5). */
export const REDUCED_IN_MS = motion.duration.tapFeedbackMax;
export const IN_MS = motion.duration.reactionStripIn;
export const OUT_MS = motion.duration.reactionStripOut;

const never = { reduceMotion: ReduceMotion.Never };
const standard = Easing.bezier(...motion.easing.standard);
const exit = Easing.bezier(...motion.easing.exit);

/** A spring that always plays (the reduced variant is chosen by hand, motion.md §6). */
export const popSpring = { ...motion.spring.pop, ...never };

/**
 * Keeps the popover mounted while it fades out. `fade` runs 0 → 1 → 0; `pop` is its scale (1 with reduced
 * motion). Reopening during the exit takes it back.
 */
export function usePopover(
  visible: boolean,
  reduce: boolean,
): { mounted: boolean; fade: SharedValue<number>; pop: SharedValue<number> } {
  const [mounted, setMounted] = useState(visible);
  const fade = useSharedValue(0);
  const pop = useSharedValue(reduce ? 1 : POP_FROM);

  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      if (reduce) {
        pop.set(1);
        fade.set(withTiming(1, { duration: REDUCED_IN_MS, easing: standard, ...never }));
      } else {
        // From closed it always pops from 0.6 (also after a reduced-motion close left it at 1).
        if (fade.get() === 0) pop.set(POP_FROM);
        pop.set(withSpring(1, popSpring));
        fade.set(withTiming(1, { duration: IN_MS, easing: standard, ...never }));
      }
      return;
    }
    fade.set(
      withTiming(0, { duration: OUT_MS, easing: exit, ...never }, (finished) => {
        if (finished) scheduleOnRN(setMounted, false);
      }),
    );
    if (!reduce) pop.set(withTiming(POP_FROM, { duration: OUT_MS, easing: exit, ...never }));
  }, [visible, reduce, fade, pop]);

  return { mounted: mounted || visible, fade, pop };
}

export interface PopoverProps {
  visible: boolean;
  reduce: boolean;
  placement: Placement;
  /** Known for the picker (six buttons); the menu sizes to its text. */
  width?: number;
  onClose: () => void;
  /** The outside area, for screen readers: "סגירת התגובות". */
  closeLabel: string;
  role: Extract<Role, 'group' | 'menu'>;
  accessibilityLabel: string;
  children: ReactNode;
  testID?: string;
}

export function Popover({
  visible,
  reduce,
  placement,
  width,
  onClose,
  closeLabel,
  role,
  accessibilityLabel,
  children,
  testID,
}: PopoverProps) {
  const { mounted, fade, pop } = usePopover(visible, reduce);

  // Android back closes the popover first (the screen's own handler, added earlier, runs after this one).
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const style = useAnimatedStyle(() => ({ opacity: fade.get(), transform: [{ scale: pop.get() }] }));

  if (!mounted) return null;

  const { side, inset, top, arrow } = placement;
  const originX =
    width === undefined ? (side === 'left' ? 0 : '100%') : side === 'left' ? arrow : width - arrow;
  return (
    <View
      style={styles.layer}
      pointerEvents={visible ? 'box-none' : 'none'}
      accessibilityViewIsModal={visible}
      // Closing: gone for screen readers at once, while it fades out.
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      testID={testID && `${testID}-layer`}
    >
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        style={StyleSheet.absoluteFill}
        testID={testID && `${testID}-outside`}
      />
      <Animated.View
        style={[
          styles.popover,
          { top, [side]: inset, transformOrigin: [originX, 0, 0] },
          width === undefined ? null : { width },
          style,
        ]}
        testID={testID}
      >
        <View
          role={role}
          accessibilityLabel={accessibilityLabel}
          onAccessibilityEscape={onClose}
          style={[styles.box, { direction: I18nManager.isRTL ? 'rtl' : 'ltr' }]}
        >
          {children}
        </View>
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.arrow, { [side]: arrow - POPOVER.arrow / 2 }]}
          testID={testID && `${testID}-arrow`}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFill, direction: 'ltr' },
  popover: { position: 'absolute' },
  box: {
    padding: POPOVER.padding,
    borderRadius: POPOVER.radius,
    borderWidth: POPOVER.border,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  // A square turned 45°: its top and left borders become the two upper edges, and its fill hides the box's
  // border under it (components.md §8.2: "a 14 dp arrow, same fill and border").
  arrow: {
    position: 'absolute',
    top: -POPOVER.arrow / 2,
    width: POPOVER.arrow,
    height: POPOVER.arrow,
    backgroundColor: color.surface,
    borderColor: color.border,
    borderTopWidth: tokens.border.hairline,
    borderLeftWidth: tokens.border.hairline,
    transform: [{ rotate: '45deg' }],
  },
});
