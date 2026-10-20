import { ADMIN_DEFAULT_PAGE_SIZE, type AdminAuditEntry } from '@sudoku-fight/protocol';
import { type ReactNode, useCallback } from 'react';

import { type Column, DataTable } from '../components/DataTable';
import { Actor } from '../components/moderation';
import { AsyncView, DateTime, Empty, Ltr, PageHeader, Pager } from '../components/ui';
import { useApi, useAsync } from '../data';
import { shortId } from '../format';
import { Rich, useI18n } from '../i18n';
import { navigate, routeHref } from '../router';

/**
 * Spec §3.5, §27.3 "יומן פעולות": every moderation action that changed something (admin_audit), newest
 * first: when, which admin (their Google address, or the password sign-in), what, on which player, and the
 * details (a name reset's names, a closed report's reason).
 */
export function AuditPage({ page }: { page: number }) {
  const { t } = useI18n();
  const api = useApi();
  const load = useCallback(() => api.audit({ page, pageSize: ADMIN_DEFAULT_PAGE_SIZE }), [api, page]);
  const result = useAsync(load);
  const title = t('audit.title');

  const columns: Column<AdminAuditEntry>[] = [
    { id: 'when', header: t('col.when'), cell: (e) => <DateTime ms={e.createdAt} /> },
    { id: 'admin', header: t('col.admin'), cell: (e) => <Actor who={e.adminEmail} /> },
    { id: 'action', header: t('col.action'), cell: (e) => <AuditActionLabel action={e.action} /> },
    {
      id: 'player',
      header: t('col.player'),
      cell: (e) =>
        e.targetUserId === null ? (
          <span className="muted">{t('common.none')}</span>
        ) : (
          <a href={routeHref({ name: 'user', id: e.targetUserId })}>
            <Ltr className="mono">{shortId(e.targetUserId)}</Ltr>
          </a>
        ),
    },
    { id: 'details', header: t('col.details'), cell: (e) => <AuditDetails entry={e} /> },
  ];

  return (
    <>
      <PageHeader title={title} docTitle={title}>
        <p className="lede">{t('audit.intro')}</p>
      </PageHeader>
      <AsyncView result={result}>
        {(data) => (
          <>
            {data.items.length === 0 ? (
              <Empty>{t('audit.empty')}</Empty>
            ) : (
              <DataTable caption={title} columns={columns} rows={data.items} rowKey={(e) => e.id} />
            )}
            {(data.total > 0 || data.page > 1) && (
              <Pager
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                onPage={(p) => navigate({ name: 'audit', page: p })}
              />
            )}
          </>
        )}
      </AsyncView>
    </>
  );
}

function AuditActionLabel({ action }: { action: string }) {
  const { label } = useI18n();
  return <>{label('auditAction', action)}</>;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/**
 * resetName: "from X to Y" (gone once the account is deleted; a persona's says it got a new invented name); a
 * closed report: its reason; a suspension the server carried to a new account of a deleted suspended one's
 * sign-in: that account, linked; the stealth bot's switch: on or off.
 */
function AuditDetails({ entry }: { entry: AdminAuditEntry }) {
  const { t, label } = useI18n();
  const none: ReactNode = <span className="muted">{t('common.none')}</span>;
  switch (entry.action) {
    case 'resetName': {
      const from = text(entry.details.fromName);
      const to = text(entry.details.toName);
      if (from === null || to === null) return <span className="muted">{t('audit.namesRemoved')}</span>;
      const k = entry.details.persona === true ? 'audit.personaRenamed' : 'audit.renamed';
      return <Rich k={k} nodes={{ from: <bdi>{from}</bdi>, to: <bdi>{to}</bdi> }} />;
    }
    case 'resolveReport':
    case 'dismissReport': {
      const reason = text(entry.details.reason);
      return reason === null ? none : <>{t('audit.report', { reason: label('reason', reason) })}</>;
    }
    case 'suspend': {
      const previous = text(entry.details.previousUserId);
      if (previous === null) return none;
      return (
        <Rich
          k="audit.carried"
          nodes={{
            account: (
              <a href={routeHref({ name: 'user', id: previous })}>
                <Ltr className="mono">{shortId(previous)}</Ltr>
              </a>
            ),
          }}
        />
      );
    }
    case 'stealthSwitch': {
      const on = entry.details.on;
      if (typeof on !== 'boolean') return none;
      return <>{t(on ? 'audit.stealthOn' : 'audit.stealthOff')}</>;
    }
    default:
      return none;
  }
}
