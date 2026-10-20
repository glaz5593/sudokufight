import {
  ADMIN_DEFAULT_PAGE_SIZE,
  ADMIN_USER_KINDS,
  type AdminUserKind,
  type AdminUserRow,
} from '@sudoku-fight/protocol';
import { useCallback } from 'react';

import { AvatarImg } from '../components/AvatarImg';
import { type Column, DataTable } from '../components/DataTable';
import { ModerationBadges } from '../components/moderation';
import {
  AsyncView,
  DateTime,
  Empty,
  Num,
  PageHeader,
  Pager,
  RelativeTime,
  SearchForm,
  Select,
} from '../components/ui';
import { useApi, useAsync } from '../data';
import { useI18n } from '../i18n';
import { DEFAULT_USER_KIND, navigate, routeHref } from '../router';

/**
 * Spec §27.3 "משתמשים": registered users with search, "last seen", games and their best rating, and their
 * moderation state (spec §3.5): suspended, waiting for a new name, open reports. The people by default; the
 * stealth bot's personas (stealth-bot.md §8) with the account-type filter, marked as such.
 */
export function UsersPage({
  search,
  page,
  kind = DEFAULT_USER_KIND,
}: {
  search: string;
  page: number;
  kind?: AdminUserKind;
}) {
  const { t } = useI18n();
  const api = useApi();
  const load = useCallback(
    () => api.users({ kind, search, page, pageSize: ADMIN_DEFAULT_PAGE_SIZE }),
    [api, kind, search, page],
  );
  const result = useAsync(load);
  const title = t('users.title');

  const columns: Column<AdminUserRow>[] = [
    {
      id: 'name',
      header: t('col.name'),
      cell: (u) => (
        <>
          <a className="user-link" href={routeHref({ name: 'user', id: u.id })}>
            <AvatarImg id={u.avatarId} size={28} decorative />
            <bdi>{u.displayName}</bdi>
          </a>
          <ModerationBadges
            deleted={u.deletedAt !== null}
            suspended={(u.suspendedAt ?? null) !== null}
            nameReset={u.nameResetRequired ?? false}
            persona={u.persona ?? false}
          />
        </>
      ),
    },
    {
      id: 'email',
      header: t('col.email'),
      cell: (u) => (u.email ? <bdi>{u.email}</bdi> : <span className="muted">{t('common.none')}</span>),
    },
    { id: 'country', header: t('col.country'), cell: (u) => u.country ?? t('common.none') },
    { id: 'joined', header: t('col.joined'), cell: (u) => <DateTime ms={u.createdAt} /> },
    { id: 'lastSeen', header: t('col.lastSeen'), cell: (u) => <RelativeTime ms={u.lastSeen} /> },
    { id: 'games', header: t('col.games'), numeric: true, cell: (u) => <Num value={u.games} /> },
    {
      id: 'bestRating',
      header: t('col.bestRating'),
      numeric: true,
      cell: (u) => <Num value={u.bestRating} />,
    },
    {
      id: 'openReports',
      header: t('col.openReports'),
      numeric: true,
      cell: (u) => <Num value={u.openReports ?? null} />,
    },
  ];

  return (
    <>
      <PageHeader title={title} docTitle={title}>
        <div className="toolbar">
          <Select
            label={t('users.kind')}
            value={kind}
            options={ADMIN_USER_KINDS.map((k) => ({ value: k, label: t(`userKind.${k}`) }))}
            onChange={(k) => navigate({ name: 'users', kind: k, search, page: 1 })}
          />
          <SearchForm
            key={search}
            label={t('users.search')}
            value={search}
            onSearch={(s) => navigate({ name: 'users', kind, search: s, page: 1 })}
          />
        </div>
      </PageHeader>
      <AsyncView result={result}>
        {(data) => (
          <>
            {data.items.length === 0 ? (
              <Empty>{search || kind !== DEFAULT_USER_KIND ? t('users.noMatch') : t('users.empty')}</Empty>
            ) : (
              <DataTable
                caption={title}
                columns={columns}
                rows={data.items}
                rowKey={(u) => u.id}
                rowHref={(u) => routeHref({ name: 'user', id: u.id })}
              />
            )}
            {(data.total > 0 || data.page > 1) && (
              <Pager
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                onPage={(p) => navigate({ name: 'users', kind, search, page: p })}
              />
            )}
          </>
        )}
      </AsyncView>
    </>
  );
}
