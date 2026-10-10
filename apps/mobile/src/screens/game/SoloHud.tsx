import type { GameType } from '@sudoku-fight/engine';
import { type ReactNode, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type LayoutChangeEvent, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import type { AvatarId } from '../../assets/avatars';
import {
  Avatar,
  type CardModel,
  cardLabel,
  DeltaLabel,
  formatScore,
  ltr,
  MistakesText,
  paletteAt,
  type ScoreDelta,
  ScoreNumber,
  SeatGlyph,
  signedText,
} from '../../components/player';
import { metrics } from '../../components/player/metrics';
import { Button } from '../../components/ui';
import { color, size, space, text, tokens } from '../../theme';
import { type Rect, within } from './geometry';
import { formatClock, type SoloStats } from './model';

/**
 * My card in solo practice: Game-Solo's HUD in direction C. There is no opponent, so the card spans the row:
 * at the start the 2-player card's anatomy (components.md §3.2: avatar and name, the big score with its last
 * delta, the mistakes), at the end "סיום אימון" (spec §6.6) and the practice's time and best move. No
 * reactions button: nobody is there to see them. No background, as C's cards.
 */
export interface SoloHudProps {
  /** My card; its score is the one to show now (held back while a chip flies to it). */
  card: CardModel;
  delta: ScoreDelta | null;
  gameType: GameType;
  stats: SoloStats;
  avatarId?: AvatarId | null;
  onEnd: () => void;
  /** Where the delta slot is, in the HUD's own coordinates: the chips fly there. */
  onTargetLayout?: (slot: Rect) => void;
  onLayout?: (e: LayoutChangeEvent) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const ME = paletteAt(0);
const row = tokens.layout.game.playerCard;

export function SoloHud({
  card,
  delta,
  gameType,
  stats,
  avatarId,
  onEnd,
  onTargetLayout,
  onLayout,
  style,
  testID = 'solo-hud',
}: SoloHudProps) {
  const { t } = useTranslation('game');
  const { t: tp } = useTranslation('player');

  // The delta slot sits in the score row; both rects are needed to place it in the HUD.
  const scoreRow = useRef<Rect | null>(null);
  const slot = useRef<Rect | null>(null);
  const report = useCallback(() => {
    if (scoreRow.current && slot.current) onTargetLayout?.(within(scoreRow.current, slot.current));
  }, [onTargetLayout]);
  const onScoreRow = useCallback(
    (e: LayoutChangeEvent) => {
      scoreRow.current = e.nativeEvent.layout;
      report();
    },
    [report],
  );
  const onSlot = useCallback(
    (e: LayoutChangeEvent) => {
      slot.current = e.nativeEvent.layout;
      report();
    },
    [report],
  );

  const time = formatClock(stats.elapsedMs);
  const best = stats.best;
  const statsLabel = [
    t('hud.timeLabel', { time }),
    best
      ? t('hud.bestLabel', { points: ltr(formatScore(best.points)), cell: ltr(best.cell) })
      : t('hud.noBestLabel'),
  ].join(t('listSep'));
  const canEnd = card.mine?.canSurrender ?? false;

  return (
    <View style={[styles.hud, style]} onLayout={onLayout} testID={testID}>
      {/* Start: who I am and my score, read as one summary (components.md §3.6). */}
      <View
        style={styles.start}
        accessible
        accessibilityRole="text"
        accessibilityLabel={cardLabel(card, tp)}
        testID={`${testID}-summary`}
      >
        <View style={styles.identity}>
          <Avatar avatarId={avatarId} size="card" colorIndex={card.colorIndex} />
          <View style={styles.nameBlock}>
            <View style={styles.nameRow}>
              <SeatGlyph colorIndex={card.colorIndex} size={metrics.glyph.name} />
              <Text style={[text('playerName'), styles.name]} numberOfLines={1}>
                {card.name}
              </Text>
            </View>
            <Text style={[text('caption'), styles.muted]} numberOfLines={1} testID={`${testID}-title`}>
              {t('subtitle', { title: t('title'), type: t(`type.${gameType}`) })}
            </Text>
          </View>
        </View>
        <View style={styles.scoreRow} onLayout={onScoreRow} testID={`${testID}-score-row`}>
          <ScoreNumber
            score={card.score}
            tint={ME.ring}
            textStyle={text('scoreXL')}
            delta={delta}
            testID={`${testID}-score`}
          />
          <View style={styles.slot} onLayout={onSlot} testID={`${testID}-delta-slot`}>
            <DeltaLabel
              delta={delta}
              tint={ME.ring}
              textStyle={text('scoreDelta')}
              testID={`${testID}-delta`}
            />
          </View>
        </View>
        <View style={styles.statusRow}>
          <MistakesText count={card.mistakes} />
        </View>
      </View>

      {/* End: leave the practice, and how it is going. */}
      <View style={styles.end}>
        <View style={styles.endRow}>
          <Button
            label={t('end.button')}
            icon="surrender"
            variant="secondary"
            size="modal"
            onPress={onEnd}
            disabled={!canEnd}
            testID="end-practice-button"
          />
        </View>
        <View
          style={styles.statsRow}
          accessible
          accessibilityRole="text"
          accessibilityLabel={statsLabel}
          testID={`${testID}-stats`}
        >
          <Stat label={t('hud.time')}>
            <Text style={[text('cellRef'), styles.value]} testID={`${testID}-time`}>
              {time}
            </Text>
          </Stat>
          <View style={styles.divider} />
          <Stat label={t('hud.best')}>
            {best ? (
              <View style={styles.best} testID={`${testID}-best`}>
                <Text style={[text('cellRef'), styles.bestPoints]}>{signedText(best.points)}</Text>
                <Text style={[text('scoreSm'), styles.value]}>{best.cell}</Text>
              </View>
            ) : (
              <Text style={[text('cellRef'), styles.muted]}>{t('hud.none')}</Text>
            )}
          </Stat>
        </View>
      </View>
    </View>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.stat}>
      <Text style={[text('micro'), styles.muted]} numberOfLines={1}>
        {label}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  hud: { flexDirection: 'row', justifyContent: 'space-between', gap: space[6] },
  start: { flexShrink: 1, minWidth: 0 },
  identity: {
    height: size.buttonModal,
    flexDirection: 'row',
    alignItems: 'center',
    gap: row.headerGap,
  },
  nameBlock: { flexShrink: 1, minWidth: 0, gap: space[1], alignItems: 'flex-start' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: metrics.card.glyphGap },
  name: { color: color.text, flexShrink: 1 },
  muted: { color: color.textMuted },
  scoreRow: {
    height: row.scoreRowHeight,
    marginTop: row.scoreRowTop,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: row.scoreGap,
  },
  // The delta's place keeps a width while empty, so the chips have somewhere to land.
  slot: { minWidth: size.touch },
  statusRow: {
    height: space[10],
    marginTop: row.actionsRowTop,
    flexDirection: 'row',
    alignItems: 'center',
  },
  end: { alignItems: 'flex-end' },
  endRow: { height: size.buttonModal, justifyContent: 'center' },
  statsRow: {
    height: row.scoreRowHeight,
    marginTop: row.scoreRowTop,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[6],
  },
  stat: { alignItems: 'center', gap: space[3] },
  divider: {
    width: tokens.border.hairline,
    height: space[12] - space[2],
    backgroundColor: color.border,
  },
  value: { color: color.text, includeFontPadding: false },
  best: { flexDirection: 'row', alignItems: 'baseline', gap: space[2], direction: 'ltr' },
  bestPoints: { color: ME.ring, includeFontPadding: false },
});
