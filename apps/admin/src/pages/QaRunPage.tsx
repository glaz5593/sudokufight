import type {
  AdminQaItem,
  AdminQaResultRequest,
  AdminQaRunDetail,
  QaBugStatus,
  QaResult,
} from '@sudoku-fight/protocol';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';

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
import { isolate, type StringKey } from '../strings';

/**
 * One QA run (docs/handoff/2026-10-23/qa-module/plan.md): the setup every task assumes, its details and
 * progress, a filter (every task, the untested, the bugs only), and its tasks as a tree in catalog order, light
 * enough to skim. At first only the categories show, one row each with how far it got (tested of all, V,
 * partial, fail, open bugs); "+" opens a category's subcategories (rows like it), and a subcategory's tasks. A
 * task is a row too: its mark, title and subtitle (none on a run opened before subtitles), and a quick V.
 * Opened, it shows its numbered steps, what is expected, who tests it, every mark and, for a bug, its state and
 * fix (the version isolated, CLAUDE.md). Under a filter, only the branches with a matching task show, and they
 * open by themselves; the counts stay the whole run's. What is open is kept per filter while the page is up.
 *
 * The marks: V (pass, nothing to write), "עבר חלקית" and "לא עבר" (both need "מה קרה בפועל"; a note is
 * optional) and "נקה" (untested). A closed run takes marks only on its bugs that wait for a fix or a test (open,
 * handled, reopened; the server answers 409 qaRunClosed to the others).
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

/** The bugs waiting for a fix (AdminQaRunCounts.openBugs). */
const OPEN_BUGS: ReadonlySet<QaBugStatus> = new Set(['open', 'reopened']);

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

/** How far a branch got, over all of its tasks (whatever the filter shows). */
interface Tally {
  total: number;
  tested: number;
  pass: number;
  partial: number;
  fail: number;
  openBugs: number;
}

function tallyOf(items: readonly AdminQaItem[]): Tally {
  const tally: Tally = { total: items.length, tested: 0, pass: 0, partial: 0, fail: 0, openBugs: 0 };
  for (const item of items) {
    if (item.result !== 'untested') {
      tally.tested += 1;
      tally[item.result] += 1;
    }
    if (item.bugStatus !== null && OPEN_BUGS.has(item.bugStatus)) tally.openBugs += 1;
  }
  return tally;
}

interface Branch {
  id: string;
  title: string;
  tally: Tally;
}

/** A category, with its subcategories that have a task the filter shows. */
interface CategoryBranch extends Branch {
  subs: SubBranch[];
}

/** A subcategory, with the tasks the filter shows. */
interface SubBranch extends Branch {
  items: AdminQaItem[];
}

/** The tree on the page: the branches with a task the filter keeps, each tallied over all of its tasks. */
function treeOf(items: readonly AdminQaItem[], show: QaShow): CategoryBranch[] {
  return groupItems(items).flatMap((group) => {
    const subs = group.subs.flatMap((sub) => {
      const shown = sub.items.filter((item) => shows(show, item));
      return shown.length === 0
        ? []
        : [{ id: sub.id, title: sub.title, tally: tallyOf(sub.items), items: shown }];
    });
    if (subs.length === 0) return [];
    return [{ id: group.id, title: group.title, tally: tallyOf(group.subs.flatMap((s) => s.items)), subs }];
  });
}

/** What the viewer opened or closed, per filter, by `c:<category>`, `s:<subcategory>` and `t:<task>`. */
type Expanded = Partial<Record<QaShow, Readonly<Record<string, boolean>>>>;

