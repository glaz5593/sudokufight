import type { AdminDayCount, AdminOverview } from '@sudoku-fight/protocol';
import { useCallback } from 'react';

import { DailyChart } from '../components/DailyChart';
import { AsyncView, DaysSelect, PageHeader, Section } from '../components/ui';
import { useApi, useAsync, useNow } from '../data';
import { fillDays, formatNumber, localDay } from '../format';
import { useI18n } from '../i18n';
import { navigate } from '../router';
import type { StringKey } from '../strings';

/** Spec §27.3 "סקירה": installs per day, active per day and week, games per day. */
export function OverviewPage({ days }: { days: number }) {
  const { t } = useI18n();
  const api = useApi();
  const load = useCallback(() => api.overview(days), [api, days]);
  const result = useAsync(load);
  const title = t('overview.title');

  return (
    <>
      <PageHeader title={title} docTitle={title}>
        <div className="toolbar">
          <DaysSelect days={days} onChange={(d) => navigate({ name: 'overview', days: d })} />
        </div>
      </PageHeader>
      <AsyncView result={result}>{(data) => <OverviewBody data={data} />}</AsyncView>
    </>
  );
}

const STATS: { label: StringKey; hint: StringKey; value: (o: AdminOverview) => number }[] = [
  { label: 'overview.installs', hint: 'overview.allTime', value: (o) => o.totals.installs },
  { label: 'overview.activeToday', hint: 'overview.activeTodayHint', value: (o) => o.activeToday },
  { label: 'overview.activeWeek', hint: 'overview.activeWeekHint', value: (o) => o.activeThisWeek },
  { label: 'overview.users', hint: 'overview.allTime', value: (o) => o.totals.users },
  { label: 'overview.games', hint: 'overview.allTime', value: (o) => o.totals.games },
  { label: 'overview.practice', hint: 'overview.practiceHint', value: (o) => o.totals.practiceGames },
  { label: 'overview.events', hint: 'overview.allTime', value: (o) => o.totals.events },
];

const CHARTS: {
  title: StringKey;
  kind: 'bar' | 'line';
  /** Active installs add up to nothing meaningful over days: say the average instead of a total. */
  average?: boolean;
  series: (o: AdminOverview) => AdminDayCount[];
}[] = [
  { title: 'chart.installs', kind: 'bar', series: (o) => o.installsPerDay },
  { title: 'chart.active', kind: 'line', average: true, series: (o) => o.activePerDay },
  { title: 'chart.games', kind: 'bar', series: (o) => o.gamesPerDay },
  { title: 'chart.practice', kind: 'bar', series: (o) => o.practicePerDay },
];

function OverviewBody({ data }: { data: AdminOverview }) {
  const { t, lang } = useI18n();
  const today = localDay(useNow());
  return (
    <>
      <Section title={t('overview.summary')}>
        <dl className="stats">
          {STATS.map((s) => (
            <div key={s.label} className="stat card">
              <dt>{t(s.label)}</dt>
              <dd className="stat-value">{formatNumber(lang, s.value(data))}</dd>
              <dd className="stat-hint">{t(s.hint)}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section title={t('overview.perDay')}>
        <div className="charts">
          {CHARTS.map((c) => {
            const points = fillDays(c.series(data), data.days, today);
            const total = points.reduce((sum, p) => sum + p.count, 0);
            const note = c.average
              ? t('chart.average', { avg: formatNumber(lang, total / Math.max(1, points.length), 1) })
              : t('chart.total', { total: formatNumber(lang, total) });
            return <DailyChart key={c.title} title={t(c.title)} points={points} kind={c.kind} note={note} />;
          })}
        </div>
      </Section>
    </>
  );
}
