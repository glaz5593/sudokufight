import type { InterferenceKind } from '@sudoku-fight/engine';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '../../../components/Icon';
import { signedText } from '../../../components/player/format';
import { color, tokens } from '../../../theme';
import { type ArsenalToken, launchable } from './arsenalModel';
import { arsenalMetrics as m } from './metrics';
import { TokenArt } from './TokenArt';
import { blockedPill, kindTitle, tokenLabel } from './wording';

export interface KindButtonProps {
  token: ArsenalToken;
  /** The target's display name, for the label ("… · הקשה משגרת אל NinaVolt"). */
  targetName: string;
  /** Its width in the grid (pickerLayout's column width). */
  width: number;
  /** Reduced motion: a still preview, and no press scale. */
  reduce: boolean;
  /** The reason bubble over this kind, while it shows (a tap on a blocked kind). */
  bubble: string | null;
  /** The second tap [D45]: the picker launches it, or says why it can't. */
  onPress: (kind: InterferenceKind) => void;
}

/**
 * One kind in the interference picker (components.md §13) [D45]: its live preview, its name (up to two lines)
 * and a clear price chip, "⁦−2⁩ נק׳". A tap launches it at the target (after the picker's arm delay); there is no
 * drag. A kind that can't go now is dimmed and its chip says why ("חסרות 3 נק׳", "תחת הפרעה", or a lock and
 * "רמה 3" for a kind above my level); a tap on it only explains. Screen readers: activating it launches, and
 * its label always says the price and the target.
 */
export function KindButton({ token, targetName, width, reduce, bubble, onPress }: KindButtonProps) {
  const { t } = useTranslation('game');
  const { kind } = token;
  const ready = launchable(token);
  const locked = token.blockedReason === 'locked';

  return (
    <View style={{ width }}>
      <Pressable
        onPress={() => onPress(kind)}
        accessibilityRole="button"
        accessibilityLabel={tokenLabel(token, targetName, t)}
        accessibilityState={{ disabled: !ready }}
        testID={`arsenal-kind-${kind}`}
        style={({ pressed }) => [
          styles.button,
          pressed && ready && styles.pressed,
          pressed && ready && !reduce && styles.pressedScale,
          !ready && styles.blocked,
        ]}
      >
        <TokenArt kind={kind} size={m.button.art} still={reduce || !ready} />
        <View style={styles.nameBox}>
          <Text style={[m.button.nameStyle, styles.name]} numberOfLines={m.button.nameLines}>
            {kindTitle(kind, t)}
          </Text>
        </View>
        <View style={styles.chip} testID={`arsenal-kind-${kind}-chip`}>
          {ready ? (
            <>
              {/* "⁦−2⁩ נק׳": the number in an LTR isolate, in a row that follows the app's direction. */}
              <Text style={[m.button.chipNumberStyle, styles.price]} numberOfLines={1}>
                {signedText(-token.cost)}
              </Text>
              <Text style={[m.button.chipTextStyle, styles.price]} numberOfLines={1}>
                {t('arsenal.unit')}
              </Text>
            </>
          ) : (
            <>
              {locked ? <Icon name="lock" size={m.button.chip.icon} color={color.textMuted} /> : null}
              <Text style={[m.button.chipTextStyle, styles.muted]} numberOfLines={1}>
                {blockedPill(token, t)}
              </Text>
            </>
          )}
        </View>
      </Pressable>
      {bubble ? (
        <View style={styles.bubbleRow} pointerEvents="none">
          <View style={styles.bubble} testID={`arsenal-bubble-${kind}`}>
            <Text style={[m.bubble.style, styles.bubbleText]}>{bubble}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    height: m.button.height,
    paddingTop: m.button.paddingTop,
    paddingHorizontal: m.button.paddingX,
    alignItems: 'center',
    borderRadius: m.button.radius,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface2,
  },
  pressed: { borderColor: color.accent, backgroundColor: color.accentSubtle },
  pressedScale: { transform: [{ scale: m.button.pressedScale }] },
  blocked: { opacity: tokens.opacity.inactivePlayer },
  // Two lines' room whatever the name, so the chips of a row line up.
  nameBox: {
    height: m.button.nameLines * (m.button.nameStyle.lineHeight ?? 0),
    marginTop: m.button.nameTop,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  name: { color: color.text, textAlign: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: m.button.chip.gap,
    height: m.button.chip.height,
    marginTop: m.button.chipTop,
    paddingHorizontal: m.button.chip.paddingX,
    maxWidth: '100%',
    borderRadius: m.button.chip.radius,
    backgroundColor: color.bg,
  },
  price: { color: color.accent },
  muted: { color: color.textMuted, flexShrink: 1 },
  // The reason over the button: centred on it, and free to be wider than it.
  bubbleRow: {
    position: 'absolute',
    bottom: m.button.height + m.button.chipTop,
    start: -m.bubble.overhang,
    end: -m.bubble.overhang,
    alignItems: 'center',
  },
  bubble: {
    paddingHorizontal: m.bubble.paddingX,
    paddingVertical: m.bubble.paddingY,
    borderRadius: m.bubble.radius,
    backgroundColor: color.accent,
  },
  bubbleText: { color: color.onAccent, textAlign: 'center' },
});
