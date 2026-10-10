import type { AvatarId, CountryCode } from '@sudoku-fight/protocol';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '../../components/Icon';
import { Avatar, Flag, ltr, paletteAt, SeatGlyph, VsBadge } from '../../components/player';
import { color, radius, size, space, text, tokens } from '../../theme';

/**
 * "ככה יראו אותך בזירה" (spec §3.2: a live preview of the card as it will show in a game; Register-Fighter):
 * my plate in my P1 colour (● ring, avatar, name and flag, "חדש", score 0), VS, and an unknown opponent in
 * P2. It follows every change on the screen. One label for screen readers.
 */
export function FighterPreview({
  avatarId,
  name,
  country,
  testID = 'fighter-preview',
}: {
  avatarId: AvatarId;
  /** Empty: the default name (home:profile.defaultName). */
  name: string;
  country: CountryCode | null;
  testID?: string;
}) {
  const { t } = useTranslation('account');
  const shown = name.trim() || t('home:profile.defaultName');
  return (
    <View style={styles.panel} testID={testID}>
      <View style={styles.titleRow}>
        <Icon name="target" size={size.icon.inline} color={color.textMuted} />
        <Text style={styles.title}>{t('fighter.previewTitle')}</Text>
      </View>
      <View
        style={styles.plates}
        accessible
        accessibilityRole="image"
        accessibilityLabel={t('fighter.previewLabel', { name: shown })}
      >
        <Plate
          colorIndex={0}
          avatarId={avatarId}
          name={shown}
          country={country}
          sub={t('fighter.previewNew')}
          testID={`${testID}-me`}
        />
        <VsBadge />
        <Plate
          colorIndex={1}
          avatarId={null}
          name={ltr(t('fighter.previewOpponentName'))}
          country={null}
          sub={t('fighter.previewOpponent')}
          testID={`${testID}-opponent`}
        />
      </View>
    </View>
  );
}

function Plate({
  colorIndex,
  avatarId,
  name,
  country,
  sub,
  testID,
}: {
  colorIndex: number;
  avatarId: AvatarId | null;
  name: string;
  country: CountryCode | null;
  sub: string;
  testID: string;
}) {
  const ring = paletteAt(colorIndex).ring;
  return (
    <View style={styles.plate} importantForAccessibility="no-hide-descendants" testID={testID}>
      <Avatar avatarId={avatarId} size="card" colorIndex={colorIndex} backdrop={color.surface2} />
      <View style={styles.names}>
        <View style={styles.nameRow}>
          <SeatGlyph colorIndex={colorIndex} size={space[4] - 1} />
          <Text style={styles.name} numberOfLines={1} testID={`${testID}-name`}>
            {name}
          </Text>
          <Flag country={country} size="compact" decorative />
        </View>
        <Text style={styles.sub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <Text style={[styles.score, { color: ring }]}>0</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: space[6],
    padding: space[6],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  title: { ...text('label'), color: color.textMuted },
  plates: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  plate: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    padding: space[4],
    borderRadius: radius.button,
    backgroundColor: color.surface2,
  },
  names: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: space[1] },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], maxWidth: '100%' },
  name: { ...text('label'), color: color.text, flexShrink: 1 },
  sub: { ...text('plateNameCompact'), color: color.textMuted },
  score: { ...text('scoreSm') },
});
