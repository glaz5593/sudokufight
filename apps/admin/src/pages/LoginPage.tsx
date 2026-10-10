import { type FormEvent, useId, useRef, useState } from 'react';

import { type AdminApi, toApiError } from '../api';
import { LangToggle } from '../components/LangToggle';
import { formatWait } from '../format';
import { useI18n } from '../i18n';
import type { StringKey } from '../strings';

/** Why the login screen is showing, besides "not signed in yet". */
export type LoginNotice = 'expired' | 'disabled' | 'unreachable' | null;

/**
 * The admin password from the server's settings (spec §27.3). The server answers 204 with an HttpOnly
 * session cookie, 401 for a wrong password, 429 after too many tries and 503 when no password is set.
 */
export function LoginPage({
  api,
  notice,
  onSignedIn,
  onRecheck,
}: {
  api: AdminApi;
  notice: LoginNotice;
  onSignedIn: () => void;
  onRecheck: () => void;
}) {
  const { t, lang } = useI18n();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(notice === 'disabled');

  const fail = (key: StringKey, vars?: Record<string, string>) => {
    setBusy(false);
    setError(t(key, vars));
    input.current?.focus();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!password) return fail('login.error.empty');
    setBusy(true);
    setError(null);
    api.login(password).then(onSignedIn, (err: unknown) => {
      const failure = toApiError(err);
      setPassword('');
      switch (failure.code) {
        case 'unauthorized':
          return fail('login.error.wrong');
        case 'tooManyRequests':
          return failure.retryAfterMs === null
            ? fail('login.error.tooManyLater')
            : fail('login.error.tooMany', { time: formatWait(lang, failure.retryAfterMs) });
        case 'disabled':
          setDisabled(true);
          return fail('login.error.disabled');
        case 'network':
          return fail('login.error.network');
        default:
          return fail('login.error.server');
      }
    });
  };

  const message =
    error ??
    (disabled
      ? t('login.error.disabled')
      : notice === 'expired'
        ? t('login.expired')
        : notice === 'unreachable'
          ? t('login.error.network')
          : null);

  return (
    <main className="login">
      <div className="login-card card">
        <div className="login-top">
          <p className="brand">
            <span className="brand-mark" aria-hidden="true" />
            {t('app.name')} · {t('app.admin')}
          </p>
          <LangToggle />
        </div>
        <h1>{t('login.title')}</h1>
        <p className="muted">{t('login.intro')}</p>
        <form onSubmit={submit} noValidate>
          <label htmlFor={id}>{t('login.password')}</label>
          <input
            ref={input}
            id={id}
            type="password"
            className="input"
            autoComplete="current-password"
            autoFocus
            dir="ltr"
            value={password}
            disabled={disabled}
            aria-invalid={error !== null}
            aria-describedby={message ? `${id}-msg` : undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
          {message && (
            <p id={`${id}-msg`} className="form-error" role="alert">
              {message}
            </p>
          )}
          <div className="login-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || disabled}>
              {busy ? t('login.submitting') : t('login.submit')}
            </button>
            {(notice === 'unreachable' || disabled) && (
              <button type="button" className="btn" onClick={onRecheck}>
                {t('login.recheck')}
              </button>
            )}
          </div>
        </form>
      </div>
    </main>
  );
}
