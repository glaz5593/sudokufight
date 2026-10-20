import { ADMIN_DEFAULT_PAGE_SIZE, type AdminStealthSwitch, type AdminUserRow } from '@sudoku-fight/protocol';
import { type ReactNode, useCallback, useState } from 'react';

import { AvatarImg } from '../components/AvatarImg';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { type Column, DataTable } from '../components/DataTable';
import { Actor, ModerationBadges } from '../components/moderation';
import {
  AsyncView,
  DateTime,
  Empty,
  Facts,
  Num,
  PageHeader,
  Pager,
  SearchForm,
  Section,
} from '../components/ui';
import { useApi, useAsync } from '../data';
import { Rich, useI18n } from '../i18n';
import { navigate, routeHref } from '../router';

/**
 * The stealth bot (stealth-bot.md §8) [D90] "בוט סמוי": its switch, and the personas the server made for it.
 *
 * - The switch: on or off, when and by whom it was last turned, and a button that turns it, after a
 *   confirmation, written to the audit log. Off stops new stealth bots at once; the games already running end
 *   as usual; no restart. On a server whose settings leave the bot out (STEALTH_BOT_ENABLED false) there is no
 *   switch, only a line that says so.
 * - The personas: the users of kind 'persona' (GET /users?kind=persona), with a search and pages: name,
 *   country, since when, games, best rating, open reports. Each opens its user page (reports, suspension, a
 *   name reset that gives it a new invented name).
 * - Its numbers are on the overview; its games on the games page, filtered.
 */
export function StealthPage({ search, page }: { search: string; page: number }) {
  const { t } = useI18n();
  const title = t('stealth.title');
  return (
    <>
      <PageHeader title={title} docTitle={title}>
        <p className="lede">{t('stealth.intro')}</p>
        <p className="lede">
          <a href={routeHref({ name: 'overview' })}>{t('stealth.toOverview')}</a>
          {' · '}
          <a href={routeHref({ name: 'games', stealth: '1' })}>{t('stealth.toGames')}</a>
        </p>
      </PageHeader>
      <SwitchSection />
      <PersonasSection search={search} page={page} />
    </>
  );
}

function SwitchSection() {
  const { t } = useI18n();
  const api = useApi();
  const load = useCallback(() => api.stealthSwitch(), [api]);
  const result = useAsync(load);
  const [asking, setAsking] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<ReactNode>(null);

  return (
    <Section title={t('stealth.switch')} hint={t('stealth.switchHint')}>
      {/* Always there (empty without a message), so screen readers hear each new one. */}
      <div className={notice === null ? 'notice-slot' : 'notice-slot notice'}>
        <p className="notice-text" role="status">
          {notice}
        </p>
      </div>
      <AsyncView result={result}>
        {(state) => <SwitchBody state={state} busy={result.loading} onAsk={(on) => setAsking(on)} />}
      </AsyncView>
      {asking !== null && (
        <ConfirmDialog
          title={t(asking ? 'confirm.stealthOn.title' : 'confirm.stealthOff.title')}
          confirmLabel={t(asking ? 'confirm.stealthOn.confirm' : 'confirm.stealthOff.confirm')}
          danger={asking}
          onClose={() => setAsking(null)}
          onConfirm={async () => {
            const { switch: after, audit } = await api.setStealth(asking);
            setNotice(
              t(audit === null ? 'done.stealthNoChange' : after.on ? 'done.stealthOn' : 'done.stealthOff'),
            );
            // The dialog gives the focus back to the button, which stays (its words change).
            setAsking(null);
            result.reload();
          }}
          onFailed={(error) => {
            // The server has no switch after all (its settings changed): show what it says now.
            if (error.code === 'stealthDisabled') result.reload();
          }}
        >
          <p>{t(asking ? 'confirm.stealthOn.body' : 'confirm.stealthOff.body')}</p>
        </ConfirmDialog>
      )}
    </Section>
  );
}

function SwitchBody({
  state,
  busy,
  onAsk,
}: {
  state: AdminStealthSwitch;
  busy: boolean;
  onAsk: (on: boolean) => void;
}) {
  const { t } = useI18n();
  if (!state.enabled) return <Empty>{t('stealth.unavailable')}</Empty>;
  const changed =
    state.changedAt === null ? (
      t('stealth.never')
    ) : (
      <Rich
        k="stealth.changedBy"
        nodes={{
          when: <DateTime ms={state.changedAt} />,
          who: state.changedBy === null ? t('common.none') : <Actor who={state.changedBy} />,
        }}
      />
    );
  return (
    <>
      <Facts
        items={[
          {
            label: t('stealth.state'),
            value: <span className="stealth-state">{t(state.on ? 'stealth.on' : 'stealth.off')}</span>,
          },
          { label: t('stealth.changed'), value: changed },
        ]}
      />
      <div className="section-actions">
        {/* One button that changes its words, so it keeps the focus across the change. */}
        <button
          type="button"
          className={state.on ? 'btn btn-sm' : 'btn btn-sm btn-danger-outline'}
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) onAsk(!state.on);
          }}
        >
          {t(state.on ? 'action.stealthOff' : 'action.stealthOn')}
        </button>
      </div>
    </>
  );
}

function PersonasSection({ search, page }: { search: string; page: number }) {
  const { t } = useI18n();
  const api = useApi();
  const load = useCallback(
    () => api.users({ kind: 'persona', search, page, pageSize: ADMIN_DEFAULT_PAGE_SIZE }),
    [api, search, page],
  );
  const result = useAsync(load);

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
          />
        </>
      ),
    },
    { id: 'country', header: t('col.country'), cell: (u) => u.country ?? t('common.none') },
    { id: 'joined', header: t('col.joined'), cell: (u) => <DateTime ms={u.createdAt} /> },
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
    <Section title={t('stealth.personas')} hint={t('stealth.personasHint')}>
      <div className="toolbar">
        <SearchForm
          key={search}
          label={t('stealth.search')}
          value={search}
          onSearch={(s) => navigate({ name: 'stealth', search: s, page: 1 })}
        />
      </div>
      <AsyncView result={result}>
        {(data) => (
          <>
            {data.items.length === 0 ? (
              <Empty>{search ? t('stealth.noMatch') : t('stealth.personasEmpty')}</Empty>
            ) : (
              <DataTable
                caption={t('stealth.personas')}
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
                onPage={(p) => navigate({ name: 'stealth', search, page: p })}
              />
            )}
          </>
        )}
      </AsyncView>
    </Section>
  );
}
