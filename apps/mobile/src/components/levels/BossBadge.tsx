import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { color, radius, size, space, text, tokens } from '../../theme';
import { Icon } from '../Icon';

/**
 * The boss's marks (plan §3.3, components.md §19.6; 1.0.3: levels-ui.md §3.2, D77). Shape and word both, never
 * colour alone; all static (nothing to reduce under Reduced Motion).
 * - BossBadge: a gold crown and the "בוס" chip, beside a boss stage's title where there is no room for more (the
 *   map's panel). Read as part of the title around it, so it is hidden from screen readers.
 * - BossBand: the band at the top of a boss stage, in place of the chip: "👑 בוס · פרק 3" in gold on the
 *   accent's subtle ground, a 1 dp gold line. It is the stage's one spoken "boss", so a screen reader reads it.
 * - BossCrown: the 16 dp crown over the bot's avatar on its card (the race, the duel): the original §5.3.3's
 *   "the boss's avatar with a crown".
 */
export function BossBadge({ testID = 'boss-badge' }: { testID?: string }) {
  const { t } = useTranslation('levels');
  return (
    <View
      style={styles.chip}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      <Icon name="crown" size={size.icon.inline - space[2]} color={color.accent} />
      <Text style={styles.text}>{t('boss.chip')}</Text>
    </View>
  );
}

/** "בוס · פרק 3" over a boss stage (its header's first row). */
export function BossBand({
  chapter,
  style,
  testID = 'boss-band',
}: {
  chapter: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { t } = useTranslation('levels');
  const words = t('boss.band', { chapter });
  return (
    <View style={[styles.band, style]} accessible accessibilityLabel={words} testID={testID}>
      <Icon name="crown" size={BAND_CROWN} color={color.accent} />
      <Text style={styles.bandText} numberOfLines={1} testID={`${testID}-text`}>
        {words}
      </Text>
    </View>
  );
}

/**
 * A crown over an avatar: put it inside the avatar's own box (a View around the Avatar). `end` (the cards): on
 * the top-end corner, clear of the avatar's "בוט" chip at the top-start; `center`: centred on the top edge.
 * Decorative: the card's label says "Pip, הבוס".
 */
export function BossCrown({
  size: px = CARD_CROWN,
  align = 'end',
  testID = 'boss-crown',
}: {
  size?: number;
  align?: 'end' | 'center';
  testID?: string;
}) {
  const top = -Math.round(px * 0.75);
  return (
    <View
      pointerEvents="none"
      style={[
        styles.crownRow,
        align === 'end' ? { top, end: -Math.round(px / 2), alignItems: 'flex-end' } : { top, start: 0 },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      <View style={styles.crown}>
        <Icon name="crown" size={px} color={color.accent} />
      </View>
    </View>
  );
}

/** The Modes board's chips (22). */
const CHIP_HEIGHT = 22;
/** levels-ui.md §3.2: the band's crown, and the crown on the bot's card (16). */
const BAND_CROWN = 16;
export const CARD_CROWN = 16;
const BAND_HEIGHT = 30;

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    height: CHIP_HEIGHT,
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
    borderWidth: tokens.border.hairline,
    borderColor: color.accent,
    backgroundColor: color.accentSubtle,
    alignSelf: 'flex-start',
  },
  text: { ...text('badge'), color: color.accent },
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    minHeight: BAND_HEIGHT,
    paddingHorizontal: space[6],
    borderRadius: radius.sm,
    borderWidth: tokens.border.hairline,
    borderColor: color.accent,
    backgroundColor: color.accentSubtle,
  },
  bandText: { ...text('label'), color: color.accent, flexShrink: 1 },
  crownRow: { position: 'absolute', end: 0, alignItems: 'center' },
  crown: {
    paddingHorizontal: space[1],
    borderRadius: radius.xs,
    backgroundColor: color.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
