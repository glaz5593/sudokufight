import type { AppLevel, GameView, LevelPuzzleView } from '@sudoku-fight/engine';
import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Icon } from '../../../components/Icon';
import { StarsBar } from '../../../components/levels/StarsBar';
import { secondsOf, signedText } from '../../../components/player/format';
import { color, radius, size, space, text } from '../../../theme';
import type { LevelsT } from '../levelWording';
import { clockText } from './BoxHud';
import { levelClock, StageHeader } from './FindHud';
import { FLASH_CHIP_SLOT, FlashPenaltyChip } from './SpotErrorHud';

/**
 * The puzzle's HUD (levels-ui.md §4.1, the Lv-Puzzle board): the header ("שלב 23" over "פאזל · פרק 3", the
 * stage's clock "0:09" with the time played plus the penalties, and the X), the star scale of its time (as fill
 * the box), and the task line: "סדר את הריבועים", "3 ריבועים זזים · 6 ריבועים קבועים", "החלפות: 2", and the
 * wrong swaps with what they cost ("החלפה שגויה ‎+5 ש׳"). A wrong swap's "‎+5 ש׳" flashes by the clock, the same
 * chip as a wrong tap's. Everything from GameView.level (level.puzzle, level.progress); this file only draws it.
 */

export interface PuzzleHudProps {
  /** The stage as played. */
  level: AppLevel;
  view: GameView;
  /** The stage's time now. */
  now: number;
  /** The "‎+5 ש׳" of my last wrong swap, while it shows (its id replays it). */
  penalty?: { id: number; ms: number } | null;
  onExit?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** "3 ריבועים זזים · 6 ריבועים קבועים", or "כל הריבועים זזים" with nothing fixed. */
export function puzzleCountsText(puzzle: Pick<LevelPuzzleView, 'moving'>, t: LevelsT): string {
  const fixed = 9 - puzzle.moving;
  if (fixed <= 0) return t('hud.puzzle.allMove');
  return t('hud.puzzle.counts', {
    moving: t('hud.puzzle.moving', { count: puzzle.moving }),
    fixed: t('hud.puzzle.fixed', { count: fixed }),
  });
}

export function PuzzleHud({ level, view, now, penalty = null, onExit, style }: PuzzleHudProps) {
  const { t } = useTranslation('levels');
  const lv = view.level;
  const puzzle = lv?.puzzle ?? null;
  const progress = lv?.progress?.kind === 'swaps' ? lv.progress : null;
  const swaps = progress?.used ?? puzzle?.swaps ?? 0;
  const mistakes = progress?.mistakes ?? puzzle?.mistakes ?? 0;
  const penaltySeconds = (lv?.penaltyMs ?? 0) / 1000;
  const elapsed = lv ? levelClock(lv, now).elapsedMs : 0;
  const clock = (
    <View style={styles.time}>
      {penalty ? <FlashPenaltyChip key={penalty.id} ms={penalty.ms} style={FLASH_CHIP_SLOT} /> : null}
      <Text
        style={styles.clock}
        accessibilityRole="timer"
        accessibilityLabel={t('hud.box.timeLabel', {
          s: secondsOf(elapsed),
          limit: secondsOf(lv?.limitMs ?? 0),
        })}
        testID="puzzle-clock"
      >
        {clockText(elapsed)}
      </Text>
    </View>
  );
  return (
    <View style={[styles.hud, style]} testID="puzzle-hud">
      <StageHeader level={level} onExit={onExit} end={clock} />
      {lv ? <StarsBar rule={lv.marks} value={elapsed} max={lv.limitMs ?? undefined} /> : null}
      <View style={styles.task}>
        <Icon name="puzzle" size={size.icon.inline} color={color.focusRing} />
        <Text style={styles.taskText} numberOfLines={1} testID="puzzle-task">
          {t('hud.puzzle.task')}
        </Text>
        {puzzle ? (
          <Text style={styles.counts} testID="puzzle-counts">
            {puzzleCountsText(puzzle, t)}
          </Text>
        ) : null}
        <Text style={styles.counts} testID="puzzle-swaps">
          {t('hud.puzzle.swaps', { count: swaps })}
        </Text>
        {mistakes > 0 ? (
          <Text
            style={styles.mistakes}
            accessibilityLabel={t('hud.puzzle.wrongLabel', { count: mistakes, s: penaltySeconds })}
            testID="puzzle-mistakes"
          >
            {t('hud.puzzle.wrong', { count: mistakes, penalty: signedText(penaltySeconds) })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hud: { gap: space[6] },
  time: { justifyContent: 'center' },
  clock: { ...text('scoreCompact'), color: color.text, writingDirection: 'ltr' },
  task: { flexDirection: 'row', alignItems: 'center', gap: space[4], flexWrap: 'wrap' },
  taskText: { ...text('rowTitle'), color: color.text },
  counts: { ...text('label'), color: color.textMuted },
  mistakes: {
    ...text('badge'),
    color: color.danger,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radius.xs,
    backgroundColor: color.dangerSubtle,
  },
});
