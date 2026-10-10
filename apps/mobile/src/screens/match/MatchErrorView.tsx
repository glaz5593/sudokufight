import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui/Button';
import type { MatchmakingFailureCode } from '../../net/matchmaking';
import { color, radius, space, text, tokens } from '../../theme';
import { Announcer } from '../game/connection/Announcer';
import { useEnter } from '../game/connection/motion';
import type { MatchScreenModel } from './matchModel';
import { metrics } from './metrics';
import { HeaderChip, joinSentences } from './parts';

type FailedModel = Extract<MatchScreenModel, { kind: 'failed' }>;

export interface MatchErrorViewProps {
  model: FailedModel;
  reduce: boolean;
  /** "חפש שוב". */
  onRetry: () => void;
  /** "עבור לאימון" (spec §16.3). */
  onPractice: () => void;
  /** "חזרה לבית". */
  onHome: () => void;
  testID?: string;
}

/** Failures that are the connection's: no answer, or it dropped. */
const CONNECTION: readonly MatchmakingFailureCode[] = ['network', 'lost'];

/**
 * The search could not go on (spec §16.3, §4.1 "מצבי שגיאה … Matchmaking"; Connection-Error's look): no
 * answer from the server, a connection lost while searching, a match whose room this phone did not reach in
 * time, or the server's refusal (a search or a ranked game already running on another device, a closed
 * queue, no sign-in). A plain explanation, the small support code, then "חפש שוב", "עבור לאימון" (practice
 * works offline) and "חזרה לבית".
 */
export function MatchErrorView({
  model: m,
  reduce,
  onRetry,
  onPractice,
  onHome,
  testID = 'match-error',
}: MatchErrorViewProps) {
  const { t } = useTranslation('match');
  const insets = useSafeAreaInsets();
  const enter = useEnter(reduce);
  const connection = CONNECTION.includes(m.code);
  const title = connection ? t('error.offlineTitle') : t('error.title');
  const body = t(`error.body.${m.code}`);

  return (
    <View style={styles.root} testID={testID}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[9] },
        ]}
      >
        <Animated.View style={[styles.column, enter]}>
          <HeaderChip header={m.header} />
          <View style={styles.illustration}>
            <Icon
              name={connection ? 'wifiOff' : 'alert'}
              size={metrics.errorIcon.glyph}
              color={color.danger}
            />
          </View>
          <Text style={styles.title} accessibilityRole="header" testID={`${testID}-title`}>
            {title}
          </Text>
          <Text style={styles.body} testID={`${testID}-body`}>
            {body}
          </Text>
          <View
            style={styles.code}
            accessible
            accessibilityLabel={t('error.code', { code: m.supportCode })}
            testID={`${testID}-code`}
          >
            <View style={styles.codeDot} />
            <Text style={styles.codeText}>{m.supportCode}</Text>
          </View>
          <View style={styles.actions}>
            <Button
              label={t('error.retry')}
              onPress={onRetry}
              size="lg"
              icon="refresh"
              style={styles.stretch}
              testID={`${testID}-retry`}
            />
            <Button
              label={t('error.practice')}
              onPress={onPractice}
              variant="secondary"
              size="md"
              style={styles.stretch}
              testID={`${testID}-practice`}
            />
            <Text style={styles.note}>{t('error.practiceNote')}</Text>
            <Button
              label={t('error.home')}
              onPress={onHome}
              variant="ghost"
              icon="home"
              testID={`${testID}-home`}
            />
          </View>
        </Animated.View>
      </ScrollView>
      <Announcer line={joinSentences([title, body], t)} testID={`${testID}-live`} />
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
    marginTop: space[6],
  },
  title: { ...text('screenTitle'), color: color.text, textAlign: 'center' },
  body: { ...text('bodyLong'), color: color.textMuted, textAlign: 'center' },
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
  codeDot: { width: space[3], height: space[3], borderRadius: radius.pill, backgroundColor: color.danger },
  codeText: { ...text('micro'), color: color.textFaint, writingDirection: 'ltr' },
  actions: { alignSelf: 'stretch', alignItems: 'center', gap: space[5], marginTop: space[8] },
  stretch: { alignSelf: 'stretch' },
  note: { ...text('caption'), color: color.textMuted, textAlign: 'center' },
});
