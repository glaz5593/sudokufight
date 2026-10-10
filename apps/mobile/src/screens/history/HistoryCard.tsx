import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { AvatarId } from '../../assets/avatars';
import { Icon } from '../../components/Icon';
import {
  Avatar,
  displayName,
  Flag,
  formatScore,
  ltr,
  paletteAt,
  scoreText,
  signedText,
} from '../../components/player';
import { color, radius, size, space, text, tokens } from '../../theme';
import { dayOf, type HistoryEntry, type HistoryOutcome, shortDate } from './historyModel';

/**
 * One game in the history (spec §14.1; History.dc.html): a result stripe, the opponents' avatars, the mode and
 * the type, the final score, the rating change and the date. The whole card opens the replay. Stage 12: in a
 * ranked game, an opponent's avatar opens their player card (and screen readers get it as an action of the
 * card).
 */

const STRIPE: Record<HistoryOutcome, string> = {
  win: color.success,
  loss: color.danger,
  tie: color.info,
  completed: color.accent,
  ended: color.textFaint,
  interrupted: color.textFaint,
};

/** At most this many opponents' avatars side by side (a 4-player game has 3). */
const AVATARS_SHOWN = 3;

export interface HistoryCardProps {
  entry: HistoryEntry;
  /** My avatar, for a solo practice (no opponent to show). */
  myAvatar: AvatarId;
  now: number;
  onOpen: (entry: HistoryEntry) => void;
  /** A ranked game's opponent (not a bot): their player card (spec §14.3). */
  onOpenPlayer?: (playerId: string) => void;
}

const PLAYER_ACTION = 'player:';

/** The isolate marks `ltr` wraps with: "84.5 : 62" is drawn in parts (mine in P1) but stays LTR in Hebrew. */
const [OPEN, CLOSE] = [...ltr('')] as [string, string];

