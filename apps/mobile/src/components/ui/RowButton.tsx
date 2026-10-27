import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { color, radius, size, space, text, tokens } from '../../theme';
import { Icon, type IconName } from '../Icon';
import { Spinner } from './Spinner';

import { Text } from './Text';
export interface RowButtonProps {
  icon: IconName;
  title: string;
  /** Second line, e.g. "מדורג · 2 שחקנים · רגיל". */
  subtitle?: string;
  onPress?: () => void;
  disabled?: boolean;
  /** Replaces the chevron with a spinner, sets `busy`, and ignores presses. */
  loading?: boolean;
  /** Chip-like use: gold border and title (components.md §1.2). */
  selected?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  ref?: Ref<View>;
}

/**
 * The full-width list row of Dir-C-Home ("עוד סיבוב"): icon, title over subtitle, and a chevron that points the
 * way reading goes (left in Hebrew). Everything sits in a `row`, so React Native mirrors it with the language.
 */
export function RowButton({
  icon,
  title,
  subtitle,
  onPress,
  disabled = false,
  loading = false,
  selected,
  accessibilityHint,
  style,
  testID,
  ref,
}: RowButtonProps) {
  const { t } = useTranslation('ui');
  const label = subtitle ? t('row.label', { title, subtitle }) : title;
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={loading ? t('button.loading', { label }) : label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{
        disabled,
        busy: loading,
        ...(selected === undefined ? null : { selected }),
      }}
      disabled={disabled}
      onPress={loading ? undefined : onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.pressed,
        selected && styles.selected,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Icon name={icon} size={size.icon.row} color={color.textMuted} />
      <View style={styles.texts}>
        <Text style={[styles.title, selected && styles.titleSelected]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {loading ? (
        <Spinner color={color.text} size={size.icon.chevron} />
      ) : (
        <Icon name="chevronForward" size={size.icon.chevron} color={color.iconFaint} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[7],
    // The least: a taller script (Thai, Arabic) may need more, never cut (localization plan 0ט).
    minHeight: size.listRow,
    paddingHorizontal: space[8],
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  pressed: {
    backgroundColor: color.surface,
  },
  selected: {
    borderColor: color.accent,
  },
  disabled: {
    opacity: tokens.opacity.disabled,
  },
  texts: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
    gap: space[2],
  },
  title: {
    ...text('rowTitle'),
    color: color.text,
  },
  titleSelected: {
    color: color.accent,
  },
  subtitle: {
    ...text('caption'),
    color: color.textMuted,
  },
});
