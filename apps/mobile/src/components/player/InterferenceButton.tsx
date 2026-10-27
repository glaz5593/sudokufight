import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import { color, radius, size, tokens } from '../../theme';
import { Icon } from '../Icon';
import { Text } from '../ui/Text';
import type { InterferenceModel } from './cardModel';
import { withAlpha } from './format';
import { metrics, paletteAt } from './metrics';
import { interferenceLabel } from './wording';

export interface InterferenceButtonProps {
  /** The opponent's display name, for the label ("הפרעה ל־NinaVolt · עלות 2 נק׳"). */
  name: string;
  state: InterferenceModel;
  /** The compact card's strip version (height 32, a 44-dp target through hitSlop). */
  compact?: boolean;
  /** The interference picker is open from this card. */
  expanded?: boolean;
  /** Tap when it can be sent: opens the picker aimed at this card (the first of the two taps, D45). */
  onPress?: () => void;
  /**
   * Tap while it can't be sent (short of points, the target busy, the game not running): the screen says why in
   * a short toast with a light haptic (components.md §8.1). While the picker is open it closes it instead.
   */
  onBlockedPress?: (state: InterferenceModel) => void;
  testID?: string;
}

/** My colour, because it is my action (components.md §8.1). */
const ME = paletteAt(0);
const PRESSED_BG = withAlpha(ME.ring, tokens.opacity.iconBadgeFill);

/**
 * The "הפרעה" button on an opponent's card (original §10 "אצל היריב: לחצן הפרעה"; components.md §8.1) [D45]:
 * an icon button in the reactions button's family, as tall as it, with the 'interfere' glyph and the word only.
 * Its price is in the picker and in its accessible label ("הפרעה ל־NinaVolt · עלות 2 נק׳"), not on it.
 *
 * Blocked (short of points, the target under interference or immune, the game not running), it is dimmed and
 * reads as disabled, but a tap still answers, with the reason (`onBlockedPress`). Hidden while the opponent is
 * disconnected (the reconnect pill takes its place) or out of the game. While the picker is open from it, it is
 * filled in my colour and reads "סגירת חלון ההפרעות": a tap closes it.
 */
export function InterferenceButton({
  name,
  state,
  compact = false,
  expanded = false,
  onPress,
  onBlockedPress,
  testID,
}: InterferenceButtonProps) {
  const { t } = useTranslation('player');
  if (state.kind === 'disconnected' || state.kind === 'out') return null;

  const available = state.kind === 'available';
  const fg = expanded ? color.bg : color.interfere.label;
  const iconColor = expanded ? color.bg : color.interfere.icon;
  const m = metrics.interfere;

  return (
    <Pressable
      onPress={() => (available ? onPress?.() : onBlockedPress?.(state))}
      // Never `disabled`: a blocked tap says why. (Pressable would also overwrite accessibilityState.disabled.)
      hitSlop={compact ? { top: metrics.compact.hitSlop, bottom: metrics.compact.hitSlop } : undefined}
      accessibilityRole="button"
      accessibilityLabel={interferenceLabel(name, state, t, expanded)}
      accessibilityState={{ disabled: !available, expanded }}
      testID={testID}
      style={({ pressed }) => [
        compact ? styles.compact : styles.regular,
        pressed && available && !expanded && { backgroundColor: PRESSED_BG },
        expanded && styles.expanded,
        !available && !expanded && { opacity: tokens.opacity.inactivePlayer },
      ]}
    >
      <Icon name="interfere" size={compact ? m.compactIcon : m.icon} color={iconColor} />
      <Text
        style={[compact ? m.compactLabelStyle : m.labelStyle, styles.label, { color: fg }]}
        numberOfLines={1}
        adjustsFontSizeToFit={compact}
        minimumFontScale={compact ? m.minFontScale : undefined}
        testID={testID ? `${testID}-label` : undefined}
      >
        {t('interfere.button')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  regular: {
    height: size.touch,
    paddingHorizontal: metrics.interfere.paddingX,
    flexDirection: 'row',
    alignItems: 'center',
    gap: metrics.interfere.gap,
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.interfere.border,
    backgroundColor: color.interfere.bg,
  },
  compact: {
    flex: 1,
    minWidth: 0,
    height: metrics.compact.actionHeight,
    paddingHorizontal: metrics.interfere.compactPaddingX,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: metrics.interfere.compactGap,
    borderRadius: metrics.compact.actionRadius,
    borderWidth: tokens.border.hairline,
    borderColor: color.interfere.border,
    backgroundColor: color.interfere.bg,
  },
  label: { flexShrink: 1 },
  expanded: { backgroundColor: ME.ring, borderColor: ME.ring },
});
