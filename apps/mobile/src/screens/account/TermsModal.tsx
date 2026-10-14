import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { ConfirmModal } from '../../components/ui';
import { legalUrl } from '../../config/legal';
import { space } from '../../theme';
import { LinkButton } from './parts';

/**
 * The terms of use and the privacy policy, accepted on purpose before the fighter is made with Google (spec §3.2
 * step 2, §3.3, §23): the same acceptance as step 2's checkbox, as a dialog, because Google's button sits above
 * that checkbox. At step 2 it comes before Google's chooser, so before the sign-in. From the login screen the
 * Google sign-in exists already when step 1 asks (Firebase made it with the chooser); leaving step 1 without a
 * fighter deletes it (authStore.ts leaveRegistration). "מאשר וממשיך" accepts and goes on; "ביטול" (and every
 * other way out) changes nothing.
 */
export function TermsModal({
  visible,
  onAccept,
  onCancel,
  testID = 'terms-modal',
}: {
  visible: boolean;
  onAccept: () => void;
  onCancel: () => void;
  testID?: string;
}) {
  const { t, i18n } = useTranslation('account');
  return (
    <ConfirmModal
      visible={visible}
      placement="center"
      icon="check"
      title={t('google.termsTitle')}
      body={t('google.termsBody')}
      confirmLabel={t('google.termsAccept')}
      onConfirm={onAccept}
      onCancel={onCancel}
      testID={testID}
    >
      <View style={styles.links}>
        <LinkButton
          role="link"
          label={t('terms.termsLink')}
          hint={t('terms.linkHint')}
          onPress={() => void Linking.openURL(legalUrl('terms', i18n.language))}
          testID={`${testID}-terms-link`}
        />
        <LinkButton
          role="link"
          label={t('terms.privacyLink')}
          hint={t('terms.linkHint')}
          onPress={() => void Linking.openURL(legalUrl('privacy', i18n.language))}
          testID={`${testID}-privacy-link`}
        />
      </View>
    </ConfirmModal>
  );
}

const styles = StyleSheet.create({
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space[6] },
});
