import type { AdminFriendRoomRow, AdminFriendRooms } from '@sudoku-fight/protocol';
import { useCallback } from 'react';

import { DailyChart } from '../components/DailyChart';
import { type Column, DataTable } from '../components/DataTable';
import { AsyncView, DateTime, DaysSelect, Empty, Ltr, PageHeader, Section } from '../components/ui';
import { useApi, useAsync, useNow } from '../data';
import { fillDays, formatDuration, formatNumber, localDay } from '../format';
import { type I18n, useI18n } from '../i18n';
import { navigate, routeHref } from '../router';

/**
 * Friends rooms (1.0.4; friends-room.md §7.5) "חדרים": the rooms open right now, as the server holds them
 * (when each opened, lobby or playing, the game type, seats taken of 4, the host, how long it has been open),
 * and the games played with friends per day over the period. Never a room's code: an admin sees the room, not
 * the key into it (the server sends none).
 */
export function RoomsPage({ days }: { days: number }) {
  const { t } = useI18n();
  const api = useApi();
  const load = useCallback(() => api.friendRooms(days), [api, days]);
  const result = useAsync(load);
  const title = t('rooms.title');

  return (
    <>
      <PageHeader title={title} docTitle={title}>
        <div className="toolbar">
          <DaysSelect days={days} onChange={(d) => navigate({ name: 'rooms', days: d })} />
        </div>
      </PageHeader>
      <AsyncView result={result}>{(data) => <RoomsBody data={data} />}</AsyncView>
    </>
  );
}

/**
 * The open rooms in words: the total, "2 בהמתנה · 1 במשחק" (the overview's card) and "חדרי חברים פתוחים: 3
 * (2 בהמתנה, 1 במשחק)" (this page).
 */
export function roomCounts(
  { t, lang }: Pick<I18n, 't' | 'lang'>,
  { lobby, playing }: AdminFriendRooms['counts'],
): { total: string; hint: string; summary: string } {
  const vars = {
    total: formatNumber(lang, lobby + playing),
    lobby: formatNumber(lang, lobby),
    playing: formatNumber(lang, playing),
  };
  return { total: vars.total, hint: t('rooms.countsHint', vars), summary: t('rooms.summary', vars) };
}

function RoomsBody({ data }: { data: AdminFriendRooms }) {
  const i18n = useI18n();
  const { t, lang, label } = i18n;
  const now = useNow();
  const today = localDay(now);
  const counts = roomCounts(i18n, data.counts);

  const columns: Column<AdminFriendRoomRow>[] = [
    { id: 'opened', header: t('col.roomOpened'), cell: (r) => <DateTime ms={r.openedAt} /> },
    {
      id: 'state',
      header: t('col.roomState'),
      cell: (r) => (
        <span className={r.state === 'playing' ? 'badge badge-warn' : 'badge'}>
          {label('roomState', r.state)}
        </span>
      ),
    },
    { id: 'type', header: t('col.type'), cell: (r) => label('gameType', r.gameType) },
    {
      id: 'players',
      header: t('col.players'),
      cell: (r) => (
        <span className="num">
          {t('rooms.seats', {
            players: formatNumber(lang, r.players),
            max: formatNumber(lang, r.maxPlayers),
          })}
        </span>
      ),
    },
    {
      id: 'host',
      header: t('col.host'),
      cell: (r) => (
        <a href={routeHref({ name: 'user', id: r.hostId })}>
          <bdi>{r.hostName}</bdi>
        </a>
      ),
    },
    {
      id: 'openFor',
      header: t('col.openFor'),
      cell: (r) => <bdi className="num">{formatDuration(now - r.openedAt)}</bdi>,
    },
    { id: 'room', header: t('col.room'), cell: (r) => <Ltr className="mono">{r.roomId}</Ltr> },
  ];

  const points = fillDays(data.gamesPerDay, data.days, today);
  const total = points.reduce((sum, p) => sum + p.count, 0);

  return (
    <>
      <Section title={t('rooms.openNow')} hint={t('rooms.openNowHint')}>
        <p className="hint">{counts.summary}</p>
        {data.rooms.length === 0 ? (
          <Empty>{t('rooms.empty')}</Empty>
        ) : (
          <DataTable
            caption={t('rooms.openNow')}
            columns={columns}
            rows={data.rooms}
            rowKey={(r) => r.roomId}
          />
        )}
      </Section>
      <Section title={t('overview.perDay')}>
        <div className="charts">
          <DailyChart
            title={t('chart.friendsGames')}
            points={points}
            kind="bar"
            note={t('chart.total', { total: formatNumber(lang, total) })}
          />
        </div>
      </Section>
    </>
  );
}
