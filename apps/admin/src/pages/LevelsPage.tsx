import type { AdminGateStat, AdminLevels, AdminLevelStat } from '@sudoku-fight/protocol';
import { type ReactNode, useCallback, useState } from 'react';

import { type Column, DataTable, type Sort } from '../components/DataTable';
import { AsyncView, DaysSelect, Empty, Ltr, Num, PageHeader, Section, Select } from '../components/ui';
import { useApi, useAsync } from '../data';
import { formatNumber, formatPercent } from '../format';
import { Rich, useI18n } from '../i18n';
import { navigate } from '../router';

/**
 * Staged practice (1.0.2, plan §5.5) "שלבים": how each level plays over the period, and where players get
 * stuck at a gate (all time), with the two tuning rules flagged: a level is too hard when more than
 * `tooHardShare` of its first tries get 0 stars; a chapter needs softening when more than `stuckShare` of the
 * players who reached the gate at its end are stuck there after `stuckAttempts` tries. The server sends the
 * thresholds with the numbers; the page only compares.
 */
export function LevelsPage({ days, chapter }: { days: number; chapter: number }) {
  const { t } = useI18n();
  const api = useApi();
  const load = useCallback(() => api.levels(days), [api, days]);
  const result = useAsync(load);
  const title = t('levels.title');

  return (
    <>
      <PageHeader title={title} docTitle={title}>
        <div className="toolbar">
          <DaysSelect days={days} onChange={(d) => navigate({ name: 'levels', days: d, chapter })} />
        </div>
      </PageHeader>
      <AsyncView result={result}>
        {(data) => <LevelsBody data={data} days={days} chapter={chapter} />}
      </AsyncView>
    </>
  );
}

export const isTooHard = (l: AdminLevelStat, share: number): boolean =>
  l.firstTryZeroRate !== null && l.firstTryZeroRate > share;

export const needsSoftening = (g: AdminGateStat, share: number): boolean =>
  g.stuckAfter3Rate !== null && g.stuckAfter3Rate > share;

/** "L014" → 14. */
const numberOf = (l: AdminLevelStat) => Number(l.levelId.slice(1));

type SortKey =
  | 'level'
  | 'starts'
  | 'plays'
  | 'players'
  | 'medianMs'
  | 'replayRate'
  | 'midQuitRate'
  | 'quitRate'
  | 'firstTryZeroRate';

const SORT_KEYS: readonly string[] = [
  'level',
  'starts',
  'plays',
  'players',
  'medianMs',
  'replayRate',
  'midQuitRate',
  'quitRate',
  'firstTryZeroRate',
] satisfies SortKey[];

/** By level by default; by a column, its empty values (null) last either way, ties by level. */
export function sortLevels(rows: readonly AdminLevelStat[], sort: Sort): AdminLevelStat[] {
  const key = (SORT_KEYS.includes(sort.column) ? sort.column : 'level') as SortKey;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'level') return sign * (numberOf(a) - numberOf(b));
    const x = a[key];
    const y = b[key];
    if (x === null || y === null) return x === y ? numberOf(a) - numberOf(b) : x === null ? 1 : -1;
    return sign * (x - y) || numberOf(a) - numberOf(b);
  });
}

/** Callouts name this many levels or chapters at most, then "and N more". */
const CALLOUT_MAX = 12;

