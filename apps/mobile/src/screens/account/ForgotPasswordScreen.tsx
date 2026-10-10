import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { sendPasswordReset, useAuth } from '../../auth/authStore';
import { toAuthError } from '../../auth/errors';
import { emailOk } from '../../auth/password';
import { ltr } from '../../components/player';
import { Button } from '../../components/ui';
import { cue } from '../../services/feedback';
import { color, space, text } from '../../theme';
import { goBack } from '../home/navigation';
import { ScreenHeader } from '../home/parts';
import { Field } from './Field';
import { errorMessage } from './messages';
import { AccountScreen, DevModeBadge, FormAlert, FormNote } from './parts';

/**
 * "שכחתי סיסמה" [D22] (spec §3.3, §4.1 "screens missing from the design"; built in direction C): the email,
 * then "check your inbox". The answer is the same whether the address has an account or not, so the
 * screen can't be used to find out who plays.
 */
export function ForgotPasswordScreen() {
  const { t } = useTranslation('account');
  const params = useLocalSearchParams<{ email?: string }>();
  const dev = useAuth((s) => s.provider) === 'dev';
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [error, setError] = useState<{ field?: string; form?: string }>({});
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const fail = (next: typeof error) => {
    setError(next);
    if (next.field) setShake((n) => n + 1);
    cue('nudge');
  };

  const submit = async () => {
    if (busy) return;
    const address = email.trim();
    if (!address) return fail({ field: t('validation.emailRequired') });
    if (!emailOk(address)) return fail({ field: t('validation.emailInvalid') });
    setError({});
    setBusy(true);
    try {
      await sendPasswordReset(address);
      setSentTo(address);
    } catch (e) {
      const { code } = toAuthError(e);
      // An unknown address gets the same answer as a known one.
      if (code === 'userNotFound') setSentTo(address);
      else if (code === 'invalidEmail') fail({ field: errorMessage(t, e) });
      else fail({ form: errorMessage(t, e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AccountScreen
      testID="forgot-password"
      footer={
        sentTo ? (
          <Button label={t('forgot.backToLogin')} size="lg" onPress={goBack} testID="forgot-back" />
        ) : (
          <Button
            label={t('forgot.submit')}
            size="lg"
            loading={busy}
            onPress={() => void submit()}
            testID="forgot-submit"
          />
        )
      }
    >
      <ScreenHeader title={t('forgot.title')} onBack={goBack} />
      <DevModeBadge />
      {sentTo ? (
        <View style={styles.sent} testID="forgot-sent">
          <Text style={styles.sentTitle} accessibilityRole="header">
            {t('forgot.sentTitle')}
          </Text>
          <FormNote tone="success" message={t('forgot.sentBody', { email: ltr(sentTo) })} />
          {dev ? <FormNote message={t('devMode.noEmail')} testID="forgot-dev-note" /> : null}
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={styles.body}>{t('forgot.body')}</Text>
          <FormAlert message={error.form ?? null} testID="forgot-alert" />
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
            returnKeyType="send"
            onSubmitEditing={() => void submit()}
            error={error.field}
            shake={shake}
            testID="forgot-email"
          />
        </View>
      )}
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  form: { gap: space[8] },
  body: { ...text('bodyLong'), color: color.textMuted },
  sent: { gap: space[8] },
  sentTitle: { ...text('h1'), color: color.text },
});
