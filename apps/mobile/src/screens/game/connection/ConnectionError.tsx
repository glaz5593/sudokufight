import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../../components/Icon';
import { useShake } from '../../../components/player/anim';
import { Button } from '../../../components/ui/Button';
import { Text } from '../../../components/ui/Text';
import { color, radius, space, text, tokens } from '../../../theme';
import { useReduceMotion } from '../../../theme/motion';
import { Announcer } from './Announcer';
import { ConnectionIcon } from './ConnectionIcon';
import type { ConnectionErrorModel } from './connectionModel';
import { metrics } from './metrics';
import { useEnter } from './motion';
import { sentences } from './wording';

export interface ConnectionErrorProps {
  model: ConnectionErrorModel;
  /** "נסה שוב". While it runs the model says `retrying`, and the button shows it. */
  onRetry: () => void;
  /** "לבית". */
  onHome: () => void;
  /** "עבור לאימון" (spec §16.3); left out, the screen offers no practice. */
  onPractice?: () => void;
  testID?: string;
}

/**
 * The connection error (spec §16.3; design Connection-Error in C's look): "שגיאת חיבור" when the network is
 * there but the game server did not answer (or refused, or the game's connection could not come back), "אין
 * חיבור לאינטרנט" when the phone has no network. A plain explanation, the small error code for support
 * (LTR, it shakes once on every new failed attempt; reduced motion: a red frame instead) with "ניסיון 2
 * נכשל" in a red chip beside it, then "נסה שוב" (the one primary; it spins while trying), "עבור לאימון" with
 * its note, and "לבית".
 *
 * A full screen. Screen readers hear the title and the explanation once it appears, and each failed attempt.
 */
export function ConnectionError({
  model: m,
  onRetry,
  onHome,
  onPractice,
  testID = 'connection-error',
}: ConnectionErrorProps) {
  const { t } = useTranslation('game');
  const reduce = useReduceMotion();
  const insets = useSafeAreaInsets();
  const enter = useEnter(reduce);
  const failedAttempts = m.retrying ? null : m.attempts;
  const shake = useShake(failedAttempts ?? undefined, reduce);

  const offline = m.failure === 'offline';
  const title = offline ? t('connection.error.offlineTitle') : t('connection.error.title');
  const body = m.refusal
    ? t(`connection.error.refusal.${m.refusal}`)
    : t(`connection.error.body.${m.failure}`);
  const failed =
    !m.retrying && m.attempts > 1 ? t('connection.error.attemptFailed', { attempt: m.attempts }) : null;
  const announcement = m.retrying
    ? null
    : failed
      ? sentences([title, failed], t)
      : sentences([title, body], t);

  return (
    <View style={styles.root} testID={testID}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space[13], paddingBottom: insets.bottom + space[9] },
        ]}
      >
        <Animated.View style={[styles.column, enter]}>
          <View style={styles.illustration}>
            {offline ? (
              <Icon name="wifiOff" size={metrics.errorIcon.glyph} color={color.danger} />
            ) : (
              <ConnectionIcon name="plug" size={metrics.errorIcon.glyph} color={color.danger} />
            )}
          </View>
          <Text style={styles.title} accessibilityRole="header" testID={`${testID}-title`}>
            {title}
          </Text>
          <Text style={styles.body} testID={`${testID}-body`}>
            {body}
          </Text>
          <View style={styles.meta} testID={`${testID}-meta`}>
            <Animated.View
              accessible
              accessibilityLabel={t('connection.error.code', { code: m.code })}
              style={[styles.code, shake.flash && styles.codeFlash, shake.style]}
              testID={`${testID}-code`}
            >
              <View style={styles.codeDot} />
              <Text style={styles.codeText}>{m.code}</Text>
            </Animated.View>
            {failed ? (
              <View style={styles.failedChip} testID={`${testID}-attempts`}>
                <Text style={styles.failed}>{failed}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.actions}>
            <Button
              label={t('connection.error.retry')}
              onPress={onRetry}
              loading={m.retrying}
              variant="primary"
              size="lg"
              icon="refresh"
              style={styles.stretch}
              testID={`${testID}-retry`}
            />
            {onPractice ? (
              <>
                <Button
                  label={t('connection.error.practice')}
                  onPress={onPractice}
                  variant="secondary"
                  size="md"
                  icon="target"
                  style={styles.stretch}
                  testID={`${testID}-practice`}
                />
                <Text style={styles.note}>{t('connection.error.practiceNote')}</Text>
              </>
            ) : null}
            <Button
              label={t('connection.error.home')}
              onPress={onHome}
              variant="ghost"
              icon="home"
              testID={`${testID}-home`}
            />
          </View>
        </Animated.View>
      </ScrollView>
      <Announcer line={announcement} testID={`${testID}-live`} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: tokens.layout.gutterHome },
  column: { alignItems: 'center', gap: space[6] },
  illustration: {
    width: metrics.errorIcon.circle,
    height: metrics.errorIcon.circle,
    borderRadius: radius.pill,
    borderWidth: tokens.border.hairline,
    borderColor: color.dangerBorder,
    backgroundColor: color.iconBg.danger,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space[4],
  },
  title: { ...text('screenTitle'), color: color.text, textAlign: 'center' },
  body: { ...text('bodyLong'), color: color.textMuted, textAlign: 'center' },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[4],
  },
  code: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[5],
    paddingVertical: space[2],
    borderRadius: radius.badge,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  codeFlash: { borderColor: color.danger },
  codeDot: { width: space[3], height: space[3], borderRadius: radius.pill, backgroundColor: color.danger },
  codeText: { ...text('micro'), color: color.textFaint, writingDirection: 'ltr' },
  failedChip: {
    paddingHorizontal: space[5],
    paddingVertical: space[2],
    borderRadius: radius.badge,
    borderWidth: tokens.border.hairline,
    borderColor: color.dangerBorder,
    backgroundColor: color.dangerSubtle,
  },
  failed: { ...text('label'), color: color.danger },
  actions: { alignSelf: 'stretch', alignItems: 'center', gap: space[5], marginTop: space[8] },
  stretch: { alignSelf: 'stretch' },
  note: { ...text('caption'), color: color.textMuted, textAlign: 'center' },
});
