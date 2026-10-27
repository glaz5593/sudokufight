import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { AVATAR_REACTIONS } from '../../avatars/reactions';
import { Icon } from '../../components/Icon';
import { Avatar } from '../../components/player/Avatar';
import { countryName } from '../../components/player/countryFlag';
import { Flag } from '../../components/player/Flag';
import { SeatGlyph } from '../../components/player/SeatGlyph';
import { IconButton } from '../../components/ui/IconButton';
import { Text } from '../../components/ui/Text';
import { color, radius, size, space, text, tokens } from '../../theme';
import { usePulse } from '../game/connection/motion';
import { metrics } from '../game/connection/metrics';
import type { FriendsPlayer, FriendsSeat } from './friendsModel';

export interface RoomSeatRowProps {
  seat: FriendsSeat;
  reduce: boolean;
  /** The host's "הוצא מהחדר" beside a guest [D85a]; left out, no button. */
  onKick?: (player: FriendsPlayer) => void;
  testID: string;
}

/**
 * A seat of the friends room (§3.2): the seat's shape (● ▲ ■ ◆, so who is who never rests on colour alone),
 * the avatar in the seat's colour (me always in P1's), the name, the flag and the general rating, small; "אני"
 * and "מארח". A player whose app is away is dimmed, "לא בחדר כרגע" [D84a]. An empty seat is dashed, "ממתין
 * לשחקן…", its dot blinking (a functional loop; static with reduced motion). The row is one element for a
 * screen reader: "Dana, ישראל, דירוג 1190, לא בחדר כרגע".
 */
export function RoomSeatRow({ seat, reduce, onKick, testID }: RoomSeatRowProps) {
  const { t, i18n } = useTranslation('friends');
  const p = seat.player;
  const pulse = usePulse(!p, reduce);
  if (!p) {
    return (
      <View
        accessible
        accessibilityLabel={t('seat.emptyLabel')}
        style={[styles.row, styles.rowEmpty]}
        testID={testID}
      >
        <View style={styles.glyph} importantForAccessibility="no-hide-descendants">
          <SeatGlyph colorIndex={seat.colorIndex} size={GLYPH} color={color.textMuted} />
        </View>
        <View style={styles.emptyAvatar}>
          <Animated.View style={[styles.emptyDot, pulse]} testID={`${testID}-dot`} />
        </View>
        <Text style={styles.emptyText}>{t('seat.empty')}</Text>
      </View>
    );
  }

  const label = [
    p.name,
    p.isMe ? t('seat.me') : null,
    p.isHost ? t('seat.host') : null,
    p.country ? countryName(p.country, i18n.language) : null,
    p.rating === null ? null : t('seat.rating', { rating: p.rating }),
    p.away ? t('seat.away') : null,
  ]
    .filter(Boolean)
    .join(t('player:listSep'));

  return (
    <View style={[styles.row, p.isMe && styles.rowMe]} testID={testID}>
      <View
        accessible
        accessibilityLabel={label}
        style={[styles.who, p.away && styles.away]}
        testID={`${testID}-who`}
      >
        <View style={styles.glyph}>
          <SeatGlyph colorIndex={seat.colorIndex} size={GLYPH} />
        </View>
        <Avatar
          avatarId={p.avatarId}
          size="compact"
          colorIndex={seat.colorIndex}
          backdrop={color.surface}
          expression={p.away ? undefined : AVATAR_REACTIONS.moods.ready}
          inactive={p.away}
        />
        <View style={styles.texts}>
          <View style={styles.nameLine}>
            <Text style={styles.name} numberOfLines={1}>
              {p.name}
            </Text>
            {p.isMe ? (
              <View style={styles.meTag}>
                <Text style={styles.meText}>{t('seat.me')}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.detailLine}>
            {p.country ? <Flag country={p.country} size="compact" decorative /> : null}
            {p.rating === null ? null : (
              <Text style={styles.rating} testID={`${testID}-rating`}>
                {p.rating}
              </Text>
            )}
            {p.isHost ? (
              <View style={styles.hostTag} testID={`${testID}-host`}>
                <Icon name="crown" size={HOST_ICON} color={color.accent} />
                <Text style={styles.hostText}>{t('seat.host')}</Text>
              </View>
            ) : null}
            {p.away ? (
              <Text style={styles.awayText} numberOfLines={1} testID={`${testID}-away`}>
                {t('seat.away')}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
      {onKick && !p.isMe && !p.isHost ? (
        <IconButton
          icon="close"
          accessibilityLabel={t('kick.label', { name: p.name })}
          onPress={() => onKick(p)}
          testID={`${testID}-kick`}
        />
      ) : null}
    </View>
  );
}

/** The seat shape before the avatar (the Modes cards draw 9; a row has room for a clearer one). */
const GLYPH = 12;
/** The crown of "מארח". */
const HOST_ICON = 12;
/** An away player's row (D84a): there, but plainly not here now. */
const AWAY_OPACITY = 0.55;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    minHeight: size.recentRow,
    paddingHorizontal: space[6],
    paddingVertical: space[2],
    borderRadius: radius.lg,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  rowMe: { borderColor: color.players[0].ring },
  rowEmpty: { borderStyle: 'dashed', backgroundColor: color.bg },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[4], minWidth: 0 },
  away: { opacity: AWAY_OPACITY },
  glyph: { width: GLYPH, alignItems: 'center' },
  texts: { flex: 1, minWidth: 0, gap: space[1], alignItems: 'flex-start' },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space[3], maxWidth: '100%' },
  name: { ...text('playerName'), color: color.text, flexShrink: 1 },
  meTag: {
    paddingHorizontal: space[4],
    paddingVertical: space[1],
    borderRadius: radius.pill,
    backgroundColor: color.players[0].ring,
  },
  meText: { ...text('badge'), color: color.players[0].onRing },
  detailLine: { flexDirection: 'row', alignItems: 'center', gap: space[3], flexWrap: 'wrap' },
  rating: { ...text('ratingCompact'), color: color.textMuted, writingDirection: 'ltr' },
  hostTag: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  hostText: { ...text('micro'), color: color.accent },
  awayText: { ...text('micro'), color: color.textMuted },
  emptyAvatar: {
    width: tokens.size.avatar.compact.frame,
    height: tokens.size.avatar.compact.frame,
    borderRadius: radius.md,
    borderWidth: tokens.border.hairline,
    borderStyle: 'dashed',
    borderColor: color.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyDot: {
    width: metrics.dot.size,
    height: metrics.dot.size,
    borderRadius: radius.pill,
    backgroundColor: color.textMuted,
  },
  emptyText: { ...text('rowTitle'), color: color.textMuted },
});
