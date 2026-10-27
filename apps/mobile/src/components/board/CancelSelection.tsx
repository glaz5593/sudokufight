import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import { color, radius, size, space, text, tokens } from '../../theme';
import { Icon } from '../Icon';
import { Text } from '../ui/Text';
import { cancelLabel } from './labels';

/**
 * "ביטול בחירה" under the keypad (components.md §12.2): a ghost button that lets go of my lock. It works only
 * while I hold one; its label names the cell ("ביטול בחירה, F8").
 */

export interface CancelSelectionProps {
  /** The cell I hold ("F8"), or null: then the button is disabled. */
  cell: string | null;
  onPress: () => void;
  testID?: string;
}

export function CancelSelection({ cell, onPress, testID = 'cancel-selection' }: CancelSelectionProps) {
  const { t } = useTranslation('board');
  const enabled = cell !== null;
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={cancelLabel(cell, t)}
      style={({ pressed }) => [
        styles.button,
        pressed && enabled ? styles.pressed : null,
        enabled ? null : styles.disabled,
      ]}
      testID={testID}
    >
      {({ pressed }) => {
        const tint = pressed && enabled ? color.text : color.textMuted;
        return (
          <>
            <Icon name="cancel" size={size.icon.card} color={tint} />
            <Text style={[text('status'), { color: tint }]} numberOfLines={1}>
              {t('cancel.label')}
            </Text>
          </>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    height: size.buttonGhost,
    paddingHorizontal: space[8],
    gap: space[4],
    borderRadius: radius.button,
  },
  pressed: { backgroundColor: color.surface },
  disabled: { opacity: tokens.opacity.disabled },
});
