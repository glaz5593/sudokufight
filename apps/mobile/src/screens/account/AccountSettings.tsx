import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { isAccountApiError } from '../../api/accountApi';
import { isSuspended } from '../../api/me';
import {
  deleteAccount,
  deleteAccountWithGoogle,
  type DeleteOutcome,
  signOut,
  useAuth,
} from '../../auth/authStore';
import { toAuthError } from '../../auth/errors';
import type { SignInMethod } from '../../auth/types';
import { ROUTES } from '../../auth/redirect';
import { ltr } from '../../components/player';
import { Button, ConfirmModal, RowButton, useToast } from '../../components/ui';
import { track } from '../../services/analytics';
import { cue } from '../../services/feedback';
import { color, radius, size, space, text, tokens } from '../../theme';
import { SectionLabel } from '../home/parts';
import { PasswordField } from './Field';
import { GoogleLogo } from './GoogleButton';
import { errorMessage } from './messages';
import { DevModeBadge, FormAlert, LinkButton } from './parts';

type Step = null | 'signOut' | 'confirmDelete' | 'password' | 'google';

/** Which "כניסה עם…" line the account gets. */
const methodKey = (methods: readonly SignInMethod[]): 'both' | SignInMethod =>
  methods.includes('google') && methods.includes('password') ? 'both' : methods[0]!;

/**
 * The account part of the settings (spec §3.3, §4.1 "הגדרות", §23; work plan stage 8): who is signed in and
 * how (email and password, Google, or both), "עריכת פרופיל" (not while suspended, spec §3.5), "שחקנים חסומים"
 * (spec §3.5), "התנתקות" (with a confirmation) and "מחיקת חשבון": a warning, then the re-authentication, then
 * the deletion (auth/authStore.ts deleteAccount says in which order and why). The root layout takes the player
 * to the login screen once signed out.
 *
 * The re-authentication is Google's chooser for an account that signs in with Google (when the build has
 * Google), and the password otherwise. A Google account has no password to type, change or reset here. An
 * account with both may confirm with its password instead (a link in Google's dialog): Google sign-in can fail on
 * a phone without Play services, or in a build whose key Firebase doesn't list, and deletion must still work.
 */
export function AccountSettings() {
  const { t } = useTranslation('account');
  const email = useAuth((s) => s.user?.email ?? s.me?.email ?? null);
  const methods = useAuth((s) => s.user?.methods);
  const googleBuild = useAuth((s) => s.google);
  const withGoogle = googleBuild && Boolean(methods?.includes('google'));
  const hasPassword = Boolean(methods?.includes('password'));
  // Spec §3.5: a suspended account can't change its profile (the server answers 403 `suspended`).
  const suspended = useAuth((s) => isSuspended(s.me));
  const { t: tm } = useTranslation('moderation');
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

  /** The account is gone from the server (and, unless `signInDeleted` is false, from Firebase). */
  const deleted = ({ signInDeleted }: DeleteOutcome) => {
    // Spec §22: account_delete, once the account is gone from the server.
    track('account_delete');
    setBusy(false);
    setStep(null);
    setPassword('');
    useToast.getState().show({
      variant: signInDeleted ? 'success' : 'warning',
      message: signInDeleted ? t('settings.deleted') : t('settings.deletedPartly'),
    });
  };

  const doDeleteWithGoogle = async () => {
    if (busy) return;
    setBusy(true);
    setError({});
    try {
      deleted(await deleteAccountWithGoogle());
    } catch (e) {
      setBusy(false);
      // Google's chooser closed: nothing was deleted, and the dialog stays.
      if (!isAccountApiError(e) && toAuthError(e).code === 'cancelled') return;
      cue('nudge');
      const again = isAccountApiError(e) && e.code === 'reauthRequired';
      setError({ form: again ? t('settings.deleteGoogleAgain') : errorMessage(t, e) });
    }
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
      deleted(await deleteAccount(password));
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
        {methods && methods.length > 0 ? (
          <View style={styles.method} accessible testID="account-settings-method">
            {methods.includes('google') ? <GoogleLogo size={size.icon.inline} /> : null}
            <Text style={styles.methodText}>{t(`settings.method.${methodKey(methods)}`)}</Text>
          </View>
        ) : null}
        <DevModeBadge style={styles.badge} />
        <RowButton
          icon="edit"
          title={t('settings.editProfile')}
          subtitle={suspended ? tm('suspended.editProfile') : undefined}
          disabled={suspended}
          onPress={() => router.push(ROUTES.editProfile)}
          testID="settings-edit-profile"
        />
        <RowButton
          icon="block"
          title={tm('blocked.settingsRow')}
          onPress={() => router.push('/blocked-players')}
          testID="settings-blocked-players"
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
        onConfirm={() => setStep(withGoogle ? 'google' : 'password')}
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
      <ConfirmModal
        visible={step === 'google'}
        placement="center"
        tone="danger"
        icon="key"
        title={t('settings.deleteGoogleTitle')}
        body={t('settings.deleteGoogleBody', { email: ltr(email ?? '') })}
        confirmLabel={t('settings.deleteGoogleSubmit')}
        confirmLoading={busy}
        onConfirm={() => void doDeleteWithGoogle()}
        onCancel={close}
        testID="delete-google"
      >
        <View style={styles.passwordBox}>
          <FormAlert message={error.form ?? null} testID="delete-google-alert" />
          {hasPassword ? (
            <LinkButton
              label={t('settings.deleteWithPassword')}
              tone="muted"
              onPress={() => {
                if (busy) return;
                setError({});
                setStep('password');
              }}
              testID="delete-google-use-password"
            />
          ) : null}
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
  method: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4] },
  methodText: { ...text('caption'), color: color.textMuted, flexShrink: 1 },
  badge: { alignSelf: 'flex-start', marginHorizontal: space[4] },
  passwordBox: { gap: space[6], alignSelf: 'stretch' },
});
