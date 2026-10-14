import { type CreateUserRequest, validateDisplayName } from '@sudoku-fight/protocol';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, Text, type TextInput, View } from 'react-native';

import { isAccountApiError } from '../../api/accountApi';
import { registerWithGoogle, signUpAndRegister, useAuth } from '../../auth/authStore';
import { toAuthError } from '../../auth/errors';
import { emailOk, passwordOk, passwordRules, passwordStrength } from '../../auth/password';
import { ROUTES } from '../../auth/redirect';
import { useRegistrationDraft } from '../../auth/registrationDraft';
import { Icon } from '../../components/Icon';
import { ltr } from '../../components/player';
import { Button, useToast } from '../../components/ui';
import { legalUrl } from '../../config/legal';
import { track } from '../../services/analytics';
import { cue } from '../../services/feedback';
import { color, size, space, text } from '../../theme';
import { Field, FieldStatus, PasswordField } from './Field';
import { FighterCard } from './FighterCard';
import { GoogleButton, OrDivider } from './GoogleButton';
import { errorMessage, withGoogleHint } from './messages';
import {
  AccentTitle,
  AccountScreen,
  Checkbox,
  DevModeBadge,
  FormAlert,
  LinkButton,
  PasswordChecklist,
  StepHeader,
  StrengthMeter,
} from './parts';
import { TermsModal } from './TermsModal';

type Errors = { email?: string; password?: string; confirm?: string; terms?: string; form?: string };

/**
 * Registration, step 2: "החשבון" (spec §3.2; Register-Account). The fighter from step 1 (with "עריכה" back
 * to it), then email, password with its 4-level meter and its one rule (at least 8 characters, nothing else:
 * Moshe, 14.10.2026), the confirmation, and the terms and privacy checkbox with links to both (spec §23).
 *
 * "צור משתמש והיכנס לזירה" makes the sign-in, sends the verification email [D22] and creates the profile
 * (POST /v1/users); the root layout then goes home. If the account was made but the profile was not (the
 * name was taken meanwhile, no connection), the player is sent back to step 1, signed in, with a toast that
 * says why: the account is not lost.
 *
 * "המשך עם Google" (Moshe, 14.10.2026), above the form when the build has it: the terms first (the checkbox,
 * or a dialog when it isn't ticked: TermsModal), then Google's chooser and the profile from step 1. A Google
 * account that already has a fighter just signs in (a toast names that fighter) and goes home; the step-1 draft
 * is dropped. Closing the chooser says nothing. The same toasts as above when the profile can't be created.
 * One attempt at a time: `working` is set at once, so a second tap (the terms dialog stays pressable while it
 * fades out) starts nothing.
 */
