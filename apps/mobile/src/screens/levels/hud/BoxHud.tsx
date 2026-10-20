import { type AppLevel, fillRegionOf, type GameView } from '@sudoku-fight/engine';
import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { MiniRegion } from '../../../components/levels/MiniRegion';
import { StarsBar } from '../../../components/levels/StarsBar';
import { secondsOf, signedText } from '../../../components/player/format';
import { color, radius, space, text } from '../../../theme';
import { fillTaskText } from '../levelWording';
import { levelClock, StageHeader } from './FindHud';

/**
 * A fill stage's HUD, for the box, the row and the column alike (components.md §19.7, the Lv-Box board;
 * levels-ui.md §2.5, §5): the header with the stage's clock ("0:09", the time played plus the penalties) and the
 * X; the star scale of its time; the task line: the small map of the board with the region lit (MiniRegion,
 * 27 dp), "מלא את ריבוע 6" / "מלא את שורה D" / "מלא את עמודה 5", "1/4 משבצות", and my mistakes with what they
 * cost ("טעות ‎+5 ש׳"). The keypad and "ביטול בחירה" stay below the board (the game screen's own). The region is
 * the played board's (fillRegionOf of the attempt's level: "שוב" moves rows and boxes); the rest from
 * GameView.level.
 */

export interface BoxHudProps {
  /** The stage as played (the attempt's level): a fillBox, fillRow or fillCol, or a boss of one. */
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
  const region = fillRegionOf(level) ?? { unit: 'box' as const, index: 0, cells: [] };
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
        <MiniRegion region={region} testID="box-mini" />
        <Text style={styles.taskText} numberOfLines={1} testID="box-task">
          {fillTaskText(region, t)}
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

const styles = StyleSheet.create({
  hud: { gap: space[6] },
  clock: { ...text('scoreCompact'), color: color.text, writingDirection: 'ltr' },
  task: { flexDirection: 'row', alignItems: 'center', gap: space[4], flexWrap: 'wrap' },
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
