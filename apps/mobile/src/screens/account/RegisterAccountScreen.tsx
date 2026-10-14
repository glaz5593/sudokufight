import { validateDisplayName } from '@sudoku-fight/protocol';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, Text, type TextInput, View } from 'react-native';

import { isAccountApiError } from '../../api/accountApi';
import { signUpAndRegister } from '../../auth/authStore';
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
import { errorMessage } from './messages';
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
 */
export function RegisterAccountScreen() {
  const { t, i18n } = useTranslation('account');
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

  const submit = async () => {
    if (busy) return;
    // Step 1 must be complete (a deep link, or a draft from an older version).
    if (validateDisplayName(name) !== null || !country) {
      router.replace(ROUTES.registerFighter);
      return;
    }
    const local: Errors = {};
    if (!email.trim()) local.email = t('validation.emailRequired');
    else if (!emailOk(email)) local.email = t('validation.emailInvalid');
    if (!passwordOk(password)) local.password = t('validation.passwordRules');
    if (confirm !== password) local.confirm = t('validation.confirmMismatch');
    if (!agree) local.terms = t('terms.required');
    if (Object.keys(local).length > 0) return fail(local);

    setErrors({});
    setBusy(true);
    cue('primaryPress');
    try {
      await signUpAndRegister(email.trim(), password, { displayName: name, avatarId, country });
      track('register_complete');
    } catch (error) {
      setBusy(false);
      if (isAccountApiError(error)) {
        // The sign-in exists now; the router takes the player back to step 1 to finish.
        const message =
          error.code === 'taken'
            ? t('account.nameTakenNow', { name: ltr(name) })
            : `${t('account.profileFailed')} ${errorMessage(t, error)}`;
        useToast.getState().show({ variant: 'error', message });
        return;
      }
      const { code } = toAuthError(error);
      if (code === 'emailInUse' || code === 'invalidEmail') return fail({ email: errorMessage(t, error) });
      if (code === 'weakPassword') return fail({ password: errorMessage(t, error) });
      return fail({ form: errorMessage(t, error) });
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
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  muted: { ...text('caption'), color: color.textMuted },
  ready: { ...text('caption'), color: color.success },
  titles: { gap: space[4] },
  subtitle: { ...text('body'), color: color.textMuted, textAlign: 'center' },
  form: { gap: space[8] },
  passwordBlock: { gap: space[5] },
  terms: { gap: space[2] },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: space[6] },
});
