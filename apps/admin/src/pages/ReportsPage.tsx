import {
  ADMIN_REPORT_FILTERS,
  type AdminReport,
  type AdminReportedPlayer,
  type AdminReportFilter,
  REPORT_REASONS,
  REPORT_RESPONSE_HOURS,
} from '@sudoku-fight/protocol';
import { useCallback, useId } from 'react';

import { AvatarImg } from '../components/AvatarImg';
import { type Column, DataTable } from '../components/DataTable';
import {
  AccountActions,
  Actor,
  ModerationBadges,
  type ModerationAction,
  ReportActions,
  useModeration,
} from '../components/moderation';
import { AsyncView, Empty, Ltr, Num, PageHeader, Pager, RelativeTime, Select } from '../components/ui';
import { useApi, useAsync, useNow } from '../data';
import { formatNumber, shortId } from '../format';
import { useI18n } from '../i18n';
import { navigate, routeHref } from '../router';

/** Reported players per page: each comes with up to ADMIN_REPORTS_PER_PLAYER reports. */
export const REPORTS_PAGE_SIZE = 20;

const HOUR = 3_600_000;

/**
 * Spec §3.5 and §27.3 "דיווחים": the reports players sent, grouped by the reported player (the most reported
 * first), with the reasons and their counts, who reported and when, and the actions: close a report as
 * resolved or dismissed, reset the player's name, suspend the account or lift the suspension.
 * An open report waiting longer than REPORT_RESPONSE_HOURS (the promise in the terms of use) is flagged: the
 * server says when the player's oldest open report came (oldestOpenAt), even when it is not among the reports
 * listed. The server puts the players with the most different reporters first.
 */
export function ReportsPage({ status, page }: { status: AdminReportFilter; page: number }) {
  const { t, label } = useI18n();
  const api = useApi();
  const load = useCallback(
    () => api.reports({ status, page, pageSize: REPORTS_PAGE_SIZE }),
    [api, status, page],
  );
  const result = useAsync(load);
  const moderation = useModeration({ reload: result.reload, loading: result.loading });
  const title = t('reports.title');

  return (
    <>
      <PageHeader title={title} docTitle={title}>
        <p className="lede">{t('reports.intro', { hours: REPORT_RESPONSE_HOURS })}</p>
        <div className="toolbar">
          <Select
            label={t('reports.filter')}
            value={status}
            options={ADMIN_REPORT_FILTERS.map((f) => ({ value: f, label: label('reportFilter', f) }))}
            onChange={(s) => navigate({ name: 'reports', status: s, page: 1 })}
          />
        </div>
      </PageHeader>
      {moderation.notice}
      <AsyncView result={result}>
        {(data) => (
          <>
            {data.items.length === 0 ? (
              <Empty>{status === 'open' ? t('reports.empty') : t('reports.emptyFilter')}</Empty>
            ) : (
              <ul className="report-groups" aria-label={t('reports.list')}>
                {data.items.map((group) => (
                  <li key={group.player.id}>
                    <ReportGroup group={group} filter={status} busy={result.loading} onAsk={moderation.ask} />
                  </li>
                ))}
              </ul>
            )}
            {(data.total > 0 || data.page > 1) && (
              <Pager
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                onPage={(p) => navigate({ name: 'reports', status, page: p })}
              />
            )}
          </>
        )}
      </AsyncView>
      {moderation.dialog}
    </>
  );
}

