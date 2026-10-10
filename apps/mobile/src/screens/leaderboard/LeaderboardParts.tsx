import type { LeaderboardEntry } from '@sudoku-fight/protocol';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, Flag, LeagueBadge, paletteAt, Rating, SeatGlyph } from '../../components/player';
import { color, radius, size, space, text, tokens } from '../../theme';
import { entryLabel, rankText, type ProgressT } from './leaderboardModel';

/**
 * The leaderboard's rows (spec §14.2; Leaderboard.dc.html in direction C): the podium of the first three, a
 * row per player after them, and my row pinned at the bottom. "Me" is always P1: the cyan frame and the ●,
 * so it never depends on the colour alone (CLAUDE.md). Each row is one button that opens the player's card,
 * with one summary for screen readers.
 */

const ME = paletteAt(0);
const GLYPH = space[5];

/** The podium's columns in screen order: 2nd, 1st, 3rd (the winner in the middle). */
const PODIUM_ORDER = [1, 0, 2] as const;
/** The steps' heights by place (1st highest), from the spacing scale (the design has no token). */
const STEP = [space[15], space[13], space[11]] as const;
/** The medals of the three places: the league colours gold, silver and bronze. */
const MEDAL = [color.league.gold, color.league.silver, color.league.bronze] as const;

