import type { InterferenceKind } from '@sudoku-fight/engine';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { color, radius, tokens } from '../../../theme';
import { curve } from '../../../components/ui/motion';
import type { Rect } from '../geometry';
import { type DragValues, ghostOffset } from './drag';
import { arsenalMetrics as m } from './metrics';
import { TokenArt } from './TokenArt';
import { ghostText, routeText } from './wording';

export interface DragGhostProps {
  kind: InterferenceKind;
  cost: number;
  /** 3–4 players: the route "אני ← NinaVolt" under the name (spec §7.3.5). */
  routeTo?: string | null;
  drag: DragValues;
  reduce: boolean;
}

/**
 * What the finger carries (spec §7.3.2, components.md §13 "Drag ghost"): the small live preview, "זיקוקים · 8
 * נק׳", and in 3–4 players the route. It follows the finger 1:1 a little above it, lifted to 1.08 (none with
 * reduced motion); its position and scale come from the drag's shared values, so it moves on the UI thread.
 * Decorative: the overlay's live region says what is being dragged.
 */
export function DragGhost({ kind, cost, routeTo, drag, reduce }: DragGhostProps) {
  const { t } = useTranslation('game');
  const style = useAnimatedStyle(() => {
    const at = ghostOffset(drag);
    const scale = drag.scale.get();
    return { opacity: scale > 0 ? 1 : 0, transform: [{ translateX: at.x }, { translateY: at.y }, { scale }] };
  });
  const onLayout = (e: LayoutChangeEvent) => {
    drag.ghostWidth.set(e.nativeEvent.layout.width);
    drag.ghostHeight.set(e.nativeEvent.layout.height);
  };
  return (
    <Animated.View style={[styles.place, style]} onLayout={onLayout} testID="arsenal-ghost">
      {/* Placed in physical coordinates; its content reads in the app's direction. */}
      <View style={[styles.ghost, I18nManager.isRTL ? styles.rtl : styles.ltr]}>
        <TokenArt kind={kind} size={m.ghost.art} still={reduce} />
        <View>
          <Text style={[m.ghost.textStyle, styles.text]} numberOfLines={1}>
            {ghostText(kind, cost, t)}
          </Text>
          {routeTo ? (
            <Text style={[m.ghost.routeStyle, styles.route]} numberOfLines={1}>
              {routeText(routeTo, t)}
            </Text>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

export interface LaunchRippleProps {
  /** The drop zone, in the overlay's coordinates. */
  zone: Rect;
  onDone: () => void;
}

const RIPPLE_FROM = m.ripple.from;
const RIPPLE_GROW = m.ripple.scale - 1;
const rippleTiming = {
  duration: m.ripple.ms,
  easing: curve('standard'),
  reduceMotion: ReduceMotion.Never,
};

/**
 * A stroke ring that ripples out of the target card as the token lands (motion.md `launch`: scale 1 → 1.15,
 * opacity 0.6 → 0, 480 ms). Full motion only; never touchable.
 */
export function LaunchRipple({ zone, onDone }: LaunchRippleProps) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(
      withTiming(1, rippleTiming, (done) => {
        if (done) scheduleOnRN(onDone);
      }),
    );
  }, [p, onDone]);
  const style = useAnimatedStyle(() => ({
    opacity: RIPPLE_FROM * (1 - p.get()),
    transform: [{ scale: 1 + RIPPLE_GROW * p.get() }],
  }));
  const place = { left: zone.x, top: zone.y, width: zone.width, height: zone.height };
  return <Animated.View style={[styles.ripple, place, style]} pointerEvents="none" testID="arsenal-ripple" />;
}

const styles = StyleSheet.create({
  place: { position: 'absolute', left: 0, top: 0 },
  ltr: { direction: 'ltr' },
  rtl: { direction: 'rtl' },
  ghost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: m.ghost.gap,
    paddingHorizontal: m.ghost.paddingX,
    paddingVertical: m.ghost.paddingY,
    borderRadius: m.ghost.radius,
    borderWidth: tokens.border.hairline,
    borderColor: color.accent,
    backgroundColor: color.surface2,
  },
  text: { color: color.text },
  route: { color: color.textMuted },
  ripple: {
    position: 'absolute',
    borderRadius: radius.button,
    borderWidth: m.ripple.width,
    borderColor: color.accent,
  },
});
