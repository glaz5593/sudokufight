import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { ltr } from '../../../components/player/format';
import type { ClockSync } from '../../../net/clockSync';
import type { NetMetrics } from '../../../net/metrics';
import { color, radius, space, text, tokens } from '../../../theme';
import { type MeasureRow, netMetricsModel, type NetMetricsModel } from './netMetricsModel';

/** What the panel reads: a RemoteGameHost has both. */
export interface NetMetricsSource {
  readonly metrics: NetMetrics;
  readonly sync: ClockSync;
}

export interface NetMetricsPanelProps {
  source: NetMetricsSource;
  /** How often it reads the measures again. */
  intervalMs?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The measures of `source` now. */
export function readNetMetrics(source: NetMetricsSource): NetMetricsModel {
  return netMetricsModel({
    summary: source.metrics.summary(),
    rtt: source.sync.rtt.summary(),
    offsetMs: source.sync.synced ? source.sync.offsetMs : null,
  });
}

/**
 * The five measures of spec §18 live (development builds: the debug screen and the game screen's overlay),
 * with the ping round trip and the clock offset: p50, p95 and max over the last 200 samples of each, the p95
 * green within its target (150 ms for the actions, 2 s for a return) and red over it. Numbers are LTR.
 */
export function NetMetricsPanel({
  source,
  intervalMs = 500,
  style,
  testID = 'net-metrics',
}: NetMetricsPanelProps) {
  const { t } = useTranslation('dev');
  // The measures live in the host and change without telling anyone: read them again on a tick.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), Math.max(100, intervalMs));
    return () => clearInterval(id);
  }, [intervalMs]);
  const model = readNetMetrics(source);

  return (
    <View style={[styles.root, style]} testID={testID}>
      {model.rows.map((row) => (
        <Row key={row.key} row={row} />
      ))}
      <View style={styles.footer}>
        <Text style={styles.foot} testID={`${testID}-offset`}>
          {model.offsetMs === null
            ? t('metrics.offsetNone')
            : t('metrics.offset', { ms: ltr(String(model.offsetMs)) })}
        </Text>
        <Text style={styles.foot}>{t('metrics.lost', { count: model.lost })}</Text>
        <Text style={styles.foot}>{t('metrics.reports', { count: model.reports })}</Text>
      </View>
    </View>
  );
}

function Row({ row }: { row: MeasureRow }) {
  const { t } = useTranslation('dev');
  const s = row.stats;
  const label = t(`metrics.${row.key}`);
  const values =
    s.count === 0
      ? t('metrics.empty')
      : t('metrics.values', { p50: s.p50 ?? 0, p95: s.p95 ?? 0, max: s.max ?? 0 });
  const count = t('metrics.count', { count: s.count, total: s.total });
  const target = t('metrics.target', { ms: row.targetMs });
  const tone = row.withinTarget === null ? styles.idle : row.withinTarget ? styles.good : styles.bad;
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={[label, values, count, target].join(t('metrics.sep'))}
      testID={`net-metrics-${row.key}`}
    >
      <View style={styles.head}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.count}>{count}</Text>
      </View>
      <Text style={[styles.values, tone]} testID={`net-metrics-${row.key}-values`}>
        {ltr(values)}
      </Text>
      <Text style={styles.target}>{target}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: space[4],
    padding: space[6],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  row: { gap: space[1] },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space[4] },
  label: { ...text('label'), color: color.text },
  count: { ...text('micro'), color: color.textFaint },
  values: { ...text('body'), writingDirection: 'ltr' },
  target: { ...text('micro'), color: color.textMuted },
  idle: { color: color.textMuted },
  good: { color: color.success },
  bad: { color: color.danger },
  footer: {
    gap: space[1],
    paddingTop: space[4],
    borderTopWidth: tokens.border.hairline,
    borderTopColor: color.border,
  },
  foot: { ...text('caption'), color: color.textMuted },
});
