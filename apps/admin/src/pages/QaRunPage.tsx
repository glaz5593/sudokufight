import type {
  AdminQaItem,
  AdminQaResultRequest,
  AdminQaRunDetail,
  QaBugStatus,
  QaResult,
} from '@sudoku-fight/protocol';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { type ApiError, toApiError } from '../api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Actor } from '../components/moderation';
import {
  actionErrorKey,
  AsyncView,
  DateTime,
  Empty,
  Facts,
  Ltr,
  PageHeader,
  Section,
  Select,
} from '../components/ui';
import { useApi, useAsync } from '../data';
import { formatNumber } from '../format';
import { Rich, useI18n } from '../i18n';
import { navigate, QA_SHOWS, type QaShow, routeHref } from '../router';
import { isolate } from '../strings';

/**
 * One QA run (docs/handoff/2026-10-23/qa-module/plan.md): its details and progress, a filter (every task, the
 * untested, the bugs only), and its tasks by category and subcategory, in catalog order. Each task shows its
 * numbered steps, what is expected, who tests it, its mark and, for a bug, its state and fix (the version
 * isolated, CLAUDE.md). The marks: V (pass, nothing to write), "עבר חלקית" and "לא עבר" (both need "מה קרה
 * בפועל"; a note is optional) and "נקה" (untested). A closed run takes marks only on its bugs that wait for a
 * fix or a test (open, handled, reopened; the server answers 409 qaRunClosed to the others).
 */
export function QaRunPage({ id, show }: { id: number; show: QaShow }) {
  const { t } = useI18n();
  const api = useApi();
  const load = useCallback(() => api.qaRun(id), [api, id]);
  const result = useAsync(load);
  return (
    <>
      <PageHeader
        title={<Rich k="qa.runTitle" nodes={{ id: <Ltr>{id}</Ltr> }} />}
        docTitle={t('qa.runTitle', { id: isolate(id) })}
        back={{ href: routeHref({ name: 'qa' }), label: t('qa.back') }}
      />
      <AsyncView result={result}>
        {(run) => <RunBody run={run} show={show} reload={result.reload} />}
      </AsyncView>
    </>
  );
}

/** Who opened, marked or closed: an admin, the password sign-in, or Claude's key. */
export function QaActor({ who }: { who: string }) {
  const { t } = useI18n();
  return who === 'claude' ? <>{t('qa.who.claude')}</> : <Actor who={who} />;
}

/** A closed run still takes a mark on these (apps/server/src/qa/rules.ts, mayMarkClosedRun). */
const MARKABLE_WHEN_CLOSED: ReadonlySet<QaBugStatus> = new Set(['open', 'handled', 'reopened']);

function shows(show: QaShow, item: AdminQaItem): boolean {
  if (show === 'untested') return item.result === 'untested';
  if (show === 'bugs') return item.bugStatus !== null;
  return true;
}

interface Group {
  id: string;
  title: string;
  subs: { id: string; title: string; items: AdminQaItem[] }[];
}

/** The tasks by category, then subcategory, keeping their order (the server's: the catalog's). */
function groupItems(items: readonly AdminQaItem[]): Group[] {
  const groups: Group[] = [];
  for (const item of items) {
    let group = groups.find((g) => g.id === item.categoryId);
    if (!group) {
      group = { id: item.categoryId, title: item.categoryTitle, subs: [] };
      groups.push(group);
    }
    let sub = group.subs.find((s) => s.id === item.subcategoryId);
    if (!sub) {
      sub = { id: item.subcategoryId, title: item.subcategoryTitle, items: [] };
      group.subs.push(sub);
    }
    sub.items.push(item);
  }
  return groups;
}

