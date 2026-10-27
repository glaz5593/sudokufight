import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { color, radius, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { Text } from '../ui/Text';
import { easing, NEVER_REDUCE } from './anim';
import { metrics } from './metrics';

export interface TargetFrameProps {
  /** The interference picker is open from this card's "הפרעה" button: this card is its target [D45]. */
  targeted: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

const OUTSET = -(metrics.targetFrame.padding + metrics.targetFrame.outline);

/**
 * The target frame around a card (components.md §3.4) while the interference picker is open from it [D45]: a
 * solid 2 dp accent outline and an "יעד" chip on its bottom edge, so it is clear whom the picker will hit
 * (original §17: in 3–4 players the target is the card whose button was tapped). Static, so nothing moves under
 * Reduced Motion either. It grows outwards, so the card does not move, and it is always the same element, so
 * the card inside keeps its state when the frame comes and goes.
 */
export function TargetFrame({ targeted, children, style }: TargetFrameProps) {
  const { t } = useTranslation('player');
  return (
    <View style={[style, targeted && styles.frame]} testID={targeted ? 'target-frame' : undefined}>
      {children}
      {targeted ? (
        <View style={styles.chipWrap} pointerEvents="none">
          <View style={styles.chip}>
            <Text style={[metrics.targetFrame.chipStyle, styles.chipText]} numberOfLines={1}>
              {t('card.target')}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    margin: OUTSET,
    padding: metrics.targetFrame.padding,
    borderRadius: radius.button,
    borderWidth: metrics.targetFrame.outline,
    borderColor: color.accent,
    backgroundColor: color.surface,
  },
  chipWrap: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: -metrics.targetFrame.chipHeight / 2,
    alignItems: 'center',
  },
  chip: {
    height: metrics.targetFrame.chipHeight,
    paddingHorizontal: metrics.targetFrame.chipPaddingX,
    borderRadius: radius.xs,
    backgroundColor: color.accent,
    justifyContent: 'center',
  },
  chipText: { color: color.onAccent },
});

/**
 * The opacity a card fades to (240 ms): dimmed while another card is the picker's target, half when out. With
 * reduced motion it changes at once.
 */
export function useCardOpacity(target: number) {
  const reduce = useReduceMotion();
  const opacity = useSharedValue(target);
  useEffect(() => {
    if (reduce) {
      opacity.set(target);
      return;
    }
    opacity.set(
      withTiming(target, {
        duration: motion.duration.stateChange,
        easing: easing.standard,
        reduceMotion: NEVER_REDUCE,
      }),
    );
  }, [target, reduce, opacity]);
  return useAnimatedStyle(() => ({ opacity: opacity.get() }));
}

export const cardOpacity = (dimmed: boolean, out: boolean): number =>
  dimmed ? tokens.opacity.dimmedCard : out ? tokens.opacity.inactivePlayer : 1;
