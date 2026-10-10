import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import { overviewFixture } from './testing/fixtures';
import { fakeServer, renderSite, SIGNED_IN, SIGNED_OUT } from './testing/server';

const password = () => screen.getByLabelText('Admin password');
const signIn = () => screen.getByRole('button', { name: 'Sign in' });

function typeAndSubmit(value: string) {
  fireEvent.change(password(), { target: { value } });
  fireEvent.click(signIn());
}

describe('signing in', () => {
  it('shows the login without a session, and the site after the right password', async () => {
    let signedIn = false;
    const server = fakeServer({
      'GET /session': () => (signedIn ? SIGNED_IN : SIGNED_OUT),
      'POST /login': (req) => {
        const ok = (req.body as { password?: string }).password === 'the-right-password';
        signedIn = ok;
        return ok ? { status: 204 } : { status: 401, body: { error: 'unauthorized' } };
      },
      'GET /overview': { body: overviewFixture() },
    });
    renderSite(server);

    expect(await screen.findByRole('heading', { name: 'Sign in to the admin site' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    // Nothing but the session check went out before signing in.
    expect(server.requests.map((r) => r.path)).toEqual(['/session']);

    fireEvent.click(signIn());
    expect((await screen.findByRole('alert')).textContent).toBe('Type the password.');

    typeAndSubmit('wrong');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Wrong password.'));
    expect(password()).toHaveProperty('value', '');

    typeAndSubmit('the-right-password');
    expect(await screen.findByRole('heading', { name: 'Overview', level: 1 })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(await screen.findByText('1,234')).toBeTruthy();
    expect(server.requests.filter((r) => r.path === '/login')).toHaveLength(2);
  });

  it('says how long to wait after too many tries', async () => {
    const server = fakeServer({
      'GET /session': SIGNED_OUT,
      'POST /login': { status: 429, body: { error: 'tooManyRequests' }, headers: { 'Retry-After': '30' } },
    });
    renderSite(server);
    await screen.findByLabelText('Admin password');
    typeAndSubmit('again');
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Too many tries. Try again in 30 seconds.'),
    );
  });

  it('a server without an admin password: says so and keeps the form shut', async () => {
    const server = fakeServer({ 'GET /session': { status: 503, body: { error: 'disabled' } } });
    renderSite(server);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('ADMIN_PASSWORD');
    expect(password()).toHaveProperty('disabled', true);
    expect(signIn()).toHaveProperty('disabled', true);
  });

  it('an unreachable server: says so, and "check again" retries the session', async () => {
    let up = false;
    const server = fakeServer({ 'GET /session': () => (up ? SIGNED_IN : { status: 502 }) });
    server.on('GET /overview', { body: overviewFixture() });
    const failing = server.fetch;
    let calls = 0;
    server.fetch = (url, init) => {
      calls++;
      return calls === 1 ? Promise.reject(new TypeError('Failed to fetch')) : failing(url, init);
    };
    renderSite(server);
    expect((await screen.findByRole('alert')).textContent).toBe("Can't reach the server.");
    up = true;
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByRole('heading', { name: 'Overview', level: 1 })).toBeTruthy();
  });
});

describe('a 401 anywhere', () => {
  it('goes back to the login, says the session ended, and returns to the same page after signing in', async () => {
    let session = true;
    const server = fakeServer({
      'GET /session': () => (session ? SIGNED_IN : SIGNED_OUT),
      'GET /overview': { body: overviewFixture() },
      'GET /installs': () =>
        session ? { body: { items: [], page: 1, pageSize: 50, total: 0 } } : SIGNED_OUT,
      'POST /login': () => {
        session = true;
        return { status: 204 };
      },
    });
    renderSite(server);
    await screen.findByRole('heading', { name: 'Overview', level: 1 });

    // The cookie runs out; the next page's request gets a 401.
    session = false;
    act(() => {
      window.location.hash = '#/installs';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect((await screen.findByRole('alert')).textContent).toBe('Your session ended. Sign in again.');
    expect(screen.queryByRole('navigation')).toBeNull();

    typeAndSubmit('the-right-password');
    expect(await screen.findByRole('heading', { name: 'Installs', level: 1 })).toBeTruthy();
    expect(await screen.findByText('No installs yet.')).toBeTruthy();
  });

  it('signing out asks the server and shows the login', async () => {
    const server = fakeServer({
      'GET /session': SIGNED_IN,
      'GET /overview': { body: overviewFixture() },
      'POST /logout': { status: 204 },
    });
    renderSite(server);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to the admin site' })).toBeTruthy();
    expect(server.requests.some((r) => r.method === 'POST' && r.path === '/logout')).toBe(true);
  });
});

describe('language', () => {
  it('Hebrew by default, right to left; the toggle switches to English, left to right', async () => {
    const server = fakeServer({ 'GET /session': SIGNED_OUT });
    renderSite(server, { lang: 'he' });
    expect(await screen.findByRole('heading', { name: 'כניסה לאתר הניהול' })).toBeTruthy();
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('he');

    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('heading', { name: 'Sign in to the admin site' })).toBeTruthy();
    expect(document.documentElement.dir).toBe('ltr');
    expect(window.localStorage.getItem('sudoku-fight-admin.lang')).toBe('en');
  });

  it('marks the current page in the nav and names the tab', async () => {
    const server = fakeServer({ 'GET /session': SIGNED_IN, 'GET /overview': { body: overviewFixture() } });
    renderSite(server, { lang: 'he' });
    const current = await screen.findByRole('link', { current: 'page' });
    expect(current.textContent).toBe('סקירה');
    expect(document.title).toBe('סקירה · ניהול סודוקו פייט');
  });

  it('an unknown address shows "not found" with a way back', async () => {
    const server = fakeServer({ 'GET /session': SIGNED_IN });
    renderSite(server, { hash: '#/nowhere' });
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to the overview' }).getAttribute('href')).toBe(
      '#/overview',
    );
  });
});