export function RegisterAccountScreen() {
  const { t, i18n } = useTranslation('account');
  const google = useAuth((s) => s.google);
  const avatarId = useRegistrationDraft((s) => s.avatarId);
  const displayName = useRegistrationDraft((s) => s.displayName);
  const country = useRegistrationDraft((s) => s.country);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [shown, setShown] = useState(false);
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [shake, setShake] = useState({ email: 0, password: 0, confirm: 0, terms: 0 });
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  /** An account is being made (email or Google): set at once, before the state above re-renders. */
  const working = useRef(false);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  // Spec §22: the registration's funnel, step by step.
  useEffect(() => track('register_step', { step: 'account' }), []);

  const name = displayName.trim();
  const rules = passwordRules(password);
  const strength = passwordStrength(password);
  const confirmState = confirm === '' ? null : confirm === password ? 'match' : 'mismatch';

  const backToFighter = () => (router.canGoBack() ? router.back() : router.replace(ROUTES.registerFighter));

  const fail = (next: Errors) => {
    setErrors(next);
    setShake((s) => ({
      email: next.email ? s.email + 1 : s.email,
      password: next.password ? s.password + 1 : s.password,
      confirm: next.confirm ? s.confirm + 1 : s.confirm,
      terms: next.terms ? s.terms + 1 : s.terms,
    }));
    cue('nudge');
  };

  /** Step 1's fighter; when it isn't complete (a deep link, an older version's draft), back to step 1. */
  const fighter = (): CreateUserRequest | null => {
    if (validateDisplayName(name) === null && country) return { displayName: name, avatarId, country };
    router.replace(ROUTES.registerFighter);
    return null;
  };

  /** The profile was not created: the sign-in exists now, and the router takes the player back to step 1. */
  const profileFailed = (error: unknown) => {
    const message =
      isAccountApiError(error) && error.code === 'taken'
        ? t('account.nameTakenNow', { name: ltr(name) })
        : `${t('account.profileFailed')} ${errorMessage(t, error)}`;
    useToast.getState().show({ variant: 'error', message });
  };

  const submit = async () => {
    if (busy || googleBusy || working.current) return;
    const profile = fighter();
    if (!profile) return;
    const local: Errors = {};
    if (!email.trim()) local.email = t('validation.emailRequired');
    else if (!emailOk(email)) local.email = t('validation.emailInvalid');
    if (!passwordOk(password)) local.password = t('validation.passwordRules');
    if (confirm !== password) local.confirm = t('validation.confirmMismatch');
    if (!agree) local.terms = t('terms.required');
    if (Object.keys(local).length > 0) return fail(local);

    setErrors({});
    setBusy(true);
    working.current = true;
    cue('primaryPress');
    try {
      await signUpAndRegister(email.trim(), password, profile);
      track('register_complete');
    } catch (error) {
      working.current = false;
      setBusy(false);
      if (isAccountApiError(error)) return profileFailed(error);
      const { code } = toAuthError(error);
      if (code === 'emailInUse' || code === 'invalidEmail')
        return fail({ email: withGoogleHint(t, error, google) });
      if (code === 'weakPassword') return fail({ password: errorMessage(t, error) });
      return fail({ form: errorMessage(t, error) });
    }
  };

  const continueWithGoogle = () => {
    if (busy || googleBusy || working.current) return;
    const profile = fighter();
    if (!profile) return;
    if (agree) void runGoogle(profile);
    else setTermsOpen(true);
  };

  const acceptTermsAndGo = () => {
    if (working.current) return;
    setTermsOpen(false);
    setAgree(true);
    setErrors((e) => ({ ...e, terms: undefined }));
    const profile = fighter();
    if (profile) void runGoogle(profile);
  };

  const runGoogle = async (profile: CreateUserRequest) => {
    if (working.current) return;
    working.current = true;
    setErrors({});
    setGoogleBusy(true);
    try {
      const outcome = await registerWithGoogle(profile);
      if (outcome === 'cancelled') {
        working.current = false;
        return setGoogleBusy(false);
      }
      if (outcome === 'created') track('register_complete');
      // A sign-in after all: this Google account already has its fighter (the root layout goes home). The toast
      // names it, so a fighter someone else made on this address (spec §3.3) doesn't pass as the player's own.
      else {
        const existing = useAuth.getState().me?.displayName ?? '';
        useToast.getState().show({ variant: 'info', message: t('google.existing', { name: ltr(existing) }) });
      }
    } catch (error) {
      working.current = false;
      setGoogleBusy(false);
      // Signed in, but the fighter wasn't saved: as with email, back to step 1 to finish.
      if (isAccountApiError(error) && useAuth.getState().status === 'needsProfile')
        return profileFailed(error);
      fail({ form: errorMessage(t, error) });
    }
  };

  return (
    <AccountScreen
      testID="register-account"
      footer={
        <Button
          label={t('account.submit')}
          size="md"
          wrapLabel
          loading={busy}
          onPress={() => void submit()}
          testID="account-submit"
        />
      }
    >
      <StepHeader step={2} onBack={backToFighter} backLabel={t('register.backToFighter')} />
      <DevModeBadge />

      <FighterCard
        avatarId={avatarId}
        name={name}
        country={country}
        note={
          <>
            {country ? <Text style={styles.muted}>{t('player:sep')}</Text> : null}
            <Icon name="check" size={size.icon.inline} color={color.success} />
            <Text style={styles.ready}>{t('account.fighterReady')}</Text>
          </>
        }
        end={
          <LinkButton
            label={t('account.edit')}
            accessibilityLabel={t('account.editLabel')}
            icon="edit"
            tone="muted"
            onPress={backToFighter}
            testID="account-edit-fighter"
          />
        }
        testID="account-fighter"
      />

      <View style={styles.titles}>
        <AccentTitle i18nKey="account.title" label={t('account.titleLabel')} />
        <Text style={styles.subtitle}>{t('account.subtitle')}</Text>
      </View>

      <FormAlert message={errors.form ?? null} testID="account-alert" />

      {google ? (
        <View style={styles.google}>
          <GoogleButton
            onPress={continueWithGoogle}
            loading={googleBusy}
            disabled={busy}
            testID="account-google"
          />
          <OrDivider label={t('google.orEmailPassword')} testID="account-or" />
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
          testID="account-email"
        />
        <View style={styles.passwordBlock}>
          <PasswordField
            label={t('fields.newPassword')}
            value={password}
            onChangeText={setPassword}
            shown={shown}
            onToggleShown={() => setShown((s) => !s)}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            onSubmitEditing={() => confirmRef.current?.focus()}
            submitBehavior="submit"
            inputRef={passwordRef}
            error={errors.password}
            shake={shake.password}
            testID="account-password"
          />
          <StrengthMeter strength={strength} testID="account-strength" />
          <PasswordChecklist rules={rules} testID="account-rules" />
        </View>
        <PasswordField
          label={t('fields.confirmPassword')}
          value={confirm}
          onChangeText={setConfirm}
          shown={shown}
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="done"
          inputRef={confirmRef}
          error={errors.confirm}
          shake={shake.confirm}
          accessibilityStatus={confirmState ? t(`password.${confirmState}`) : undefined}
          status={
            confirmState ? (
              <FieldStatus
                label={t(`password.${confirmState}`)}
                tone={confirmState === 'match' ? 'ok' : 'bad'}
                icon={confirmState === 'match' ? 'check' : 'close'}
                testID={`account-confirm-${confirmState}`}
              />
            ) : null
          }
          testID="account-confirm"
        />

        <View style={styles.terms}>
          <Checkbox
            checked={agree}
            onChange={(v) => {
              setAgree(v);
              if (v) setErrors((e) => ({ ...e, terms: undefined }));
            }}
            label={t('terms.accept')}
            error={errors.terms}
            shake={shake.terms}
            testID="account-terms"
          />
          <View style={styles.links}>
            <LinkButton
              role="link"
              label={t('terms.termsLink')}
              hint={t('terms.linkHint')}
              onPress={() => void Linking.openURL(legalUrl('terms', i18n.language))}
              testID="account-terms-link"
            />
            <LinkButton
              role="link"
              label={t('terms.privacyLink')}
              hint={t('terms.linkHint')}
              onPress={() => void Linking.openURL(legalUrl('privacy', i18n.language))}
              testID="account-privacy-link"
            />
          </View>
        </View>
      </View>

      <TermsModal visible={termsOpen} onAccept={acceptTermsAndGo} onCancel={() => setTermsOpen(false)} />
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  muted: { ...text('caption'), color: color.textMuted },
  ready: { ...text('caption'), color: color.success },
  titles: { gap: space[4] },
  subtitle: { ...text('body'), color: color.textMuted, textAlign: 'center' },
  form: { gap: space[8] },
  google: { gap: space[8] },
  passwordBlock: { gap: space[5] },
  terms: { gap: space[2] },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: space[6] },
});
