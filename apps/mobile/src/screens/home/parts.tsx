import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '../../components/Icon';
import { IconButton } from '../../components/ui';
import { color, radius, size, space, text, tokens } from '../../theme';

/**
 * Small pieces shared by the home-level screens, in direction C: flat surfaces, 1 dp borders, no skew
 * (components.md §0.1). They follow the app direction: every row is a plain `row`, mirrored in Hebrew.
 */

/** Side gutters: 24 on Home (Dir-C-Home), 16 on the other screens (Modes, GameType). */
export const GUTTER = {
  home: tokens.layout.gutterHome,
  screen: tokens.layout.gutterGame,
} as const;

/** The back button of a header: the 44×44 icon button with the chevron turned to point back. */
export function BackButton({
  onPress,
  label,
  testID = 'back',
}: {
  onPress: () => void;
  /** What it says to a screen reader; "חזרה" by default ("חזרה להתחברות" on the registration). */
  label?: string;
  testID?: string;
}) {
  const { t } = useTranslation('home');
  return (
    <IconButton
      icon="chevronForward"
      iconSize="header"
      accessibilityLabel={label ?? t('header.back')}
      onPress={onPress}
      // The box is symmetric, so turning it over only turns the chevron: "forward" becomes "back" in both
      // directions (left in English, right in Hebrew).
      style={styles.flip}
      testID={testID}
    />
  );
}

export interface ScreenHeaderProps {
  title: string;
  /** A line under the title, e.g. the mode on the game-type screen. */
  subtitle?: string;
  onBack?: () => void;
  /** Something at the end of the row (an avatar, a button). */
  end?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Back button, title and an optional end item, 56 high (the Modes and GameType boards). */
export function ScreenHeader({ title, subtitle, onBack, end, style }: ScreenHeaderProps) {
  return (
    <View style={[styles.header, style]}>
      {onBack ? <BackButton onPress={onBack} /> : null}
      <View style={styles.titles}>
        <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {end}
    </View>
  );
}

/** A section's title with a rule that runs to the end, and an optional note after it ("מדורג ——— …"). */
export function SectionLabel({ title, note, icon }: { title: string; note?: string; icon?: IconName }) {
  return (
    <View style={styles.section}>
      {icon ? <Icon name={icon} size={size.icon.inline} color={color.textMuted} /> : null}
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      <View style={styles.rule} />
      {note ? (
        <Text style={styles.sectionNote} numberOfLines={1}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

export interface ChipProps {
  label: string;
  /** An icon after the label, and a value after it in the text colour ("שלב 14 · ★ 29", Modes-Levels). */
  icon?: IconName;
  iconColor?: string;
  /** The icon drawn filled (a star earned). */
  iconFilled?: boolean;
  /** Latin and LTR (a number). */
  value?: string;
  testID?: string;
}

/** A small flat tag ("ללא דירוג", "בקרוב", "הופסק"), or one with an icon and a value ("שלב 14 · ★ 29"). */
export function Chip({
  label,
  icon,
  iconColor = color.textMuted,
  iconFilled = false,
  value,
  testID,
}: ChipProps) {
  const words = (
    <Text style={styles.chipText} numberOfLines={1}>
      {label}
    </Text>
  );
  // A plain tag is its words alone (as before the icon chips: the bot selection reads it so).
  if (icon === undefined && value === undefined) {
    return (
      <View style={styles.chip} testID={testID}>
        {words}
      </View>
    );
  }
  return (
    <View style={[styles.chip, styles.chipRow]} testID={testID}>
      {words}
      {icon ? <Icon name={icon} size={CHIP.icon} color={iconColor} filled={iconFilled} /> : null}
      {value !== undefined ? (
        <Text style={[styles.chipText, styles.chipValue]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
    </View>
  );
}

/** Sizes from the boards that have no token: the Modes header row (56). */
const HEADER_HEIGHT = 56;

/** The Modes board's chips: 22 high, 8 in from each side, an 11 icon 4 from the words (modesChipWidth.test). */
export const CHIP = {
  height: 22,
  paddingX: space[4],
  gap: space[2],
  icon: 11,
  border: tokens.border.hairline,
  font: tokens.type.micro,
} as const;

const styles = StyleSheet.create({
  flip: { transform: [{ scaleX: -1 }] },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[6],
    minHeight: HEADER_HEIGHT,
  },
  titles: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: space[1] },
  title: { ...text('screenTitle'), color: color.text },
  subtitle: { ...text('caption'), color: color.textMuted },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    minHeight: size.icon.chevron,
  },
  sectionTitle: { ...text('label'), color: color.textMuted },
  rule: { flex: 1, height: tokens.border.hairline, backgroundColor: color.border },
  sectionNote: { ...text('caption'), color: color.textMuted, flexShrink: 1 },
  chip: {
    height: CHIP.height,
    paddingHorizontal: CHIP.paddingX,
    justifyContent: 'center',
    borderRadius: radius.xs,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface2,
  },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: CHIP.gap },
  chipText: { ...text('micro'), color: color.textMuted },
  chipValue: { color: color.text, writingDirection: 'ltr' },
});
