import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { checkEmailVerified, sendVerificationEmail, useAuth } from '../../auth/authStore';
import { ROUTES } from '../../auth/redirect';
import { Icon } from '../../components/Icon';
import { ltr } from '../../components/player';
import { Button, useToast } from '../../components/ui';
import { cue } from '../../services/feedback';
import { color, radius, size, space, text, tokens } from '../../theme';
import { goBack } from '../home/navigation';
import { ScreenHeader } from '../home/parts';
import { errorMessage } from './messages';
import { AccountScreen, DevModeBadge, FormAlert, FormNote } from './parts';

/**
 * Email verification [D22] (spec §3.1 "נשלח מייל אימות"). Not a gate: practice works without it (D24 is
 * rejected, so the account is required, but its email need not be verified to practise; config/account.ts).
 * "שלח שוב" sends the link again; "אימתתי" reads the sign-in again and, once verified, says so and goes
 * back.
 */
export function VerifyEmailScreen() {
  const { t } = useTranslation('account');
  const email = useAuth((s) => s.user?.email ?? s.me?.email ?? '');
  const dev = useAuth((s) => s.provider) === 'dev';
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<{ tone: 'muted' | 'success'; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resend = async () => {
    setSending(true);
    setError(null);
    try {
      await sendVerificationEmail();
      setNote({ tone: 'success', message: t('verify.sent') });
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setSending(false);
    }
  };

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      if (await checkEmailVerified()) {
        cue('correct');
        useToast.getState().show({ variant: 'success', message: t('verify.done') });
        goBack();
        return;
      }
      setNote({ tone: 'muted', message: t('verify.notYet') });
      cue('nudge');
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <AccountScreen
      testID="verify-email"
      footer={
        <View style={styles.actions}>
          <Button
            label={t('verify.check')}
            size="lg"
            loading={checking}
            onPress={() => void check()}
            testID="verify-check"
          />
          <Button
            label={t('verify.resend')}
            variant="secondary"
            size="md"
            loading={sending}
            onPress={() => void resend()}
            testID="verify-resend"
          />
        </View>
      }
    >
      <ScreenHeader title={t('verify.title')} onBack={goBack} />
      <DevModeBadge />
      <View style={styles.hero}>
        <View style={styles.iconCircle}>
          <Icon name="mail" size={size.icon.nav} color={color.accent} />
        </View>
        <Text style={styles.body} testID="verify-body">
          {t('verify.body', { email: ltr(email) })}
        </Text>
        <Text style={styles.why}>{t('verify.why')}</Text>
      </View>
      <FormAlert message={error} testID="verify-alert" />
      {note ? <FormNote tone={note.tone} message={note.message} testID="verify-note" /> : null}
      {dev ? <FormNote message={t('verify.devNote')} testID="verify-dev-note" /> : null}
    </AccountScreen>
  );
}

/**
 * Home's reminder while the email is not verified [D22]: one row, the whole of it a button to /verify-email.
 * Nothing when verified, or before the sign-in is known.
 */
export function VerifyBanner({
  style,
  testID = 'verify-banner',
}: {
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { t } = useTranslation('account');
  const user = useAuth((s) => s.user);
  if (!user || user.emailVerified) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('verify.bannerLabel')}
      onPress={() => router.push(ROUTES.verifyEmail)}
      style={({ pressed }) => [styles.banner, pressed && styles.bannerPressed, style]}
      testID={testID}
    >
      <Icon name="mail" size={size.icon.card} color={color.warning} />
      <Text style={styles.bannerText} numberOfLines={2}>
        {t('verify.bannerTitle')}
      </Text>
      <Text style={styles.bannerAction}>{t('verify.bannerAction')}</Text>
    </Pressable>
  );
}

const ICON_CIRCLE = size.ctaHero - space[8];

const styles = StyleSheet.create({
  actions: { gap: space[6] },
  hero: { alignItems: 'center', gap: space[6], paddingTop: space[6] },
  iconCircle: {
    width: ICON_CIRCLE,
    height: ICON_CIRCLE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.accentSubtle,
  },
  body: { ...text('bodyLong'), color: color.text, textAlign: 'center' },
  why: { ...text('caption'), color: color.textMuted, textAlign: 'center' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    minHeight: size.touch,
    paddingHorizontal: space[6],
    paddingVertical: space[4],
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  bannerPressed: { backgroundColor: color.surface2 },
  bannerText: { ...text('body'), color: color.text, flex: 1 },
  bannerAction: { ...text('buttonSm'), color: color.accent },
});
