import {
  ADMIN_DEFAULT_PAGE_SIZE,
  type AdminQaOpenRunRequest,
  type AdminQaRun,
  QA_PLATFORMS,
  QA_RUN_WHO,
  type QaCatalog,
  type QaPlatform,
  type QaRunWho,
} from '@sudoku-fight/protocol';
import { type FormEvent, useCallback, useId, useState } from 'react';

import { type ApiError, toApiError } from '../api';
import { type Column, DataTable } from '../components/DataTable';
import {
  actionErrorKey,
  AsyncView,
  DateTime,
  Empty,
  Ltr,
  Num,
  PageHeader,
  Pager,
  Section,
} from '../components/ui';
import { useApi, useAsync } from '../data';
import { useI18n } from '../i18n';
import { navigate, routeHref } from '../router';
import { QaActor } from './QaRunPage';

/**
 * The QA module (docs/handoff/2026-10-23/qa-module/plan.md), "בדיקות": a new run (title, app version, device,
 * platform, whose tasks, and the catalog's categories, all by default), and the runs, newest first, each with
 * its counts. Opening a run goes to it.
 */
export function QaRunsPage({ page }: { page: number }) {
  const { t } = useI18n();
  const title = t('qa.title');
  return (
    <>
      <PageHeader title={title} docTitle={title}>
        <p className="lede">{t('qa.intro')}</p>
      </PageHeader>
      <NewRunSection />
      <RunsSection page={page} />
    </>
  );
}

/** The server's limits (apps/server/src/admin/qa.ts, openRunBody). */
const TITLE_MAX = 80;
const VERSION_MAX = 40;
const DEVICE_MAX = 80;

function NewRunSection() {
  const { t } = useI18n();
  const api = useApi();
  const load = useCallback(() => api.qaCatalog(), [api]);
  const catalog = useAsync(load);
  return (
    <Section title={t('qa.new')} hint={t('qa.newHint')}>
      <AsyncView result={catalog}>{(data) => <NewRunForm catalog={data} />}</AsyncView>
    </Section>
  );
}

