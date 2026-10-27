import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { type AvatarFace, type AvatarIdOrNone, sameFace } from '../../avatars';
import { decimalSeparator } from '../../i18n/compose';
import { color, radius, text, tokens } from '../../theme';
import { Text } from '../ui/Text';
import { ActivityLine } from './ActivityLine';
import { Avatar } from './Avatar';
import { HitChip, RankBadge, ReconnectPill } from './Badges';
import { type CardModel, type MistakePips, pipsForWidth, sameCard } from './cardModel';
import { CardIconButton } from './CardIconButton';
import { Flag } from './Flag';
import { ltr, signedText } from './format';
import { InterferenceButton } from './InterferenceButton';
import { metrics, paletteAt } from './metrics';
import { inactiveCard, type PlayerCardActions } from './PlayerCard';
import { Rating } from './Rating';
import { sameProps, sameStyle } from './sameProps';
import { DeltaLabel, type ScoreDelta, ScoreNumber } from './Score';
import { SeatGlyph } from './SeatGlyph';
import { cardOpacity, TargetFrame, useCardOpacity } from './TargetFrame';
import { cardLabel, displayName, type Gender } from './wording';

export interface PlayerCardCompactProps extends PlayerCardActions {
  model: CardModel;
  avatarId?: AvatarIdOrNone | null;
  /** The avatar's face in the game or the replay: its mood, and the reaction to play. */
  face?: AvatarFace | null;
  country?: string | null;
  gender?: Gender;
  /** components.md §7.1: 114 in 3P; 106 for me and 78 for the others in 4P (see compactCardWidth). */
  width?: number;
  delta?: ScoreDelta | null;
  persistentDelta?: boolean;
  dimmed?: boolean;
  /** This card is the interference picker's target [D45]. */
  targeted?: boolean;
  interferenceExpanded?: boolean;
  reactionsExpanded?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const c = metrics.compact;

/**
 * The compact card of a 3–4 player game (components.md §7): place badge, avatar with presence and flag, name,
 * rating, score with penalty pips, activity with the lock ring, and an action strip ("הפרעה" for opponents,
 * surrender and reactions for me). Cards keep their seat order; only the place badge changes.
 */
export const PlayerCardCompact = memo(function PlayerCardCompact({
  model,
  avatarId,
  face = null,
  country,
  gender,
  width,
  delta = null,
  persistentDelta = false,
  dimmed = false,
  targeted = false,
  interferenceExpanded = false,
  reactionsExpanded = false,
  onSurrender,
  onReactions,
  onInterfere,
  onInterfereBlocked,
  style,
  testID,
}: PlayerCardCompactProps) {
  const { t } = useTranslation('player');
  const palette = paletteAt(model.colorIndex);
  const name = displayName(model, t);
  const fade = useCardOpacity(cardOpacity(dimmed, model.out !== null));

  return (
    <TargetFrame targeted={targeted} style={style}>
      <Animated.View style={[styles.card, width === undefined ? null : { width }, fade]} testID={testID}>
        <View
          style={styles.summary}
          accessible
          accessibilityRole="text"
          accessibilityLabel={cardLabel(model, t, { gender, compact: true })}
          accessibilityHint={targeted ? t('card.targetHint') : undefined}
          testID={testID ? `${testID}-summary` : undefined}
        >
          <View>
            <Avatar
              avatarId={avatarId}
              size="compact"
              colorIndex={model.colorIndex}
              presence={model.presence}
              backdrop={color.surface}
              bot={model.isBot}
              inactive={inactiveCard(model)}
              expression={face?.expression}
              reaction={face?.reaction}
              testID={testID ? `${testID}-avatar` : undefined}
            />
            <Flag country={country} size="compact" decorative style={styles.flag} />
            {model.hit ? <HitChip seconds={model.hit.secondsLeft} style={styles.hitChip} /> : null}
          </View>

          <View style={styles.nameRow}>
            <SeatGlyph colorIndex={model.colorIndex} size={metrics.glyph.name} />
            <Text style={[text('plateNameCompact'), styles.name]} numberOfLines={1}>
              {name}
            </Text>
          </View>

          {model.rating === null ? null : (
            <Rating value={model.rating} size="compact" decorative style={styles.rating} />
          )}

          <View style={styles.scoreRow}>
            <ScoreNumber
              score={model.score}
              tint={palette.ring}
              textStyle={text('scoreCompact')}
              delta={delta}
              testID={testID ? `${testID}-score` : undefined}
            />
            <Pips pips={pipsForWidth(model.pips, width)} />
            <View style={styles.float} pointerEvents="none">
              <DeltaLabel
                delta={delta}
                tint={palette.ring}
                textStyle={c.gainStyle}
                rise
                persistent={persistentDelta}
                testID={testID ? `${testID}-delta` : undefined}
              />
            </View>
          </View>

          <View style={styles.activity}>
            <ActivityLine activity={model.activity} colorIndex={model.colorIndex} gender={gender} compact />
          </View>
        </View>

        <RankBadge place={model.place} style={styles.rank} />

        <View style={styles.strip}>
          {model.mine ? (
            <>
              <CardIconButton
                compact
                icon="surrender"
                label={model.mine.practice ? t('actions.endPractice') : t('actions.surrender')}
                onPress={onSurrender}
                disabled={!model.mine.canSurrender}
                testID="surrender"
              />
              <CardIconButton
                compact
                icon="reactions"
                label={t('actions.reactions')}
                onPress={onReactions}
                coolingDown={!model.mine.reactionReady}
                expanded={reactionsExpanded}
                testID="reactions"
              />
            </>
          ) : model.activity.kind === 'reconnecting' ? (
            <ReconnectPill seconds={model.activity.secondsLeft} compact />
          ) : model.presence === 'unstable' ? (
            // [D42] The connection is lost, the game goes on: the mark alone, no countdown.
            <ReconnectPill compact />
          ) : model.interference ? (
            <InterferenceButton
              compact
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
    </TargetFrame>
  );
}, sameCompactCard);

/** Renders only when what the card shows changed (sameCard, sameFace), not on each re-read of the time. */
function sameCompactCard(a: PlayerCardCompactProps, b: PlayerCardCompactProps): boolean {
  return sameProps(a, b, { model: sameCard, face: sameFace, style: sameStyle });
}

/**
 * The last penalties in small red pips, "×n" first from five mistakes (components.md §7.2), as many as the card
 * has room for (pipsForWidth). Should they still not fit (a big system font), they give way and the oldest is
 * cut, never the score.
 */
function Pips({ pips }: { pips: MistakePips }) {
  const { t } = useTranslation('player');
  if (!pips.penalties.length) return null;
  const decimal = decimalSeparator(t);
  // LTR isolates: "−2" and "×6" keep the sign before the number in Hebrew (CLAUDE.md).
  const labels = [
    ...(pips.overflow === null ? [] : [ltr(t('mistakes.overflow', { count: pips.overflow }))]),
    ...pips.penalties.map((p) => signedText(-p, decimal)),
  ];
  return (
    <View style={styles.pips} testID="pips">
      {labels.map((label, i) => (
        <View key={`${i}-${label}`} style={styles.pip}>
          <Text style={[c.pip.style, styles.pipText]}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    height: c.height,
    paddingTop: c.paddingTop,
    alignItems: 'center',
    backgroundColor: color.surface,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    borderRadius: radius.button,
  },
  summary: { alignItems: 'center', alignSelf: 'stretch' },
  rank: { position: 'absolute', top: metrics.rankBadge.top, start: metrics.rankBadge.start },
  flag: { position: 'absolute', bottom: c.flagBottom, start: c.flagStart },
  hitChip: { position: 'absolute', top: metrics.card.hitChipOffset, end: metrics.card.hitChipOffset },
  nameRow: {
    marginTop: c.nameTop,
    paddingHorizontal: c.namePaddingX,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: metrics.glyph.gap,
  },
  name: { color: color.text, flexShrink: 1 },
  rating: { marginTop: c.ratingTop },
  scoreRow: {
    marginTop: c.scoreTop,
    height: c.scoreRowHeight,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: c.scoreGap,
  },
  float: {
    position: 'absolute',
    bottom: c.scoreRowHeight,
    start: 0,
    end: 0,
    alignItems: 'center',
  },
  // Left to right, newest last; too wide, they shrink and the oldest is cut (the row ends at the newest).
  pips: {
    flexDirection: 'row',
    gap: c.pip.gap,
    direction: 'ltr',
    flexShrink: 1,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  pip: {
    height: c.pip.height,
    paddingHorizontal: c.pip.paddingX,
    borderRadius: c.pip.radius,
    borderWidth: tokens.border.hairline,
    borderColor: color.dangerBorder,
    justifyContent: 'center',
  },
  pipText: { color: color.danger },
  activity: {
    marginTop: c.activityTop,
    height: c.activityHeight,
    justifyContent: 'center',
    maxWidth: '100%',
  },
  strip: {
    position: 'absolute',
    start: c.actionInset,
    end: c.actionInset,
    bottom: c.actionBottom,
    height: c.actionHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: c.actionGap,
  },
});
