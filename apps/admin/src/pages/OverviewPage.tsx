import {
  type AdminDayCount,
  type AdminFriendRooms,
  type AdminOverview,
  type AdminReturnCount,
  type AdminStealthOverview,
  STEALTH_CLOSE_CALL_SECONDS,
  STEALTH_RETURN_MINUTES,
  STEALTH_WIN_TARGET,
} from '@sudoku-fight/protocol';
import { type ReactNode, useCallback } from 'react';

import { DailyChart } from '../components/DailyChart';
import { AsyncView, DaysSelect, PageHeader, Section } from '../components/ui';
import { useApi, useAsync, useNow } from '../data';
import { fillDays, formatNumber, formatPercent, localDay } from '../format';
import { type I18n, useI18n } from '../i18n';
import { navigate, routeHref } from '../router';
import type { StringKey } from '../strings';
import { roomCounts } from './RoomsPage';

/**
 * Spec §27.3 "סקירה": installs per day, active per day and week, games per day. With the friends rooms open
 * now (1.0.4, GET /rooms): a card of their own, left out when the server can't say (an older one, an error).
 * And the stealth bot (stealth-bot.md §8), once it has personas or games: the share of ranked games against
 * it, the players' win rate against it (target 45%–55%), the search time, reports and blocks of personas,
 * who played again soon after, against the bot and against people, and the close calls (two people who each
 * got the bot within a minute, §3.5). Users are people only.
 */
export function OverviewPage({ days }: { days: number }) {
  const { t } = useI18n();
  const api = useApi();
  const load = useCallback(() => api.overview(days), [api, days]);
  const result = useAsync(load);
  const loadRooms = useCallback(() => api.friendRooms(days), [api, days]);
  const rooms = useAsync(loadRooms);
  const title = t('overview.title');

  return (
    <>
      <PageHeader title={title} docTitle={title}>
        <div className="toolbar">
          <DaysSelect days={days} onChange={(d) => navigate({ name: 'overview', days: d })} />
        </div>
      </PageHeader>
      <AsyncView result={result}>
        {(data) => <OverviewBody data={data} rooms={rooms.error ? undefined : rooms.data} />}
      </AsyncView>
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

function OverviewBody({ data, rooms }: { data: AdminOverview; rooms: AdminFriendRooms | undefined }) {
  const i18n = useI18n();
  const { t, lang } = i18n;
  const today = localDay(useNow());
  const open = rooms === undefined ? null : roomCounts(i18n, rooms.counts);
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
          {open !== null && (
            <div className="stat card">
              <dt>
                <a href={routeHref({ name: 'rooms' })}>{t('overview.rooms')}</a>
              </dt>
              <dd className="stat-value">{open.total}</dd>
              <dd className="stat-hint">{open.hint}</dd>
            </div>
          )}
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
      {data.stealth && (data.stealth.personas > 0 || data.stealth.stealthGames > 0) && (
        <StealthSection stealth={data.stealth} days={data.days} today={today} />
      )}
    </>
  );
}

/** A share in words, or "—" when there is nothing to divide by. */
function share(i18n: Pick<I18n, 't' | 'lang'>, part: number, whole: number): string {
  return whole > 0 ? formatPercent(i18n.lang, part / whole) : i18n.t('common.none');
}

const returnRate = (i18n: Pick<I18n, 't' | 'lang'>, r: AdminReturnCount) => share(i18n, r.returned, r.games);

/** The stealth bot over the period (stealth-bot.md §8): only the admin site tells its games apart. */
function StealthSection({
  stealth: s,
  days,
  today,
}: {
  stealth: AdminStealthOverview;
  days: number;
  today: string;
}) {
  const i18n = useI18n();
  const { t, lang } = i18n;
  const seconds = (v: number | null) =>
    v === null ? t('common.none') : t('stealth.seconds', { s: formatNumber(lang, v, 1) });
  const per100 = (n: number) =>
    t('stealth.per100', {
      n: s.stealthGames > 0 ? formatNumber(lang, (100 * n) / s.stealthGames, 1) : t('common.none'),
    });
  const offTarget =
    s.winRate !== null && (s.winRate < STEALTH_WIN_TARGET.min || s.winRate > STEALTH_WIN_TARGET.max);
  const stats: { key: string; label: ReactNode; value: string; hint: string; flag?: ReactNode }[] = [
    {
      key: 'share',
      label: <a href={routeHref({ name: 'games', stealth: '1' })}>{t('stealth.share')}</a>,
      value: share(i18n, s.stealthGames, s.rankedGames),
      hint: t('stealth.shareHint', {
        games: formatNumber(lang, s.stealthGames),
        total: formatNumber(lang, s.rankedGames),
      }),
    },
    {
      key: 'winRate',
      label: t('stealth.winRate'),
      value: s.winRate === null ? t('common.none') : formatPercent(lang, s.winRate),
      hint: t('stealth.winRateHint', {
        min: formatPercent(lang, STEALTH_WIN_TARGET.min),
        max: formatPercent(lang, STEALTH_WIN_TARGET.max),
        wins: formatNumber(lang, s.wins),
        losses: formatNumber(lang, s.losses),
      }),
      flag: offTarget ? <span className="badge badge-warn">{t('stealth.offTarget')}</span> : null,
    },
    {
      key: 'wait',
      label: t('stealth.wait'),
      value: seconds(s.wait.stealth.avgSec),
      hint: t('stealth.waitHint', { people: seconds(s.wait.people.avgSec) }),
    },
    {
      key: 'reports',
      label: t('stealth.reports'),
      value: formatNumber(lang, s.reports),
      hint: per100(s.reports),
    },
    {
      key: 'blocks',
      label: t('stealth.blocks'),
      value: formatNumber(lang, s.blocks),
      hint: per100(s.blocks),
    },
    {
      key: 'returned',
      label: t('stealth.returned', { minutes: formatNumber(lang, STEALTH_RETURN_MINUTES) }),
      value: returnRate(i18n, s.returned.stealth),
      hint: t('stealth.returnedHint', { people: returnRate(i18n, s.returned.people) }),
    },
    {
      // stealth-bot.md §3.5: does the bot take games from people who could have met?
      key: 'closeCalls',
      label: t('stealth.closeCalls', { seconds: formatNumber(lang, STEALTH_CLOSE_CALL_SECONDS) }),
      value: formatNumber(lang, s.closeCalls),
      hint: t('stealth.closeCallsHint'),
    },
    {
      key: 'personas',
      label: <a href={routeHref({ name: 'stealth' })}>{t('stealth.personasCount')}</a>,
      value: formatNumber(lang, s.personas),
      hint: t('overview.allTime'),
    },
  ];
  const points = fillDays(s.stealthPerDay, days, today);
  const total = points.reduce((sum, p) => sum + p.count, 0);
  return (
    <Section title={t('stealth.title')} hint={t('stealth.periodHint')}>
      <dl className="stats">
        {stats.map((stat) => (
          <div key={stat.key} className="stat card">
            <dt>{stat.label}</dt>
            <dd className="stat-value">
              {stat.value}
              {stat.flag}
            </dd>
            <dd className="stat-hint">{stat.hint}</dd>
          </div>
        ))}
      </dl>
      <div className="charts">
        <DailyChart
          title={t('chart.stealthGames')}
          points={points}
          kind="bar"
          note={t('chart.total', { total: formatNumber(lang, total) })}
        />
      </div>
    </Section>
  );
}
