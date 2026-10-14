import type { AvatarId, CountryCode } from '@sudoku-fight/protocol';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import type { AvatarReaction } from '../../avatars';
import { Avatar, countryName, Flag, SeatGlyph } from '../../components/player';
import { color, radius, space, text, tokens } from '../../theme';

/** The seat glyph before my name (● in P1), as on the game's cards, and the gap after it. */
const GLYPH = space[4] - 1;
const GLYPH_GAP = space[3];
/** What the name's row spends before the name itself. */
export const NAME_LEAD = GLYPH + GLYPH_GAP;

/**
 * My fighter, one card the width of the screen (Register-Fighter's preview, Register-Account's "הלוחם מוכן"):
 * my avatar in my P1 frame, ● and the display name with room for all of it (an ellipsis only past the card's
 * width), and under it the flag and the country's name, then `note` ("חדש", "✓ הלוחם מוכן"). `end`: an
 * action at the end ("עריכה").
 */
export function FighterCard({
  avatarId,
  name,
  country,
  note,
  end,
  idle = false,
  reaction = null,
  style,
  testID,
}: {
  avatarId: AvatarId | null;
  name: string;
  country: CountryCode | null;
  note?: ReactNode;
  end?: ReactNode;
  /** The avatar idles (a stage view: AVATAR_STAGES.picker). */
  idle?: boolean;
  reaction?: AvatarReaction | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { i18n } = useTranslation('account');
  return (
    <View style={[styles.card, style]} testID={testID}>
      <Avatar
        avatarId={avatarId}
        size="row"
        colorIndex={0}
        backdrop={color.surface}
        idle={idle}
        reaction={reaction}
        testID={testID && `${testID}-avatar`}
      />
      <View style={styles.text}>
        <View style={styles.nameRow}>
          <SeatGlyph colorIndex={0} size={GLYPH} />
          <Text style={styles.name} numberOfLines={1} testID={testID && `${testID}-name`}>
            {name}
          </Text>
        </View>
        <View style={styles.line}>
          <Flag country={country} size="compact" decorative />
          {country ? (
            <Text style={styles.country} numberOfLines={1}>
              {countryName(country, i18n.language)}
            </Text>
          ) : null}
          {note}
        </View>
      </View>
      {end}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[6],
    padding: space[6],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    // Me, in my P1 colour.
    borderColor: color.players[0]!.ring,
    backgroundColor: color.surface,
  },
  text: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: space[2] },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: GLYPH_GAP, maxWidth: '100%' },
  name: { ...text('playerName'), color: color.text, flexShrink: 1 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  country: { ...text('caption'), color: color.textMuted, flexShrink: 1 },
});
