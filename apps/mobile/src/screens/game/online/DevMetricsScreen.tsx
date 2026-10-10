import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../../components/ui';
import { color, space, text, tokens } from '../../../theme';
import { NetMetricsPanel, type NetMetricsSource } from './NetMetricsPanel';

export interface DevMetricsScreenProps {
  /** The online game's host (the game store's online session); null when none is open. */
  source: NetMetricsSource | null;
  onClose: () => void;
  testID?: string;
}

/**
 * /dev/metrics (development builds, work plan stage 7): the debug screen of spec §18's five measures for the
 * online game that is open (also reachable over the game itself, from its "ms" chip). The same numbers go to
 * analytics as latency_sample (c2sP95, s2cP95, actionP95).
 */
export function DevMetricsScreen({ source, onClose, testID = 'dev-metrics-screen' }: DevMetricsScreenProps) {
  const { t } = useTranslation('dev');
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID={testID}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[12] }]}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            {t('metrics.title')}
          </Text>
          <Button
            label={t('online.close')}
            variant="ghost"
            icon="close"
            onPress={onClose}
            testID="dev-metrics-close"
          />
        </View>
        {source ? (
          <>
            <Text style={styles.muted}>{t('metrics.subtitle')}</Text>
            <NetMetricsPanel source={source} />
          </>
        ) : (
          <Text style={styles.muted} testID={`${testID}-none`}>
            {t('metrics.none')}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: tokens.layout.gutterHome, gap: space[8] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[6] },
  title: { ...text('screenTitle'), color: color.text, flexShrink: 1 },
  muted: { ...text('body'), color: color.textMuted },
});
