import {
  type AvatarId,
  type CountryCode,
  isAvatarId,
  type Me,
  type UpdateMeRequest,
} from '@sudoku-fight/protocol';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { isAccountApiError, isOfflineError } from '../../api/accountApi';
import { nextRenameAt } from '../../api/me';
import { updateProfile, useAuth } from '../../auth/authStore';
import { Button, useToast } from '../../components/ui';
import { useMyLevel } from '../../progress/hooks';
import { cue } from '../../services/feedback';
import { space } from '../../theme';
import { goBack } from '../home/navigation';
import { ScreenHeader } from '../home/parts';
import { AvatarPicker } from './AvatarPicker';
import { CountryPicker } from './CountryPicker';
import { Field } from './Field';
import { errorMessage } from './messages';
import { NameField } from './NameField';
import { AccountScreen, DevModeBadge, FormAlert } from './parts';
import { nameSubmittable, useNameCheck } from './useNameCheck';

/** The date a rename is allowed again, in the app's language ("9 בנוב׳ 2026"). */
export function renameDate(at: number, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric' }).format(at);
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}

/**
 * "עריכת פרופיל" (spec §4.1 "screens missing from the design"; work plan stage 8): the avatar and the
 * country any time [D21], the display name once in 30 days [D20] — while it is locked the field says until
 * when. Saves only what changed (PATCH /v1/me). From Home's card and from the settings.
 */
export function EditProfileScreen() {
  const me = useAuth((s) => s.me);
  if (!me) return null;
  return <EditProfileForm me={me} />;
}

function EditProfileForm({ me }: { me: Me }) {
  const { t, i18n } = useTranslation('account');
  // An account made outside the app may have no avatar or country yet: nothing is chosen until the player
  // picks one.
  const [avatarId, setAvatarId] = useState<AvatarId | null>(isAvatarId(me.avatarId) ? me.avatarId : null);
  const [country, setCountry] = useState<CountryCode | null>(me.country);
  const [name, setName] = useState(me.displayName);
  const [renameAt] = useState(() => nextRenameAt(me, Date.now()));
  const check = useNameCheck(name, { current: me.displayName });
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  // [D17] Avatars above my level show locked (none in V1).
  const level = useMyLevel();

  const patch: UpdateMeRequest = {};
  if (avatarId !== null && avatarId !== me.avatarId) patch.avatarId = avatarId;
  if (country !== null && country !== me.country) patch.country = country;
  if (renameAt === null && check.name !== me.displayName) patch.displayName = check.name;
  const changed = Object.keys(patch).length > 0;

  const save = async () => {
    if (busy || !changed) return;
    if (patch.displayName !== undefined && !nameSubmittable(check.state)) {
      setShake((n) => n + 1);
      cue('nudge');
      return;
    }
    setBusy(true);
    setNameError(null);
    setFormError(null);
    cue('primaryPress');
    try {
      await updateProfile(patch);
      useToast.getState().show({ variant: 'success', message: t('edit.saved') });
      goBack();
    } catch (error) {
      setBusy(false);
      cue('nudge');
      if (isAccountApiError(error) && error.code === 'renameTooSoon') {
        const at = error.body?.nextRenameAt;
        setNameError(
          at ? t('edit.nameLocked', { date: renameDate(at, i18n.language) }) : errorMessage(t, error),
        );
        setShake((n) => n + 1);
      } else if (isAccountApiError(error) && ['taken', 'blocked', 'invalidName'].includes(error.code)) {
        setNameError(errorMessage(t, error));
        setShake((n) => n + 1);
      } else if (isOfflineError(error)) {
        setFormError(t('edit.offline'));
      } else {
        setFormError(errorMessage(t, error));
      }
    }
  };

  return (
    <AccountScreen
      testID="edit-profile"
      footer={
        <Button
          label={t('edit.save')}
          size="lg"
          loading={busy}
          disabled={!changed}
          onPress={() => void save()}
          testID="edit-save"
        />
      }
    >
      <ScreenHeader title={t('edit.title')} onBack={goBack} />
      <DevModeBadge />
      <FormAlert message={formError} testID="edit-alert" />
      <AvatarPicker value={avatarId} onChange={setAvatarId} level={level} />
      <View style={styles.form}>
        {renameAt === null ? (
          <NameField
            value={name}
            onChangeText={(v) => {
              setName(v);
              setNameError(null);
            }}
            check={check}
            error={nameError}
            hint={t('edit.nameRule')}
            shake={shake}
            testID="edit-name"
          />
        ) : (
          <Field
            label={t('fields.displayName')}
            value={me.displayName}
            editable={false}
            hint={t('edit.nameLocked', { date: renameDate(renameAt, i18n.language) })}
            testID="edit-name-locked"
          />
        )}
        <CountryPicker value={country} onChange={setCountry} testID="edit-country" />
      </View>
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  form: { gap: space[8] },
});
