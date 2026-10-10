import { Pressable, StyleSheet } from 'react-native';

import { color, radius, size, tokens } from '../../theme';
import { Icon, type IconName } from '../Icon';
import { metrics } from './metrics';

export interface CardIconButtonProps {
  icon: IconName;
  /** Required: the button has no visible text. */
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  /** The reaction rate limit [D19]: disabled and at .5 for its 2 s. */
  coolingDown?: boolean;
  /** The reactions picker is open. */
  expanded?: boolean;
  /** The compact card's 32-dp strip button (a 44-dp target through hitSlop). */
  compact?: boolean;
  testID?: string;
}

/** The 44 × 44 icon button of a card (components.md §1.4), and its compact form (§7.2). */
export function CardIconButton({
  icon,
  label,
  onPress,
  disabled = false,
  coolingDown = false,
  expanded,
  compact = false,
  testID,
}: CardIconButtonProps) {
  const off = disabled || coolingDown;
  const slop = compact ? { top: metrics.compact.hitSlop, bottom: metrics.compact.hitSlop } : undefined;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      hitSlop={slop}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, ...(expanded === undefined ? null : { expanded }) }}
      testID={testID}
      style={({ pressed }) => [
        compact ? styles.compact : styles.regular,
        (pressed || expanded) && styles.active,
        expanded && styles.expanded,
        off && {
          opacity: coolingDown && !disabled ? tokens.opacity.inactivePlayer : tokens.opacity.disabled,
        },
      ]}
    >
      {({ pressed }) => (
        <Icon
          name={icon}
          size={compact ? metrics.compact.actionIcon : size.icon.card}
          color={pressed || expanded ? color.text : color.textMuted}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  regular: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: {
    flex: 1,
    minWidth: 0,
    height: metrics.compact.actionHeight,
    borderRadius: metrics.compact.actionRadius,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  active: { backgroundColor: color.surface2 },
  expanded: { borderColor: color.textMuted },
});
