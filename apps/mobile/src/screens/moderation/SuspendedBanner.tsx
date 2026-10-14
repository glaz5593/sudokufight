import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, type StyleProp, StyleSheet, Text, type ViewStyle } from 'react-native';

import { isSuspended } from '../../api/me';
import { useAuth } from '../../auth/authStore';
import { Icon } from '../../components/Icon';
import { color, radius, size, space, text, tokens } from '../../theme';

/** The suspension's screen (app/account-suspended.tsx). */
export const SUSPENDED_PATH = '/account-suspended';

/**
 * Home, under the card, while the account is suspended (spec §3.5): "החשבון מושעה: אין משחקים מדורגים" and
 * "פרטים", which opens the suspension's screen. Nothing otherwise. Its own small file: Home loads at start.
 */
export function SuspendedBanner({
  style,
  testID = 'suspended-banner',
}: {
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { t } = useTranslation('moderation');
  const suspended = useAuth((s) => isSuspended(s.me));
  if (!suspended) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('suspended.bannerLabel')}
      onPress={() => router.push(SUSPENDED_PATH)}
      style={({ pressed }) => [styles.banner, pressed && styles.pressed, style]}
      testID={testID}
    >
      <Icon name="lock" size={size.icon.card} color={color.danger} />
      <Text style={styles.text} numberOfLines={2}>
        {t('suspended.banner')}
      </Text>
      <Text style={styles.action}>{t('suspended.bannerAction')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    minHeight: size.touch,
    paddingHorizontal: space[6],
    paddingVertical: space[4],
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.dangerBorder,
    backgroundColor: color.surface,
  },
  pressed: { backgroundColor: color.surface2 },
  text: { ...text('body'), color: color.text, flex: 1 },
  action: { ...text('buttonSm'), color: color.accent },
});
