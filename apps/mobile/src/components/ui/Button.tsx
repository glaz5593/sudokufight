import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type Insets,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  type TextStyle,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { color, radius, size, space, text, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { Icon, type IconName } from '../Icon';
import { curve } from './motion';
import { Spinner } from './Spinner';

/** components.md §1: primary (skewed gold), secondary (outline), ghost (text) and danger (outline, red). */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
/** Heights: hero 96 · lg 60 · md 52 · modal 48 (`size.ctaHero`, `buttonLg`, `buttonMd`, `buttonModal`). Ghost is always 44. */
export type ButtonSize = 'hero' | 'lg' | 'md' | 'modal';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon, before the label (the start edge, so it mirrors with the language). */
  icon?: IconName;
  disabled?: boolean;
  /** Shows a spinner, sets `busy`, and ignores presses. */
  loading?: boolean;
  /** Secondary "chip" use: gold border and label (components.md §1.2). */
  selected?: boolean;
  /**
   * Primary only: once the phone's text is large (fontScale ≥ LARGE_TEXT_SCALE), the label may take a second
   * line instead of being cut, and the button grows to hold it. Below that the label keeps to one line at the
   * button's height, as every button does.
   */
  wrapLabel?: boolean;
  /** Overrides the visible label for screen readers (the visible label is the default). */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  hitSlop?: number | Insets;
  /** Style of the outer box: flex, margins, alignSelf. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
  ref?: Ref<View>;
}

const HEIGHT: Record<ButtonSize, number> = {
  hero: size.ctaHero,
  lg: size.buttonLg,
  md: size.buttonMd,
  modal: size.buttonModal,
};

/**
 * From this system text scale (Android's "Large" font size and up), a `wrapLabel` button may take two lines.
 * It takes the second only when the label doesn't fit on one, and stays as high as before when it does.
 */
export const LARGE_TEXT_SCALE = 1.15;

/** Rubik 700, 44 / 28 / 22 / 18. */
const PRIMARY_LABEL: Record<ButtonSize, TextStyle> = {
  hero: text('ctaHero'),
  lg: text('screenTitle'),
  md: text('h1'),
  modal: text('sheetTitle'),
};

const ICON_SIZE: Record<ButtonSize, number> = {
  hero: size.icon.nav,
  lg: size.icon.header,
  md: size.icon.card,
  modal: size.icon.inline,
};

const SKEW = `${tokens.effects.skewXDeg}deg`;
const UNSKEW = `${-tokens.effects.skewXDeg}deg`;
const CTA = tokens.elevation.cta;

/**
 * The app's button. One gold primary per screen (components.md §0.6). The primary is skewed −8° in both
 * languages (a brand slant, not a direction cue) and sits on a hard gold shadow that shrinks when pressed.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size: sizeName = 'md',
  icon,
  disabled = false,
  loading = false,
  selected,
  wrapLabel = false,
  accessibilityLabel,
  accessibilityHint,
  hitSlop,
  style,
  testID,
  ref,
}: ButtonProps) {
  const { t } = useTranslation('ui');
  const reduce = useReduceMotion();
  const { fontScale } = useWindowDimensions();
  const twoLines = wrapLabel && fontScale >= LARGE_TEXT_SCALE;
  const press = useSharedValue(0);
  const face = useAnimatedStyle(() => ({
    transform: [{ translateY: press.get() * CTA.pressedTranslateY }, { skewX: SKEW }],
  }));

  const spoken = accessibilityLabel ?? label;
  const a11y = {
    accessibilityRole: 'button' as const,
    accessibilityLabel: loading ? t('button.loading', { label: spoken }) : spoken,
    accessibilityHint,
    accessibilityState: {
      disabled,
      busy: loading,
      ...(selected === undefined ? null : { selected }),
    },
    disabled,
    onPress: loading ? undefined : onPress,
    hitSlop,
    testID,
    ref,
  };

  if (variant === 'primary') {
    const height = HEIGHT[sizeName];
    // Two lines of a large label: the height becomes a minimum, and the face (and its shadow) grow with it.
    const box = twoLines ? { minHeight: height } : { height };
    // cta.press (motion.md §4.1): 80 ms down, 140 ms up. Reduced motion: the same 3 dp, without the tween.
    const toPressed = (to: number, duration: number) =>
      press.set(reduce ? to : withTiming(to, { duration, easing: curve('standard') }));
    return (
      <Pressable
        {...a11y}
        onPressIn={() => toPressed(1, motion.duration.tapFeedbackMin)}
        onPressOut={() => toPressed(0, motion.duration.tapFeedbackMax)}
        style={[box, disabled && styles.disabled, style]}
      >
        {disabled ? null : (
          <View
            testID={testID && `${testID}-shadow`}
            style={[
              styles.primaryShadow,
              twoLines ? { top: CTA.offsetY, bottom: -CTA.offsetY } : { height, top: CTA.offsetY },
              { transform: [{ skewX: SKEW }] },
            ]}
          />
        )}
        <Animated.View style={[styles.primaryFace, box, twoLines && styles.primaryFaceTall, face]}>
          <View style={[styles.content, loading && styles.hidden, { transform: [{ skewX: UNSKEW }] }]}>
            {icon ? <Icon name={icon} size={ICON_SIZE[sizeName]} color={color.onAccent} /> : null}
            <Text
              style={[PRIMARY_LABEL[sizeName], styles.primaryLabel, twoLines && styles.labelWrap]}
              numberOfLines={twoLines ? 2 : 1}
              testID={testID && `${testID}-label`}
            >
              {label}
            </Text>
          </View>
          {loading ? (
            <View style={styles.spinnerOverlay}>
              <Spinner color={color.onAccent} stroke={tokens.border.lockRing} size={size.icon.header} />
            </View>
          ) : null}
        </Animated.View>
      </Pressable>
    );
  }

  if (variant === 'ghost') {
    return (
      <Pressable
        {...a11y}
        style={({ pressed }) => [
          styles.ghost,
          icon ? styles.ghostWithIcon : styles.ghostTextOnly,
          pressed && styles.pressedSurface,
          disabled && styles.disabled,
          style,
        ]}
      >
        {({ pressed }) => {
          const tint = pressed ? color.text : color.textMuted;
          return (
            <View style={styles.content}>
              {loading ? <Spinner color={tint} size={space[7]} stroke={size.iconStroke} /> : null}
              {icon && !loading ? <Icon name={icon} size={size.icon.card} color={tint} /> : null}
              <Text style={[text(icon ? 'status' : 'buttonSm'), { color: tint }]} numberOfLines={1}>
                {label}
              </Text>
            </View>
          );
        }}
      </Pressable>
    );
  }

  // Secondary and danger: flat outlines, never skewed, so they never look like the primary.
  const danger = variant === 'danger';
  const tint = danger ? color.danger : selected ? color.accent : color.text;
  return (
    <Pressable
      {...a11y}
      style={({ pressed }) => [
        styles.outline,
        { height: HEIGHT[sizeName] },
        danger ? styles.danger : selected ? styles.selected : null,
        pressed && (danger ? styles.dangerPressed : styles.pressedSurface),
        disabled && styles.disabled,
        style,
      ]}
    >
      <View style={[styles.content, loading && styles.hidden]}>
        {icon ? <Icon name={icon} size={danger ? size.icon.inline : size.icon.card} color={tint} /> : null}
        <Text style={[text(danger ? 'sheetTitle' : 'button'), { color: tint }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      {loading ? (
        <View style={styles.spinnerOverlay}>
          <Spinner color={tint} size={size.icon.card} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  disabled: {
    opacity: tokens.opacity.disabled,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[4],
  },
  hidden: {
    opacity: 0,
  },
  spinnerOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryShadow: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: radius.button,
    backgroundColor: color.accentShadow,
  },
  primaryFace: {
    justifyContent: 'center',
    paddingHorizontal: space[10],
    borderRadius: radius.button,
    backgroundColor: color.accent,
  },
  primaryFaceTall: {
    paddingVertical: space[4],
  },
  primaryLabel: {
    color: color.onAccent,
    textAlign: 'center',
  },
  labelWrap: {
    flexShrink: 1,
  },
  outline: {
    justifyContent: 'center',
    paddingHorizontal: space[8],
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  selected: {
    borderColor: color.accent,
  },
  danger: {
    backgroundColor: color.dangerSubtle,
    borderColor: color.dangerBorder,
  },
  dangerPressed: {
    backgroundColor: color.dangerPressed,
  },
  pressedSurface: {
    backgroundColor: color.surface,
  },
  ghost: {
    height: size.buttonGhost,
    justifyContent: 'center',
    borderRadius: radius.button,
  },
  ghostTextOnly: {
    paddingHorizontal: space[2],
  },
  ghostWithIcon: {
    paddingHorizontal: space[8],
  },
});
