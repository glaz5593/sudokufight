import { type AppLevel, levelNumber, type LevelView } from '@sudoku-fight/engine';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Icon, type IconName } from '../../../components/Icon';
import { StarsBar } from '../../../components/levels/StarsBar';
import { ltr, secondsOf } from '../../../components/player/format';
import { IconButton } from '../../../components/ui';
import { timing } from '../../../components/ui/motion';
import { LEVEL_UI, type LevelUiSettings } from '../../../config/levels';
import { allLevels } from '../../../levels/levelsData';
import { color, radius, size, space, text, tokens } from '../../../theme';
import { motion, useReduceMotion } from '../../../theme/motion';
import { secondsText } from '../../home/homeModel';
import { levelClock, PenaltyChip, StageHeader } from './FindHud';

/**
 * Spot the error's HUD (components.md §19.6, the Idea-1 board; plan Idea-1): the stage's header; the goal,
 * "בלוח מסתתרות 2 ספרות שגויות. הקש עליהן.", and under it, muted, "הספרות הכהות הן של הלוח, והן תמיד נכונות.";
 * a magnifier for each error ("נמצאו 1/2"), one filling as its error is found; the stage's clock with the
 * "‎+5 ש׳" of a tap on a right digit beside it; and the star meter of its time. Under the board (in place of the
 * keypad), the tip card in the kind's first LEVEL_UI.tipLevels stages, which the player can close.
 *
 * The board itself is TapLevelScreen's ("mine" digits in P1 with ●, a found error struck with the right digit
 * small and a green ring, the errors not found framed at the end). Every number here is the engine's view.
 *
 * Motion: a magnifier fills over 240 ms (`level.spot.found`); the penalty chip comes in, holds 1.2 s and goes
 * (`level.miss.flash`). Reduced Motion: the magnifier is full at once; the chip only fades.
 */

export interface SpotErrorHudProps {
  /** The stage as played (a spotError). */
  level: AppLevel;
  /** GameView.level of the tap engine. */
  view: LevelView;
  /** The stage's time now. */
  now: number;
  /** The "‎+5 ש׳" of my last tap on a right digit (its id plays it again). */
  penalty?: { id: number; ms: number } | null;
  onExit?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function SpotErrorHud({ level, view, now, penalty = null, onExit, style }: SpotErrorHudProps) {
  const { t } = useTranslation('levels');
  const total = level.kind === 'spotError' ? level.targets.errors.length : 0;
  const found = Math.min(total, view.find?.found.length ?? 0);
  const { elapsedMs } = levelClock(view, now);
  const limit = view.limitMs ?? 0;
  return (
    <View style={[styles.hud, style]} testID="spot-hud">
      <StageHeader level={level} onExit={onExit} />
      <View style={styles.goal}>
        <Text style={styles.goalText} testID="spot-goal">
          {t('hud.spotError.goal', { count: total })}
        </Text>
        <Text style={styles.note} testID="spot-note">
          {t('hud.spotError.note')}
        </Text>
      </View>
      <View style={styles.row}>
        <View
          style={styles.found}
          accessible
          accessibilityLabel={t('hud.spotError.foundLabel', { found, total })}
          testID="spot-found"
        >
          {Array.from({ length: total }, (_, i) => (
            <Lens key={i} found={i < found} testID={`spot-lens-${i}`} />
          ))}
          <Text style={styles.foundWord}>{t('hud.spotError.found')}</Text>
          <Text style={styles.count} testID="spot-found-count">
            {ltr(`${found}/${total}`)}
          </Text>
        </View>
        <View style={styles.time}>
          {penalty ? <FlashPenaltyChip key={penalty.id} ms={penalty.ms} style={FLASH_CHIP_SLOT} /> : null}
          <View
            style={styles.clock}
            accessible
            accessibilityRole="timer"
            accessibilityLabel={t('hud.spotError.timeLabel', {
              s: secondsOf(elapsedMs),
              limit: secondsOf(limit),
            })}
            testID="spot-clock"
          >
            <Text style={styles.clockWord}>{t('hud.spotError.time')}</Text>
            <Text style={styles.clockValue} testID="spot-clock-value">
              {secondsText(elapsedMs)}
            </Text>
            <Text style={styles.clockWord}>{t('units.seconds')}</Text>
          </View>
        </View>
      </View>
      <StarsBar rule={view.marks} value={elapsedMs} max={view.limitMs ?? undefined} />
    </View>
  );
}

/** A magnifier slot: faint while its error hides, success-tinted once found (it fills, `level.spot.found`). */
function Lens({ found, testID }: { found: boolean; testID: string }) {
  const reduce = useReduceMotion();
  const fill = useSharedValue(found ? 1 : 0);
  useEffect(() => {
    const to = found ? 1 : 0;
    fill.set(reduce ? to : withTiming(to, timing(motion.duration.stateChange, 'standard', reduce)));
  }, [found, reduce, fill]);
  const fillStyle = useAnimatedStyle(() => ({ opacity: fill.get() }));
  return (
    <View
      style={[styles.lens, found ? styles.lensFound : null]}
      testID={`${testID}-${found ? 'found' : 'open'}`}
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.lensFill, fillStyle]}
        testID={`${testID}-fill`}
      />
      <Icon name="search" size={LENS_ICON} color={found ? color.success : color.iconFaint} filled={found} />
    </View>
  );
}

/**
 * "‎+5 ש׳" beside the clock (components.md §19.5, motion.md `level.miss.flash`): in over 240 ms, held 1.2 s, out
 * over 240 ms. Reduced Motion: the same fades, nothing scales. Decorative: the live region says the penalty.
 * It hangs off the clock's start side (FLASH_CHIP_SLOT), so the clock never moves for it.
 */
