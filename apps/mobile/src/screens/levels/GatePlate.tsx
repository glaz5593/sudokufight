import type { GateState } from '@sudoku-fight/engine';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { Icon } from '../../components/Icon';
import { MiniBar } from '../../components/levels/MiniBar';
import { Star, STAR_SIZES } from '../../components/levels/StarRow';
import { ltr } from '../../components/player/format';
import { curve } from '../../components/ui/motion';
import { color, radius, size, space, text, tokens } from '../../theme';
import { motion, reduceMotionFlag, useReduceMotion } from '../../theme/motion';
import type { LevelsT } from './levelWording';
import { type PlateState, plateState } from './mapModel';

/**
 * The gate plate under a chapter's header (components.md §19.3; the Main and Map-Gate boards), standing for
 * the gate at the end of the chapter before:
 * - **closed:** a dashed plate, a lock, "נפתח ב־20 כוכבים", a gold bar and "17/20";
 * - **enough stars, the boss not played:** "22/20" and "שחק את שלב הבוס כדי לפתוח" (the gate stays shut
 *   without the boss, plan §4.5);
 * - **open:** a solid pill, an open lock and "פרק 5 פתוח".
 * A button: a closed plate opens the gate sheet, an open one shows the chapter in the panel. The first time it is
 * seen open (`unlocking`) the shackle lifts and the words fade in (`level.gate.unlock`); Reduced Motion: only
 * the state changes.
 */

export interface GatePlateProps {
  /** The chapter the gate opens (the plate sits under its header). */
  chapter: number;
  /** The gate at the end of the chapter before (gateState). */
  gate: GateState;
  /** Width and height from the map's layout (220 × 52 closed, 120 × 44 open). */
  width: number;
  height: number;
  selected: boolean;
  /** It has just opened: play the unlock once. */
  unlocking?: boolean;
  onPress: () => void;
}

/** The plate's label: "פרק 5 נעול, 17 מתוך 20 כוכבים בפרק 4". */
export function gatePlateLabel(chapter: number, gate: GateState, state: PlateState, t: LevelsT): string {
  const values = { n: chapter, prev: chapter - 1, stars: gate.stars, need: gate.need };
  if (state === 'open') return t('gate.openLabel', values);
  return t(state === 'bossMissing' ? 'gate.bossLabel' : 'gate.lockedLabel', values);
}

export function GatePlate({
  chapter,
  gate,
  width,
  height,
  selected,
  unlocking = false,
  onPress,
}: GatePlateProps) {
  const { t } = useTranslation('levels');
  const state = plateState(gate);
  const label = gatePlateLabel(chapter, gate, state, t);
  const testID = `gate-${chapter}`;
  if (state === 'open') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        onPress={onPress}
        style={[styles.open, { width, height }]}
        testID={testID}
      >
        <View style={[styles.openPill, selected && styles.selected]} testID={`${testID}-open`}>
          <Unlocking unlocking={unlocking} />
          <Text style={styles.openText} numberOfLines={1}>
            {t('gate.open', { n: chapter })}
          </Text>
        </View>
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.closed, { width, height }, selected && styles.selected]}
      testID={testID}
    >
      <Icon name="lock" size={size.icon.inline} color={color.textMuted} />
      <View style={styles.middle}>
        <Text style={styles.need} numberOfLines={1} testID={`${testID}-line`}>
          {state === 'bossMissing' ? t('gate.boss') : t('gate.need', { need: gate.need })}
        </Text>
        <MiniBar share={gate.stars / gate.need} testID={`${testID}-bar`} />
      </View>
      <View style={styles.count}>
        <Star filled size={STAR_SIZES.panel} />
        <Text style={styles.countText} testID={`${testID}-count`}>
          {ltr(t('gate.count', { stars: gate.stars, need: gate.need }))}
        </Text>
      </View>
    </Pressable>
  );
}

/** The open lock; the first time, its shackle lifts (a turn and a fade), then the words come. */
function Unlocking({ unlocking }: { unlocking: boolean }) {
  const reduce = useReduceMotion();
  const moving = unlocking && !reduce;
  const lift = useSharedValue(moving ? 0 : 1);
  useEffect(() => {
    if (!moving) {
      lift.set(1);
      return;
    }
    lift.set(
      withDelay(
        motion.duration.reducedFade,
        withTiming(1, {
          duration: UNLOCK_MS,
          easing: curve('emphasized'),
          reduceMotion: reduceMotionFlag(false),
        }),
        reduceMotionFlag(false),
      ),
    );
  }, [moving, lift]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.4 + 0.6 * lift.get(),
    transform: [{ rotate: `${(1 - lift.get()) * -20}deg` }, { translateY: (1 - lift.get()) * 2 }],
  }));
  return (
    <Animated.View style={style} testID="gate-unlock-icon">
      <Icon name="unlock" size={OPEN_ICON} color={color.textMuted} />
    </Animated.View>
  );
}

/** motion.md `level.gate.unlock`: the shackle 360 ms. */
const UNLOCK_MS = 360;
const OPEN_ICON = 14;
const OPEN_PILL = 32;

const styles = StyleSheet.create({
  closed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[5],
    paddingHorizontal: space[7],
    borderRadius: radius.lg,
    borderWidth: tokens.border.hairline,
    borderStyle: 'dashed',
    borderColor: color.iconFaint,
    backgroundColor: color.surface,
  },
  selected: { borderColor: color.text },
  middle: { flex: 1, minWidth: 0, gap: space[3] },
  need: { ...text('buttonSm'), color: color.text },
  count: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  countText: { ...text('scoreDelta'), color: color.text },
  open: { alignItems: 'center', justifyContent: 'center' },
  openPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    height: OPEN_PILL,
    paddingHorizontal: space[6],
    borderRadius: radius.pill,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  openText: { ...text('label'), color: color.text },
});
