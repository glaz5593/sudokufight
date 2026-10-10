import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, radius, size, text, tokens } from '../../theme';
import { Icon } from '../Icon';
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
  /** The arsenal is open from this card. */
  expanded?: boolean;
  /** Tap when it can be sent: opens the arsenal (launching is by drag only, D18). */
  onPress?: () => void;
  /** Tap while short of points: the screen shows "אין מספיק נקודות…" and a light haptic (§8.1). */
  onBlockedPress?: (state: InterferenceModel) => void;
  testID?: string;
}

/** My colour, because it is my action (components.md §8.1). */
const ME = paletteAt(0);
const PRESSED_BG = withAlpha(ME.ring, tokens.opacity.iconBadgeFill);

/**
 * The ⚡ button on an opponent's card with the cost of my next interference (components.md §8.1). Hidden while
 * the opponent is disconnected (the reconnect pill takes its place) or out of the game.
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
  // Short of points it still answers a tap (with the reason), but reads as disabled.
  const pressable = available || state.kind === 'points';
  const fg = expanded ? color.bg : color.interfere.label;
  const iconColor = expanded ? color.bg : color.interfere.icon;
  const caption =
    state.kind === 'points' && !compact ? t('interfere.missing', { count: state.missing }) : null;

  return (
    <Pressable
      onPress={() => (available ? onPress?.() : onBlockedPress?.(state))}
      // Leave `disabled` unset while short of points: Pressable would overwrite accessibilityState.disabled.
      disabled={pressable ? undefined : true}
      hitSlop={compact ? { top: metrics.compact.hitSlop, bottom: metrics.compact.hitSlop } : undefined}
      accessibilityRole="button"
      accessibilityLabel={interferenceLabel(name, state, t, expanded)}
      accessibilityState={{ disabled: !available, expanded }}
      testID={testID}
      style={({ pressed }) => [
        compact ? styles.compact : styles.regular,
        pressed && available && { backgroundColor: PRESSED_BG },
        expanded && styles.expanded,
        !available && { opacity: tokens.opacity.inactivePlayer },
      ]}
    >
      <Icon
        name="bolt"
        size={compact ? metrics.interfere.compactIcon : metrics.interfere.icon}
        color={iconColor}
      />
      {compact ? (
        <View style={styles.compactCost}>
          <Text style={[metrics.interfere.compactCostStyle, { color: fg }]}>{String(state.cost)}</Text>
          <Text style={[metrics.interfere.compactUnitStyle, { color: expanded ? fg : color.textMuted }]}>
            {t('interfere.unit')}
          </Text>
        </View>
      ) : (
        <Text style={[text('buttonSm'), { color: fg }]} numberOfLines={1}>
          {caption ?? t('interfere.cost', { cost: state.cost })}
        </Text>
      )}
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: metrics.interfere.compactGap,
    borderRadius: metrics.compact.actionRadius,
    borderWidth: tokens.border.hairline,
    borderColor: color.interfere.border,
    backgroundColor: color.interfere.bg,
  },
  compactCost: { flexDirection: 'row', alignItems: 'baseline', gap: metrics.interfere.compactGap },
  expanded: { backgroundColor: ME.ring, borderColor: ME.ring },
});