/** The page under its header, for an answer of the server (exported for a static render of real data). */
export function LevelsBody({ data, days, chapter }: { data: AdminLevels; days: number; chapter: number }) {
  const { t, lang, label } = useI18n();
  const [sort, setSort] = useState<Sort>({ column: 'level', dir: 'asc' });
  const pct = (ratio: number) => formatPercent(lang, ratio);
  const none = <span className="muted">{t('common.none')}</span>;
  const rate = (ratio: number | null) => (ratio === null ? none : <span className="num">{pct(ratio)}</span>);

  const plays = data.levels.reduce((sum, l) => sum + l.plays, 0);
  const starts = data.levels.reduce((sum, l) => sum + l.starts, 0);
  const anyPlay = plays + starts > 0;
  const chapters = [...new Set(data.levels.map((l) => l.chapter))].sort((a, b) => a - b);
  const current = chapters.includes(chapter) ? chapter : 0;
  const shown = current > 0 ? data.levels.filter((l) => l.chapter === current) : data.levels;
  const tooHard = data.levels.filter((l) => isTooHard(l, data.tooHardShare));
  const reached = data.gates.filter((g) => g.reached > 0);
  const soften = reached.filter((g) => needsSoftening(g, data.stuckShare));

  /** "a, b, c and 3 more". */
  const listOf = (items: { key: string; node: ReactNode }[]) => {
    const head = items.slice(0, CALLOUT_MAX);
    const rest = items.length - head.length;
    return (
      <>
        {head.map((item, i) => (
          <span key={item.key}>
            {i > 0 && ', '}
            {item.node}
          </span>
        ))}
        {rest > 0 && <> {t('levels.more', { count: formatNumber(lang, rest) })}</>}
      </>
    );
  };

  const levelColumns: Column<AdminLevelStat>[] = [
    {
      id: 'level',
      header: t('col.level'),
      sortable: true,
      cell: (l) => (
        <>
          <Ltr className="mono">{l.levelId}</Ltr>
          {l.boss && <span className="badge">{t('levels.boss')}</span>}
          {isTooHard(l, data.tooHardShare) && (
            <span className="badge badge-stop">{t('levels.tooHardBadge')}</span>
          )}
        </>
      ),
    },
    { id: 'chapter', header: t('col.chapter'), numeric: true, cell: (l) => <Num value={l.chapter} /> },
    {
      id: 'kind',
      header: t('col.kind'),
      cell: (l) => (l.kind === null ? none : <span className="kind">{label('levelKind', l.kind)}</span>),
    },
    {
      id: 'starts',
      header: t('col.starts'),
      numeric: true,
      sortable: true,
      cell: (l) => <Num value={l.starts} />,
    },
    {
      id: 'plays',
      header: t('col.plays'),
      numeric: true,
      sortable: true,
      cell: (l) => <Num value={l.plays} />,
    },
    {
      id: 'players',
      header: t('col.players'),
      numeric: true,
      sortable: true,
      cell: (l) => <Num value={l.players} />,
    },
    { id: 'stars', header: t('col.stars'), cell: (l) => <StarsMeter stars={l.stars} /> },
    {
      id: 'medianMs',
      header: t('col.median'),
      numeric: true,
      sortable: true,
      cell: (l) =>
        l.medianMs === null ? (
          none
        ) : (
          <span className="num">{t('levels.seconds', { s: formatNumber(lang, l.medianMs / 1000, 1) })}</span>
        ),
    },
    {
      id: 'replayRate',
      header: t('col.replayRate'),
      numeric: true,
      sortable: true,
      cell: (l) => rate(l.replayRate),
    },
    {
      id: 'midQuitRate',
      header: t('col.midQuitRate'),
      numeric: true,
      sortable: true,
      cell: (l) => rate(l.midQuitRate),
    },
    {
      id: 'quitRate',
      header: t('col.quitRate'),
      numeric: true,
      sortable: true,
      cell: (l) => rate(l.quitRate),
    },
    {
      id: 'firstTryZeroRate',
      header: t('col.firstTryZero'),
      numeric: true,
      sortable: true,
      cell: (l) =>
        l.firstTryZeroRate === null ? (
          none
        ) : (
          <span className="rate-of">
            <span className="num">{pct(l.firstTryZeroRate)}</span>{' '}
            <span className="muted">{t('levels.ofFirstTries', { n: formatNumber(lang, l.firstTries) })}</span>
          </span>
        ),
    },
  ];

  const gateColumns: Column<AdminGateStat>[] = [
    {
      id: 'gate',
      header: t('col.gate'),
      cell: (g) => (
        <>
          {t('levels.gateName', {
            from: formatNumber(lang, g.chapter - 1),
            to: formatNumber(lang, g.chapter),
          })}
          {needsSoftening(g, data.stuckShare) && (
            <span className="badge badge-stop">{t('levels.softenBadge')}</span>
          )}
        </>
      ),
    },
    { id: 'reached', header: t('col.reached'), numeric: true, cell: (g) => <Num value={g.reached} /> },
    { id: 'opened', header: t('col.opened'), numeric: true, cell: (g) => <Num value={g.opened} /> },
    { id: 'stuck', header: t('col.stuck'), numeric: true, cell: (g) => <Num value={g.stuck} /> },
    {
      id: 'stuckAfter3',
      header: t('col.stuckAfter', { n: formatNumber(lang, data.stuckAttempts) }),
      numeric: true,
      cell: (g) => <Num value={g.stuckAfter3} />,
    },
    {
      id: 'stuckAfter3Rate',
      header: t('col.stuckShare'),
      cell: (g) => {
        if (g.stuckAfter3Rate === null) return none;
        const share = Math.min(1, Math.max(0, g.stuckAfter3Rate));
        return (
          <span className="meter-cell">
            <span className="meter" aria-hidden="true">
              <span className="meter-fill" style={{ inlineSize: `${share * 100}%` }} />
            </span>
            <span className="num">{pct(share)}</span>
          </span>
        );
      },
    },
  ];

  const onSort = (column: string) =>
    setSort((prev) =>
      prev.column === column
        ? { column, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { column, dir: column === 'level' ? 'asc' : 'desc' },
    );

  return (
    <>
      <p className="hint">
        {t('levels.summary', {
          plays: formatNumber(lang, plays),
          starts: formatNumber(lang, starts),
          played: formatNumber(lang, data.levels.filter((l) => l.plays > 0).length),
          levels: formatNumber(lang, data.levels.length),
        })}
      </p>
      {anyPlay && (
        <div className={tooHard.length > 0 ? 'callout callout-stop' : 'callout'}>
          {tooHard.length > 0 ? (
            <Rich
              k="levels.tooHard"
              nodes={{
                levels: listOf(
                  tooHard.map((l) => ({
                    key: l.levelId,
                    node: (
                      <>
                        <Ltr className="mono">{l.levelId}</Ltr> (
                        {t('levels.shareOf', {
                          pct: pct(l.firstTryZeroRate ?? 0),
                          n: formatNumber(lang, l.firstTries),
                        })}
                        )
                      </>
                    ),
                  })),
                ),
                share: pct(data.tooHardShare),
              }}
            />
          ) : (
            t('levels.noTooHard', { share: pct(data.tooHardShare) })
          )}
        </div>
      )}
      {reached.length > 0 && (
        <div className={soften.length > 0 ? 'callout callout-stop' : 'callout'}>
          {soften.length > 0 ? (
            <Rich
              k="levels.soften"
              nodes={{
                chapters: listOf(
                  soften.map((g) => ({
                    key: String(g.chapter),
                    node: (
                      <>
                        {t('levels.chapterItem', { chapter: formatNumber(lang, g.chapter - 1) })} (
                        {pct(g.stuckAfter3Rate ?? 0)})
                      </>
                    ),
                  })),
                ),
                share: pct(data.stuckShare),
                attempts: formatNumber(lang, data.stuckAttempts),
              }}
            />
          ) : (
            t('levels.noSoften', {
              share: pct(data.stuckShare),
              attempts: formatNumber(lang, data.stuckAttempts),
            })
          )}
        </div>
      )}

      <Section title={t('levels.byLevel')} hint={t('levels.byLevelHint')}>
        {!anyPlay ? (
          <Empty>{t('levels.empty')}</Empty>
        ) : (
          <>
            <div className="toolbar section-toolbar">
              <Select
                label={t('levels.chapter')}
                value={current}
                options={[
                  { value: 0, label: t('levels.allChapters') },
                  ...chapters.map((c) => ({
                    value: c,
                    label: t('levels.chapterOption', { chapter: formatNumber(lang, c) }),
                  })),
                ]}
                onChange={(c) => navigate({ name: 'levels', days, chapter: c })}
              />
              <StarsLegend />
            </div>
            <div className="levels-table">
              <DataTable
                caption={t('levels.byLevel')}
                columns={levelColumns}
                rows={sortLevels(shown, sort)}
                rowKey={(l) => l.levelId}
                rowClassName={(l) => (isTooHard(l, data.tooHardShare) ? 'row-stop' : undefined)}
                sort={sort}
                onSort={onSort}
              />
            </div>
          </>
        )}
      </Section>

      <Section title={t('levels.gates')} hint={t('levels.gatesHint')}>
        {reached.length === 0 ? (
          <Empty>{t('levels.gatesEmpty')}</Empty>
        ) : (
          <DataTable
            caption={t('levels.gates')}
            columns={gateColumns}
            rows={reached}
            rowKey={(g) => String(g.chapter)}
            rowClassName={(g) => (needsSoftening(g, data.stuckShare) ? 'row-stop' : undefined)}
          />
        )}
      </Section>
    </>
  );
}

const STAR_COUNTS = [0, 1, 2, 3] as const;

/**
 * The plays by stars, as a stacked bar on the stars' ordinal ramp (fewer stars, a darker step of the same
 * yellow), with every share written out beside it: the colours are never the only way to read it.
 */
function StarsMeter({ stars }: { stars: AdminLevelStat['stars'] }) {
  const { t, lang } = useI18n();
  const total = stars.reduce((sum, n) => sum + n, 0);
  if (total === 0) return <span className="muted">{t('common.none')}</span>;
  const share = (n: number) => formatPercent(lang, n / total);
  return (
    <span className="stars-cell">
      <span className="stars-meter" aria-hidden="true">
        {STAR_COUNTS.map((k) =>
          stars[k] > 0 ? (
            <span
              key={k}
              className={`stars-seg stars-${k}`}
              style={{ flexGrow: stars[k] }}
              title={t('levels.starsTitle', {
                count: formatNumber(lang, stars[k]),
                stars: formatNumber(lang, k),
                pct: share(stars[k]),
              })}
            />
          ) : null,
        )}
      </span>
      <span className="stars-text" aria-hidden="true">
        {STAR_COUNTS.map((k) => (
          <span key={k} className="stars-part">
            <span className={`stars-key stars-${k}`} />
            <bdi dir="ltr">
              {k}★ {share(stars[k])}
            </bdi>
          </span>
        ))}
      </span>
      <span className="visually-hidden">
        {t('levels.starsA11y', {
          s0: share(stars[0]),
          s1: share(stars[1]),
          s2: share(stars[2]),
          s3: share(stars[3]),
        })}
      </span>
    </span>
  );
}

/** What each colour of the star bars means (the shares beside every bar say it in words too). */
function StarsLegend() {
  const { t } = useI18n();
  return (
    <div className="stars-legend" aria-hidden="true">
      <span>{t('levels.legend')}</span>
      {STAR_COUNTS.map((k) => (
        <span key={k} className="stars-part">
          <span className={`stars-key stars-${k}`} />
          <bdi dir="ltr">{k}★</bdi>
        </span>
      ))}
    </div>
  );
}