export function FlashPenaltyChip({
  ms,
  style,
  testID = 'penalty-chip',
}: {
  ms: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { t } = useTranslation('levels');
  const reduce = useReduceMotion();
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.set(
      withSequence(
        withTiming(1, timing(motion.duration.stateChange, 'standard', reduce)),
        withDelay(CHIP_HOLD_MS, withTiming(0, timing(motion.duration.stateChange, 'exit', reduce))),
      ),
    );
  }, [opacity, reduce]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.View style={[style, fade]} pointerEvents="none">
      <PenaltyChip ms={ms} t={t} testID={testID} />
    </Animated.View>
  );
}

/** How long the penalty chip holds between its fades (motion.md `level.miss.flash`). */
const CHIP_HOLD_MS = 1200;

/** Where FlashPenaltyChip hangs: off the start side of the clock it is beside (its parent). */
export const FLASH_CHIP_SLOT: ViewStyle = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  end: '100%',
  marginEnd: space[4],
  justifyContent: 'center',
};

/**
 * Is a kind's tip card shown on this stage: one of the first LEVEL_UI.tipLevels stages of `kind` (the stage's
 * data). Spot the error and the chain [D64] have one.
 */
export function kindTipShown(
  kind: Extract<AppLevel['kind'], 'spotError' | 'chain'>,
  level: Pick<AppLevel, 'id' | 'kind'>,
  settings: Pick<LevelUiSettings, 'tipLevels'> = LEVEL_UI,
  levels: readonly Pick<AppLevel, 'id' | 'kind'>[] = allLevels(),
): boolean {
  if (level.kind !== kind) return false;
  const n = levelNumber(level.id) ?? 0;
  const before = levels.filter((l) => l.kind === level.kind && (levelNumber(l.id) ?? 0) < n).length;
  return before < settings.tipLevels;
}

/** Spot the error's tip card on this stage (the kind's first LEVEL_UI.tipLevels stages). */
export const spotTipShown = (
  level: Pick<AppLevel, 'id' | 'kind'>,
  settings?: Pick<LevelUiSettings, 'tipLevels'>,
  levels?: readonly Pick<AppLevel, 'id' | 'kind'>[],
): boolean => kindTipShown('spotError', level, settings, levels);

export interface TipCardProps {
  /** "טיפ". */
  title: string;
  tip: string;
  icon: IconName;
  /** The close button's label for screen readers. */
  closeLabel: string;
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
  /** Its parts: `${testID}-text`, `${testID}-close`. */
  testID: string;
}

/** A kind's tip card (Idea-1, Idea-3): its icon, "טיפ" and the tip, with its close button. */
export function TipCard({ title, tip, icon, closeLabel, onClose, style, testID }: TipCardProps) {
  return (
    <View style={[styles.tip, style]} testID={testID}>
      <View
        style={styles.tipBody}
        accessible
        accessibilityLabel={`${title}: ${tip}`}
        testID={`${testID}-text`}
      >
        <View style={styles.tipIcon}>
          <Icon name={icon} size={size.icon.inline} color={color.textMuted} />
        </View>
        <View style={styles.tipWords}>
          <Text style={styles.tipTitle}>{title}</Text>
          <Text style={styles.tipText}>{tip}</Text>
        </View>
      </View>
      <IconButton
        icon="close"
        accessibilityLabel={closeLabel}
        onPress={onClose}
        style={styles.tipClose}
        testID={`${testID}-close`}
      />
    </View>
  );
}

export interface SpotErrorTipProps {
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
}

/** The tip card (Idea-1): "חפש ספרה שמופיעה פעמיים באותה שורה, עמודה או ריבוע.", with its close button. */
export function SpotErrorTip({ onClose, style }: SpotErrorTipProps) {
  const { t } = useTranslation('levels');
  return (
    <TipCard
      title={t('hud.spotError.tipTitle')}
      tip={t('hud.spotError.tip')}
      icon="search"
      closeLabel={t('hud.spotError.tipClose')}
      onClose={onClose}
      style={style}
      testID="spot-tip"
    />
  );
}

/** components.md §19.6: the magnifier slots 28 with an 18 icon; the tip's icon in a 36 circle. */
const LENS = 28;
const LENS_ICON = 18;
const TIP_ICON = 36;

const styles = StyleSheet.create({
  hud: { gap: space[6] },
  goal: { gap: space[2], alignItems: 'flex-start' },
  goalText: { ...text('status'), color: color.text },
  note: { ...text('caption'), color: color.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[6] },
  found: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  lens: {
    width: LENS,
    height: LENS,
    borderRadius: radius.badge,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  lensFound: { borderColor: color.success },
  lensFill: { backgroundColor: color.iconBg.success },
  foundWord: { ...text('status'), color: color.textMuted, marginStart: space[2] },
  count: { ...text('scoreCompact'), color: color.text },
  time: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  clock: { flexDirection: 'row', alignItems: 'baseline', gap: space[3] },
  clockWord: { ...text('status'), color: color.textMuted },
  clockValue: { ...text('scoreCompact'), color: color.text, writingDirection: 'ltr' },
  tip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    minHeight: 64,
    paddingVertical: space[5],
    paddingStart: space[6],
    paddingEnd: space[3],
    borderRadius: radius.xl,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  tipBody: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space[6] },
  tipIcon: {
    width: TIP_ICON,
    height: TIP_ICON,
    borderRadius: TIP_ICON / 2,
    backgroundColor: color.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipWords: { flex: 1, minWidth: 0, gap: space[2], alignItems: 'flex-start' },
  tipTitle: { ...text('label'), color: color.textMuted },
  tipText: { ...text('body'), color: color.text },
  tipClose: { borderWidth: 0 },
});
