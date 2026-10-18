import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { color, radius, text, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { Icon } from '../Icon';
import { easing, NEVER_REDUCE } from './anim';
import { metrics } from './metrics';

/**
 * Small pieces of the cards: the reconnect pill (§3.3), the hit chip (§3.4), the rank badge (§6) and the VS
 * badge (§3.5). All decorative: the card's label says the same in words.
 */

const hidden = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

/**
 * "Reconnecting… 12": replaces the ⚡ button while an opponent is disconnected (§3.3). Without `seconds`, the
 * icon alone: the opponent's connection is lost but still in its soft phase [D42] (no countdown, the game goes
 * on).
 */
export function ReconnectPill({
  seconds = null,
  compact = false,
}: {
  seconds?: number | null;
  compact?: boolean;
}) {
  const h = compact ? metrics.reconnectPill.compactHeight : metrics.reconnectPill.height;
  const iconOnly = seconds === null;
  return (
    <View
      style={[
        styles.pill,
        { height: h, borderRadius: h / 2 },
        iconOnly ? [styles.iconOnly, { width: h }] : null,
      ]}
      testID={iconOnly ? 'unstable-pill' : 'reconnect-pill'}
      {...hidden}
    >
      <Icon
        name="wifiOff"
        size={metrics.reconnectPill.icon}
        color={iconOnly ? color.status.unstable : color.textMuted}
      />
      {iconOnly ? null : (
        <Text style={[compact ? metrics.interfere.compactCostStyle : text('scoreSm'), styles.text]}>
          {String(seconds)}
        </Text>
      )}
    </View>
  );
}

/** The small ⚡ chip on the avatar of a player under interference, with the seconds left (§3.4, spec §7.4). */
export function HitChip({ seconds, style }: { seconds: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.hit, style]} testID="hit-chip" {...hidden}>
      <Icon name="bolt" size={metrics.hitChip.icon} color={color.textMuted} />
      <Text style={[metrics.hitChip.secondsStyle, styles.muted]}>{String(seconds)}</Text>
    </View>
  );
}

/**
 * "#1" on a compact card (§6): gold for the leader only. When the place changes the badge slides 8 dp and
 * fades in (240 ms); with reduced motion it only fades.
 */
export function RankBadge({ place, style }: { place: number; style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation('player');
  const reduce = useReduceMotion();
  const first = place === 1;
  const shift = useSharedValue(0);
  const fade = useSharedValue(1);
  const last = useRef(place);
  useEffect(() => {
    if (last.current === place) return;
    last.current = place;
    const timing = {
      duration: motion.duration.stateChange,
      easing: easing.standard,
      reduceMotion: NEVER_REDUCE,
    };
    fade.set(0);
    fade.set(withTiming(1, timing));
    shift.set(reduce ? 0 : metrics.rankBadge.slide);
    shift.set(withTiming(0, timing));
  }, [place, reduce, fade, shift]);
  const anim = useAnimatedStyle(() => ({ opacity: fade.get(), transform: [{ translateY: shift.get() }] }));
  return (
    <Animated.View
      style={[styles.rank, first ? styles.rankFirst : styles.rankOther, anim, style]}
      {...hidden}
    >
      <Text style={[metrics.rankBadge.style, { color: first ? color.onAccent : color.text }]}>
        {t('rank', { place })}
      </Text>
    </Animated.View>
  );
}

/** The skewed "VS" between the two cards (§3.5). */
export function VsBadge({ style }: { style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation('player');
  return (
    <View style={[styles.vs, style]} {...hidden}>
      <Text style={[text('vsBadge'), styles.vsText]}>{t('vs')}</Text>
    </View>
  );
}

const SKEW = `${tokens.effects.skewXDeg}deg`;
const UNSKEW = `${-tokens.effects.skewXDeg}deg`;

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: metrics.reconnectPill.gap,
    paddingHorizontal: metrics.reconnectPill.paddingX,
    backgroundColor: color.bg,
    borderWidth: tokens.border.hairline,
    borderColor: color.textMuted,
  },
  // The soft phase's mark [D42]: a round chip with the wifi-off icon in the amber of the presence dot.
  iconOnly: { paddingHorizontal: 0, justifyContent: 'center', borderColor: color.status.unstable },
  text: { color: color.text },
  muted: { color: color.textMuted },
  hit: {
    height: metrics.hitChip.height,
    borderRadius: metrics.hitChip.radius,
    paddingHorizontal: metrics.hitChip.paddingX,
    flexDirection: 'row',
    alignItems: 'center',
    gap: metrics.hitChip.gap,
    backgroundColor: color.surface2,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  rank: {
    height: metrics.rankBadge.height,
    minWidth: metrics.rankBadge.minWidth,
    paddingHorizontal: metrics.rankBadge.paddingX,
    borderRadius: radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankFirst: { backgroundColor: color.accent },
  rankOther: {
    backgroundColor: color.surface2,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  vs: {
    width: metrics.vs.width,
    height: metrics.vs.height,
    borderRadius: radius.xs,
    backgroundColor: color.vsBadge.bg,
    borderWidth: tokens.border.hairline,
    borderColor: color.vsBadge.border,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ skewX: SKEW }],
  },
  vsText: { color: color.vsBadge.text, transform: [{ skewX: UNSKEW }] },
});
