import type { InterferenceKind } from '@sudoku-fight/engine';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { type AccessibilityActionEvent, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { ReduceMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Icon } from '../../../components/Icon';
import { color, tokens } from '../../../theme';
import { motion } from '../../../theme/motion';
import { curve } from '../../../components/ui/motion';
import { type ArsenalToken, inZone, launchable } from './arsenalModel';
import { type DragValues, landingOf } from './drag';
import { arsenalMetrics as m } from './metrics';
import { TokenArt } from './TokenArt';
import { blockedPill, kindTitle, tokenLabel } from './wording';

export interface TokenCardProps {
  token: ArsenalToken;
  /** The target's display name, for the labels. */
  targetName: string;
  drag: DragValues;
  reduce: boolean;
  /** This token is in the finger: its slot shows "בגרירה…". */
  dragging: boolean;
  /** Another token is in the finger: this one can't start a second drag. */
  locked: boolean;
  /** The tap hint over this token, while it shows. */
  bubble: string | null;
  onLift: (kind: InterferenceKind) => void;
  onHover: (inside: boolean) => void;
  /** Let go: `launch` when released inside the zone and still launchable. */
  onRelease: (kind: InterferenceKind, launch: boolean) => void;
  /** The ghost has landed or gone back. */
  onSettled: () => void;
  /** A tap (or a screen reader's activate): never a launch (D18), only a hint. */
  onTap: (kind: InterferenceKind) => void;
}

const LIFT = m.ghost.lift;
const press = { ...motion.spring.press, reduceMotion: ReduceMotion.Never };
const settle = { ...motion.spring.settle, reduceMotion: ReduceMotion.Never };
const shrink = { duration: m.launch.shrinkMs, easing: curve('exit'), reduceMotion: ReduceMotion.Never };

/**
 * One token in the arsenal (components.md §13: 108 × 136, its live preview, its name and the cost pill), and
 * its drag (spec §7.3.2–4, motion.md `token.lift` / `launch` / `launch.cancel`). The Pan gesture runs on the UI
 * thread: it moves the ghost, tests the finger against the one drop zone, and on release either shrinks the
 * ghost into the card (launch) or springs it back (cancel). A token that can't be launched never starts a
 * drag; a tap only shows the hint, it never launches (D18: drag only). Reduced motion: no lift, no flight
 * back or into the card; the ghost still follows the finger and the drop works the same.
 */
export function TokenCard({
  token,
  targetName,
  drag,
  reduce,
  dragging,
  locked,
  bubble,
  onLift,
  onHover,
  onRelease,
  onSettled,
  onTap,
}: TokenCardProps) {
  const { t } = useTranslation('game');
  const { kind } = token;
  const ready = launchable(token);
  // Read at the moment of release, on the UI thread: the score may have dropped mid-drag.
  const can = useSharedValue(ready);
  useEffect(() => {
    can.set(ready);
  }, [can, ready]);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(ready && !locked)
      .minDistance(m.dragSlop)
      .withTestId(`arsenal-drag-${kind}`)
      .onStart((e) => {
        'worklet';
        drag.startX.set(e.absoluteX - e.translationX);
        drag.startY.set(e.absoluteY - e.translationY);
        drag.tx.set(e.translationX);
        drag.ty.set(e.translationY);
        drag.hover.set(false);
        drag.scale.set(1);
        if (!reduce) drag.scale.set(withSpring(LIFT, press));
        scheduleOnRN(onLift, kind);
      })
      .onUpdate((e) => {
        'worklet';
        drag.tx.set(e.translationX);
        drag.ty.set(e.translationY);
        const inside = inZone(drag.zone.get(), e.absoluteX, e.absoluteY);
        if (inside !== drag.hover.get()) {
          drag.hover.set(inside);
          scheduleOnRN(onHover, inside);
        }
      })
      .onEnd((e, success) => {
        'worklet';
        const zone = drag.zone.get();
        const launch = success && can.get() && zone !== null && inZone(zone, e.absoluteX, e.absoluteY);
        drag.hover.set(false);
        scheduleOnRN(onRelease, kind, launch);
        if (reduce) {
          // Gone at once: no flight into the card and none back to the slot (the token is back in it).
          drag.scale.set(0);
          scheduleOnRN(onSettled);
          return;
        }
        if (launch && zone !== null) {
          const to = landingOf(drag, zone);
          drag.tx.set(withTiming(to.x, shrink));
          drag.ty.set(withTiming(to.y, shrink));
          drag.scale.set(
            withTiming(0, shrink, (done) => {
              if (done) scheduleOnRN(onSettled);
            }),
          );
          return;
        }
        drag.tx.set(withSpring(0, settle));
        drag.scale.set(withSpring(1, settle));
        drag.ty.set(
          withSpring(0, settle, (done) => {
            if (done) scheduleOnRN(onSettled);
          }),
        );
      });
    const tap = Gesture.Tap()
      .maxDistance(m.dragSlop)
      .withTestId(`arsenal-tap-${kind}`)
      .onEnd((_e, success) => {
        'worklet';
        if (success) scheduleOnRN(onTap, kind);
      });
    return Gesture.Race(pan, tap);
  }, [ready, locked, kind, drag, reduce, can, onLift, onHover, onRelease, onSettled, onTap]);

  const blocked = !ready;
  const label = tokenLabel(token, targetName, t);
  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'activate') onTap(kind);
  };

  return (
    <View style={styles.wrap}>
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled: blocked }}
          accessibilityActions={[{ name: 'activate' }]}
          onAccessibilityAction={onAction}
          style={[styles.token, dragging && styles.slot, !dragging && blocked && styles.blocked]}
          testID={`arsenal-token-${kind}`}
        >
          {dragging ? (
            <View style={styles.slotInner}>
              <View style={styles.slotArt}>
                <TokenArt kind={kind} size={m.token.art} still />
              </View>
              <Text style={[m.token.pillTextStyle, styles.slotText]}>{t('arsenal.dragging')}</Text>
            </View>
          ) : (
            <>
              <TokenArt kind={kind} size={m.token.art} still={reduce || !token.unlocked} />
              <Text style={[m.token.nameStyle, styles.name]} numberOfLines={1}>
                {kindTitle(kind, t)}
              </Text>
              <View style={styles.pill}>
                <Icon
                  name={token.unlocked ? 'bolt' : 'lock'}
                  size={m.token.pill.icon}
                  color={blocked ? color.textMuted : color.accent}
                />
                <Text
                  style={blocked ? [m.token.pillTextStyle, styles.muted] : [m.token.pillStyle, styles.cost]}
                  numberOfLines={1}
                >
                  {blockedPill(token, t)}
                </Text>
              </View>
            </>
          )}
        </View>
      </GestureDetector>
      {bubble ? (
        <View style={styles.bubbleRow} pointerEvents="none">
          <View style={styles.bubble} testID={`arsenal-bubble-${kind}`}>
            <Text style={[m.token.pillTextStyle, styles.bubbleText]}>{bubble}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Up to 108 wide; narrower on a small screen, so three always fit in the tray.
  wrap: { flex: 1, maxWidth: m.token.width },
  token: {
    height: m.token.height,
    paddingTop: m.token.paddingTop,
    alignItems: 'center',
    borderRadius: m.token.radius,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface2,
  },
  blocked: { opacity: tokens.opacity.inactivePlayer },
  // The empty slot while its token is in the finger: a dashed gold outline (Interference-Drag).
  slot: {
    borderWidth: m.token.dashed,
    borderStyle: 'dashed',
    borderColor: color.accent,
    backgroundColor: color.accentSubtle,
    justifyContent: 'center',
    paddingTop: 0,
  },
  slotInner: { alignItems: 'center', gap: m.token.pill.gap },
  slotArt: { opacity: tokens.opacity.disabled },
  slotText: { color: color.accent },
  name: { color: color.text, marginTop: m.token.nameTop },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: m.token.pill.gap,
    height: m.token.pill.height,
    marginTop: m.token.pill.gap,
    paddingHorizontal: m.token.pill.paddingX,
    borderRadius: m.token.pill.radius,
    backgroundColor: color.bg,
  },
  cost: { color: color.accent },
  muted: { color: color.textMuted },
  // The hint over the token: centred on it, and free to be wider than it.
  bubbleRow: {
    position: 'absolute',
    bottom: m.token.height + m.token.pill.gap,
    start: -m.token.width,
    end: -m.token.width,
    alignItems: 'center',
  },
  bubble: {
    paddingHorizontal: m.bubble.paddingX,
    paddingVertical: m.bubble.paddingY,
    borderRadius: m.bubble.radius,
    backgroundColor: color.accent,
  },
  bubbleText: { color: color.onAccent, textAlign: 'center' },
});