function NewRunForm({ catalog }: { catalog: QaCatalog }) {
  const { t, label } = useI18n();
  const api = useApi();
  const id = useId();
  const [title, setTitle] = useState('');
  const [appVersion, setAppVersion] = useState('');
  const [device, setDevice] = useState('');
  const [platform, setPlatform] = useState<QaPlatform | ''>('android');
  const [who, setWho] = useState<QaRunWho>('all');
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(catalog.categories.map((c) => c.id)),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const missing =
      title.trim() === '' || appVersion.trim() === ''
        ? t('qa.needFields')
        : picked.size === 0
          ? t('qa.needCategory')
          : null;
    setProblem(missing);
    if (missing !== null) return;
    const all = catalog.categories.every((c) => picked.has(c.id));
    const request: AdminQaOpenRunRequest = {
      title: title.trim(),
      appVersion: appVersion.trim(),
      device: device.trim() === '' ? null : device.trim(),
      platform: platform === '' ? null : platform,
      who,
      // Every category: left out (the server takes them all, the ones added later too).
      ...(all ? null : { categories: catalog.categories.filter((c) => picked.has(c.id)).map((c) => c.id) }),
    };
    setBusy(true);
    try {
      const run = await api.openQaRun(request);
      navigate({ name: 'qaRun', id: run.id });
    } catch (err: unknown) {
      setError(toApiError(err));
      setBusy(false);
    }
  };

  const toggle = (categoryId: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(categoryId);
      else next.delete(categoryId);
      return next;
    });

  const tasksOf = (c: QaCatalog['categories'][number]) =>
    c.subcategories.reduce((n, s) => n + s.tasks.length, 0);

  return (
    <form className="qa-form" noValidate onSubmit={(e) => void submit(e)}>
      <div className="toolbar">
        <div className="toolbar-item">
          <label htmlFor={`${id}-title`}>{t('qa.field.title')}</label>
          <input
            id={`${id}-title`}
            className="input"
            value={title}
            maxLength={TITLE_MAX}
            aria-required="true"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="toolbar-item">
          <label htmlFor={`${id}-version`}>{t('qa.field.appVersion')}</label>
          <input
            id={`${id}-version`}
            className="input"
            dir="ltr"
            value={appVersion}
            maxLength={VERSION_MAX}
            aria-required="true"
            autoComplete="off"
            onChange={(e) => setAppVersion(e.target.value)}
          />
        </div>
        <div className="toolbar-item">
          <label htmlFor={`${id}-device`}>{t('qa.field.device')}</label>
          <input
            id={`${id}-device`}
            className="input"
            value={device}
            maxLength={DEVICE_MAX}
            onChange={(e) => setDevice(e.target.value)}
          />
        </div>
        <div className="toolbar-item">
          <label htmlFor={`${id}-platform`}>{t('qa.field.platform')}</label>
          <select
            id={`${id}-platform`}
            className="input"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as QaPlatform | '')}
          >
            {QA_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {label('platform', p)}
              </option>
            ))}
            <option value="">{t('qa.platformNone')}</option>
          </select>
        </div>
        <div className="toolbar-item">
          <label htmlFor={`${id}-who`}>{t('qa.field.who')}</label>
          <select
            id={`${id}-who`}
            className="input"
            value={who}
            onChange={(e) => setWho(e.target.value as QaRunWho)}
          >
            {QA_RUN_WHO.map((w) => (
              <option key={w} value={w}>
                {label('qa.runWho', w)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset className="qa-categories">
        <legend>{t('qa.field.categories')}</legend>
        {catalog.categories.map((c) => (
          <label key={c.id} className="qa-check">
            <input
              type="checkbox"
              checked={picked.has(c.id)}
              onChange={(e) => toggle(c.id, e.target.checked)}
            />
            {t('qa.categoryTasks', { title: c.title, n: tasksOf(c) })}
          </label>
        ))}
      </fieldset>
      {(problem !== null || error !== null) && (
        <p className="form-error" role="alert">
          {problem ?? (error && t(actionErrorKey(error.code)))}
          {error?.code === 'badRequest' && <span className="form-error-detail">{error.message}</span>}
        </p>
      )}
      <div className="section-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? t('common.working') : t('action.qaOpen')}
        </button>
      </div>
    </form>
  );
}

function RunsSection({ page }: { page: number }) {
  const { t, label } = useI18n();
  const api = useApi();
  const load = useCallback(() => api.qaRuns({ page, pageSize: ADMIN_DEFAULT_PAGE_SIZE }), [api, page]);
  const result = useAsync(load);

  const count = (id: string, header: string, value: (r: AdminQaRun) => number): Column<AdminQaRun> => ({
    id,
    header,
    numeric: true,
    cell: (r) => <Num value={value(r)} />,
  });
  const columns: Column<AdminQaRun>[] = [
    {
      id: 'title',
      header: t('col.qaRun'),
      cell: (r) => <a href={routeHref({ name: 'qaRun', id: r.id })}>{r.title}</a>,
    },
    { id: 'version', header: t('col.version'), cell: (r) => <Ltr className="mono">{r.appVersion}</Ltr> },
    {
      id: 'device',
      header: t('col.device'),
      cell: (r) =>
        [r.device, r.platform === null ? null : label('platform', r.platform)]
          .filter((v) => v !== null)
          .join(' · ') || t('common.none'),
    },
    { id: 'status', header: t('col.runStatus'), cell: (r) => label('qa.status', r.status) },
    {
      id: 'opened',
      header: t('col.openedBy'),
      cell: (r) => (
        <>
          <DateTime ms={r.createdAt} />
          <span className="fact-note">
            <QaActor who={r.createdBy} />
          </span>
        </>
      ),
    },
    count('pass', t('col.qaPass'), (r) => r.counts.pass),
    count('partial', t('col.qaPartial'), (r) => r.counts.partial),
    count('fail', t('col.qaFail'), (r) => r.counts.fail),
    count('untested', t('col.qaUntested'), (r) => r.counts.untested),
    count('openBugs', t('col.qaOpenBugs'), (r) => r.counts.openBugs),
    count('handled', t('col.qaHandled'), (r) => r.counts.handled),
  ];

  return (
    <Section title={t('qa.runs')}>
      <AsyncView result={result}>
        {(data) => (
          <>
            {data.items.length === 0 ? (
              <Empty>{t('qa.runsEmpty')}</Empty>
            ) : (
              <DataTable
                caption={t('qa.runs')}
                columns={columns}
                rows={data.items}
                rowKey={(r) => String(r.id)}
                rowHref={(r) => routeHref({ name: 'qaRun', id: r.id })}
              />
            )}
            {(data.total > 0 || data.page > 1) && (
              <Pager
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                onPage={(p) => navigate({ name: 'qa', page: p })}
              />
            )}
          </>
        )}
      </AsyncView>
    </Section>
  );
}
