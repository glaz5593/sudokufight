import { type ReactNode, useEffect, useId, useState } from 'react';

import type { ApiError } from '../api';
import { type AsyncResult, useNow } from '../data';
import { compactJson, formatDateTime, formatNumber, formatRelative, formatSigned } from '../format';
import { useI18n } from '../i18n';
import { DAY_RANGES } from '../router';
import type { StringKey } from '../strings';

/** Small building blocks shared by the pages. Text comes in already translated. */

/** The page's heading (App focuses it on every page change) and the browser tab's title. */
export function PageHeader({
  title,
  docTitle,
  back,
  children,
}: {
  title: ReactNode;
  /** Plain text for the browser tab. */
  docTitle: string;
  back?: { href: string; label: string };
  children?: ReactNode;
}) {
  useDocTitle(docTitle);
  return (
    <header className="page-head">
      {back && (
        <a className="back-link" href={back.href}>
          {back.label}
        </a>
      )}
      <h1 tabIndex={-1}>{title}</h1>
      {children}
    </header>
  );
}

/** Sets the browser tab's title for the page. */
export function useDocTitle(page: string): void {
  const { t } = useI18n();
  const title = t('app.docTitle', { page });
  useEffect(() => {
    document.title = title;
  }, [title]);
}

export function Loading() {
  const { t } = useI18n();
  return (
    <p className="state state-loading" role="status">
      {t('common.loading')}
    </p>
  );
}

const ERROR_TEXT: Record<ApiError['code'], StringKey> = {
  network: 'error.network',
  server: 'error.server',
  internal: 'error.server',
  notFound: 'error.notFound',
  badRequest: 'error.badRequest',
  tooLarge: 'error.badRequest',
  tooManyRequests: 'error.tooMany',
  disabled: 'error.disabled',
  unauthorized: 'login.expired',
  // The moderation actions' refusals (components/ConfirmDialog.tsx shows them).
  notOpen: 'error.notOpen',
  accountDeleted: 'error.accountDeleted',
  googleRequired: 'error.googleRequired',
  // The stealth bot's switch on a server without the stealth bot (pages/StealthPage.tsx).
  stealthDisabled: 'error.stealthDisabled',
  // The QA module (/qa routes; its pages come later).
  qaDisabled: 'error.qaDisabled',
  qaCatalogInvalid: 'error.qaCatalogInvalid',
  qaRunClosed: 'error.qaRunClosed',
  qaNotBug: 'error.qaNotBug',
  // Only the Google sign-in answers these, and the login page words them itself (pages/LoginPage.tsx).
  invalidToken: 'error.server',
  wrongProvider: 'error.server',
  unverifiedEmail: 'error.server',
  notAllowed: 'error.server',
  unavailable: 'error.server',
};

/** The words for a moderation action's failure: a 404 there means the report or account went meanwhile. */
export function actionErrorKey(code: ApiError['code']): StringKey {
  return code === 'notFound' ? 'error.actionNotFound' : ERROR_TEXT[code];
}

