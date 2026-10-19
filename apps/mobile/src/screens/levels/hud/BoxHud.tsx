import type { AppLevel, GameView } from '@sudoku-fight/engine';
import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { StarsBar } from '../../../components/levels/StarsBar';
import { secondsOf, signedText } from '../../../components/player/format';
import { color, radius, space, text, tokens } from '../../../theme';
import { levelClock, StageHeader } from './FindHud';

/**
 * Fill the box's HUD (components.md §19.7, the Lv-Box board): the header with the stage's clock ("0:09", the
 * time played plus the penalties) and the X; the star scale of its time; the task line: a mini map of the
 * nine boxes with this one lit, "מלא את ריבוע 6", "1/4 משבצות", and my mistakes with what they cost ("טעות
 * ‎+5 ש׳"). The keypad and "ביטול בחירה" stay below the board (the game screen's own). All from GameView.level.
 */

export interface BoxHudProps {
  /** The stage as played (a fillBox, or its boss). */
  level: AppLevel;
  view: GameView;
  /** The game's time now. */
  now: number;
  onExit?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** The stage's clock as Lv-Box shows it: "0:09", "0:20". */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function BoxHud({ level, view, now, onExit, style }: BoxHudProps) {
  const { t } = useTranslation('levels');
  const lv = view.level;
  const box = level.kind === 'fillBox' ? level.targets.box : 0;
  const progress = lv?.progress?.kind === 'cells' ? lv.progress : null;
  const me = view.players.find((p) => p.id === view.me);
  const mistakes = me?.mistakes ?? 0;
  const penaltySeconds = (lv?.penaltyMs ?? 0) / 1000;
  const elapsed = lv ? levelClock(lv, now).elapsedMs : 0;
  const clock = (
    <Text
      style={styles.clock}
      accessibilityRole="timer"
      accessibilityLabel={t('hud.box.timeLabel', {
        s: secondsOf(elapsed),
        limit: secondsOf(lv?.limitMs ?? 0),
      })}
      testID="box-clock"
    >
      {clockText(elapsed)}
    </Text>
  );
  return (
    <View style={[styles.hud, style]} testID="box-hud">
      <StageHeader level={level} onExit={onExit} end={clock} />
      {lv ? <StarsBar rule={lv.marks} value={elapsed} max={lv.limitMs ?? undefined} /> : null}
      <View style={styles.task}>
        <MiniBoxes lit={box} />
        <Text style={styles.taskText} numberOfLines={1} testID="box-task">
          {t('hud.box.task', { n: box + 1 })}
        </Text>
        {progress ? (
          <Text
            style={styles.cells}
            accessibilityLabel={t('hud.box.cellsLabel', { done: progress.done, total: progress.total })}
            testID="box-cells"
          >
            {t('hud.box.cells', { done: progress.done, total: progress.total })}
          </Text>
        ) : null}
        {mistakes > 0 ? (
          <Text
            style={styles.mistakes}
            accessibilityLabel={t('hud.box.mistakesLabel', { count: mistakes, s: penaltySeconds })}
            testID="box-mistakes"
          >
            {t('hud.box.mistakes', { count: mistakes, penalty: signedText(penaltySeconds) })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** The nine boxes, this one lit (always LTR: box 1 at the top-left). Decorative. */
function MiniBoxes({ lit }: { lit: number }) {
  return (
    <View
      style={styles.mini}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="box-mini"
    >
      {Array.from({ length: 9 }, (_, b) => (
        <View
          key={b}
          style={[styles.miniBox, { backgroundColor: b === lit ? color.focusRing : color.border }]}
          testID={b === lit ? 'box-mini-lit' : undefined}
        />
      ))}
    </View>
  );
}

const MINI = 6;

const styles = StyleSheet.create({
  hud: { gap: space[6] },
  clock: { ...text('scoreCompact'), color: color.text, writingDirection: 'ltr' },
  task: { flexDirection: 'row', alignItems: 'center', gap: space[4], flexWrap: 'wrap' },
  mini: {
    direction: 'ltr',
    width: 3 * MINI + 2 * tokens.border.hairline,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.border.hairline,
  },
  miniBox: { width: MINI, height: MINI, borderRadius: radius.bar / 2 },
  taskText: { ...text('rowTitle'), color: color.text },
  cells: { ...text('label'), color: color.textMuted },
  mistakes: {
    ...text('badge'),
    color: color.danger,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radius.xs,
    backgroundColor: color.dangerSubtle,
  },
});
