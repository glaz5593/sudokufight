import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, type TextInput, View } from 'react-native';

import { isAccountApiError } from '../../api/accountApi';
import { signIn, signInWithGoogle, useAuth } from '../../auth/authStore';
import { toAuthError } from '../../auth/errors';
import { emailOk } from '../../auth/password';
import { ROUTES } from '../../auth/redirect';
import { Button } from '../../components/ui';
import { VersionInfo } from '../../components/VersionInfo';
import { Text } from '../../components/ui/Text';
import { type AppVersionInfo, appVersionInfo } from '../../config/appVersion';
import { cue } from '../../services/feedback';
import { color, space, text } from '../../theme';
import { Field, PasswordField } from './Field';
import { GoogleButton, OrDivider } from './GoogleButton';
import { LoginArena } from './LoginArena';
import { errorMessage, withGoogleHint } from './messages';
import { AccentTitle, AccountScreen, Brand, DevModeBadge, FormAlert, LinkButton } from './parts';

/**
 * "התחברות" (spec §3.3; Login): email and password, the eye that shows the password, "שכחתי סיסמה", and the
 * way to registration. Errors (spec §4.1 "מצבי שגיאה"): an empty or malformed email and an empty password
 * at once on submit; then the sign-in's own (wrong password → under the password, unknown address → under
 * the email, too many attempts and no connection → over the form). Success needs no navigation here: the
 * root layout follows the auth status (home, or step 1 of the registration when the account has no profile).
 *
 * "המשך עם Google" (Moshe, 14.10.2026), above the form when the build has it (a Firebase build; not the
 * development sign-in): Google's chooser, then the same: home, or step 1 for a Google account new to the game
 * (signed in; step 1 creates the fighter). Closing the chooser says nothing. Its errors go over the form; a
 * wrong password also suggests Google, since an address that signed up with Google has no password.
 *
 * The footer ends with the app's version and build (components/VersionInfo), as the settings do.
 */
export function LoginScreen({ version = appVersionInfo() }: { version?: AppVersionInfo | null } = {}) {
  const { t } = useTranslation('account');
  const google = useAuth((s) => s.google);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [shake, setShake] = useState({ email: 0, password: 0 });
  const passwordRef = useRef<TextInput>(null);

  const fail = (next: typeof errors) => {
    setErrors(next);
    setShake((s) => ({
      email: next.email ? s.email + 1 : s.email,
      password: next.password ? s.password + 1 : s.password,
    }));
    cue('nudge');
  };

  const submit = async () => {
    if (busy || googleBusy) return;
    const local: typeof errors = {};
    if (!email.trim()) local.email = t('validation.emailRequired');
    else if (!emailOk(email)) local.email = t('validation.emailInvalid');
    if (!password) local.password = t('validation.passwordRequired');
    if (local.email || local.password) return fail(local);

    setErrors({});
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (error) {
      setBusy(false);
      if (isAccountApiError(error)) return fail({ form: errorMessage(t, error) });
      const { code } = toAuthError(error);
      const message = withGoogleHint(t, error, google);
      if (code === 'wrongPassword') return fail({ password: message });
      if (code === 'userNotFound' || code === 'invalidEmail') return fail({ email: message });
      return fail({ form: message });
    }
  };

  const continueWithGoogle = async () => {
    if (busy || googleBusy) return;
    setErrors({});
    setGoogleBusy(true);
    try {
      // Signed in: the root layout takes it from here (home, or step 1 to create the fighter).
      if ((await signInWithGoogle()) === 'cancelled') setGoogleBusy(false);
    } catch (error) {
      setGoogleBusy(false);
      fail({ form: errorMessage(t, error) });
    }
  };

  return (
    <AccountScreen
      testID="login"
      footer={
        <View style={styles.footer}>
          <Button
            label={t('login.submit')}
            size="lg"
            loading={busy}
            onPress={() => void submit()}
            testID="login-submit"
          />
          <View style={styles.registerRow}>
            <Text style={styles.muted}>{t('login.noAccount')}</Text>
            <LinkButton
              label={t('login.register')}
              onPress={() => router.push(ROUTES.registerFighter)}
              testID="login-register"
            />
          </View>
          {/* Which app this is (Moshe, 14.10.2026), small, under everything. */}
          <VersionInfo info={version} />
        </View>
      }
    >
      <DevModeBadge />
      {/* The board: the wordmark alone, over the rivals around the empty seat. */}
      <Brand compact />
      <LoginArena />
      <View style={styles.titles}>
        <AccentTitle i18nKey="login.title" label={t('login.titleLabel')} />
        <Text style={styles.subtitle}>{t('login.subtitle')}</Text>
      </View>

      <FormAlert message={errors.form ?? null} testID="login-alert" />

      {google ? (
        <View style={styles.google}>
          <GoogleButton
            onPress={() => void continueWithGoogle()}
            loading={googleBusy}
            disabled={busy}
            testID="login-google"
          />
          <OrDivider label={t('google.orEmail')} testID="login-or" />
        </View>
      ) : null}

      <View style={styles.form}>
        <Field
          label={t('fields.email')}
          icon="mail"
          ltr
          value={email}
          onChangeText={setEmail}
          placeholder={t('fields.emailPlaceholder')}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          submitBehavior="submit"
          error={errors.email}
          shake={shake.email}
          testID="login-email"
        />
        <PasswordField
          label={t('fields.password')}
          value={password}
          onChangeText={setPassword}
          shown={shown}
          onToggleShown={() => setShown((s) => !s)}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          inputRef={passwordRef}
          error={errors.password}
          shake={shake.password}
          testID="login-password"
        />
        <View style={styles.forgotRow}>
          <LinkButton
            label={t('login.forgot')}
            tone="muted"
            onPress={() =>
              router.push({
                pathname: ROUTES.forgotPassword,
                params: email.trim() ? { email: email.trim() } : {},
              })
            }
            testID="login-forgot"
          />
        </View>
      </View>
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  titles: { gap: space[4] },
  subtitle: { ...text('body'), color: color.textMuted, textAlign: 'center' },
  form: { gap: space[8] },
  google: { gap: space[8] },
  forgotRow: { alignItems: 'flex-end', marginTop: -space[6] },
  footer: { gap: space[4] },
  registerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2] },
  muted: { ...text('body'), color: color.textMuted },
});
