import type { AdminCheatFlag, AdminRating, AdminUserDetail, AdminUserGame } from '@sudoku-fight/protocol';
import { useCallback } from 'react';

import { type Column, DataTable } from '../components/DataTable';
import {
  AsyncView,
  DateTime,
  Empty,
  Facts,
  Ltr,
  Num,
  PageHeader,
  RatingChange,
  RelativeTime,
  Section,
  usePlayerStatus,
} from '../components/ui';
import { useApi, useAsync } from '../data';
import { formatNumber, formatPercent } from '../format';
import { useI18n } from '../i18n';
import { routeHref } from '../router';
import { installColumns } from './InstallsPage';

/**
 * Spec §27.3: a user's profile, level and XP (spec §15), ratings, game history and stats, the installs they
 * used, and the anomaly flags of their ranked games (spec §21: for review only).
 */
export function UserDetailPage({ id }: { id: string }) {
  const { t } = useI18n();
  const api = useApi();
  const load = useCallback(() => api.user(id), [api, id]);
  const result = useAsync(load);
  const name = result.data?.id === id ? result.data.displayName : null;

  return (
    <>
      <PageHeader
        title={name === null ? t('user.profile') : <bdi>{name}</bdi>}
        docTitle={name ?? t('user.profile')}
        back={{ href: routeHref({ name: 'users' }), label: t('user.back') }}
      />
      <AsyncView result={result}>{(data) => <UserBody data={data} />}</AsyncView>
    </>
  );
}