export function Podium({
  podium,
  myId,
  onOpen,
}: {
  podium: readonly LeaderboardEntry[];
  myId: string | null;
  onOpen: (entry: LeaderboardEntry) => void;
}) {
  const { t, i18n } = useTranslation('progress');
  return (
    <View
      style={styles.podium}
      accessibilityRole="list"
      accessibilityLabel={t('leaderboard.podium')}
      testID="leaderboard-podium"
    >
      {PODIUM_ORDER.map((i) => {
        const entry = podium[i];
        if (!entry) return <View key={i} style={styles.podiumColumn} />;
        const mine = entry.id === myId;
        const medal = MEDAL[i]!;
        return (
          <Pressable
            key={entry.id}
            accessibilityRole="button"
            accessibilityLabel={entryLabel(entry, t as ProgressT, i18n.language, mine)}
            accessibilityHint={t('leaderboard.openHint')}
            onPress={() => onOpen(entry)}
            style={({ pressed }) => [styles.podiumColumn, pressed && styles.pressed]}
            testID={`leaderboard-podium-${entry.rank}-${entry.id}`}
          >
            <Avatar
              avatarId={entry.avatarId}
              size={i === 0 ? 'row' : 'card'}
              colorIndex={mine ? 0 : null}
              backdrop={color.bg}
            />
            {mine ? <MeChip /> : null}
            <View style={styles.podiumName}>
              <Text
                style={[text('label'), mine ? styles.me : styles.strong, styles.shrink]}
                numberOfLines={1}
              >
                {entry.displayName}
              </Text>
              <Flag country={entry.country} size="compact" decorative />
            </View>
            <Rating value={entry.rating} size="list" provisional={entry.provisional} decorative />
            <View style={[styles.step, { height: STEP[i], borderTopColor: medal }]}>
              <Text style={[text('scoreCompact'), { color: medal }]}>{entry.rank}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function MeChip() {
  const { t } = useTranslation('progress');
  return (
    <View style={styles.meChip}>
      <SeatGlyph colorIndex={0} size={GLYPH} color={ME.onRing} />
      <Text style={[text('micro'), styles.onMe]}>{t('common.you')}</Text>
    </View>
  );
}

export function LeaderboardRow({
  entry,
  mine,
  onOpen,
  testID,
}: {
  entry: LeaderboardEntry;
  mine: boolean;
  onOpen: (entry: LeaderboardEntry) => void;
  testID?: string;
}) {
  const { t, i18n } = useTranslation('progress');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={entryLabel(entry, t as ProgressT, i18n.language, mine)}
      accessibilityHint={t('leaderboard.openHint')}
      onPress={() => onOpen(entry)}
      style={({ pressed }) => [styles.row, mine && styles.rowMine, pressed && styles.pressed]}
      testID={testID ?? `leaderboard-row-${entry.id}`}
    >
      <Text style={[text('label'), styles.rank, mine ? styles.me : styles.muted]} numberOfLines={1}>
        {rankText(entry.rank)}
      </Text>
      <Avatar
        avatarId={entry.avatarId}
        size="compact"
        colorIndex={mine ? 0 : null}
        backdrop={color.surface}
      />
      <View style={styles.who}>
        <View style={styles.nameRow}>
          {mine ? <SeatGlyph colorIndex={0} size={GLYPH} /> : null}
          <Text
            style={[text('playerName'), mine ? styles.me : styles.strong, styles.shrink]}
            numberOfLines={1}
          >
            {entry.displayName}
          </Text>
          <Flag country={entry.country} size="compact" decorative />
        </View>
        {entry.league ? (
          <LeagueBadge league={entry.league} level={entry.level} variant="icon" />
        ) : (
          <Text style={[text('micro'), styles.muted]} numberOfLines={1}>
            {`${t('common.provisional')}${t('player:sep')}${t('common.level', { level: entry.level })}`}
          </Text>
        )}
      </View>
      <Rating value={entry.rating} size="list" provisional={entry.provisional} decorative />
    </Pressable>
  );
}

/**
 * My row, pinned at the bottom (spec §14.2: "#214 · MosheG · 1287"), with "שחק" beside it (Leaderboard.dc.html:
 * the screen's one gold action, "play to climb"); while I have no rating in this tab, a line saying so and
 * "שחק".
 */
export function PinnedMe({
  me,
  onOpen,
  onPlay,
}: {
  me: LeaderboardEntry | null;
  onOpen: (entry: LeaderboardEntry) => void;
  onPlay: () => void;
}) {
  const { t } = useTranslation('progress');
  const play = (label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPlay}
      style={({ pressed }) => [styles.play, pressed && styles.pressed]}
      testID="leaderboard-play"
    >
      <Text style={[text('buttonSm'), styles.onAccent]}>{t('leaderboard.play')}</Text>
    </Pressable>
  );
  if (me) {
    return (
      <View style={[styles.pinned, styles.pinnedRow]} testID="leaderboard-me">
        <View style={styles.grow}>
          <LeaderboardRow entry={me} mine onOpen={onOpen} testID="leaderboard-me-row" />
        </View>
        {play(t('leaderboard.climbHint'))}
      </View>
    );
  }
  return (
    <View style={[styles.pinned, styles.pinnedRow, styles.pinnedEmpty]} testID="leaderboard-me-none">
      <SeatGlyph colorIndex={0} size={GLYPH} />
      <Text style={[text('caption'), styles.muted, styles.grow]}>{t('leaderboard.meNone')}</Text>
      {play(t('leaderboard.playHint'))}
    </View>
  );
}

const RANK_WIDTH = space[14];

const styles = StyleSheet.create({
  podium: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space[4],
    paddingTop: space[6],
  },
  podiumColumn: { flex: 1, minWidth: 0, alignItems: 'center', gap: space[3] },
  podiumName: { flexDirection: 'row', alignItems: 'center', gap: space[2], maxWidth: '100%' },
  step: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space[2],
    borderTopWidth: tokens.border.badgeRing,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    backgroundColor: color.surface,
  },
  meChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: ME.ring,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[5],
    minHeight: size.listRow,
    paddingHorizontal: space[5],
    borderRadius: radius.lg,
    backgroundColor: color.surface,
    borderWidth: tokens.border.hairline,
    borderColor: color.surface,
  },
  rowMine: { borderColor: ME.ring },
  pressed: { opacity: 0.85 },
  rank: { width: RANK_WIDTH, textAlign: 'center' },
  who: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: space[2] },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], maxWidth: '100%' },
  shrink: { flexShrink: 1 },
  grow: { flex: 1 },
  pinned: {
    paddingHorizontal: tokens.layout.gutterGame,
    paddingVertical: space[4],
    backgroundColor: color.bg,
    borderTopWidth: tokens.border.hairline,
    borderTopColor: color.border,
  },
  pinnedRow: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  pinnedEmpty: { minHeight: size.listRow },
  play: {
    minHeight: size.touch,
    minWidth: size.touch,
    paddingHorizontal: space[8],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.button,
    backgroundColor: color.accent,
  },
  onAccent: { color: color.onAccent },
  strong: { color: color.text },
  muted: { color: color.textMuted },
  me: { color: ME.ring },
  onMe: { color: ME.onRing },
});
