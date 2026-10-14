import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { color, space, text, tokens } from '../../theme';
import { metrics } from './metrics';

export type RatingSize = 'home' | 'list' | 'card' | 'compact';

/** components.md §5.1: 44 Home · 22 lists · 16 the 2P card · 15 the compact card. */
const NUMBER_STYLE: Record<RatingSize, TextStyle> = {
  home: text('rating'),
  list: metrics.rating.listStyle,
  card: metrics.card.ratingStyle,
  compact: text('ratingCompact'),
};

export interface RatingProps {
  value: number;
  size?: RatingSize;
  /** The rating key's name ("רגיל"): drawn above the number on Home, and spoken. */
  label?: string;
  /** Shows the label above the number (Home's three columns). */
  showLabel?: boolean;
  /** The first 10 games in this rating key (spec §11.2). */
  provisional?: boolean;
  /** Inside a card, the card's label already says the rating. */
  decorative?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Home's three columns: the number is 44 and a column a third of the card, so the provisional chip goes under
 * the number, not beside it (Moshe's device test, 14.10.2026: "זמני" squeezed the numbers), and the number
 * stays whole on one line, shrinking a little rather than being cut at the largest text sizes.
 */
const STACKED: Record<RatingSize, boolean> = { home: true, list: false, card: false, compact: false };
const FIT_NUMBER = { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.6 } as const;

/** A rating number: Teko, tabular, LTR, gold. No star in C. */
export function Rating({
  value,
  size = 'card',
  label,
  showLabel = false,
  provisional = false,
  decorative = false,
  style,
  testID,
}: RatingProps) {
  const { t } = useTranslation('player');
  const shown = Math.round(value);
  const base =
    label === undefined
      ? t('rating.label', { value: shown })
      : t('rating.labelWithKey', { key: label, value: shown });
  const a11y = provisional ? t('rating.provisionalLabel', { label: base }) : base;
  return (
    <View
      style={[styles.column, style]}
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'text'}
      accessibilityLabel={decorative ? undefined : a11y}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'yes'}
      testID={testID}
    >
      {showLabel && label !== undefined ? <Text style={[text('label'), styles.label]}>{label}</Text> : null}
      <View style={STACKED[size] ? styles.stack : styles.row}>
        <Text style={[NUMBER_STYLE[size], styles.number]} {...(STACKED[size] ? FIT_NUMBER : null)}>
          {String(shown)}
        </Text>
        {provisional ? (
          <View style={styles.chip} testID={testID && `${testID}-provisional`}>
            <Text style={[text('plateNameCompact'), styles.chipText]} numberOfLines={1}>
              {t('rating.provisional')}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { alignItems: 'center' },
  // Dir-C-Home: the key name sits 8 above the number.
  label: { color: color.textMuted, marginBottom: space[4] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  stack: { alignItems: 'center', gap: space[2] },
  number: { color: color.accent },
  chip: {
    minHeight: metrics.rating.provisionalChipHeight,
    paddingHorizontal: metrics.rating.provisionalPaddingX,
    borderRadius: metrics.rating.provisionalChipHeight / 2,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    justifyContent: 'center',
  },
  chipText: { color: color.textMuted },
});
