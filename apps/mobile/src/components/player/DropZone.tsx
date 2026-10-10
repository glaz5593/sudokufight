import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { color, radius, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { easing, NEVER_REDUCE } from './anim';
import { metrics } from './metrics';

export interface DropZoneProps {
  /** This card is where the dragged interference must land (spec §7.3). */
  active: boolean;
  /** The finger is over it. */
  hover?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

const OUTSET = -(metrics.dropTarget.padding + metrics.dropTarget.outline);

/**
 * The drop-target frame around a card (components.md §3.4): a dashed gold outline that breathes (motion.md
 * `dropzone.active`), filled while the finger is over it, and a "גרור לכאן" chip on its bottom edge. It grows
 * outwards, so the card does not move; still and solid with reduced motion. Always the same element, so the
 * card inside keeps its state when the frame comes and goes.
 */
export function DropZone({ active, hover = false, children, style }: DropZoneProps) {
  const { t } = useTranslation('player');
  const reduce = useReduceMotion();
  const scale = useSharedValue(1);
  useEffect(() => {
    if (!active || reduce) {
      cancelAnimation(scale);
      scale.set(1);
      return;
    }
    scale.set(
      withRepeat(
        withTiming(metrics.dropTarget.breatheScale, {
          duration: motion.loop.dropZoneBreathe / 2,
          easing: easing.loop,
          reduceMotion: NEVER_REDUCE,
        }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(scale);
  }, [active, reduce, scale]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <Animated.View
      style={[
        style,
        active && styles.zone,
        active && !reduce && styles.dashed,
        active && hover && styles.hover,
        anim,
      ]}
      testID={active ? 'drop-zone' : undefined}
    >
      {children}
      {active ? (
        <View style={styles.chipWrap} pointerEvents="none">
          <View style={styles.chip}>
            <Text style={[metrics.dropTarget.chipStyle, styles.chipText]}>{t('card.drop')}</Text>
          </View>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  zone: {
    margin: OUTSET,
    padding: metrics.dropTarget.padding,
    borderRadius: radius.button,
    borderWidth: metrics.dropTarget.outline,
    borderColor: color.accent,
    backgroundColor: color.surface,
  },
  dashed: { borderStyle: 'dashed' },
  hover: { backgroundColor: color.accentSubtle },
  chipWrap: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: -metrics.dropTarget.chipHeight / 2,
    alignItems: 'center',
  },
  chip: {
    height: metrics.dropTarget.chipHeight,
    paddingHorizontal: metrics.dropTarget.chipPaddingX,
    borderRadius: radius.xs,
    backgroundColor: color.accent,
    justifyContent: 'center',
  },
  chipText: { color: color.onAccent },
});

/** The opacity a card fades to (240 ms): dimmed while another card is the drop target, half when out. */
export function useCardOpacity(target: number) {
  const opacity = useSharedValue(target);
  useEffect(() => {
    opacity.set(
      withTiming(target, {
        duration: motion.duration.stateChange,
        easing: easing.standard,
        reduceMotion: NEVER_REDUCE,
      }),
    );
  }, [target, opacity]);
  return useAnimatedStyle(() => ({ opacity: opacity.get() }));
}

export const cardOpacity = (dimmed: boolean, out: boolean): number =>
  dimmed ? tokens.opacity.dimmedCard : out ? tokens.opacity.inactivePlayer : 1;
