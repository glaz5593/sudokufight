import type { CountryCode } from '@sudoku-fight/protocol';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { isAccountApiError } from '../../api/accountApi';
import { leaveRegistration, registerProfile, useAuth } from '../../auth/authStore';
import { ROUTES } from '../../auth/redirect';
import { useRegistrationDraft } from '../../auth/registrationDraft';
import { Button } from '../../components/ui';
import { track } from '../../services/analytics';
import { cue } from '../../services/feedback';
import { space } from '../../theme';
import { AvatarPicker } from './AvatarPicker';
import { CountryPicker } from './CountryPicker';
import { FighterPreview } from './FighterPreview';
import { errorMessage } from './messages';
import { NameField } from './NameField';
import {
  AccentTitle,
  AccountScreen,
  DevModeBadge,
  FormAlert,
  FormNote,
  LinkButton,
  StepHeader,
} from './parts';
import { TermsModal } from './TermsModal';
import { nameSubmittable, useNameCheck } from './useNameCheck';

/**
 * Registration, step 1: "צור את הלוחם שלך" (spec §3.2; Register-Fighter). Three fields: the avatar (its sheet
 * shows all of them in a grid), the display name with its live check, and the country [D21]; under them the
 * live preview of my card.
 *
 * Signed out: "המשך" goes on to step 2 (the account). Signed in without a profile (the registration stopped
 * after the account was made, or the name was taken meanwhile): "היכנס לזירה" creates the profile here, and
 * the header offers "התנתקות" instead of the way back.
 *
 * A Google account new to the game (signed in from the login screen with "המשך עם Google") comes here signed
 * in too, without having seen step 2: its note says so, and before the profile is created it accepts the terms
 * (TermsModal), unless this same account accepted them already (registrationDraft.ts termsAcceptedBy). An account
 * with a password accepted them at step 2. "התנתקות" here deletes a Google-only sign-in that has no fighter
 * (authStore.ts leaveRegistration), so its Google details don't stay at Firebase.
 *
 * Signed in, this is the registration's last screen: no "step 1 of 2" then.
 */
export function RegisterFighterScreen() {
  const { t } = useTranslation('account');
  const status = useAuth((s) => s.status);
  const methods = useAuth((s) => s.user?.methods);
  const uid = useAuth((s) => s.user?.uid ?? null);
  const signedIn = status === 'needsProfile';
  const googleOnly = Boolean(methods?.includes('google') && !methods.includes('password'));
  const termsAccepted = useRegistrationDraft((s) => uid !== null && s.termsAcceptedBy === uid);
  const avatarId = useRegistrationDraft((s) => s.avatarId);
  const displayName = useRegistrationDraft((s) => s.displayName);
  const country = useRegistrationDraft((s) => s.country);
  const draft = useRegistrationDraft.getState();
  const check = useNameCheck(displayName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [countryError, setCountryError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  /** The profile is being created: set at once, so a second tap (or the closing dialog's) does nothing. */
  const creating = useRef(false);

  // Spec §22: the registration's funnel, step by step.
  useEffect(() => track('register_step', { step: 'fighter' }), []);

  const submit = async () => {
    if (busy || creating.current) return;
    const nameOk = nameSubmittable(check.state);
    // An empty name says so; invalid, taken and blocked ones already say why under the field.
    setNameError(check.state === 'idle' ? t('name.problem.tooShort') : null);
    setCountryError(country ? null : t('validation.countryRequired'));
    setFormError(null);
    if (!nameOk || !country) {
      if (!nameOk && check.state !== 'checking') setShake((n) => n + 1);
      cue('nudge');
      return;
    }
    cue('primaryPress');
    if (!signedIn) {
      router.push(ROUTES.registerAccount);
      return;
    }
    if (googleOnly && !termsAccepted) {
      setTermsOpen(true);
      return;
    }
    await create(country);
  };

  const create = async (chosen: CountryCode) => {
    if (creating.current) return;
    creating.current = true;
    setBusy(true);
    try {
      await registerProfile({ displayName: check.name, avatarId, country: chosen });
      track('register_complete');
    } catch (error) {
      creating.current = false;
      setBusy(false);
      if (isAccountApiError(error) && ['taken', 'blocked', 'invalidName'].includes(error.code)) {
        setNameError(errorMessage(t, error));
        setShake((n) => n + 1);
      } else {
        setFormError(errorMessage(t, error));
      }
      cue('nudge');
    }
  };

  return (
    <AccountScreen
      testID="register-fighter"
      footer={
        <Button
          label={signedIn ? t('fighter.enterArena') : t('fighter.continue')}
          size="md"
          wrapLabel
          loading={busy}
          onPress={() => void submit()}
          testID="fighter-submit"
        />
      }
    >
      <StepHeader
        step={signedIn ? undefined : 1}
        onBack={
          signedIn ? undefined : () => (router.canGoBack() ? router.back() : router.replace(ROUTES.login))
        }
        backLabel={t('register.backToLogin')}
        end={
          signedIn ? (
            <LinkButton
              label={t('fighter.signOut')}
              onPress={() => void leaveRegistration()}
              testID="fighter-sign-out"
            />
          ) : undefined
        }
      />
      <DevModeBadge />
      <AccentTitle i18nKey="fighter.title" label={t('fighter.titleLabel')} />
      {signedIn ? (
        <FormNote
          message={googleOnly ? t('fighter.googleNote') : t('fighter.resumeNote')}
          testID="fighter-resume"
        />
      ) : null}
      <FormAlert message={formError} testID="fighter-alert" />

      <View style={styles.form}>
        <AvatarPicker value={avatarId} onChange={draft.setAvatar} />
        <NameField
          value={displayName}
          onChangeText={(v) => {
            draft.setName(v);
            setNameError(null);
          }}
          check={check}
          error={nameError}
          shake={shake}
        />
        <CountryPicker
          value={country}
          onChange={(c) => {
            draft.setCountry(c);
            setCountryError(null);
          }}
          error={countryError}
          hint={t('country.hint')}
        />
      </View>

      <FighterPreview avatarId={avatarId} name={displayName} country={country} />

      <TermsModal
        visible={termsOpen}
        onAccept={() => {
          // The dialog stays pressable while it fades out: a second tap must not create twice.
          if (creating.current) return;
          setTermsOpen(false);
          if (uid) draft.acceptTermsFor(uid);
          if (country) void create(country);
        }}
        onCancel={() => setTermsOpen(false)}
        testID="fighter-terms"
      />
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  form: { gap: space[8] },
});