function UserBody({ data }: { data: AdminUserDetail }) {
  const i18n = useI18n();
  const { t, lang, label } = i18n;
  const playerStatus = usePlayerStatus();
  const none = <span className="muted">{t('common.none')}</span>;

  const ratingColumns: Column<AdminRating>[] = [
    { id: 'key', header: t('col.ratingKey'), cell: (r) => <Ltr className="mono">{r.key}</Ltr> },
    { id: 'rating', header: t('col.rating'), numeric: true, cell: (r) => <Num value={r.rating} /> },
    { id: 'games', header: t('col.games'), numeric: true, cell: (r) => <Num value={r.games} /> },
    {
      id: 'provisional',
      header: t('col.provisional'),
      cell: (r) => (r.provisional ? t('common.yes') : t('common.no')),
    },
    { id: 'peak', header: t('col.peak'), numeric: true, cell: (r) => <Num value={r.peak} /> },
  ];

  const gameColumns: Column<AdminUserGame>[] = [
    {
      id: 'started',
      header: t('col.started'),
      cell: (g) => (
        <a href={routeHref({ name: 'game', id: g.gameId })}>
          <DateTime ms={g.startedAt} />
        </a>
      ),
    },
    { id: 'mode', header: t('col.mode'), cell: (g) => label('mode', g.mode) },
    { id: 'type', header: t('col.type'), cell: (g) => label('gameType', g.gameType) },
    { id: 'players', header: t('col.players'), numeric: true, cell: (g) => <Num value={g.playerCount} /> },
    { id: 'place', header: t('col.place'), numeric: true, cell: (g) => <Num value={g.place} /> },
    {
      id: 'score',
      header: t('col.score'),
      numeric: true,
      cell: (g) => <Num value={g.finalScore} digits={1} />,
    },
    { id: 'mistakes', header: t('col.mistakes'), numeric: true, cell: (g) => <Num value={g.mistakes} /> },
    { id: 'status', header: t('col.status'), cell: (g) => playerStatus(g.status, g.endedAt !== null) },
    {
      id: 'rating',
      header: t('col.ratingChange'),
      cell: (g) => <RatingChange before={g.ratingBefore} after={g.ratingAfter} />,
    },
  ];

  const flagColumns: Column<AdminCheatFlag>[] = [
    {
      id: 'when',
      header: t('col.time'),
      cell: (f) =>
        f.gameId === null ? (
          <DateTime ms={f.createdAt} />
        ) : (
          <a href={routeHref({ name: 'game', id: f.gameId })}>
            <DateTime ms={f.createdAt} />
          </a>
        ),
    },
    { id: 'reason', header: t('col.reason'), cell: (f) => label('cheat', f.reason) },
    {
      id: 'value',
      header: t('col.value'),
      cell: (f) =>
        f.value === null
          ? none
          : f.reason === 'fastThinking'
            ? t('user.flagSeconds', { n: formatNumber(lang, f.value / 1000, 2) })
            : formatNumber(lang, f.value, 1),
    },
  ];

  const stats: { label: string; value: string }[] = [
    { label: t('stats.level'), value: formatNumber(lang, data.level) },
    { label: t('stats.xp'), value: formatNumber(lang, data.xp) },
    { label: t('stats.games'), value: formatNumber(lang, data.stats.games) },
    { label: t('stats.wins'), value: formatNumber(lang, data.stats.wins) },
    { label: t('stats.losses'), value: formatNumber(lang, data.stats.losses) },
    {
      label: t('stats.winRate'),
      value: data.stats.winRate === null ? t('common.none') : formatPercent(lang, data.stats.winRate),
    },
    {
      label: t('stats.avgMistakes'),
      value:
        data.stats.avgMistakes === null ? t('common.none') : formatNumber(lang, data.stats.avgMistakes, 1),
    },
    {
      label: t('stats.avgScore'),
      value: data.stats.avgScore === null ? t('common.none') : formatNumber(lang, data.stats.avgScore, 1),
    },
  ];

  return (
    <>
      <Section title={t('user.profile')}>
        <Facts
          items={[
            { label: t('col.id'), value: <Ltr className="mono">{data.id}</Ltr> },
            { label: t('col.email'), value: data.email ? <bdi>{data.email}</bdi> : none },
            { label: t('col.country'), value: data.country ?? none },
            {
              label: t('col.avatar'),
              value: data.avatarId ? <Ltr className="mono">{data.avatarId}</Ltr> : none,
            },
            { label: t('col.joined'), value: <DateTime ms={data.createdAt} /> },
            { label: t('col.lastSeen'), value: <RelativeTime ms={data.lastSeen} /> },
            ...(data.deletedAt !== null
              ? [{ label: t('col.deleted'), value: <DateTime ms={data.deletedAt} /> }]
              : []),
          ]}
        />
      </Section>

      <Section title={t('user.stats')}>
        <dl className="stats stats-compact">
          {stats.map((s) => (
            <div key={s.label} className="stat card">
              <dt>{s.label}</dt>
              <dd className="stat-value">{s.value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title={t('user.ratings')}>
        {data.ratings.length === 0 ? (
          <Empty>{t('user.noRatings')}</Empty>
        ) : (
          <DataTable
            caption={t('user.ratings')}
            columns={ratingColumns}
            rows={data.ratings}
            rowKey={(r) => r.key}
          />
        )}
      </Section>

      <Section title={t('user.games')}>
        {data.recentGames.length === 0 ? (
          <Empty>{t('user.noGames')}</Empty>
        ) : (
          <DataTable
            caption={t('user.games')}
            columns={gameColumns}
            rows={data.recentGames}
            rowKey={(g) => g.gameId}
            rowHref={(g) => routeHref({ name: 'game', id: g.gameId })}
          />
        )}
      </Section>

      <Section title={t('user.flags')}>
        {data.cheatFlags.length === 0 ? (
          <Empty>{t('user.noFlags')}</Empty>
        ) : (
          <DataTable
            caption={t('user.flags')}
            columns={flagColumns}
            rows={data.cheatFlags}
            rowKey={(f) => `${f.gameId ?? ''}-${f.reason}-${f.createdAt}`}
          />
        )}
      </Section>

      <Section title={t('user.installs')}>
        {data.installs.length === 0 ? (
          <Empty>{t('user.noInstalls')}</Empty>
        ) : (
          <DataTable
            caption={t('user.installs')}
            columns={installColumns(i18n)}
            rows={data.installs}
            rowKey={(r) => r.id}
            rowHref={(r) => routeHref({ name: 'install', id: r.id })}
          />
        )}
      </Section>
    </>
  );
}