export function HistoryCard({ entry: e, myAvatar, now, onOpen, onOpenPlayer }: HistoryCardProps) {
  const { t, i18n } = useTranslation('history');
  const { t: tProgress } = useTranslation('progress');
  const { t: tg } = useTranslation('game');
  const { t: tp } = useTranslation('player');
  const day = dayOf(e.startedAt, now);
  const date = day ? t(`card.${day}`) : shortDate(e.startedAt, i18n.language);
  const opponent = e.opponents.length === 1 ? e.opponents[0]! : null;
  const who = opponent
    ? displayName(opponent, tp)
    : e.opponents.length > 1
      ? [
          e.place === null ? null : t('card.place', { place: e.place }),
          t('card.against', { count: e.opponents.length }),
        ]
          .filter(Boolean)
          .join(' · ')
      : t('card.alone');
  const duel =
    e.myScore !== null && opponent && e.opponentScore !== null
      ? { mine: formatScore(e.myScore), theirs: formatScore(e.opponentScore) }
      : null;
  const score =
    e.myScore === null
      ? '—'
      : duel
        ? ltr(`${duel.mine} : ${duel.theirs}`)
        : t('card.points', { score: scoreText(e.myScore) });
  const rating =
    e.source === 'practice' ? t('card.unrated') : e.ratingDelta === null ? null : signedText(e.ratingDelta);
  const mode = t(`card.mode.${e.mode}`);
  const type = tg(`type.${e.gameType}`);
  const outcome = t(`card.outcome.${e.outcome}`);
  const label = t('card.label', {
    outcome,
    who,
    mode,
    type,
    score,
    rating: rating === null ? '' : e.source === 'practice' ? rating : t('card.rating', { delta: rating }),
    date,
  });

  const players = e.source === 'ranked' && onOpenPlayer ? e.opponents.filter((o) => !o.isBot) : [];
  const playerActions = players.map((o) => ({
    name: `${PLAYER_ACTION}${o.id}`,
    label: tProgress('card.openOf', { name: displayName(o, tp) }),
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('card.hint')}
      accessibilityActions={playerActions.length ? playerActions : undefined}
      onAccessibilityAction={
        playerActions.length
          ? (event) => {
              const name = event.nativeEvent.actionName;
              if (name.startsWith(PLAYER_ACTION)) onOpenPlayer?.(name.slice(PLAYER_ACTION.length));
            }
          : undefined
      }
      onPress={() => onOpen(e)}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
      testID={`history-card-${e.id}`}
    >
      <View
        style={[styles.stripe, { backgroundColor: STRIPE[e.outcome] }]}
        testID={`history-card-${e.id}-stripe-${e.outcome}`}
      />
      <View style={styles.avatars}>
        {e.opponents.length === 0 ? (
          <Avatar avatarId={myAvatar} size="compact" colorIndex={0} />
        ) : (
          e.opponents.slice(0, AVATARS_SHOWN).map((o, k) => {
            const avatar = (
              <Avatar avatarId={o.avatar} size="compact" colorIndex={o.colorIndex} bot={o.isBot} />
            );
            const overlap = k === 0 ? null : styles.overlap;
            return players.includes(o) ? (
              // Its own touch target: the card's screen-reader action does the same.
              <Pressable
                key={o.id}
                accessible={false}
                onPress={() => onOpenPlayer?.(o.id)}
                hitSlop={space[3]}
                style={overlap}
                testID={`history-card-${e.id}-player-${o.id}`}
              >
                {avatar}
              </Pressable>
            ) : (
              <View key={o.id} style={overlap}>
                {avatar}
              </View>
            );
          })
        )}
      </View>
      <View style={styles.middle}>
        <View style={styles.row}>
          <Text style={[text('rowTitle'), styles.strong, styles.shrink]} numberOfLines={1}>
            {who}
          </Text>
          {opponent?.country ? <Flag country={opponent.country} size="compact" decorative /> : null}
        </View>
        <Text style={[text('caption'), styles.muted]} numberOfLines={1}>
          {`${outcome} · ${mode} · ${type}`}
        </Text>
      </View>
      <View style={styles.end}>
        {/* History.dc.html: my score in my colour (me is always P1), the opponent's muted. */}
        <Text
          style={[text('scoreSm'), e.myScore === null ? styles.strong : duel ? styles.muted : styles.me]}
          testID={`history-card-${e.id}-score`}
        >
          {duel ? (
            <>
              {OPEN}
              <Text style={styles.me} testID={`history-card-${e.id}-my-score`}>
                {duel.mine}
              </Text>
              {` : ${duel.theirs}`}
              {CLOSE}
            </>
          ) : (
            score
          )}
        </Text>
        {rating === null ? null : (
          <Text
            style={[
              text('caption'),
              e.ratingDelta === null ? styles.muted : e.ratingDelta < 0 ? styles.danger : styles.success,
            ]}
            testID={`history-card-${e.id}-rating`}
          >
            {rating}
          </Text>
        )}
        <Text style={[text('micro'), styles.muted]}>{date}</Text>
      </View>
      <View style={styles.open}>
        <Text style={[text('micro'), styles.accent]}>{t('card.replay')}</Text>
        <Icon name="chevronForward" size={size.icon.chevron} color={color.accent} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[5],
    minHeight: size.listRow,
    paddingVertical: space[4],
    paddingEnd: space[4],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
    overflow: 'hidden',
  },
  pressed: { backgroundColor: color.surface2 },
  stripe: { alignSelf: 'stretch', width: space[2] },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  overlap: { marginStart: -space[5] },
  middle: { flex: 1, minWidth: 0, gap: space[1], alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], maxWidth: '100%' },
  shrink: { flexShrink: 1 },
  end: { alignItems: 'flex-end', gap: space[1] },
  strong: { color: color.text },
  muted: { color: color.textMuted },
  me: { color: paletteAt(0).ring },
  success: { color: color.success },
  accent: { color: color.accent },
  open: { alignItems: 'center', gap: space[1] },
  danger: { color: color.danger },
});
