import { ADMIN_DEFAULT_PAGE_SIZE, type AdminInstallRow } from '@sudoku-fight/protocol';
import { useCallback } from 'react';

import { type Column, DataTable } from '../components/DataTable';
import {
  AsyncView,
  DateTime,
  Empty,
  Ltr,
  Num,
  PageHeader,
  Pager,
  RelativeTime,
  SearchForm,
} from '../components/ui';
import { useApi, useAsync } from '../data';
import { shortId } from '../format';
import { type I18n, useI18n } from '../i18n';
import { navigate, routeHref } from '../router';

/** Spec §27.3 "משתמשים והתקנות": every install with "last seen", so you can tell who left (§27.1). */
export function InstallsPage({ search, page }: { search: string; page: number }) {
  const i18n = useI18n();
  const { t } = i18n;
  const api = useApi();
  const load = useCallback(
    () => api.installs({ search, page, pageSize: ADMIN_DEFAULT_PAGE_SIZE }),
    [api, search, page],
  );
  const result = useAsync(load);
  const title = t('installs.title');

  return (
    <>
      <PageHeader title={title} docTitle={title}>
        <div className="toolbar">
          <SearchForm
            key={search}
            label={t('installs.search')}
            value={search}
            onSearch={(s) => navigate({ name: 'installs', search: s, page: 1 })}
          />
        </div>
      </PageHeader>
      <AsyncView result={result}>
        {(data) => (
          <>
            {data.items.length === 0 ? (
              <Empty>{search ? t('installs.noMatch') : t('installs.empty')}</Empty>
            ) : (
              <DataTable
                caption={title}
                columns={installColumns(i18n)}
                rows={data.items}
                rowKey={(r) => r.id}
                rowHref={(r) => routeHref({ name: 'install', id: r.id })}
              />
            )}
            {(data.total > 0 || data.page > 1) && (
              <Pager
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                onPage={(p) => navigate({ name: 'installs', search, page: p })}
              />
            )}
          </>
        )}
      </AsyncView>
    </>
  );
}

/** The install table's columns; the user page lists a user's installs with the same ones. */
export function installColumns({ t, label }: I18n): Column<AdminInstallRow>[] {
  return [
    {
      id: 'id',
      header: t('col.id'),
      cell: (r) => (
        <a href={routeHref({ name: 'install', id: r.id })} title={r.id}>
          <Ltr className="mono">{shortId(r.id)}</Ltr>
        </a>
      ),
    },
    { id: 'platform', header: t('col.platform'), cell: (r) => label('platform', r.platform) },
    { id: 'version', header: t('col.version'), cell: (r) => <Ltr className="mono">{r.appVersion}</Ltr> },
    { id: 'firstSeen', header: t('col.firstSeen'), cell: (r) => <DateTime ms={r.firstSeen} /> },
    { id: 'lastSeen', header: t('col.lastSeen'), cell: (r) => <RelativeTime ms={r.lastSeen} /> },
    {
      id: 'user',
      header: t('col.user'),
      cell: (r) =>
        r.userId ? (
          <a href={routeHref({ name: 'user', id: r.userId })}>
            <bdi>{r.userName ?? shortId(r.userId)}</bdi>
          </a>
        ) : (
          <span className="muted">{t('installs.noAccount')}</span>
        ),
    },
    { id: 'events', header: t('col.events'), numeric: true, cell: (r) => <Num value={r.events} /> },
  ];
}
