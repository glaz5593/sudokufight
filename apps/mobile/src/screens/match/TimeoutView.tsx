import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui/Button';
import { Text } from '../../components/ui/Text';
import { color, radius, space, text, tokens } from '../../theme';
import { Announcer } from '../game/connection/Announcer';
import { useEnter } from '../game/connection/motion';
import { clockText, type MatchScreenModel } from './matchModel';
import { metrics } from './metrics';
import { HeaderChip, joinSentences, rangeText } from './parts';

type TimeoutModel = Extract<MatchScreenModel, { kind: 'timeout' }>;

export interface TimeoutViewProps {
  model: TimeoutModel;
  reduce: boolean;
  /** "המשך לחפש": no cap on the range (spec §10). */
  onKeepSearching: () => void;
  /** "שחק מול בוט בינתיים". */
  onBot: () => void;
  /** "חזרה לבית". */
  onHome: () => void;
  testID?: string;
}

/**
 * Nobody found within 60 s (spec §10; Match-Timeout in C's look): how long and in what range it searched, then
 * the three ways on: "המשך לחפש" (the primary: the same search, with the cap on the range removed), "שחק
 * מול בוט בינתיים", and "חזרה לבית". When nobody else was searching at all (`alone`), the title and the
 * explanation say so instead of the range, and "בלי הגבלת טווח" goes (it means nothing with nobody there).
 * A screen reader hears the title and the explanation.
 */
export function TimeoutView({
  model: m,
  reduce,
  onKeepSearching,
  onBot,
  onHome,
  testID = 'match-timeout',
}: TimeoutViewProps) {
  const { t } = useTranslation('match');
  const insets = useSafeAreaInsets();
  const enter = useEnter(reduce);
  const minutes = Math.max(1, Math.round(m.elapsedMs / 60_000));
  const searched = t('timeout.minutes', { count: minutes });
  // "יריב", or "מספיק יריבים" for a table of 3–4 (spec §10: the game starts only when it is full).
  const openSeats = Math.max(1, m.header.players - 1);
  const body = m.alone
    ? t('timeout.aloneBody', { count: openSeats, time: searched })
    : t('timeout.body', { time: searched, range: m.range ? rangeText(m.range) : '' });
  const time = clockText(m.elapsedMs);
  const title = m.alone
    ? t('timeout.aloneTitle', { count: openSeats })
    : t('timeout.title', { count: openSeats });

  return (
    <View style={styles.root} testID={testID}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[9] },
        ]}
      >
        <Animated.View style={[styles.column, enter]}>
          <HeaderChip header={m.header} testID={`${testID}-header`} />
          <View style={styles.illustration}>
            <Icon name="search" size={metrics.errorIcon.glyph} color={color.textMuted} />
          </View>
          <Text
            style={styles.elapsed}
            accessibilityLabel={t('search.elapsedLabel', { time })}
            testID={`${testID}-elapsed`}
          >
            {time}
          </Text>
          <Text style={styles.title} accessibilityRole="header" testID={`${testID}-title`}>
            {title}
          </Text>
          <Text style={styles.body} testID={`${testID}-body`}>
            {body}
          </Text>

          <View style={styles.actions}>
            <Button
              label={t('timeout.keep')}
              onPress={onKeepSearching}
              size="lg"
              icon="refresh"
              accessibilityHint={t('timeout.keepHint')}
              style={styles.stretch}
              testID={`${testID}-keep`}
            />
            {m.alone ? null : <Text style={styles.keepNote}>{t('timeout.keepNote')}</Text>}
            <Button
              label={t('timeout.bot')}
              onPress={onBot}
              variant="secondary"
              size="md"
              icon="bot"
              style={styles.stretch}
              testID={`${testID}-bot`}
            />
            <Button
              label={t('timeout.home')}
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
    borderColor: color.border,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space[6],
  },
  elapsed: { ...text('scoreCompact'), color: color.textMuted },
  title: { ...text('screenTitle'), color: color.text, textAlign: 'center' },
  body: { ...text('bodyLong'), color: color.textMuted, textAlign: 'center' },
  actions: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: space[5],
    marginTop: space[8],
  },
  stretch: { alignSelf: 'stretch' },
  keepNote: { ...text('caption'), color: color.textMuted, textAlign: 'center', marginTop: -space[3] },
});
