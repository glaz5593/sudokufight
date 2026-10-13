import type { AdminAuthMethods, AdminGoogleWebConfig } from '@sudoku-fight/protocol';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';

import { type AdminApi, type ApiError, toApiError } from '../api';
import { LangToggle } from '../components/LangToggle';
import { formatWait } from '../format';
import {
  type GoogleAccount,
  type GoogleSignIn,
  type GoogleSignInError,
  loadGoogleSignIn,
  toGoogleSignInError,
} from '../google';
import { useI18n } from '../i18n';
import { isolate, type StringKey } from '../strings';

/** Why the login screen is showing, besides "not signed in yet". */
export type LoginNotice = 'expired' | 'disabled' | 'unreachable' | null;

/**
 * The sign-in (spec §27.3). The server says how it lets an admin in (GET /admin/api/auth/methods): with Google
 * (an account on its ADMIN_EMAILS list; the real servers), with the admin password, or both. Either way the
 * server answers 204 with the same HttpOnly session cookie.
 *
 * Google: the Firebase JS SDK opens Google's account chooser in a popup (google.ts loads the SDK only when the
 * server offers Google), the page posts the account's Firebase ID token to /login/google and then signs out
 * of Firebase: the session cookie is what keeps the admin signed in. The button takes a click only once the
 * SDK is ready ("Loading Google sign-in…" until then; focusable, aria-disabled), so nothing is downloaded
 * between the click and the popup, which the browser would then block. A failed load says why under the
 * button, which then loads it again (and only that: the next click opens the popup).
 *
 * Password: 401 wrong password. Both: 429 after too many tries (one budget). 403 `disabled`: that way is off
 * on this server; 503 `disabled`: the whole admin site is off (no way to sign in is set up).
 */

/** What the server takes; 'off' when it takes nothing (the admin site is off), 'unknown' when it can't be asked. */
type Methods =
  | { status: 'loading' }
  | { status: 'ready'; password: boolean; google: AdminGoogleWebConfig | null }
  | { status: 'off' }
  | { status: 'unknown' };

/**
 * A message, kept as a key so it follows a language switch, and shown where it belongs: at the top of the
 * card, under the Google button or under the password.
 */
interface Message {
  at: 'page' | 'google' | 'password';
  key: StringKey;
  /** Left-to-right values for the placeholders (an address, a host): isolated inside the sentence. */
  values?: Record<string, string>;
  /** For {time}: how long to wait. */
  waitMs?: number;
  /** A technical detail (a Firebase code, the server's reason), shown as it is under the message. */
  detail?: string;
}

type Problem = Omit<Message, 'at'>;

type Busy = 'password' | 'google' | 'googleServer' | null;

/** The Firebase SDK for the server's web config: loading (the button waits for it), ready, or failed. */
type Sdk =
  | { status: 'loading' }
  | { status: 'ready'; signer: GoogleSignIn }
  | { status: 'failed'; error: GoogleSignInError };

/** How a load of the SDK ended: for which config, and which try (the button's "load again" starts another). */
interface SdkLoad {
  config: AdminGoogleWebConfig;
  attempt: number;
  sdk: Exclude<Sdk, { status: 'loading' }>;
}

function methodsOf({ password, google }: AdminAuthMethods): Methods {
  return password || google !== null ? { status: 'ready', password, google } : { status: 'off' };
}

function noticeMessage(notice: LoginNotice): Message | null {
  if (notice === 'expired') return { at: 'page', key: 'login.expired' };
  if (notice === 'unreachable') return { at: 'page', key: 'login.error.network' };
  return null;
}

function tooMany(failure: ApiError): Problem {
  return failure.retryAfterMs === null
    ? { key: 'login.error.tooManyLater' }
    : { key: 'login.error.tooMany', waitMs: failure.retryAfterMs };
}

function passwordProblem(failure: ApiError): Problem {
  switch (failure.code) {
    case 'unauthorized':
      return { key: 'login.error.wrong' };
    case 'tooManyRequests':
      return tooMany(failure);
    case 'network':
      return { key: 'login.error.network' };
    default:
      return { key: 'login.error.server' };
  }
}

/** Google's side: the popup, or the SDK. */
function googleProblem(error: GoogleSignInError): Problem {
  switch (error.failure) {
    case 'popupClosed':
      return { key: 'login.google.closed' };
    case 'popupBlocked':
      return { key: 'login.google.blocked' };
    case 'network':
      return { key: 'login.google.network' };
    case 'load':
      return { key: 'login.google.load' };
    case 'unauthorizedDomain':
      return {
        key: 'login.google.unauthorizedDomain',
        values: { host: window.location.hostname },
        detail: error.code ?? undefined,
      };
    case 'providerOff':
      return { key: 'login.google.providerOff', detail: error.code ?? undefined };
    case 'webStorage':
      return { key: 'login.google.webStorage', detail: error.code ?? undefined };
    case 'failed':
      return { key: 'login.google.failed', detail: error.code ?? error.message };
  }
}

