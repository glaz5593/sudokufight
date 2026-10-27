import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Spinner } from '../../components/ui';
import { color, size, space } from '../../theme';
import { Field, FieldStatus } from './Field';
import type { NameCheck } from './useNameCheck';

/**
 * The display-name field with its live check (spec §3.1; Register-Fighter "שם לתצוגה … פנוי"): a status
 * inside the box (בודק… / פנוי / תפוס / לא תקין / לא מתאים), and under it the rule that is broken, why the
 * name can't be had, or the rules themselves while nothing is typed.
 */
export function NameField({
  value,
  onChangeText,
  check,
  error,
  hint,
  shake,
  testID = 'name',
}: {
  value: string;
  onChangeText: (value: string) => void;
  check: NameCheck;
  /** An error from submitting (e.g. the server's "taken" after a race), shown over the live one. */
  error?: string | null;
  /** Under the field while nothing is wrong (default: the rules). */
  hint?: string | null;
  shake?: number;
  testID?: string;
}) {
  const { t } = useTranslation('account');
  const { state } = check;

  let liveError: string | null = null;
  if (state === 'invalid' && check.problem) {
    // The characters apart, each said alone (name.charSpace: a space in Hebrew and English).
    liveError = t(`name.problem.${check.problem}`, { chars: check.chars.join(t('name.charSpace')) });
  } else if (state === 'taken') liveError = t('name.takenHint');
  else if (state === 'blocked') liveError = t('name.blockedHint');

  const statusWord = state === 'idle' ? null : t(`name.status.${state}`);
  const tone =
    state === 'available'
      ? 'ok'
      : state === 'taken' || state === 'invalid' || state === 'blocked'
        ? 'bad'
        : 'muted';

  return (
    <Field
      label={t('fields.displayName')}
      value={value}
      onChangeText={onChangeText}
      placeholder={t('fields.displayNamePlaceholder')}
      autoComplete="nickname"
      textContentType="nickname"
      autoCapitalize="none"
      autoCorrect={false}
      maxLength={32}
      error={error ?? liveError}
      hint={state === 'error' ? t('name.errorHint') : (hint ?? t('name.rules'))}
      accessibilityStatus={statusWord ?? undefined}
      shake={shake}
      testID={testID}
      status={
        statusWord ? (
          state === 'checking' ? (
            <View style={styles.checking} testID={`${testID}-status-checking`}>
              <Spinner color={color.textMuted} size={size.icon.inline} />
              <FieldStatus label={statusWord} tone="muted" />
            </View>
          ) : (
            <FieldStatus
              label={statusWord}
              tone={tone}
              icon={tone === 'ok' ? 'check' : tone === 'bad' ? 'close' : undefined}
              testID={`${testID}-status-${state}`}
            />
          )
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  checking: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
});
