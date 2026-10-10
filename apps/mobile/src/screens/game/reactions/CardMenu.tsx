import { type ComponentRef, type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  I18nManager,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { Icon } from '../../../components/Icon';
import { color, radius, size, space, text, tokens } from '../../../theme';
import { useReduceMotion } from '../../../theme/motion';
import type { Rect } from '../geometry';
import { avatarX, defaultCardRect, placeUnder } from './model';
import { Popover } from './Popover';

/**
 * An opponent card's menu (spec §8, D19: "אפשר להשתיק יריב דרך התפריט של הכרטיס שלו"). No board draws it
 * (components.md §17.9); as proposed there, a long press on the opponent's card opens a one-item menu under
 * it: "השתק תגובות", or "בטל השתקה" once muted. A muted player's reactions are neither shown nor played.
 *
 * Screen readers can't long-press a card whose parts are read one by one, so the trigger also holds a
 * button only they reach, right after the card: "תפריט הכרטיס של NinaVolt".
 */

/** How long a press on the card opens its menu (React Native's own long press). */
export const LONG_PRESS_MS = 500;

export interface CardMenuTriggerProps {
  /** The opponent's name, for the screen reader's button. */
  name: string;
  muted: boolean;
  onOpen: () => void;
  /** No menu now (the card is mine, nobody to mute): only the card. */
  disabled?: boolean;
  /** The card. Its own buttons (⚡) keep their taps: the long press is only on the rest of it. */
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function CardMenuTrigger({
  name,
  muted,
  onOpen,
  disabled = false,
  children,
  style,
  testID = 'card-menu-trigger',
}: CardMenuTriggerProps) {
  const { t } = useTranslation('game');
  if (disabled) return <View style={style}>{children}</View>;
  return (
    <View style={style}>
      <Pressable
        onLongPress={onOpen}
        delayLongPress={LONG_PRESS_MS}
        accessible={false}
        importantForAccessibility="no"
        testID={testID}
      >
        {children}
      </Pressable>
      <View style={styles.srOnly}>
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={t('reactions.menu.open', { name })}
          accessibilityHint={t(muted ? 'reactions.menu.openHintMuted' : 'reactions.menu.openHint', { name })}
          style={styles.srButton}
          testID={`${testID}-a11y`}
        />
      </View>
    </View>
  );
}

export interface CardMenuProps {
  visible: boolean;
  /** The opponent card's rect, in the coordinates of the layer the menu is drawn in (the screen's root). */
  anchor: Rect | null;
  name: string;
  muted: boolean;
  /** "השתק תגובות" / "בטל השתקה": the menu says the change to screen readers and closes itself. */
  onToggleMute: () => void;
  onClose: () => void;
  testID?: string;
}

export function CardMenu({
  visible,
  anchor,
  name,
  muted,
  onToggleMute,
  onClose,
  testID = 'card-menu',
}: CardMenuProps) {
  const { t } = useTranslation('game');
  const reduce = useReduceMotion();
  const { width: screenWidth } = useWindowDimensions();
  const item = useRef<ComponentRef<typeof Pressable>>(null);

  useEffect(() => {
    if (visible && item.current) AccessibilityInfo.sendAccessibilityEvent(item.current, 'focus');
  }, [visible]);

  const card = anchor ?? defaultCardRect(screenWidth, !I18nManager.isRTL);
  const placement = placeUnder(card, screenWidth, avatarX(card, screenWidth));

  const toggle = () => {
    onToggleMute();
    AccessibilityInfo.announceForAccessibility(
      t(muted ? 'reactions.menu.unmuted' : 'reactions.menu.muted', { name }),
    );
    onClose();
  };

  return (
    <Popover
      visible={visible}
      reduce={reduce}
      placement={placement}
      onClose={onClose}
      closeLabel={t('reactions.menu.close')}
      role="menu"
      accessibilityLabel={t('reactions.menu.label', { name })}
      testID={testID}
    >
      <View style={[styles.menu, { minWidth: card.width - 2 * (space[2] + tokens.border.hairline) }]}>
        <Text
          style={styles.title}
          numberOfLines={1}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {name}
        </Text>
        <Pressable
          ref={item}
          onPress={toggle}
          role="menuitem"
          accessibilityLabel={t(muted ? 'reactions.menu.unmuteLabel' : 'reactions.menu.muteLabel', { name })}
          testID={`${testID}-mute`}
          style={({ pressed }) => [styles.item, pressed && styles.pressed]}
        >
          {muted ? <Icon name="reactions" size={size.icon.card} color={color.text} /> : <MutedIcon />}
          <Text style={styles.itemText} numberOfLines={1}>
            {t(muted ? 'reactions.menu.unmute' : 'reactions.menu.mute')}
          </Text>
        </Pressable>
      </View>
    </Popover>
  );
}

/** The reactions icon struck through (Icon's stroke style: 24 × 24, stroke 2, round caps). */
function MutedIcon() {
  const px = size.icon.card;
  return (
    <Svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color.text}
      strokeWidth={size.iconStroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="icon-reactionsMuted"
    >
      <Circle cx="12" cy="12" r="9" />
      <Path d="M8.5 14.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2" />
      <Path d="M9 9.5h.01M15 9.5h.01" />
      <Path d="M4 4l16 16" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  // Reachable by screen readers, invisible and untouchable on screen (as the game's live region).
  srOnly: {
    position: 'absolute',
    bottom: 0,
    start: 0,
    width: tokens.border.hairline,
    height: tokens.border.hairline,
    overflow: 'hidden',
  },
  srButton: { width: tokens.border.hairline, height: tokens.border.hairline },
  menu: { gap: space[1] },
  title: {
    ...text('label'),
    color: color.textMuted,
    paddingHorizontal: space[4],
    paddingTop: space[2],
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[5],
    minHeight: size.touch,
    paddingHorizontal: space[4],
    borderRadius: radius.button,
  },
  pressed: { backgroundColor: color.surface2 },
  itemText: { ...text('status'), color: color.text, flexShrink: 1 },
});
