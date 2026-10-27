import { useTranslation } from 'react-i18next';
import { type StyleProp, type TextStyle } from 'react-native';

import { size } from '../../theme';
import { Text } from '../ui/Text';
import { countryName, flagEmoji } from './countryFlag';
import { metrics } from './metrics';

export type FlagSize = 'home' | 'game' | 'compact' | 'sheet';

const FLAG_PX: Record<FlagSize, number> = {
  home: size.flag.home,
  game: size.flag.game,
  compact: size.flag.compact,
  sheet: metrics.flagSheet,
};

export interface FlagProps {
  /** ISO 3166-1 alpha-2, e.g. "IL". Nothing is drawn for a missing or malformed code. */
  country: string | null | undefined;
  /** components.md §4: home 18 · game 15 · compact 13 · sheet 12. */
  size?: FlagSize;
  /** Inside a card the card's label carries the country, so the flag stays silent. */
  decorative?: boolean;
  style?: StyleProp<TextStyle>;
}

/** A country flag as system emoji. Screen readers hear "מדינה: ישראל", never the emoji. */
export function Flag({ country, size: flagSize = 'game', decorative = false, style }: FlagProps) {
  const { t, i18n } = useTranslation('player');
  const emoji = flagEmoji(country);
  if (!emoji || !country) return null;
  const px = FLAG_PX[flagSize];
  return (
    <Text
      style={[{ fontSize: px, lineHeight: Math.round(px * metrics.flagLine) }, style]}
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={
        decorative ? undefined : t('flag.label', { country: countryName(country, i18n.language) })
      }
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'yes'}
      testID={`flag-${country.toUpperCase()}`}
    >
      {emoji}
    </Text>
  );
}
