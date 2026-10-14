import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '../../components/Icon';
import { color, radius, size, space, text, tokens } from '../../theme';
import { FieldMessage } from './Field';

/**
 * A field that opens a picker (the avatar and the country of Register-Fighter and Edit profile): the same box
 * as the name field under its label (components in direction C: 44 high, surface2 fill, 1 dp border, red with
 * an error), with what is chosen inside it (a small avatar or a flag, and its name) and "שינוי ⌄" at the end.
 * One button for screen readers: "מדינה: ישראל", and the error after it. Under it, the error or the hint
 * exactly as the name field shows them (FieldMessage: the alert icon, announced as it appears).
 */
export function PickerField({
  label,
  value,
  placeholder,
  leading,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  error = null,
  hint = null,
  testID,
}: {
  label: string;
  /** The chosen item's name; null: nothing chosen yet (the placeholder shows). */
  value: string | null;
  placeholder: string;
  /** Before the name: the chosen avatar, the flag. */
  leading?: ReactNode;
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
  error?: string | null;
  hint?: string | null;
  testID?: string;
}) {
  const { t } = useTranslation('account');
  return (
    <View style={styles.field}>
      <Text style={styles.label} importantForAccessibility="no">
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[accessibilityLabel, error].filter(Boolean).join(', ')}
        accessibilityHint={accessibilityHint}
        onPress={onPress}
        style={({ pressed }) => [styles.box, error ? styles.boxError : null, pressed && styles.pressed]}
        testID={testID}
      >
        {leading}
        <Text style={[styles.value, value === null && styles.placeholder]} numberOfLines={1}>
          {value ?? placeholder}
        </Text>
        <View style={styles.change} importantForAccessibility="no-hide-descendants">
          <Text style={styles.changeText} numberOfLines={1}>
            {t('fields.change')}
          </Text>
          <Icon name="chevronDown" size={size.icon.chevron} color={color.textMuted} />
        </View>
      </Pressable>
      <FieldMessage error={error} hint={hint} testID={testID} />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space[4] },
  label: { ...text('label'), color: color.input.label, alignSelf: 'flex-start' },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    minHeight: size.input,
    paddingVertical: space[2],
    paddingStart: space[4],
    paddingEnd: space[5],
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.input.border,
    backgroundColor: color.input.bg,
  },
  boxError: { borderColor: color.input.borderError },
  pressed: { backgroundColor: color.surface },
  value: { ...text('input'), color: color.input.text, flex: 1 },
  placeholder: { color: color.input.placeholder },
  change: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  changeText: { ...text('label'), color: color.textMuted },
});