export function ErrorBox({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="state state-error" role="alert">
      <p>{t(ERROR_TEXT[error.code])}</p>
      {onRetry && error.code !== 'notFound' && (
        <button type="button" className="btn" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

/** Loading, then the error or the data. A reload keeps the previous data on screen, faded. */
export function AsyncView<T>({
  result,
  children,
}: {
  result: AsyncResult<T>;
  children: (data: T) => ReactNode;
}) {
  if (result.error) return <ErrorBox error={result.error} onRetry={result.reload} />;
  if (result.data === undefined) return <Loading />;
  return (
    <div className={result.loading ? 'is-stale' : undefined} aria-busy={result.loading}>
      {children(result.data)}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="state state-empty">{children}</p>;
}

/** Left-to-right data (ids, versions, screen and event names, JSON) inside the page's direction. */
export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={className}>
      {children}
    </bdi>
  );
}

export function Num({ value, digits = 0 }: { value: number | null | undefined; digits?: number }) {
  const { t, lang } = useI18n();
  if (value === null || value === undefined) return <span className="muted">{t('common.none')}</span>;
  return <span className="num">{formatNumber(lang, value, digits)}</span>;
}

/** "1500 ← 1512 (+12)": the arrow follows the reading direction, the sign stays with its number. */
export function RatingChange({ before, after }: { before: number | null; after: number | null }) {
  const { t, lang } = useI18n();
  if (after === null) return <span className="muted">{t('common.none')}</span>;
  if (before === null) return <Num value={after} />;
  const delta = Math.round(after) - Math.round(before);
  return (
    <span className="rating-change">
      <Num value={before} /> <span aria-hidden="true">{t('common.arrow')}</span> <Num value={after} />{' '}
      <bdi dir="ltr" className={delta > 0 ? 'delta up' : delta < 0 ? 'delta down' : 'delta'}>
        ({formatSigned(lang, delta)})
      </bdi>
    </span>
  );
}

/** "לפני 3 ימים", with the date and time as a tooltip. */
export function RelativeTime({ ms }: { ms: number | null | undefined }) {
  const { t, lang } = useI18n();
  const now = useNow();
  if (ms === null || ms === undefined) return <span className="muted">{t('common.none')}</span>;
  return (
    <time dateTime={new Date(ms).toISOString()} title={formatDateTime(lang, ms)}>
      {formatRelative(lang, ms, now)}
    </time>
  );
}

export function DateTime({ ms }: { ms: number | null | undefined }) {
  const { t, lang } = useI18n();
  if (ms === null || ms === undefined) return <span className="muted">{t('common.none')}</span>;
  return <time dateTime={new Date(ms).toISOString()}>{formatDateTime(lang, ms)}</time>;
}

/** A player's status in words; 'active' in a game that has ended means they played to the end. */
export function usePlayerStatus(): (status: string, ended: boolean) => string {
  const { t, label } = useI18n();
  return (status, ended) => (status === 'active' && ended ? t('status.finished') : label('status', status));
}

/** Payloads longer than this fold into a one-line summary that opens to the full, indented JSON. */
const JSON_INLINE_MAX = 120;

/** Event props or a game event's payload: one line, or folded when long (e.g. the game's whole config). */
export function JsonValue({ value }: { value: unknown }) {
  const text = compactJson(value);
  if (text.length <= JSON_INLINE_MAX) return <Ltr className="mono json">{text}</Ltr>;
  return (
    <details className="json-long" dir="ltr">
      <summary className="mono">{text.slice(0, JSON_INLINE_MAX)}</summary>
      <pre className="mono">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

/** Label / value pairs. */
export function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="facts">
      {items.map((item) => (
        <div key={item.label} className="fact">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const { t, lang } = useI18n();
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  return (
    <nav className="pager" aria-label={t('pager.label')}>
      <button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t('pager.prev')}
      </button>
      <span className="pager-status" aria-live="polite">
        {t('pager.status', {
          page: formatNumber(lang, page),
          pages: formatNumber(lang, pages),
          total: formatNumber(lang, total),
        })}
      </span>
      <button type="button" className="btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t('pager.next')}
      </button>
    </nav>
  );
}

/** The server refuses longer searches (apps/server/src/admin/constants.ts, MAX_SEARCH_LENGTH). */
export const SEARCH_MAX_LENGTH = 100;

/** A search box that applies on submit. Remount it (key) to reset it to a new value. */
export function SearchForm({
  label,
  value,
  onSearch,
}: {
  label: string;
  value: string;
  onSearch: (search: string) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [text, setText] = useState(value);
  return (
    <form
      role="search"
      className="toolbar-item search"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(text.trim());
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className="search-row">
        <input
          id={id}
          type="search"
          className="input"
          value={text}
          autoComplete="off"
          spellCheck={false}
          maxLength={SEARCH_MAX_LENGTH}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn-primary">
          {t('common.search')}
        </button>
        {value && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setText('');
              onSearch('');
            }}
          >
            {t('common.clear')}
          </button>
        )}
      </div>
    </form>
  );
}

export function Select<V extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: { value: V; label: string }[];
  onChange: (value: V) => void;
}) {
  const id = useId();
  return (
    <div className="toolbar-item">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="input"
        value={String(value)}
        onChange={(e) => {
          const picked = options.find((o) => String(o.value) === e.target.value);
          if (picked) onChange(picked.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The period filter of the overview and the screens page: 7 / 30 / 90 days (and a day count from a URL). */
export function DaysSelect({ days, onChange }: { days: number; onChange: (days: number) => void }) {
  const { t, lang } = useI18n();
  const values: number[] = DAY_RANGES.includes(days as (typeof DAY_RANGES)[number])
    ? [...DAY_RANGES]
    : [...DAY_RANGES, days].sort((a, b) => a - b);
  return (
    <Select
      label={t('range.label')}
      value={days}
      options={values.map((d) => ({ value: d, label: t('range.days', { days: formatNumber(lang, d) }) }))}
      onChange={onChange}
    />
  );
}

/**
 * The four player colours and shapes of the app (docs/design/tokens.json, color.players: ring and
 * shapePath): ownership is never colour alone.
 */
export const SEATS = [
  { color: '#36c9f0', path: 'M12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16z' },
  { color: '#ff9440', path: 'M12 4l8 15H4z' },
  { color: '#a2e28e', path: 'M5 5h14v14H5z' },
  { color: '#a57af0', path: 'M12 3l9 9-9 9-9-9z' },
] as const;

/** A seat's shape in its colour, named for screen readers ("Player 2"). */
export function Seat({ seat }: { seat: number }) {
  const { t } = useI18n();
  const look = SEATS[seat];
  return (
    <span className="seat">
      <svg className="seat-shape" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        {look ? (
          <path d={look.path} fill={look.color} />
        ) : (
          <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
        )}
      </svg>
      <span className="visually-hidden">{t('game.seat', { n: seat + 1 })}</span>
    </span>
  );
}