/** The server's answer to a Google sign-in (AdminGoogleLoginError), but `disabled`. */
function googleServerProblem(failure: ApiError, account: GoogleAccount): Problem {
  switch (failure.code) {
    case 'notAllowed':
      return account.email === null
        ? { key: 'login.google.notAllowedNoEmail' }
        : { key: 'login.google.notAllowed', values: { email: account.email } };
    case 'unverifiedEmail':
      return { key: 'login.google.unverified' };
    case 'wrongProvider':
      return { key: 'login.google.wrongProvider' };
    case 'invalidToken':
      return { key: 'login.google.invalidToken', detail: failure.message };
    case 'unavailable':
      return { key: 'login.google.unavailable' };
    case 'tooManyRequests':
      return tooMany(failure);
    case 'network':
      return { key: 'login.error.network' };
    default:
      return { key: 'login.error.server' };
  }
}

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
  const googleButton = useRef<HTMLButtonElement>(null);
  const [sdkAttempt, setSdkAttempt] = useState(0);
  const [sdkLoad, setSdkLoad] = useState<SdkLoad | null>(null);
  const [methods, setMethods] = useState<Methods>(() =>
    notice === 'disabled'
      ? { status: 'off' }
      : notice === 'unreachable'
        ? { status: 'unknown' }
        : { status: 'loading' },
  );
  const [message, setMessage] = useState<Message | null>(() => noticeMessage(notice));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<Busy>(null);

  const asking = methods.status === 'loading';
  useEffect(() => {
    if (!asking) return;
    let live = true;
    api.authMethods().then(
      (found) => {
        if (live) setMethods(methodsOf(found));
      },
      (err: unknown) => {
        if (!live) return;
        const failure = toApiError(err);
        if (failure.code === 'disabled') return setMethods({ status: 'off' });
        setMethods({ status: 'unknown' });
        setMessage({
          at: 'page',
          key: failure.code === 'network' ? 'login.error.network' : 'login.error.server',
        });
      },
    );
    return () => {
      live = false;
    };
  }, [api, asking]);

  const google = methods.status === 'ready' ? methods.google : null;
  const passwordOn = methods.status === 'ready' && methods.password;

  // Load the SDK as soon as the server offers Google (and again on "load again"), so the click can open the
  // popup at once.
  useEffect(() => {
    if (google === null) return;
    let live = true;
    const ended = (sdk: SdkLoad['sdk']) => {
      if (live) setSdkLoad({ config: google, attempt: sdkAttempt, sdk });
    };
    loadGoogleSignIn(google).then(
      (signer) => ended({ status: 'ready', signer }),
      (error: unknown) => ended({ status: 'failed', error: toGoogleSignInError(error) }),
    );
    return () => {
      live = false;
    };
  }, [google, sdkAttempt]);
  const sdk: Sdk | null =
    google === null
      ? null
      : sdkLoad !== null && sdkLoad.config === google && sdkLoad.attempt === sdkAttempt
        ? sdkLoad.sdk
        : { status: 'loading' };

  // After a failed try, back to the control that failed.
  useEffect(() => {
    if (message?.at === 'password') input.current?.focus();
    else if (message?.at === 'google') googleButton.current?.focus();
  }, [message]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy !== null) return;
    if (!password) return setMessage({ at: 'password', key: 'login.error.empty' });
    setBusy('password');
    setMessage(null);
    api.login(password).then(onSignedIn, (err: unknown) => {
      const failure = toApiError(err);
      setPassword('');
      setBusy(null);
      if (failure.code === 'disabled') {
        if (failure.status === 503 || google === null) return setMethods({ status: 'off' });
        // The server's settings changed since the page asked: Google only now.
        setMethods({ status: 'ready', password: false, google });
        return setMessage({ at: 'google', key: 'login.passwordOff' });
      }
      setMessage({ at: 'password', ...passwordProblem(failure) });
    });
  };

  const signInWithGoogle = async (signer: GoogleSignIn) => {
    setBusy('google');
    setMessage(null);
    let account: GoogleAccount;
    try {
      // Nothing awaited before this: the popup opens within the click.
      account = await signer.signIn(lang);
    } catch (error) {
      setBusy(null);
      return setMessage({ at: 'google', ...googleProblem(toGoogleSignInError(error)) });
    }
    setBusy('googleServer');
    try {
      await api.loginWithGoogle(account.idToken);
    } catch (err) {
      const failure = toApiError(err);
      setBusy(null);
      if (failure.code === 'disabled') {
        if (failure.status === 503 || !passwordOn) return setMethods({ status: 'off' });
        // The server's settings changed since the page asked: the password only now.
        setMethods({ status: 'ready', password: true, google: null });
        return setMessage({ at: 'password', key: 'login.google.off' });
      }
      return setMessage({ at: 'google', ...googleServerProblem(failure, account) });
    } finally {
      void signer.signOut();
    }
    onSignedIn();
  };

  /** The Google button: signs in once the SDK is ready, loads it again after a failure, waits meanwhile. */
  const onGoogleClick = () => {
    if (busy !== null || sdk === null || sdk.status === 'loading') return;
    if (sdk.status === 'failed') return setSdkAttempt((n) => n + 1);
    void signInWithGoogle(sdk.signer);
  };

  const shown: Message | null =
    methods.status === 'off' ? { at: 'page', key: 'login.error.disabled' } : message;
  const messageId = `${id}-msg`;
  const messageAt = (at: Message['at'], className?: string) =>
    shown?.at === at ? <MessageLine id={messageId} message={shown} className={className} /> : null;
  // A failed load of the SDK: under the button, unless a newer message is there. Not in `message`, so it
  // takes no focus (the admin may be typing the password by then).
  const sdkFailure: Message | null =
    sdk?.status === 'failed' && shown?.at !== 'google' ? { at: 'google', ...googleProblem(sdk.error) } : null;
  const sdkFailureId = `${id}-sdk`;
  const googleLabel =
    busy === 'google'
      ? t('login.google.waiting')
      : busy === 'googleServer'
        ? t('login.submitting')
        : sdk?.status === 'loading'
          ? t('login.google.loading')
          : sdk?.status === 'failed'
            ? t('login.google.reload')
            : t('login.google');
  const intro: StringKey | null =
    methods.status !== 'ready'
      ? null
      : google !== null && passwordOn
        ? 'login.introBoth'
        : google !== null
          ? 'login.introGoogle'
          : 'login.intro';

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
        {methods.status === 'loading' && (
          <p className="muted" role="status">
            {t('login.loadingMethods')}
          </p>
        )}
        {intro !== null && <p className="muted">{t(intro)}</p>}
        {messageAt('page', 'login-notice')}
        {google !== null && (
          <div className="login-google">
            <button
              ref={googleButton}
              type="button"
              className="btn btn-google"
              autoFocus
              disabled={busy !== null}
              aria-disabled={sdk?.status === 'loading' || undefined}
              aria-busy={busy === 'google' || busy === 'googleServer' || sdk?.status === 'loading'}
              aria-describedby={
                shown?.at === 'google' ? messageId : sdkFailure !== null ? sdkFailureId : undefined
              }
              onClick={onGoogleClick}
            >
              <GoogleMark />
              {googleLabel}
            </button>
            {messageAt('google')}
            {sdkFailure !== null && <MessageLine id={sdkFailureId} message={sdkFailure} />}
          </div>
        )}
        {google !== null && passwordOn && <p className="login-or">{t('login.or')}</p>}
        {passwordOn && (
          <form onSubmit={submit} noValidate>
            <label htmlFor={id}>{t('login.password')}</label>
            <input
              ref={input}
              id={id}
              type="password"
              className="input"
              autoComplete="current-password"
              autoFocus={google === null}
              dir="ltr"
              value={password}
              // "Google is off" sits here too, but says nothing against the password.
              aria-invalid={shown?.at === 'password' && shown.key !== 'login.google.off'}
              aria-describedby={shown?.at === 'password' ? messageId : undefined}
              onChange={(e) => setPassword(e.target.value)}
            />
            {messageAt('password')}
            <div className="login-actions">
              <button
                type="submit"
                className={google === null ? 'btn btn-primary login-submit' : 'btn login-submit'}
                disabled={busy !== null}
              >
                {busy === 'password' ? t('login.submitting') : t('login.submit')}
              </button>
            </div>
          </form>
        )}
        {(methods.status === 'off' || methods.status === 'unknown') && (
          <div className="login-actions">
            <button type="button" className="btn" onClick={onRecheck}>
              {t('login.recheck')}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function MessageLine({ id, message, className }: { id: string; message: Message; className?: string }) {
  const { t, lang } = useI18n();
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(message.values ?? {})) vars[name] = isolate(value);
  if (message.waitMs !== undefined) vars.time = formatWait(lang, message.waitMs);
  return (
    <p id={id} className={className ? `form-error ${className}` : 'form-error'} role="alert">
      {t(message.key, vars)}
      {message.detail !== undefined && (
        <span className="form-error-detail mono">
          <bdi dir="ltr">{message.detail}</bdi>
        </span>
      )}
    </p>
  );
}

/** Google's "G", as on its sign-in buttons. Decorative: the button says "Google" in words. */
function GoogleMark() {
  return (
    <svg
      className="google-mark"
      viewBox="0 0 48 48"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