function ReportGroup({
  group,
  filter,
  busy,
  onAsk,
}: {
  group: AdminReportedPlayer;
  filter: AdminReportFilter;
  busy: boolean;
  onAsk: (action: ModerationAction) => void;
}) {
  const { t, lang, label } = useI18n();
  const now = useNow();
  const headingId = useId();
  const { player, counts, reports } = group;
  const deleted = player.deletedAt !== null;
  const name = player.displayName;
  const shownName = name ?? t('mod.deletedAccount');

  // The oldest open report may be past the ADMIN_REPORTS_PER_PLAYER listed: the server says when it came.
  const oldestOpen = group.oldestOpenAt;
  const overdue = oldestOpen !== null && now - oldestOpen > REPORT_RESPONSE_HOURS * HOUR;
  // The first report is known only when every matching report is here (at most ADMIN_REPORTS_PER_PLAYER).
  const complete = reports.length >= counts.total;
  const first = complete && reports.length > 0 ? Math.min(...reports.map((r) => r.createdAt)) : null;
  const anyOpen = reports.some((r) => r.status === 'open');

  const columns: Column<AdminReport>[] = [
    { id: 'when', header: t('col.when'), cell: (r) => <RelativeTime ms={r.createdAt} /> },
    { id: 'reason', header: t('col.reason'), cell: (r) => label('reason', r.reason) },
    {
      id: 'reporter',
      header: t('col.reporter'),
      cell: (r) => (
        <a href={routeHref({ name: 'user', id: r.reporter.id })}>
          <bdi>{r.reporter.displayName ?? t('mod.deletedAccount')}</bdi>
        </a>
      ),
    },
    {
      id: 'game',
      header: t('col.game'),
      cell: (r) =>
        r.gameId === null ? (
          <span className="muted">{t('common.none')}</span>
        ) : (
          <a href={routeHref({ name: 'game', id: r.gameId })}>
            <Ltr className="mono">{shortId(r.gameId)}</Ltr>
          </a>
        ),
    },
    // With the "open" filter every row is open: the column would say nothing.
    ...(filter === 'open'
      ? []
      : [
          {
            id: 'status',
            header: t('col.reportStatus'),
            cell: (r: AdminReport) => <ReportStatusCell report={r} />,
          },
        ]),
    ...(anyOpen
      ? [
          {
            id: 'actions',
            header: t('col.actions'),
            cell: (r: AdminReport) => (
              <ReportActions report={r} player={name} disabled={busy} onAsk={onAsk} />
            ),
          },
        ]
      : []),
  ];

  return (
    <article className="card report-group" aria-labelledby={headingId}>
      <header className="report-group-head">
        <div className="report-player">
          <AvatarImg id={player.avatarId} size={44} decorative />
          <div>
            <h2 id={headingId} className="report-player-name">
              <a href={routeHref({ name: 'user', id: player.id })}>
                <bdi>{shownName}</bdi>
              </a>
            </h2>
            <div className="report-player-meta">
              {name === null && <Ltr className="mono muted">{shortId(player.id)}</Ltr>}
              <ModerationBadges
                deleted={deleted}
                suspended={player.suspendedAt !== null}
                nameReset={player.nameResetRequired}
                persona={player.persona ?? false}
              />
              {overdue && (
                <span className="badge badge-stop">
                  {t('reports.overdue', { hours: formatNumber(lang, REPORT_RESPONSE_HOURS) })}
                </span>
              )}
            </div>
          </div>
        </div>
        <AccountActions
          user={{
            id: player.id,
            name,
            suspended: player.suspendedAt !== null,
            deleted,
            persona: player.persona ?? false,
          }}
          disabled={busy}
          onAsk={onAsk}
        />
      </header>

      <dl className="facts report-summary">
        <div className="fact">
          <dt>{t('reports.reasons')}</dt>
          <dd>
            <ul className="reason-counts">
              {REPORT_REASONS.map((reason) => (
                <li key={reason} className={counts[reason] === 0 ? 'chip muted' : 'chip'}>
                  {label('reason', reason)} <Num value={counts[reason]} />
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div className="fact">
          <dt>{t('reports.total')}</dt>
          <dd>
            <Num value={counts.total} />
          </dd>
        </div>
        <div className="fact">
          <dt>{t('reports.reporters')}</dt>
          <dd>
            <Num value={counts.reporters} />
          </dd>
        </div>
        <div className="fact">
          <dt>{t('reports.open')}</dt>
          <dd>
            <Num value={group.open} />
          </dd>
        </div>
        {first !== null && (
          <div className="fact">
            <dt>{t('reports.first')}</dt>
            <dd>
              <RelativeTime ms={first} />
            </dd>
          </div>
        )}
        <div className="fact">
          <dt>{t('reports.last')}</dt>
          <dd>
            <RelativeTime ms={group.lastReportedAt} />
          </dd>
        </div>
      </dl>

      <DataTable
        caption={t('reports.table', { name: shownName })}
        columns={columns}
        rows={reports}
        rowKey={(r) => r.id}
      />
      {!complete && (
        <p className="hint report-more">
          {t('reports.shown', {
            shown: formatNumber(lang, reports.length),
            total: formatNumber(lang, counts.total),
          })}
        </p>
      )}
    </article>
  );
}

/** Open, or resolved / dismissed by whom and when. */
function ReportStatusCell({ report }: { report: AdminReport }) {
  const { label } = useI18n();
  const word = label('reportStatus', report.status);
  if (report.status === 'open') return <span className="badge badge-stop">{word}</span>;
  return (
    <span className="report-closed">
      <span className="badge">{word}</span>
      {report.resolvedBy !== null && (
        <span className="muted">
          <Actor who={report.resolvedBy} />
        </span>
      )}
      {report.resolvedAt !== null && (
        <span className="muted">
          <RelativeTime ms={report.resolvedAt} />
        </span>
      )}
    </span>
  );
}