function RunBody({ run, show, reload }: { run: AdminQaRunDetail; show: QaShow; reload: () => void }) {
  const { t, label, lang } = useI18n();
  const api = useApi();
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const closed = run.status === 'closed';
  const c = run.counts;
  const n = (value: number) => formatNumber(lang, value);
  const groups = groupItems(run.items.filter((item) => shows(show, item)));

  return (
    <>
      <Section title={t('common.details')}>
        {/* Always there (empty without a message), so screen readers hear each new one. */}
        <div className={notice === null ? 'notice-slot' : 'notice-slot notice'}>
          <p className="notice-text" role="status">
            {notice}
          </p>
        </div>
        <Facts
          items={[
            { label: t('qa.field.title'), value: run.title },
            { label: t('qa.field.appVersion'), value: <Ltr className="mono">{run.appVersion}</Ltr> },
            { label: t('col.device'), value: run.device ?? t('common.none') },
            {
              label: t('qa.field.platform'),
              value: run.platform === null ? t('common.none') : label('platform', run.platform),
            },
            { label: t('qa.field.who'), value: label('qa.runWho', run.filter.who) },
            { label: t('col.runStatus'), value: label('qa.status', run.status) },
            {
              label: t('col.openedBy'),
              value: (
                <Rich
                  k="qa.byWhen"
                  nodes={{ when: <DateTime ms={run.createdAt} />, who: <QaActor who={run.createdBy} /> }}
                />
              ),
            },
            ...(run.closedAt === null
              ? []
              : [
                  {
                    label: t('qa.closedAt'),
                    value: (
                      <Rich
                        k="qa.byWhen"
                        nodes={{
                          when: <DateTime ms={run.closedAt} />,
                          who: run.closedBy === null ? t('common.none') : <QaActor who={run.closedBy} />,
                        }}
                      />
                    ),
                  },
                ]),
          ]}
        />
        {closed ? (
          <p className="muted">{t('qa.closedHint')}</p>
        ) : (
          <div className="section-actions">
            <button type="button" className="btn btn-sm" onClick={() => setAsking(true)}>
              {t('action.qaClose')}
            </button>
          </div>
        )}
      </Section>
      <Section title={t('qa.progress')}>
        <p>
          {t('qa.progressLine', {
            tested: n(c.total - c.untested),
            total: n(c.total),
            pass: n(c.pass),
            partial: n(c.partial),
            fail: n(c.fail),
            untested: n(c.untested),
            openBugs: n(c.openBugs),
            handled: n(c.handled),
          })}
        </p>
        <div className="toolbar">
          <Select
            label={t('qa.show')}
            value={show}
            options={QA_SHOWS.map((s) => ({ value: s, label: label('qa.show', s) }))}
            onChange={(s) => navigate({ name: 'qaRun', id: run.id, show: s })}
          />
        </div>
        {groups.length === 0 && <Empty>{t('qa.noTasks')}</Empty>}
      </Section>
      {groups.map((group) => (
        <Section key={group.id} title={group.title}>
          {group.subs.map((sub) => (
            <div key={sub.id}>
              <h3>{sub.title}</h3>
              <ol className="qa-tasks">
                {sub.items.map((item) => (
                  <li key={item.taskId}>
                    <TaskCard runId={run.id} item={item} closed={closed} onMarked={reload} />
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </Section>
      ))}
      {asking && (
        <ConfirmDialog
          title={t('confirm.qaClose.title')}
          confirmLabel={t('action.qaClose')}
          audited={false}
          onClose={() => setAsking(false)}
          onConfirm={async () => {
            await api.closeQaRun(run.id);
            setNotice(t('done.qaClose'));
            setAsking(false);
            reload();
          }}
        >
          <p>{t('confirm.qaClose.body')}</p>
        </ConfirmDialog>
      )}
    </>
  );
}

const RESULT_BADGE: Record<QaResult, string> = {
  untested: 'badge',
  pass: 'badge',
  partial: 'badge badge-warn',
  fail: 'badge badge-danger',
};

const BUG_BADGE: Record<QaBugStatus, string> = {
  open: 'badge badge-danger',
  reopened: 'badge badge-danger',
  handled: 'badge badge-warn',
  verified: 'badge',
};

/** The server keeps at most this much of "מה קרה בפועל" and of a note (apps/server/src/admin/qa.ts). */
const MARK_TEXT_MAX = 2000;

function TaskCard({
  runId,
  item,
  closed,
  onMarked,
}: {
  runId: number;
  item: AdminQaItem;
  closed: boolean;
  onMarked: () => void;
}) {
  const { t, label } = useI18n();
  const api = useApi();
  const headingId = useId();
  const [form, setForm] = useState<MarkFormResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const formWasOpen = useRef(false);
  const markable = !closed || (item.bugStatus !== null && MARKABLE_WHEN_CLOSED.has(item.bugStatus));
  const off = !markable || busy;

  // The form closed (saved or cancelled): the focus goes back to the button that opened it.
  useEffect(() => {
    if (form === null && formWasOpen.current) opener.current?.focus();
    formWasOpen.current = form !== null;
  }, [form]);

  const mark = async (request: AdminQaResultRequest): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await api.markQa(runId, item.taskId, request);
      setBusy(false);
      onMarked();
      return true;
    } catch (err: unknown) {
      const apiError = toApiError(err);
      setError(apiError);
      setBusy(false);
      // The run closed meanwhile: show it as it is now.
      if (apiError.code === 'qaRunClosed') onMarked();
      return false;
    }
  };

  const openForm = (button: HTMLButtonElement, result: MarkFormResult) => {
    opener.current = button;
    setError(null);
    setForm(result);
  };

  return (
    <article className="card qa-task" aria-labelledby={headingId}>
      <h4 id={headingId}>{item.title}</h4>
      <p className="muted">{t('qa.taskWho', { who: label('qa.who', item.who) })}</p>
      <p className="qa-label">{t('qa.steps')}</p>
      <ol className="qa-list">
        {item.steps.map((step, i) => (
          <li key={i} className="qa-text">
            {step}
          </li>
        ))}
      </ol>
      <p className="qa-label">{t('qa.expected')}</p>
      <ul className="qa-list">
        {item.expected.map((line, i) => (
          <li key={i} className="qa-text">
            {line}
          </li>
        ))}
      </ul>
      <p className="qa-result">
        <span className="qa-label">{t('qa.result')}</span>
        <span className={RESULT_BADGE[item.result]}>{label('qa.result', item.result)}</span>
        {item.bugStatus !== null && (
          <span className={BUG_BADGE[item.bugStatus]}>
            {t('qa.bugStatus', { status: label('qa.bug', item.bugStatus) })}
          </span>
        )}
        {item.testedAt !== null && item.testedBy !== null && (
          <span className="muted">
            <Rich
              k="qa.byWhen"
              nodes={{ when: <DateTime ms={item.testedAt} />, who: <QaActor who={item.testedBy} /> }}
            />
          </span>
        )}
      </p>
      {item.actual !== null && <TextBlock label={t('qa.actual')} text={item.actual} />}
      {item.note !== null && <TextBlock label={t('qa.note')} text={item.note} />}
      {item.fixNote !== null && (
        <div className="qa-fix">
          <p className="qa-label">
            {t('qa.fix')}
            {item.fixedIn !== null && (
              <>
                {' · '}
                <Rich k="qa.fixedIn" nodes={{ version: <Ltr className="mono">{item.fixedIn}</Ltr> }} />
              </>
            )}
            {item.handledAt !== null && item.handledBy !== null && (
              <>
                {' · '}
                <Rich
                  k="qa.byWhen"
                  nodes={{ when: <DateTime ms={item.handledAt} />, who: <QaActor who={item.handledBy} /> }}
                />
              </>
            )}
          </p>
          <p className="qa-text">{item.fixNote}</p>
        </div>
      )}
      <div className="actions qa-actions" role="group" aria-label={t('qa.marks')}>
        <button
          type="button"
          className="btn btn-sm"
          aria-label={t('qa.mark.passName')}
          disabled={off}
          onClick={() => void mark({ result: 'pass' })}
        >
          {t('qa.mark.pass')}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          aria-expanded={form === 'pass'}
          disabled={off}
          onClick={(e) => openForm(e.currentTarget, 'pass')}
        >
          {t('qa.mark.passNote')}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          aria-expanded={form === 'partial'}
          disabled={off}
          onClick={(e) => openForm(e.currentTarget, 'partial')}
        >
          {t('qa.mark.partial')}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          aria-expanded={form === 'fail'}
          disabled={off}
          onClick={(e) => openForm(e.currentTarget, 'fail')}
        >
          {t('qa.mark.fail')}
        </button>
        {item.result !== 'untested' && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={off}
            onClick={() => void mark({ result: 'untested' })}
          >
            {t('qa.mark.clear')}
          </button>
        )}
      </div>
      {form !== null && (
        <MarkForm
          result={form}
          busy={busy}
          onCancel={() => setForm(null)}
          onSave={async (actual, note) => {
            if (await mark({ result: form, actual, note })) setForm(null);
          }}
        />
      )}
      {error && (
        <p className="form-error" role="alert">
          {t(actionErrorKey(error.code))}
          {error.code === 'badRequest' && <span className="form-error-detail">{error.message}</span>}
        </p>
      )}
    </article>
  );
}

function TextBlock({ label, text }: { label: string; text: string }) {
  return (
    <>
      <p className="qa-label">{label}</p>
      <p className="qa-text">{text}</p>
    </>
  );
}

/** The marks that open a form: V with a note, or "עבר חלקית" / "לא עבר" with what actually happened. */
type MarkFormResult = 'pass' | 'partial' | 'fail';

/**
 * "עבר חלקית" or "לא עבר": what actually happened (required), and a note (optional). "V עם הערה": the note
 * only, since the expected happened.
 */
function MarkForm({
  result,
  busy,
  onSave,
  onCancel,
}: {
  result: MarkFormResult;
  busy: boolean;
  onSave: (actual: string | null, note: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const { t, label } = useI18n();
  const id = useId();
  const actualRef = useRef<HTMLTextAreaElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const withActual = result !== 'pass';
  const [actual, setActual] = useState('');
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    (withActual ? actualRef : noteRef).current?.focus();
  }, [withActual]);

  return (
    <form
      className="qa-mark"
      noValidate
      aria-label={t('qa.markAs', { result: label('qa.result', result) })}
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        if (withActual && actual.trim() === '') {
          setMissing(true);
          actualRef.current?.focus();
          return;
        }
        void onSave(withActual ? actual.trim() : null, note.trim() === '' ? null : note.trim());
      }}
    >
      {withActual && (
        <div className="toolbar-item">
          <label htmlFor={`${id}-actual`}>{t('qa.actual')}</label>
          <textarea
            ref={actualRef}
            id={`${id}-actual`}
            className="input"
            rows={3}
            value={actual}
            maxLength={MARK_TEXT_MAX}
            aria-required="true"
            aria-invalid={missing || undefined}
            aria-describedby={missing ? `${id}-missing` : undefined}
            onChange={(e) => {
              setActual(e.target.value);
              if (e.target.value.trim() !== '') setMissing(false);
            }}
          />
          {missing && (
            <p id={`${id}-missing`} className="form-error" role="alert">
              {t('qa.actualRequired')}
            </p>
          )}
        </div>
      )}
      <div className="toolbar-item">
        <label htmlFor={`${id}-note`}>{t('qa.noteOptional')}</label>
        <textarea
          ref={noteRef}
          id={`${id}-note`}
          className="input"
          rows={2}
          value={note}
          maxLength={MARK_TEXT_MAX}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="actions">
        <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>
          {busy ? t('common.working') : t('qa.mark.save')}
        </button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
