import type { AdminGameDetail, AdminGameEvent, AdminGamePlayer } from '@sudoku-fight/protocol';
import { useCallback } from 'react';

import { type Column, DataTable } from '../components/DataTable';
import { StealthBadge } from '../components/moderation';
import {
  AsyncView,
  DateTime,
  Empty,
  Facts,
  JsonValue,
  Ltr,
  Num,
  PageHeader,
  RatingChange,
  Seat,
  Section,
  usePlayerStatus,
} from '../components/ui';
import { useApi, useAsync } from '../data';
import { formatDuration, formatOffset, shortId } from '../format';
import { Rich, useI18n } from '../i18n';
import { routeHref } from '../router';
import { isolate } from '../strings';
import { playerName } from './GamesPage';

/** Spec §27.3: one game, its players (score, place, rating) and its event log. */
export function GameDetailPage({ id }: { id: string }) {
  const { t } = useI18n();
  const api = useApi();
  const load = useCallback(() => api.game(id), [api, id]);
  const result = useAsync(load);

  return (
    <>
      <PageHeader
        title={<Rich k="game.title" nodes={{ id: <Ltr className="mono">{shortId(id)}</Ltr> }} />}
        docTitle={t('game.title', { id: isolate(shortId(id)) })}
        back={{ href: routeHref({ name: 'games' }), label: t('game.back') }}
      />
      <AsyncView result={result}>{(data) => <GameBody data={data} />}</AsyncView>
    </>
  );
}

/** Above this, an event time is a wall-clock time (epoch ms, after 2001), not a game-clock offset. */
const EPOCH_MS = 1e12;

/**
 * The log shows time since the start. The server stores wall-clock times (epoch ms), and events before the
 * start (the countdown) come out negative; a small value is already an offset.
 */
export function sinceStart(tMs: number, startedAt: number): number {
  return tMs > EPOCH_MS ? tMs - startedAt : tMs;
}

function GameBody({ data }: { data: AdminGameDetail }) {
  const { t, label } = useI18n();
  const playerStatus = usePlayerStatus();
  const none = <span className="muted">{t('common.none')}</span>;

  const playerColumns: Column<AdminGamePlayer>[] = [
    {
      id: 'seat',
      header: t('col.seat'),
      cell: (p) => (
        <span className="player">
          <Seat seat={p.seat} />
          {p.userId ? (
            <a href={routeHref({ name: 'user', id: p.userId })}>
              <bdi>{playerName(p, t('games.bot'))}</bdi>
            </a>
          ) : (
            playerName(p, t('games.bot'))
          )}
          {p.persona && <StealthBadge label={t('mod.persona')} />}
        </span>
      ),
    },
    { id: 'place', header: t('col.place'), numeric: true, cell: (p) => <Num value={p.place} /> },
    {
      id: 'score',
      header: t('col.score'),
      numeric: true,
      cell: (p) => <Num value={p.finalScore} digits={1} />,
    },
    { id: 'mistakes', header: t('col.mistakes'), numeric: true, cell: (p) => <Num value={p.mistakes} /> },
    { id: 'status', header: t('col.status'), cell: (p) => playerStatus(p.status, data.endedAt !== null) },
    {
      id: 'rating',
      header: t('col.ratingChange'),
      cell: (p) => <RatingChange before={p.ratingBefore} after={p.ratingAfter} />,
    },
  ];

  const eventColumns: Column<AdminGameEvent>[] = [
    { id: 'seq', header: t('col.seq'), numeric: true, cell: (e) => <Num value={e.seq} /> },
    {
      id: 'time',
      header: t('col.time'),
      numeric: true,
      cell: (e) => <bdi className="num">{formatOffset(sinceStart(e.tMs, data.startedAt))}</bdi>,
    },
    { id: 'type', header: t('col.event'), cell: (e) => <Ltr className="mono">{e.type}</Ltr> },
    {
      id: 'payload',
      header: t('col.payload'),
      cell: (e) => <JsonValue value={e.payload} />,
    },
  ];

  const players = [...data.players].sort((a, b) => a.seat - b.seat);

  return (
    <>
      <Section title={t('common.details')}>
        <Facts
          items={[
            { label: t('col.id'), value: <Ltr className="mono">{data.id}</Ltr> },
            {
              label: t('col.mode'),
              value: (
                <>
                  {label('mode', data.mode)}
                  {data.stealth && <StealthBadge label={t('games.stealth')} />}
                </>
              ),
            },
            { label: t('col.type'), value: label('gameType', data.gameType) },
            { label: t('col.players'), value: <Num value={data.playerCount} /> },
            { label: t('col.puzzle'), value: <Ltr className="mono">{data.puzzleId}</Ltr> },
            { label: t('col.started'), value: <DateTime ms={data.startedAt} /> },
            { label: t('col.ended'), value: <DateTime ms={data.endedAt} /> },
            {
              label: t('col.duration'),
              value:
                data.endedAt === null ? (
                  <span className="badge">{t('games.running')}</span>
                ) : (
                  <bdi className="num">{formatDuration(data.endedAt - data.startedAt)}</bdi>
                ),
            },
            { label: t('col.endReason'), value: data.endReason ? label('endReason', data.endReason) : none },
          ]}
        />
      </Section>

      <Section title={t('game.players')}>
        <DataTable
          caption={t('game.players')}
          columns={playerColumns}
          rows={players}
          rowKey={(p) => String(p.seat)}
        />
      </Section>

      <Section title={t('game.events')}>
        {data.events.length === 0 ? (
          <Empty>{t('game.noEvents')}</Empty>
        ) : (
          <DataTable
            caption={t('game.events')}
            columns={eventColumns}
            rows={data.events}
            rowKey={(e) => String(e.seq)}
          />
        )}
      </Section>

      <details className="raw">
        <summary>{t('game.rules')}</summary>
        <pre dir="ltr" className="mono">
          {JSON.stringify(data.rules, null, 2)}
        </pre>
      </details>
    </>
  );
}
