import type { Me } from '@sudoku-fight/protocol';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { isAccountApiError, isOfflineError } from '../../api/accountApi';
import { signOut, updateProfile, useAuth } from '../../auth/authStore';
import { Icon } from '../../components/Icon';
import { shownName } from '../../components/player/temporaryName';
import { Button, ConfirmModal, useToast } from '../../components/ui';
import { Text } from '../../components/ui/Text';
import { cue } from '../../services/feedback';
import { color, radius, size, space, text } from '../../theme';
import { errorMessage } from '../account/messages';
import { NameField } from '../account/NameField';
import { AccountScreen, DevModeBadge, FormAlert, LinkButton } from '../account/parts';
import { nameSubmittable, useNameCheck } from '../account/useNameCheck';
import { isolateName } from '../game/hit/hitModel';

/**
 * "בחר שם חדש" (spec §3.5): an admin replaced an offensive display name with a temporary one ("שחקן48213") and
 * the profile says so (Me.nameResetRequired). The root layout keeps the player here (auth/redirect.ts) until a
 * new name is saved: the name field with its live check (taken, blocked words, the rules), free of the 30-day
 * rule this time (the server allows it). Saving takes the player home. Meanwhile "אימון בינתיים" (practice works
 * offline too, where saving can't) and "הגדרות" (deleting the account is there) stay open (auth/redirect.ts
 * OPEN_WHILE_NAME_RESET), and "התנתקות" signs out.
 */
export function ChooseNameScreen() {
  const me = useAuth((s) => s.me);
  if (!me) return null;
  return <ChooseNameForm me={me} />;
}

function ChooseNameForm({ me }: { me: Me }) {
  const { t } = useTranslation('moderation');
  const { t: ta } = useTranslation('account');
  const [name, setName] = useState('');
  const check = useNameCheck(name, { current: me.displayName });
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<'ask' | 'busy' | null>(null);

  const refuse = (message: string | null) => {
    setNameError(message);
    setShake((n) => n + 1);
    cue('nudge');
  };

  const save = async () => {
    if (busy) return;
    if (check.state === 'current') return refuse(t('chooseName.same'));
    if (check.state === 'idle' || !nameSubmittable(check.state)) return refuse(null);
    setBusy(true);
    setNameError(null);
    setFormError(null);
    cue('primaryPress');
    try {
      await updateProfile({ displayName: check.name });
      // The root layout takes the player home once the profile no longer asks for a name.
      useToast.getState().show({ variant: 'success', message: t('chooseName.saved') });
    } catch (error) {
      setBusy(false);
      cue('nudge');
      if (
        isAccountApiError(error) &&
        ['taken', 'blocked', 'invalidName', 'renameTooSoon'].includes(error.code)
      ) {
        refuse(errorMessage(ta, error));
      } else if (isOfflineError(error)) {
        setFormError(t('chooseName.offline'));
      } else {
        setFormError(errorMessage(ta, error));
      }
    }
  };

  const leave = async () => {
    setLeaving('busy');
    await signOut();
    setLeaving(null);
  };

  return (
    <AccountScreen
      testID="choose-name"
      footer={
        <View style={styles.footer}>
          <Button
            label={t('chooseName.save')}
            size="lg"
            loading={busy}
            onPress={() => void save()}
            testID="choose-name-save"
          />
          <LinkButton
            label={t('chooseName.practice')}
            icon="target"
            onPress={() => router.push({ pathname: '/game-type', params: { mode: 'solo' } })}
            testID="choose-name-practice"
          />
          <LinkButton
            label={t('chooseName.settings')}
            icon="settings"
            tone="muted"
            onPress={() => router.push('/settings')}
            testID="choose-name-settings"
          />
          <LinkButton
            label={t('chooseName.signOut')}
            tone="muted"
            onPress={() => setLeaving('ask')}
            testID="choose-name-sign-out"
          />
        </View>
      }
    >
      <DevModeBadge />
      <View style={styles.hero}>
        <View style={styles.iconCircle}>
          <Icon name="edit" size={size.icon.header} color={color.accent} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {t('chooseName.title')}
        </Text>
        <Text style={styles.body}>
          {t('chooseName.body', { name: isolateName(shownName(me.displayName, t)) })}
        </Text>
      </View>
      <FormAlert message={formError} testID="choose-name-alert" />
      <NameField
        value={name}
        onChangeText={(v) => {
          setName(v);
          setNameError(null);
        }}
        check={check}
        error={nameError}
        hint={t('chooseName.rule')}
        shake={shake}
        testID="choose-name-field"
      />
      <ConfirmModal
        visible={leaving !== null}
        placement="center"
        icon="logout"
        title={ta('settings.signOutTitle')}
        body={ta('settings.signOutBody')}
        confirmLabel={ta('settings.signOut')}
        confirmLoading={leaving === 'busy'}
        onConfirm={() => void leave()}
        onCancel={() => setLeaving((l) => (l === 'busy' ? l : null))}
        testID="choose-name-sign-out-confirm"
      />
    </AccountScreen>
  );
}

const ICON_CIRCLE = size.ctaHero - space[8];

const styles = StyleSheet.create({
  footer: { gap: space[4], alignItems: 'stretch' },
  hero: { alignItems: 'center', gap: space[6], paddingTop: space[6] },
  iconCircle: {
    width: ICON_CIRCLE,
    height: ICON_CIRCLE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.accentSubtle,
  },
  title: { ...text('screenTitle'), color: color.text, textAlign: 'center' },
  body: { ...text('bodyLong'), color: color.textMuted, textAlign: 'center' },
});
