import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { type Insets, Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { color, radius, size, tokens } from '../../theme';
import { Icon, type IconName } from '../Icon';
import { Spinner } from './Spinner';

export interface IconButtonProps {
  icon: IconName;
  /** Required: an icon alone says nothing to a screen reader ("הגדרות", "כניעה", "תגובות", "סגירה"). */
  accessibilityLabel: string;
  onPress?: () => void;
  /** 20 inside a card (default), 22 in a header (components.md §1.4). */
  iconSize?: 'card' | 'header';
  disabled?: boolean;
  /** Shows a spinner, sets `busy`, and ignores presses. */
  loading?: boolean;
  /** For a button that opens something (the reactions picker): sets `expanded` and the open look. */
  expanded?: boolean;
  accessibilityHint?: string;
  hitSlop?: number | Insets;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  ref?: Ref<View>;
}

/** The 44×44 outlined icon button of direction C (settings, surrender, reactions, close). components.md §1.4. */
export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  iconSize = 'card',
  disabled = false,
  loading = false,
  expanded,
  accessibilityHint,
  hitSlop,
  style,
  testID,
  ref,
}: IconButtonProps) {
  const { t } = useTranslation('ui');
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={loading ? t('button.loading', { label: accessibilityLabel }) : accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{
        disabled,
        busy: loading,
        ...(expanded === undefined ? null : { expanded }),
      }}
      disabled={disabled}
      onPress={loading ? undefined : onPress}
      hitSlop={hitSlop}
      testID={testID}
      style={({ pressed }) => [
        styles.box,
        (pressed || expanded) && styles.active,
        expanded && styles.expanded,
        disabled && styles.disabled,
        style,
      ]}
    >
      {({ pressed }) =>
        loading ? (
          <Spinner color={color.textMuted} size={size.icon.inline} />
        ) : (
          <Icon
            name={icon}
            size={iconSize === 'header' ? size.icon.header : size.icon.card}
            color={pressed || expanded ? color.text : color.textMuted}
          />
        )
      }
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    width: size.iconButton,
    height: size.iconButton,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  active: {
    backgroundColor: color.surface2,
  },
  expanded: {
    borderColor: color.textMuted,
  },
  disabled: {
    opacity: tokens.opacity.disabled,
  },
});
