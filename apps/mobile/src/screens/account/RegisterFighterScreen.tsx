import type { CountryCode } from '@sudoku-fight/protocol';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { isAccountApiError } from '../../api/accountApi';
import { registerProfile, signOut, useAuth } from '../../auth/authStore';
import { ROUTES } from '../../auth/redirect';
import { useRegistrationDraft } from '../../auth/registrationDraft';
import { Flag } from '../../components/player';
import { Button } from '../../components/ui';
import { track } from '../../services/analytics';
import { cue } from '../../services/feedback';
import { color, radius, space, text, tokens } from '../../theme';
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
import { nameSubmittable, useNameCheck } from './useNameCheck';

/**
 * Registration, step 1: "צור את הלוחם שלך" (spec §3.2; Register-Fighter). The avatar on its stage and the
 * strip, the display name with its live check, the country [D21], and the live preview of the card.
 *
 * Signed out: "המשך" goes on to step 2 (the account). Signed in without a profile (the registration stopped
 * after the account was made, or the name was taken meanwhile): "היכנס לזירה" creates the profile here, and
 * the header offers "התנתקות" instead of the way back.
 */
export function RegisterFighterScreen() {
  const { t } = useTranslation('account');
  const status = useAuth((s) => s.status);
  const signedIn = status === 'needsProfile';
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

  // Spec §22: the registration's funnel, step by step.
  useEffect(() => track('register_step', { step: 'fighter' }), []);

  const submit = async () => {
    if (busy) return;
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
    setBusy(true);
    try {
      await registerProfile({ displayName: check.name, avatarId, country });
      track('register_complete');
    } catch (error) {
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
          size="lg"
          loading={busy}
          onPress={() => void submit()}
          testID="fighter-submit"
        />
      }
    >
      <StepHeader
        step={1}
        onBack={
          signedIn ? undefined : () => (router.canGoBack() ? router.back() : router.replace(ROUTES.login))
        }
        backLabel={t('register.backToLogin')}
        end={
          signedIn ? (
            <LinkButton
              label={t('fighter.signOut')}
              onPress={() => void signOut()}
              testID="fighter-sign-out"
            />
          ) : undefined
        }
      />
      <DevModeBadge />
      <AccentTitle i18nKey="fighter.title" label={t('fighter.titleLabel')} />
      {signedIn ? <FormNote message={t('fighter.resumeNote')} testID="fighter-resume" /> : null}
      <FormAlert message={formError} testID="fighter-alert" />

      <AvatarPicker
        value={avatarId}
        onChange={draft.setAvatar}
        caption={<NameTag name={displayName} country={country} />}
      />

      <View style={styles.form}>
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
    </AccountScreen>
  );
}

/**
 * The board's tag under the avatar on the stage: my flag and the name as typed (the default name while it is
 * empty). Seen, not spoken: the field under it and the preview say the same.
 */
function NameTag({ name, country }: { name: string; country: CountryCode | null }) {
  const { t } = useTranslation('account');
  return (
    <View
      style={styles.tag}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="fighter-name-tag"
    >
      <Flag country={country} size="home" decorative />
      <Text style={styles.tagName} numberOfLines={1}>
        {name.trim() || t('home:profile.defaultName')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space[8] },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    maxWidth: '100%',
    paddingHorizontal: space[8],
    paddingVertical: space[3],
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface2,
  },
  tagName: { ...text('h2'), color: color.text, flexShrink: 1 },
});
