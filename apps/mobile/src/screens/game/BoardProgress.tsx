import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ltr, paletteAt, sameProps, sameStyle } from '../../components/player';
import { metrics } from '../../components/player/metrics';
import { Text } from '../../components/ui/Text';
import { color, radius, size, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';

/**
 * The board's progress in solo practice (Game-Solo: "50/81"), where a game with opponents has its lead bar
 * (components.md §9): a 4 dp bar in my colour that fills from the start edge, and a tag at the fill's end. The
 * fill moves over 650 ms like the lead bar (motion.md `dominance.bar`), scaleX only; it jumps with reduced
 * motion.
 */
export interface BoardProgressProps {
  filled: number;
  total: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const ME = paletteAt(0);
const standard = Easing.bezier(...motion.easing.standard);

/** A flex share that follows `share` (the tag's spacers, as LeadBar places its tag). */
function useShare(share: number, reduce: boolean) {
  const value = useSharedValue(share);
  useEffect(() => {
    value.set(
      reduce
        ? share
        : withTiming(share, {
            duration: motion.duration.dominanceSlide,
            easing: standard,
            reduceMotion: ReduceMotion.Never,
          }),
    );
  }, [share, reduce, value]);
  return value;
}

export const BoardProgress = memo(function BoardProgress({
  filled,
  total,
  style,
  testID = 'board-progress',
}: BoardProgressProps) {
  const { t } = useTranslation('game');
  const reduce = useReduceMotion();
  const share = total > 0 ? Math.min(1, Math.max(0, filled / total)) : 0;
  const value = useShare(share, reduce);
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: value.get() }] }));
  const before = useAnimatedStyle(() => ({ flexGrow: value.get() }));
  const after = useAnimatedStyle(() => ({ flexGrow: 1 - value.get() }));

  return (
    <View
      style={[styles.wrap, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('progress.label')}
      accessibilityValue={{
        min: 0,
        max: total,
        now: filled,
        text: t('progress.a11y', { count: total, filled, total }),
      }}
      testID={testID}
    >
      <View style={styles.track}>
        <Animated.View style={[styles.fill, fill]} />
      </View>
      <View style={styles.tagRow} pointerEvents="none">
        <Animated.View style={[styles.spacer, before]} />
        <View style={styles.anchor}>
          <View style={styles.tag}>
            <Text style={[metrics.lead.tagStyle, styles.tagText]} testID={`${testID}-value`}>
              {ltr(t('progress.value', { filled, total }))}
            </Text>
          </View>
        </View>
        <Animated.View style={[styles.spacer, after]} />
      </View>
    </View>
  );
}, sameProgress);

/** The screen renders 4 times a second; the bar only when the board's count or its look changed. */
function sameProgress(a: BoardProgressProps, b: BoardProgressProps): boolean {
  return sameProps(a, b, { style: sameStyle });
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  track: {
    height: size.dominanceBar.height,
    borderRadius: radius.bar,
    backgroundColor: color.progress.timerTrack,
    overflow: 'hidden',
  },
  fill: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.bar,
    backgroundColor: ME.ring,
    transformOrigin: I18nManager.isRTL ? 'right' : 'left',
  },
  tagRow: {
    marginTop: metrics.lead.tagTop,
    height: metrics.lead.tagHeight,
    flexDirection: 'row',
  },
  spacer: { flexBasis: 0, minWidth: metrics.lead.edgeMin },
  anchor: { width: 0, alignItems: 'center', overflow: 'visible' },
  tag: {
    position: 'absolute',
    top: 0,
    height: metrics.lead.tagHeight,
    paddingHorizontal: metrics.lead.tagPaddingX,
    borderRadius: metrics.lead.tagRadius,
    borderWidth: tokens.border.hairline,
    borderColor: ME.ring,
    backgroundColor: color.bg,
    justifyContent: 'center',
  },
  tagText: { color: ME.ring },
});
