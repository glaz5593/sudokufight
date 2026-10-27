import { router } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { refreshMe } from '../../auth/authStore';
import { Icon } from '../../components/Icon';
import { ltr } from '../../components/player';
import { Button, RowButton } from '../../components/ui';
import { Text } from '../../components/ui/Text';
import { accountConfig } from '../../config/account';
import { legalUrl } from '../../config/legal';
import { color, radius, size, space, text, tokens } from '../../theme';
import { AccountSettings } from '../account/AccountSettings';
import { goBack } from '../home/navigation';
import { GUTTER, ScreenHeader, SectionLabel } from '../home/parts';

/** The terms of use at their contact section (the server's legal pages, spec §23). */
export const contactUrl = (language: string): string => `${legalUrl('terms', language)}#contact`;

/**
 * "החשבון מושעה" (spec §3.5): an admin suspended the account. What it means (no ranked games, no profile changes),
 * what still works (practice, blocking, deleting the account), how to reach us (the terms' contact section, and
 * the address when the build has one), and the account's own actions: sign out and delete the account (the
 * settings' account section, the same dialogs). Opened from Home's banner and from a ranked start that was
 * refused; the profile is read again as it opens, so a lifted suspension shows at once elsewhere.
 */
export function SuspendedScreen({
  supportEmail = accountConfig.supportEmail,
}: {
  supportEmail?: string | null;
}) {
  const { t, i18n } = useTranslation('moderation');
  const { top, bottom } = useSafeAreaInsets();

  useEffect(() => {
    void refreshMe();
  }, []);

  const openContact = () => {
    void Linking.openURL(contactUrl(i18n.language)).catch(() => undefined);
  };

  return (
    <View style={[styles.screen, { paddingTop: top }]} testID="account-suspended">
      <ScreenHeader title={t('suspended.title')} onBack={goBack} style={styles.header} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom + space[12] }]}>
        <View style={styles.hero}>
          <View style={styles.iconCircle}>
            <Icon name="lock" size={size.icon.header} color={color.danger} />
          </View>
          <Text style={styles.body}>{t('suspended.body')}</Text>
          <Text style={styles.can}>{t('suspended.can')}</Text>
          <Button
            variant="secondary"
            icon="target"
            label={t('suspended.practice')}
            onPress={() => router.push({ pathname: '/game-type', params: { mode: 'solo' } })}
            testID="suspended-practice"
          />
        </View>

        <View style={styles.section}>
          <SectionLabel title={t('suspended.contactTitle')} />
          <View style={styles.card}>
            <Text style={styles.contact}>{t('suspended.contact')}</Text>
            {supportEmail ? (
              <Text style={styles.contact} selectable testID="suspended-email">
                {t('suspended.contactEmail', { email: ltr(supportEmail) })}
              </Text>
            ) : null}
            <RowButton
              icon="mail"
              title={t('suspended.openContact')}
              accessibilityHint={t('suspended.opensInBrowser')}
              onPress={openContact}
              testID="suspended-contact"
            />
          </View>
        </View>

        <AccountSettings />
      </ScrollView>
    </View>
  );
}

const ICON_CIRCLE = size.ctaHero - space[8];

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { paddingHorizontal: GUTTER.screen },
  content: { paddingHorizontal: GUTTER.screen, paddingTop: space[6], gap: space[11] },
  hero: { alignItems: 'center', gap: space[6] },
  iconCircle: {
    width: ICON_CIRCLE,
    height: ICON_CIRCLE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.iconBg.danger,
  },
  body: { ...text('bodyLong'), color: color.text, textAlign: 'center' },
  can: { ...text('body'), color: color.textMuted, textAlign: 'center' },
  section: { gap: space[5] },
  card: {
    gap: space[4],
    padding: space[4],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  contact: { ...text('body'), color: color.textMuted, paddingHorizontal: space[4], paddingTop: space[2] },
});
