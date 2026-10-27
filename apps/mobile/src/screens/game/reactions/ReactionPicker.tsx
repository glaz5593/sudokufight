import { type ComponentRef, type Ref, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  I18nManager,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';

import { Text } from '../../../components/ui/Text';
import { cue } from '../../../services/feedback';
import { color, radius, space, tokens } from '../../../theme';
import { motion, useReduceMotion } from '../../../theme/motion';
import type { Rect } from '../geometry';
import {
  defaultCardRect,
  type PickerItem,
  pickerWidth,
  placeUnder,
  POPOVER,
  reactionsButtonX,
} from './model';
import { POP_FROM, Popover, popSpring } from './Popover';

/**
 * My reactions picker (spec §8, components.md §8.2, Reactions.dc.html): from the reactions button on my card, a
 * row of the game's six reactions (😂 😱 😎 🤦 🔥 👀), each a 44 dp button with its emoji at 26, in a popover
 * under my card whose arrow points at the button. It pops open with the emoji staggered 40 ms
 * (`reactions.strip`), and closes on a pick or an outside tap (120 ms).
 *
 * A pick plays `reactSend` (a selection haptic), calls `onPick(emoji)` (the screen sends it with host.react)
 * and closes. The float that rises from my card is the screen's, from the reaction event, as for everyone's.
 * During the 2 s rate limit [D19] the items are disabled at .5; the limit itself comes from the view.
 */
export interface ReactionPickerProps {
  visible: boolean;
  /** My card's rect, in the coordinates of the layer the picker is drawn in (the game screen's root). */
  anchor: Rect | null;
  /** From pickerModel(view, now).items. */
  items: readonly PickerItem[];
  onPick: (emoji: string) => void;
  /** An outside tap, back, escape, or right after a pick. */
  onClose: () => void;
  testID?: string;
}

/** The emoji in a picker button (components.md §8.2: 26 in 44). */
const EMOJI = space[11] - space[1];

export function ReactionPicker({
  visible,
  anchor,
  items,
  onPick,
  onClose,
  testID = 'reaction-picker',
}: ReactionPickerProps) {
  const { t } = useTranslation('game');
  const reduce = useReduceMotion();
  const { width: screenWidth } = useWindowDimensions();
  const first = useRef<ComponentRef<typeof Pressable>>(null);

  // Screen readers go to the first emoji as the picker opens.
  useEffect(() => {
    if (visible && first.current) AccessibilityInfo.sendAccessibilityEvent(first.current, 'focus');
  }, [visible]);

  const card = anchor ?? defaultCardRect(screenWidth, I18nManager.isRTL);
  const width = pickerWidth(items.length);
  const placement = placeUnder(card, screenWidth, reactionsButtonX(card, screenWidth), width);

  const labelOf = (item: PickerItem) =>
    item.nameKey
      ? t('reactions.item', { name: t(`reactions.name.${item.nameKey}`) })
      : t('reactions.itemOther', { emoji: item.emoji });

  const pick = (emoji: string) => {
    cue('reactSend');
    onPick(emoji);
    onClose();
  };

  return (
    <Popover
      visible={visible}
      reduce={reduce}
      placement={placement}
      width={width}
      onClose={onClose}
      closeLabel={t('reactions.close')}
      role="group"
      accessibilityLabel={t('reactions.picker')}
      testID={testID}
    >
      <View style={styles.row}>
        {items.map((item, i) => (
          <EmojiButton
            key={item.emoji}
            ref={i === 0 ? first : undefined}
            item={item}
            index={i}
            visible={visible}
            reduce={reduce}
            label={labelOf(item)}
            hint={item.disabled ? t('reactions.coolingDown') : undefined}
            onPress={pick}
            testID={`${testID}-${i}`}
          />
        ))}
      </View>
    </Popover>
  );
}

interface EmojiButtonProps {
  ref?: Ref<ComponentRef<typeof Pressable>>;
  item: PickerItem;
  index: number;
  visible: boolean;
  reduce: boolean;
  label: string;
  hint?: string;
  onPress: (emoji: string) => void;
  testID: string;
}

/** One emoji: pops in 40 ms after the one before it (reduced motion: there at once, with the fade). */
function EmojiButton({ ref, item, index, visible, reduce, label, hint, onPress, testID }: EmojiButtonProps) {
  const pop = useSharedValue(reduce ? 1 : POP_FROM);

  useEffect(() => {
    if (!visible) return;
    if (reduce) {
      pop.set(1);
      return;
    }
    pop.set(POP_FROM);
    pop.set(withDelay(index * motion.sequence.listStagger, withSpring(1, popSpring)));
  }, [visible, reduce, index, pop]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: pop.get() }] }));

  return (
    <Pressable
      ref={ref}
      onPress={() => onPress(item.emoji)}
      disabled={item.disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: item.disabled }}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.pressed,
        item.disabled && { opacity: tokens.opacity.inactivePlayer },
      ]}
    >
      <Animated.View style={style} testID={`${testID}-face`}>
        <Text style={styles.emoji} allowFontScaling={false}>
          {item.emoji}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: POPOVER.gap },
  button: {
    width: POPOVER.button,
    height: POPOVER.button,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: color.surface2 },
  emoji: { fontSize: EMOJI, lineHeight: POPOVER.button - space[4], textAlign: 'center' },
});
