import { useEffect, useRef, useState } from 'react';

import { type AdminApi, createApi, type FetchLike, toApiError } from './api';
import { LangToggle } from './components/LangToggle';
import { PageHeader } from './components/ui';
import { ApiContext, NowContext } from './data';
import { useI18n } from './i18n';
import { AuditPage } from './pages/AuditPage';
import { GameDetailPage } from './pages/GameDetailPage';
import { GamesPage } from './pages/GamesPage';
import { InstallDetailPage } from './pages/InstallDetailPage';
import { InstallsPage } from './pages/InstallsPage';
import { LoginPage, type LoginNotice } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { ReportsPage } from './pages/ReportsPage';
import { ScreensPage } from './pages/ScreensPage';
import { UserDetailPage } from './pages/UserDetailPage';
import { UsersPage } from './pages/UsersPage';
import {
  DEFAULT_DAYS,
  DEFAULT_REPORT_FILTER,
  type Route,
  routeHref,
  type Section,
  sectionOf,
  useRoute,
} from './router';
import type { StringKey } from './strings';

/**
 * The admin site (spec §27.3): for viewing, but for the moderation actions on the reports (spec §3.5), each
 * confirmed and written to the audit log. It asks the server for the session first; without one it shows
 * the login, and any 401 later (the cookie ran out, the server restarted with a new secret) brings it back.
 */

type Auth = { status: 'checking' } | { status: 'signedIn' } | { status: 'signedOut'; notice: LoginNotice };

const MINUTE = 60_000;

export function App({ fetch }: { fetch?: FetchLike } = {}) {
  const [auth, setAuth] = useState<Auth>({ status: 'checking' });
  const [api] = useState<AdminApi>(() =>
    createApi({ fetch, onUnauthorized: () => setAuth({ status: 'signedOut', notice: 'expired' }) }),
  );
  const [check, setCheck] = useState(0);

  useEffect(() => {
    let live = true;
    api.session().then(
      () => {
        if (live) setAuth({ status: 'signedIn' });
      },
      (err: unknown) => {
        if (!live) return;
        const { code } = toApiError(err);
        const notice: LoginNotice =
          code === 'disabled' ? 'disabled' : code === 'unauthorized' ? null : 'unreachable';
        setAuth({ status: 'signedOut', notice });
      },
    );
    return () => {
      live = false;
    };
  }, [api, check]);

  if (auth.status === 'checking') return <Checking />;
  if (auth.status === 'signedOut') {
    return (
      <LoginPage
        key={check}
        api={api}
        notice={auth.notice}
        onSignedIn={() => setAuth({ status: 'signedIn' })}
        onRecheck={() => {
          setAuth({ status: 'checking' });
          setCheck((c) => c + 1);
        }}
      />
    );
  }
  return (
    <ApiContext value={api}>
      <Shell
        onLogout={() => {
          const done = () => setAuth({ status: 'signedOut', notice: null });
          api.logout().then(done, done);
        }}
      />
    </ApiContext>
  );
}

function Checking() {
  const { t } = useI18n();
  return (
    <main className="login">
      <p className="state state-loading" role="status">
        {t('login.checking')}
      </p>
    </main>
  );
}

const NAV: { section: Section; label: StringKey; route: Route }[] = [
  { section: 'overview', label: 'nav.overview', route: { name: 'overview' } },
  { section: 'installs', label: 'nav.installs', route: { name: 'installs' } },
  { section: 'users', label: 'nav.users', route: { name: 'users' } },
  { section: 'games', label: 'nav.games', route: { name: 'games' } },
  { section: 'screens', label: 'nav.screens', route: { name: 'screens' } },
  { section: 'reports', label: 'nav.reports', route: { name: 'reports' } },
  { section: 'audit', label: 'nav.audit', route: { name: 'audit' } },
];

/** "Now" for relative times, moved on every minute. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), MINUTE);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const { t } = useI18n();
  const route = useRoute();
  const now = useMinuteClock();
  const main = useRef<HTMLElement>(null);
  const current = sectionOf(route);

  // A new page: focus its heading, so a screen reader starts there and Tab continues from it.
  const pageKey = route.name === 'install' || route.name === 'user' || route.name === 'game' ? route.id : '';
  const firstPage = useRef(true);
  useEffect(() => {
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    main.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [route.name, pageKey]);

  return (
    <NowContext value={now}>
      <div className="shell">
        <header className="topbar">
          <div className="topbar-inner">
            <a className="brand" href={routeHref({ name: 'overview' })}>
              <span className="brand-mark" aria-hidden="true" />
              {t('app.name')} · {t('app.admin')}
            </a>
            <nav className="nav" aria-label={t('nav.label')}>
              <ul>
                {NAV.map((item) => (
                  <li key={item.section}>
                    <a
                      href={routeHref(item.route)}
                      aria-current={current === item.section ? 'page' : undefined}
                    >
                      {t(item.label)}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="topbar-actions">
              <LangToggle />
              <button type="button" className="btn" onClick={onLogout}>
                {t('auth.logout')}
              </button>
            </div>
          </div>
        </header>
        <main ref={main} className="main">
          <Page route={route} />
        </main>
      </div>
    </NowContext>
  );
}

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'overview':
      return <OverviewPage days={route.days ?? DEFAULT_DAYS} />;
    case 'installs':
      return <InstallsPage search={route.search ?? ''} page={route.page ?? 1} />;
    case 'install':
      return <InstallDetailPage id={route.id} />;
    case 'users':
      return <UsersPage search={route.search ?? ''} page={route.page ?? 1} />;
    case 'user':
      return <UserDetailPage id={route.id} />;
    case 'games':
      return <GamesPage mode={route.mode ?? ''} search={route.search ?? ''} page={route.page ?? 1} />;
    case 'game':
      return <GameDetailPage id={route.id} />;
    case 'screens':
      return <ScreensPage days={route.days ?? DEFAULT_DAYS} />;
    case 'reports':
      return <ReportsPage status={route.status ?? DEFAULT_REPORT_FILTER} page={route.page ?? 1} />;
    case 'audit':
      return <AuditPage page={route.page ?? 1} />;
    case 'notFound':
      return <NotFound />;
  }
}

function NotFound() {
  const { t } = useI18n();
  return (
    <PageHeader
      title={t('notFound.title')}
      docTitle={t('notFound.title')}
      back={{ href: routeHref({ name: 'overview' }), label: t('notFound.back') }}
    />
  );
}
