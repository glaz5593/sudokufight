import type { AdminEventRow, AdminInstallDetail } from '@sudoku-fight/protocol';
import { Fragment, useCallback } from 'react';

import { type Column, DataTable } from '../components/DataTable';
import {
  AsyncView,
  DateTime,
  Empty,
  Facts,
  JsonValue,
  Ltr,
  Num,
  PageHeader,
  RelativeTime,
  Section,
} from '../components/ui';
import { useApi, useAsync } from '../data';
import { formatDateTime, formatDuration, formatNumber, shortId } from '../format';
import { Rich, useI18n } from '../i18n';
import { routeHref } from '../router';
import { isolate } from '../strings';

/** One install: its facts, its sessions as screen paths, and its latest events. */
export function InstallDetailPage({ id }: { id: string }) {
  const { t } = useI18n();
  const api = useApi();
  const load = useCallback(() => api.install(id), [api, id]);
  const result = useAsync(load);

  return (
    <>
      <PageHeader
        title={<Rich k="install.title" nodes={{ id: <Ltr className="mono">{shortId(id)}</Ltr> }} />}
        docTitle={t('install.title', { id: isolate(shortId(id)) })}
        back={{ href: routeHref({ name: 'installs' }), label: t('install.back') }}
      />
      <AsyncView result={result}>{(data) => <InstallBody data={data} />}</AsyncView>
    </>
  );
}

function InstallBody({ data }: { data: AdminInstallDetail }) {
  const { t, lang, label } = useI18n();

  const eventColumns: Column<AdminEventRow>[] = [
    { id: 'tClient', header: t('col.tClient'), cell: (e) => <DateTime ms={e.tClient} /> },
    { id: 'event', header: t('col.event'), cell: (e) => <Ltr className="mono">{e.name}</Ltr> },
    {
      id: 'props',
      header: t('col.props'),
      cell: (e) => <JsonValue value={e.props} />,
    },
    { id: 'tServer', header: t('col.tServer'), cell: (e) => <RelativeTime ms={e.tServer} /> },
  ];

  return (
    <>
      <Section title={t('common.details')}>
        <Facts
          items={[
            { label: t('col.id'), value: <Ltr className="mono">{data.id}</Ltr> },
            { label: t('col.platform'), value: label('platform', data.platform) },
            { label: t('col.version'), value: <Ltr className="mono">{data.appVersion}</Ltr> },
            { label: t('col.firstSeen'), value: <DateTime ms={data.firstSeen} /> },
            { label: t('col.lastSeen'), value: <RelativeTime ms={data.lastSeen} /> },
            {
              label: t('col.user'),
              value: data.userId ? (
                <a href={routeHref({ name: 'user', id: data.userId })}>
                  <bdi>{data.userName ?? shortId(data.userId)}</bdi>
                </a>
              ) : (
                <span className="muted">{t('installs.noAccount')}</span>
              ),
            },
            { label: t('col.events'), value: <Num value={data.events} /> },
          ]}
        />
      </Section>

      <Section title={t('install.sessions')} hint={t('install.sessionsHint')}>
        {data.sessions.length === 0 ? (
          <Empty>{t('install.noSessions')}</Empty>
        ) : (
          <ol className="sessions">
            {data.sessions.map((s) => (
              <li key={s.startedAt} className="session card">
                <div className="session-head">
                  {t('install.session', {
                    start: formatDateTime(lang, s.startedAt),
                    duration: isolate(formatDuration(s.endedAt - s.startedAt)),
                    count: formatNumber(lang, s.screens.length),
                  })}
                </div>
                <ol className="path" aria-label={t('install.path')}>
                  {s.screens.map((screen, i) => (
                    <Fragment key={i}>
                      {i > 0 && (
                        <li className="path-sep" aria-hidden="true">
                          {t('common.arrow')}
                        </li>
                      )}
                      <li className="chip">
                        <Ltr className="mono">{screen}</Ltr>
                      </li>
                    </Fragment>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title={t('install.events')}>
        {data.recentEvents.length === 0 ? (
          <Empty>{t('install.noEvents')}</Empty>
        ) : (
          <DataTable
            caption={t('install.events')}
            columns={eventColumns}
            rows={data.recentEvents}
            rowKey={(e) => e.id}
          />
        )}
      </Section>
    </>
  );
}
