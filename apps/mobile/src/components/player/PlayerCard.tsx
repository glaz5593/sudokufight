import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import type { AvatarId } from '../../assets/avatars';
import { color, size, text, tokens } from '../../theme';
import { ActivityLine, MistakesText } from './ActivityLine';
import { Avatar } from './Avatar';
import { HitChip, ReconnectPill } from './Badges';
import type { CardModel, InterferenceModel } from './cardModel';
import { CardIconButton } from './CardIconButton';
import { cardOpacity, DropZone, useCardOpacity } from './DropZone';
import { Flag } from './Flag';
import { InterferenceButton } from './InterferenceButton';
import { metrics, paletteAt } from './metrics';
import { Rating } from './Rating';
import { DeltaLabel, type ScoreDelta, ScoreNumber } from './Score';
import { SeatGlyph } from './SeatGlyph';
import { cardLabel, displayName, type Gender } from './wording';

export interface PlayerCardActions {
  onSurrender?: () => void;
  onReactions?: () => void;
  /** Tap on ⚡ when it can be sent: open the arsenal. */
  onInterfere?: () => void;
  /** Tap on ⚡ while short of points: toast and haptic (§8.1). */
  onInterfereBlocked?: (state: InterferenceModel) => void;
}

export interface PlayerCardProps extends PlayerCardActions {
  model: CardModel;
  avatarId?: AvatarId | null;
  /** ISO alpha-2 country code. */
  country?: string | null;
  /** Picks the Hebrew feminine forms ("בוחרת"); see components.md §17.8. */
  gender?: Gender;
  /**
   * My card sits at the start edge; the opponent's is its mirror image at the end edge, avatar outermost
   * (components.md §3.1). Defaults from `model.isMe`.
   */
  side?: 'start' | 'end';
  /** The last score change, for the "+3.5" slot. */
  delta?: ScoreDelta | null;
  /**
   * A bot's level (Game-Bot: "בוט · חד"), in the rating's place under the name, as the bot has no rating:
   * `text` drawn ("3 · מתקדם"), `label` said after "בוט" ("רמה 3, מתקדם").
   */
  botLevel?: { text: string; label: string } | null;
  /** Keep the delta on screen instead of fading it (design-system page). */
  persistentDelta?: boolean;
  /** Another card is the drop target (§3.4). */
  dimmed?: boolean;
  /** This card is the drop target, and whether the finger is over it. */
  dropTarget?: boolean;
  dropHover?: boolean;
  /** "שחרר כאן: שיגור זיקוקים אל NinaVolt", while this card is the drop target. */
  dropLabel?: string;
  /** The arsenal is open from this card's ⚡. */
  interferenceExpanded?: boolean;
  /** My reactions picker is open. */
  reactionsExpanded?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The player card of a 2-player game (components.md §3, Dir-C-Game): identity, the big score with its last
 * delta, and a status line with the card's actions. No background or border: it sits on the screen.
 * Screen readers get one summary ("NinaVolt · 39.5 נקודות · בוחרת A8, …"); the buttons stay separate.
 */
export function PlayerCard({
  model,
  avatarId,
  country,
  gender,
  side,
  delta = null,
  botLevel = null,
  persistentDelta = false,
  dimmed = false,
  dropTarget = false,
  dropHover = false,
  dropLabel,
  interferenceExpanded = false,
  reactionsExpanded = false,
  onSurrender,
  onReactions,
  onInterfere,
  onInterfereBlocked,
  style,
  testID,
}: PlayerCardProps) {
  const { t } = useTranslation('player');
  const palette = paletteAt(model.colorIndex);
  const mirrored = (side ?? (model.isMe ? 'start' : 'end')) === 'end';
  const row = mirrored ? styles.rowReverse : styles.row;
  const name = displayName(model, t);
  const fade = useCardOpacity(cardOpacity(dimmed, model.out !== null));

  return (
    <DropZone active={dropTarget} hover={dropHover} style={style}>
      <Animated.View style={[styles.card, fade]} testID={testID}>
        <View
          accessible
          accessibilityRole="text"
          accessibilityLabel={cardLabel(model, t, { gender, botLevel: botLevel?.label })}
          accessibilityHint={dropTarget ? dropLabel : undefined}
          testID={testID ? `${testID}-summary` : undefined}
        >
          <View style={[row, styles.identity]}>
            <View>
              <Avatar
                avatarId={avatarId}
                size="card"
                colorIndex={model.colorIndex}
                presence={model.presence}
                bot={model.isBot}
                inactive={model.out !== null || model.presence !== 'online'}
              />
              {model.hit ? <HitChip seconds={model.hit.secondsLeft} style={styles.hitChip} /> : null}
            </View>
            <View style={[styles.nameBlock, mirrored ? styles.alignEnd : styles.alignStart]}>
              <View style={[row, styles.nameRow]}>
                <View style={[row, styles.glyphName]}>
                  <SeatGlyph colorIndex={model.colorIndex} size={metrics.glyph.name} />
                  <Text style={[text('playerName'), styles.name]} numberOfLines={1}>
                    {name}
                  </Text>
                </View>
                <Flag country={country} size="game" decorative />
              </View>
              {model.rating !== null ? (
                <Rating value={model.rating} size="card" decorative />
              ) : model.isBot && botLevel ? (
                <View style={styles.levelChip} testID={testID ? `${testID}-bot-level` : undefined}>
                  <Text style={[text('micro'), styles.levelText]} numberOfLines={1}>
                    {botLevel.text}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={[row, styles.scoreRow]}>
            <ScoreNumber
              score={model.score}
              tint={palette.ring}
              textStyle={text('scoreXL')}
              delta={delta}
              testID={testID ? `${testID}-score` : undefined}
            />
            <DeltaLabel
              delta={delta}
              tint={palette.ring}
              textStyle={text('scoreDelta')}
              persistent={persistentDelta}
              testID={testID ? `${testID}-delta` : undefined}
            />
          </View>
        </View>

        <View style={[row, styles.statusRow]}>
          {model.isMe ? (
            <MistakesText count={model.mistakes} />
          ) : (
            <ActivityLine activity={model.activity} colorIndex={model.colorIndex} gender={gender} />
          )}
          {model.mine ? (
            <View style={styles.actions}>
              <CardIconButton
                icon="surrender"
                label={model.mine.practice ? t('actions.endPractice') : t('actions.surrender')}
                onPress={onSurrender}
                disabled={!model.mine.canSurrender}
                testID="surrender"
              />
              <CardIconButton
                icon="reactions"
                label={t('actions.reactions')}
                onPress={onReactions}
                coolingDown={!model.mine.reactionReady}
                expanded={reactionsExpanded}
                testID="reactions"
              />
            </View>
          ) : model.activity.kind === 'reconnecting' ? (
            <ReconnectPill seconds={model.activity.secondsLeft} />
          ) : model.interference ? (
            <InterferenceButton
              name={name}
              state={model.interference}
              expanded={interferenceExpanded}
              onPress={onInterfere}
              onBlockedPress={onInterfereBlocked}
              testID="interfere"
            />
          ) : null}
        </View>
      </Animated.View>
    </DropZone>
  );
}

const card = tokens.layout.game.playerCard;

const styles = StyleSheet.create({
  card: { width: size.playerCard.width, height: size.playerCard.height },
  row: { flexDirection: 'row' },
  rowReverse: { flexDirection: 'row-reverse' },
  identity: { height: card.headerHeight, alignItems: 'center', gap: card.headerGap },
  hitChip: { position: 'absolute', top: metrics.card.hitChipOffset, end: metrics.card.hitChipOffset },
  nameBlock: { flexShrink: 1, minWidth: 0 },
  alignStart: { alignItems: 'flex-start' },
  alignEnd: { alignItems: 'flex-end' },
  nameRow: { alignItems: 'center', gap: metrics.card.nameGap, flexShrink: 1, minWidth: 0 },
  glyphName: { alignItems: 'center', gap: metrics.card.glyphGap, flexShrink: 1, minWidth: 0 },
  name: { color: color.text, flexShrink: 1 },
  // The bot's level: a small flat chip (as BotSelect's), short enough to fit under the name with it (44).
  levelChip: {
    height: metrics.card.levelChipHeight,
    paddingHorizontal: metrics.card.levelChipPaddingX,
    justifyContent: 'center',
    borderRadius: tokens.radius.xs,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface2,
    maxWidth: '100%',
  },
  levelText: { color: color.textMuted },
  scoreRow: {
    height: card.scoreRowHeight,
    marginTop: card.scoreRowTop,
    alignItems: 'baseline',
    gap: card.scoreGap,
  },
  statusRow: {
    height: card.actionsRowHeight,
    marginTop: card.actionsRowTop,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: card.actionsGap,
  },
  actions: { flexDirection: 'row', gap: card.actionsGap },
});
