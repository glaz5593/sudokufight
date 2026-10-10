import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { deleteAccount, signOut, useAuth } from '../../auth/authStore';
import { toAuthError } from '../../auth/errors';
import { ROUTES } from '../../auth/redirect';
import { ltr } from '../../components/player';
import { Button, ConfirmModal, RowButton, useToast } from '../../components/ui';
import { track } from '../../services/analytics';
import { cue } from '../../services/feedback';
import { color, radius, space, text, tokens } from '../../theme';
import { SectionLabel } from '../home/parts';
import { PasswordField } from './Field';
import { errorMessage } from './messages';
import { DevModeBadge, FormAlert } from './parts';

type Step = null | 'signOut' | 'confirmDelete' | 'password';

/**
 * The account part of the settings (spec §3.3, §4.1 "הגדרות", §23; work plan stage 8): who is signed in,
 * "עריכת פרופיל", "התנתקות" (with a confirmation) and "מחיקת חשבון": a warning, then the password
 * (re-authentication), then the deletion (auth/authStore.ts deleteAccount says in which order and why). The
 * root layout takes the player to the login screen once signed out.
 */
export function AccountSettings() {
  const { t } = useTranslation('account');
  const email = useAuth((s) => s.user?.email ?? s.me?.email ?? null);
  const [step, setStep] = useState<Step>(null);
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: string; form?: string }>({});
  const [shake, setShake] = useState(0);

  const close = () => {
    if (busy) return;
    setStep(null);
    setPassword('');
    setError({});
  };

  const doSignOut = async () => {
    setBusy(true);
    await signOut();
    setBusy(false);
    setStep(null);
  };

  const doDelete = async () => {
    if (busy) return;
    if (!password) {
      setError({ field: t('validation.passwordRequired') });
      setShake((n) => n + 1);
      cue('nudge');
      return;
    }
    setBusy(true);
    setError({});
    try {
      const { signInDeleted } = await deleteAccount(password);
      // Spec §22: account_delete, once the account is gone from the server.
      track('account_delete');
      setBusy(false);
      setStep(null);
      setPassword('');
      useToast.getState().show({
        variant: signInDeleted ? 'success' : 'warning',
        message: signInDeleted ? t('settings.deleted') : t('settings.deletedPartly'),
      });
    } catch (e) {
      setBusy(false);
      cue('nudge');
      const code = toAuthError(e).code;
      if (code === 'wrongPassword' || code === 'invalidCredentials') {
        setError({ field: errorMessage(t, e) });
        setShake((n) => n + 1);
      } else {
        setError({ form: errorMessage(t, e) });
      }
    }
  };

  return (
    <View style={styles.section} testID="account-settings">
      <SectionLabel title={t('settings.section')} />
      <View style={styles.card}>
        {email ? (
          <Text style={styles.email} testID="account-settings-email">
            {t('settings.signedInAs', { email: ltr(email) })}
          </Text>
        ) : null}
        <DevModeBadge style={styles.badge} />
        <RowButton
          icon="edit"
          title={t('settings.editProfile')}
          onPress={() => router.push(ROUTES.editProfile)}
          testID="settings-edit-profile"
        />
        <RowButton
          icon="logout"
          title={t('settings.signOut')}
          onPress={() => setStep('signOut')}
          testID="settings-sign-out"
        />
      </View>
      <Button
        variant="danger"
        icon="trash"
        label={t('settings.deleteAccount')}
        onPress={() => setStep('confirmDelete')}
        testID="settings-delete"
      />

      <ConfirmModal
        visible={step === 'signOut'}
        placement="center"
        icon="logout"
        title={t('settings.signOutTitle')}
        body={t('settings.signOutBody')}
        confirmLabel={t('settings.signOut')}
        confirmLoading={busy}
        onConfirm={() => void doSignOut()}
        onCancel={close}
        testID="sign-out-confirm"
      />
      <ConfirmModal
        visible={step === 'confirmDelete'}
        placement="center"
        tone="danger"
        icon="trash"
        title={t('settings.deleteTitle')}
        body={t('settings.deleteBody')}
        confirmLabel={t('settings.deleteContinue')}
        onConfirm={() => setStep('password')}
        onCancel={close}
        testID="delete-confirm"
      />
      <ConfirmModal
        visible={step === 'password'}
        placement="center"
        tone="danger"
        icon="key"
        title={t('settings.deletePasswordTitle')}
        body={t('settings.deletePasswordBody', { email: ltr(email ?? '') })}
        confirmLabel={t('settings.deleteSubmit')}
        confirmLoading={busy}
        onConfirm={() => void doDelete()}
        onCancel={close}
        testID="delete-password"
      >
        <View style={styles.passwordBox}>
          <FormAlert message={error.form ?? null} testID="delete-alert" />
          <PasswordField
            label={t('fields.password')}
            value={password}
            onChangeText={setPassword}
            shown={shown}
            onToggleShown={() => setShown((s) => !s)}
            autoComplete="current-password"
            textContentType="password"
            error={error.field}
            shake={shake}
            testID="delete-password-input"
          />
        </View>
      </ConfirmModal>
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
  email: { ...text('body'), color: color.textMuted, paddingHorizontal: space[4], paddingTop: space[2] },
  badge: { alignSelf: 'flex-start', marginHorizontal: space[4] },
  passwordBox: { gap: space[6], alignSelf: 'stretch' },
});