function RunBody({ run, show, reload }: { run: AdminQaRunDetail; show: QaShow; reload: () => void }) {
  const { t, label, lang } = useI18n();
  const api = useApi();
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Kept through a reload (AsyncView keeps the page up with the old data meanwhile).
  const [expanded, setExpanded] = useState<Expanded>({});
  const closed = run.status === 'closed';
  const c = run.counts;
  const n = (value: number) => formatNumber(lang, value);
  const tree = treeOf(run.items, show);
  // Under a filter, the categories and subcategories open by themselves; a task opens only when asked.
  const branchesOpen = show !== 'all';
  const isOpen = (key: string, byDefault: boolean) => expanded[show]?.[key] ?? byDefault;
  const toggle = (key: string, byDefault: boolean) =>
    setExpanded((prev) => ({ ...prev, [show]: { ...prev[show], [key]: !(prev[show]?.[key] ?? byDefault) } }));

  return (
    <>
      <p className="qa-setup">{t('qa.setup')}</p>
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
      </Section>
      <Section title={t('qa.tasks')}>
        <div className="toolbar">
          <Select
            label={t('qa.show')}
            value={show}
            options={QA_SHOWS.map((s) => ({ value: s, label: label('qa.show', s) }))}
            onChange={(s) => navigate({ name: 'qaRun', id: run.id, show: s })}
          />
        </div>
        {tree.length === 0 ? (
          <Empty>{t('qa.noTasks')}</Empty>
        ) : (
          <ul className="qa-tree">
            {tree.map((category) => {
              const categoryKey = `c:${category.id}`;
              return (
                <BranchRow
                  key={category.id}
                  level={3}
                  branch={category}
                  open={isOpen(categoryKey, branchesOpen)}
                  onToggle={() => toggle(categoryKey, branchesOpen)}
                >
                  {category.subs.map((sub) => {
                    const subKey = `s:${sub.id}`;
                    return (
                      <BranchRow
                        key={sub.id}
                        level={4}
                        branch={sub}
                        open={isOpen(subKey, branchesOpen)}
                        onToggle={() => toggle(subKey, branchesOpen)}
                      >
                        {sub.items.map((item) => {
                          const taskKey = `t:${item.taskId}`;
                          return (
                            <li key={item.taskId}>
                              <TaskCard
                                runId={run.id}
                                item={item}
                                closed={closed}
                                open={isOpen(taskKey, false)}
                                onToggle={() => toggle(taskKey, false)}
                                onMarked={reload}
                              />
                            </li>
                          );
                        })}
                      </BranchRow>
                    );
                  })}
                </BranchRow>
              );
            })}
          </ul>
        )}
      </Section>
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

/** A row's "+" or "−": hidden from screen readers, which hear its button's aria-expanded instead. */
function Sign({ open }: { open: boolean }) {
  return (
    <span className="qa-sign" aria-hidden="true">
      {open ? '−' : '+'}
    </span>
  );
}

/** A category's or a subcategory's row (a heading that opens it, and its tally), and its children when open. */
function BranchRow({
  level,
  branch,
  open,
  onToggle,
  children,
}: {
  level: 3 | 4;
  branch: Branch;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const childrenId = useId();
  const Heading = level === 3 ? 'h3' : 'h4';
  return (
    <li className={level === 3 ? 'qa-branch qa-category' : 'qa-branch qa-sub'}>
      <div className="qa-row">
        <Heading className="qa-row-heading">
          <button
            type="button"
            className="qa-toggle"
            aria-expanded={open}
            aria-controls={open ? childrenId : undefined}
            onClick={onToggle}
          >
            <Sign open={open} />
            <span className="qa-row-title">{branch.title}</span>
          </button>
        </Heading>
        <TallyLine tally={branch.tally} />
      </div>
      {open && (
        <ul id={childrenId} className="qa-tree">
          {children}
        </ul>
      )}
    </li>
  );
}

/** "בוצע N%" (tested of all, rounded down: 100% only when every task is tested), then V, partial, fail, bugs. */
function TallyLine({ tally }: { tally: Tally }) {
  const { t, lang } = useI18n();
  const n = (value: number) => formatNumber(lang, value);
  const done = tally.total === 0 ? 0 : Math.floor((tally.tested * 100) / tally.total);
  const counts: { key: StringKey; value: number; alert: boolean }[] = [
    { key: 'qa.mark.pass', value: tally.pass, alert: false },
    { key: 'qa.result.partial', value: tally.partial, alert: tally.partial > 0 },
    { key: 'qa.result.fail', value: tally.fail, alert: tally.fail > 0 },
    { key: 'qa.openBugs', value: tally.openBugs, alert: tally.openBugs > 0 },
  ];
  return (
    <span className="qa-tally">
      <span className="qa-count">{t('qa.done', { pct: n(done) })}</span>
      {counts.map(({ key, value, alert }) => (
        <span key={key} className={alert ? 'qa-count qa-alert' : 'qa-count'}>
          <span>{t(key)}</span> <span>{n(value)}</span>
        </span>
      ))}
    </span>
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

/**
 * A task: its row (the mark, title and subtitle, and a quick V while it is closed) and, opened, everything about
 * it with every mark. A refusal shows under the row, open or not.
 */
function TaskCard({
  runId,
  item,
  closed,
  open,
  onToggle,
  onMarked,
}: {
  runId: number;
  item: AdminQaItem;
  closed: boolean;
  open: boolean;
  onToggle: () => void;
  onMarked: () => void;
}) {
  const { t, label } = useI18n();
  const api = useApi();
  const id = useId();
  const titleId = `${id}-title`;
  const resultId = `${id}-result`;
  const subtitleId = `${id}-subtitle`;
  const detailId = `${id}-detail`;
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

  const passButton = (className: string) => (
    <button
      type="button"
      className={className}
      aria-label={t('qa.mark.passName')}
      disabled={off}
      onClick={() => void mark({ result: 'pass' })}
    >
      {t('qa.mark.pass')}
    </button>
  );

  return (
    <article className="qa-task" aria-labelledby={titleId}>
      <div className="qa-row">
        <button
          type="button"
          className="qa-toggle"
          aria-expanded={open}
          aria-controls={open ? detailId : undefined}
          aria-labelledby={titleId}
          aria-describedby={item.subtitle === null ? resultId : `${resultId} ${subtitleId}`}
          onClick={onToggle}
        >
          <Sign open={open} />
          <span id={resultId} className={RESULT_BADGE[item.result]}>
            {label('qa.result', item.result)}
          </span>
          <span className="qa-task-text">
            <span id={titleId} className="qa-row-title">
              {item.title}
            </span>
            {item.subtitle !== null && (
              <span id={subtitleId} className="qa-subtitle">
                {item.subtitle}
              </span>
            )}
          </span>
        </button>
        {/* Opened, the V is with the other marks. */}
        {!open && passButton('btn btn-sm qa-quick')}
      </div>
      {open && (
        <div id={detailId} className="qa-detail">
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
          {(item.bugStatus !== null || (item.testedAt !== null && item.testedBy !== null)) && (
            <p className="qa-result">
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
          )}
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
                      nodes={{
                        when: <DateTime ms={item.handledAt} />,
                        who: <QaActor who={item.handledBy} />,
                      }}
                    />
                  </>
                )}
              </p>
              <p className="qa-text">{item.fixNote}</p>
            </div>
          )}
          <div className="actions qa-actions" role="group" aria-label={t('qa.marks')}>
            {passButton('btn btn-sm')}
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
        </div>
      )}
      {error && (
        <p className="form-error qa-error" role="alert">
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
