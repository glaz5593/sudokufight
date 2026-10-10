import { ADMIN_DEFAULT_PAGE_SIZE, type AdminGamePlayer, type AdminGameRow } from '@sudoku-fight/protocol';
import { useCallback } from 'react';

import { type Column, DataTable } from '../components/DataTable';
import { AsyncView, DateTime, Empty, PageHeader, Pager, SearchForm, Seat, Select } from '../components/ui';
import { useApi, useAsync } from '../data';
import { formatDuration, shortId } from '../format';
import { useI18n } from '../i18n';
import { navigate, routeHref } from '../router';

/** The modes a game can have (the engine's GAME_MODES); '' is every mode. */
export const MODE_FILTERS = ['', 'ranked', 'bot', 'solo'] as const;

export function playerName(p: AdminGamePlayer, botLabel: string): string {
  return p.displayName ?? (p.userId ? shortId(p.userId) : botLabel);
}

/** Spec §27.3 "משחקים": the games, newest first, with their players. */
export function GamesPage({ mode, search, page }: { mode: string; search: string; page: number }) {
  const { t, label } = useI18n();
  const api = useApi();
  const load = useCallback(
    () => api.games({ mode, search, page, pageSize: ADMIN_DEFAULT_PAGE_SIZE }),
    [api, mode, search, page],
  );
  const result = useAsync(load);
  const title = t('games.title');

  const modeOptions = (MODE_FILTERS as readonly string[]).includes(mode)
    ? MODE_FILTERS
    : [...MODE_FILTERS, mode];

  const columns: Column<AdminGameRow>[] = [
    {
      id: 'started',
      header: t('col.started'),
      cell: (g) => (
        <a href={routeHref({ name: 'game', id: g.id })}>
          <DateTime ms={g.startedAt} />
        </a>
      ),
    },
    { id: 'mode', header: t('col.mode'), cell: (g) => label('mode', g.mode) },
    { id: 'type', header: t('col.type'), cell: (g) => label('gameType', g.gameType) },
    {
      id: 'players',
      header: t('col.players'),
      cell: (g) => (
        <ul className="players-inline">
          {[...g.players]
            .sort((a, b) => a.seat - b.seat)
            .map((p) => (
              <li key={p.seat}>
                <Seat seat={p.seat} />
                <bdi>{playerName(p, t('games.bot'))}</bdi>
              </li>
            ))}
        </ul>
      ),
    },
    {
      id: 'duration',
      header: t('col.duration'),
      cell: (g) =>
        g.endedAt === null ? (
          <span className="badge">{t('games.running')}</span>
        ) : (
          <bdi className="num">{formatDuration(g.endedAt - g.startedAt)}</bdi>
        ),
    },
    {
      id: 'endReason',
      header: t('col.endReason'),
      cell: (g) => (g.endReason ? label('endReason', g.endReason) : t('common.none')),
    },
  ];

  return (
    <>
      <PageHeader title={title} docTitle={title}>
        <div className="toolbar">
          <Select
            label={t('games.mode')}
            value={mode}
            options={modeOptions.map((m) => ({ value: m, label: m ? label('mode', m) : t('mode.all') }))}
            onChange={(m) => navigate({ name: 'games', mode: m, search, page: 1 })}
          />
          <SearchForm
            key={search}
            label={t('games.search')}
            value={search}
            onSearch={(s) => navigate({ name: 'games', mode, search: s, page: 1 })}
          />
        </div>
      </PageHeader>
      <AsyncView result={result}>
        {(data) => (
          <>
            {data.items.length === 0 ? (
              <Empty>{search || mode ? t('games.noMatch') : t('games.empty')}</Empty>
            ) : (
              <DataTable
                caption={title}
                columns={columns}
                rows={data.items}
                rowKey={(g) => g.id}
                rowHref={(g) => routeHref({ name: 'game', id: g.id })}
              />
            )}
            {(data.total > 0 || data.page > 1) && (
              <Pager
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                onPage={(p) => navigate({ name: 'games', mode, search, page: p })}
              />
            )}
          </>
        )}
      </AsyncView>
    </>
  );
}
