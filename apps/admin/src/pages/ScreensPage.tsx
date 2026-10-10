import type { AdminScreens, AdminScreenStat } from '@sudoku-fight/protocol';
import { useCallback, useState } from 'react';

import { type Column, DataTable, type Sort } from '../components/DataTable';
import { AsyncView, DaysSelect, Empty, Ltr, Num, PageHeader } from '../components/ui';
import { useApi, useAsync } from '../data';
import { formatNumber, formatPercent } from '../format';
import { Rich, useI18n } from '../i18n';
import { navigate } from '../router';

/** Spec §27.3 "מסכים": views per screen, and the screens where people stop. */
export function ScreensPage({ days }: { days: number }) {
  const { t } = useI18n();
  const api = useApi();
  const load = useCallback(() => api.screens(days), [api, days]);
  const result = useAsync(load);
  const title = t('screens.title');

  return (
    <>
      <PageHeader title={title} docTitle={title}>
        <div className="toolbar">
          <DaysSelect days={days} onChange={(d) => navigate({ name: 'screens', days: d })} />
        </div>
      </PageHeader>
      <AsyncView result={result}>{(data) => <ScreensBody data={data} />}</AsyncView>
    </>
  );
}

type SortKey = 'screen' | 'views' | 'installs' | 'exits' | 'exitRate' | 'lastScreenOfGone';

const SORT_KEYS: readonly string[] = [
  'screen',
  'views',
  'installs',
  'exits',
  'exitRate',
  'lastScreenOfGone',
] satisfies SortKey[];

export function sortScreens(rows: readonly AdminScreenStat[], sort: Sort): AdminScreenStat[] {
  const key = (SORT_KEYS.includes(sort.column) ? sort.column : 'views') as SortKey;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = key === 'screen' ? a.screen.localeCompare(b.screen) : a[key] - b[key];
    // Ties: more views first, then by name, so the order never jumps between reloads.
    return primary !== 0 ? sign * primary : b.views - a.views || a.screen.localeCompare(b.screen);
  });
}

function ScreensBody({ data }: { data: AdminScreens }) {
  const { t, lang } = useI18n();
  const [sort, setSort] = useState<Sort>({ column: 'views', dir: 'desc' });

  const stopMax = data.screens.reduce((m, s) => Math.max(m, s.lastScreenOfGone), 0);
  const stopScreens = stopMax > 0 ? data.screens.filter((s) => s.lastScreenOfGone === stopMax) : [];
  const isStop = (s: AdminScreenStat) => stopMax > 0 && s.lastScreenOfGone === stopMax;

  const columns: Column<AdminScreenStat>[] = [
    {
      id: 'screen',
      header: t('col.screen'),
      sortable: true,
      cell: (s) => (
        <>
          <Ltr className="mono">{s.screen}</Ltr>
          {isStop(s) && <span className="badge badge-stop">{t('screens.stopBadge')}</span>}
        </>
      ),
    },
    {
      id: 'views',
      header: t('col.views'),
      numeric: true,
      sortable: true,
      cell: (s) => <Num value={s.views} />,
    },
    {
      id: 'installs',
      header: t('col.installs'),
      numeric: true,
      sortable: true,
      cell: (s) => <Num value={s.installs} />,
    },
    {
      id: 'exits',
      header: t('col.exits'),
      numeric: true,
      sortable: true,
      cell: (s) => <Num value={s.exits} />,
    },
    {
      id: 'exitRate',
      header: t('col.exitRate'),
      sortable: true,
      cell: (s) => {
        const pct = Math.min(1, Math.max(0, s.exitRate));
        return (
          <span className="meter-cell">
            <span className="meter" aria-hidden="true">
              <span className="meter-fill" style={{ inlineSize: `${pct * 100}%` }} />
            </span>
            <span className="num">{formatPercent(lang, pct)}</span>
          </span>
        );
      },
    },
    {
      id: 'lastScreenOfGone',
      header: t('col.lastOfGone'),
      numeric: true,
      sortable: true,
      cell: (s) => <Num value={s.lastScreenOfGone} />,
    },
  ];

  const onSort = (column: string) =>
    setSort((prev) =>
      prev.column === column
        ? { column, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { column, dir: column === 'screen' ? 'asc' : 'desc' },
    );

  return (
    <>
      <p className="hint">
        {t('screens.summary', {
          sessions: formatNumber(lang, data.sessions),
          gap: formatNumber(lang, data.sessionGapMinutes),
          gone: formatNumber(lang, data.goneAfterDays),
        })}
      </p>
      {data.screens.length === 0 ? (
        <Empty>{t('screens.empty')}</Empty>
      ) : (
        <>
          <div className={stopScreens.length > 0 ? 'callout callout-stop' : 'callout'}>
            {stopScreens.length > 0 ? (
              <Rich
                k="screens.stop"
                nodes={{
                  screen: stopScreens.map((s, i) => (
                    <span key={s.screen}>
                      {i > 0 && ', '}
                      <Ltr className="mono">{s.screen}</Ltr>
                    </span>
                  )),
                  count: formatNumber(lang, stopMax),
                }}
              />
            ) : (
              t('screens.noStop')
            )}
          </div>
          <DataTable
            caption={t('screens.title')}
            columns={columns}
            rows={sortScreens(data.screens, sort)}
            rowKey={(s) => s.screen}
            rowClassName={(s) => (isStop(s) ? 'row-stop' : undefined)}
            sort={sort}
            onSort={onSort}
          />
        </>
      )}
    </>
  );
}
