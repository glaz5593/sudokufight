import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { color, radius, size, space, text, tokens } from '../../theme';
import { Icon } from '../Icon';

/**
 * The boss's mark (plan §3.3, components.md §19.6): a gold crown and the "בוס" chip, beside a boss stage's
 * title (the panel, "מוכן?", the stage's own header). Shape and word both, never colour alone; it is read as
 * part of the title around it, so it is hidden from screen readers.
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

/** The Modes board's chips (22). */
const CHIP_HEIGHT = 22;

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
});
