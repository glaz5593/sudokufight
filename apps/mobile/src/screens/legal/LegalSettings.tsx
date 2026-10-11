import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { RowButton } from '../../components/ui';
import { type LegalPage, legalUrl } from '../../config/legal';
import { color, radius, space, tokens } from '../../theme';
import { SectionLabel } from '../home/parts';

/**
 * The settings' "מידע ומשפטי" (spec §23; work plan stage 14): the privacy policy and the terms of use (the
 * game server's pages, in the app's language, in the browser), and the licenses screen (/licenses).
 */
export function LegalSettings() {
  const { t, i18n } = useTranslation('home');
  const open = (page: LegalPage) => {
    // No browser to open it (rare): nothing to do on the phone; the page is also linked from the stores.
    void Linking.openURL(legalUrl(page, i18n.language)).catch(() => undefined);
  };

  return (
    <View style={styles.section} testID="legal-settings">
      <SectionLabel title={t('settings.about')} />
      <View style={styles.card}>
        <RowButton
          icon="shield"
          title={t('settings.privacy')}
          accessibilityHint={t('settings.opensInBrowser')}
          onPress={() => open('privacy')}
          testID="settings-privacy"
        />
        <RowButton
          icon="document"
          title={t('settings.terms')}
          accessibilityHint={t('settings.opensInBrowser')}
          onPress={() => open('terms')}
          testID="settings-terms"
        />
        <RowButton
          icon="copyright"
          title={t('settings.licenses')}
          onPress={() => router.push('/licenses')}
          testID="settings-licenses"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space[5] },
  card: {
    gap: space[4],
    padding: space[4],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
});
