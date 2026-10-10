import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { INSTALL_A, installDetail, installsPage, USER_A, userDetail } from '../testing/fixtures';
import { isolate } from '../strings';
import { fakeServer, renderSite, SIGNED_IN } from '../testing/server';

function setup(hash = '#/installs') {
  const server = fakeServer({
    'GET /session': SIGNED_IN,
    'GET /installs': (req) => ({ body: installsPage(Number(req.query.get('page') ?? '1')) }),
    [`GET /installs/${INSTALL_A}`]: { body: installDetail() },
    [`GET /users/${USER_A}`]: { body: userDetail() },
  });
  renderSite(server, { hash });
  return server;
}

const table = () => screen.getByRole('table', { name: 'Installs' });

describe('installs', () => {
  it('lists installs: short id, platform, version, last seen as "3 days ago" with the date as a tooltip', async () => {
    const server = setup();
    await screen.findByRole('table', { name: 'Installs' });
    expect(server.gets('/installs')).toEqual(['/admin/api/installs?page=1&pageSize=50']);

    const rows = within(table()).getAllByRole('row');
    expect(rows).toHaveLength(3);
    const first = rows[1] as HTMLElement;
    expect(
      within(first)
        .getByRole('link', { name: INSTALL_A.slice(0, 8) })
        .getAttribute('href'),
    ).toBe(`#/installs/${INSTALL_A}`);
    expect(within(first).getByText('Android')).toBeTruthy();
    expect(within(first).getByText('0.1.0')).toBeTruthy();
    const lastSeen = within(first).getByText('3 days ago');
    expect(lastSeen.tagName).toBe('TIME');
    expect(lastSeen.getAttribute('title')).toMatch(/\d{4}/);
    expect(within(first).getByRole('link', { name: 'Moshe' }).getAttribute('href')).toBe(`#/users/${USER_A}`);
    expect(within(rows[2] as HTMLElement).getByText('No account')).toBeTruthy();
    expect(screen.getByText('Page 1 of 3 · 120 in all')).toBeTruthy();
  });

  it('search asks the server with the text and starts again at page 1', async () => {
    const server = setup('#/installs?page=2');
    await screen.findByText('Page 2 of 3 · 120 in all');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '  pixel  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() =>
      expect(server.gets('/installs')).toEqual([
        '/admin/api/installs?page=2&pageSize=50',
        '/admin/api/installs?search=pixel&page=1&pageSize=50',
      ]),
    );
    expect(window.location.hash).toBe('#/installs?search=pixel');

    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(server.gets('/installs')).toHaveLength(3));
    expect(server.gets('/installs')[2]).toBe('/admin/api/installs?page=1&pageSize=50');
  });

  it('paging asks for the next and previous pages, and stops at the ends', async () => {
    const server = setup();
    await screen.findByText('Page 1 of 3 · 120 in all');
    expect(screen.getByRole('button', { name: 'Previous' })).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Page 2 of 3 · 120 in all');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Page 3 of 3 · 120 in all');
    expect(screen.getByRole('button', { name: 'Next' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await screen.findByText('Page 2 of 3 · 120 in all');

    expect(server.gets('/installs')).toEqual([
      '/admin/api/installs?page=1&pageSize=50',
      '/admin/api/installs?page=2&pageSize=50',
      '/admin/api/installs?page=3&pageSize=50',
      '/admin/api/installs?page=2&pageSize=50',
    ]);
  });

  it('a row opens the install: its sessions as screen paths and its latest events', async () => {
    setup();
    await screen.findByRole('table', { name: 'Installs' });
    fireEvent.click(within(table()).getAllByText('Android')[0] as HTMLElement);
    expect(
      await screen.findByRole('heading', { name: `Install ${INSTALL_A.slice(0, 8)}`, level: 1 }),
    ).toBeTruthy();
    await screen.findByText(INSTALL_A);

    const path = screen.getByRole('list', { name: 'Screen path' });
    // Screen readers get the three screens; the arrows between them are for the eye only.
    expect(
      within(path)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['home', 'lobby', 'game']);
    expect(path.textContent).toBe('home→lobby→game');
    // The duration sits in LRI…PDI isolates (strings.ts isolate()).
    const head = document.querySelector('.session-head')?.textContent ?? '';
    expect(head.endsWith(`· ${isolate('4:10')} · screens: 3`)).toBe(true);

    const events = screen.getByRole('table', { name: 'Recent events' });
    expect(within(events).getByText('screen_view')).toBeTruthy();
    expect(within(events).getByText('{"screen":"game"}')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All installs' }).getAttribute('href')).toBe('#/installs');
  });

  it('a click on the user link inside a row opens the user, not the install', async () => {
    setup();
    await screen.findByRole('table', { name: 'Installs' });
    const link = within(table()).getAllByRole('link', { name: 'Moshe' })[0] as HTMLElement;
    fireEvent.click(link);
    // The link may move the hash to the user (jsdom follows fragment links); the row must not take over.
    await new Promise((r) => setTimeout(r, 0));
    expect(window.location.hash).not.toContain('/installs/');
  });

  it('an unknown install says not found', async () => {
    setup('#/installs/nope');
    expect((await screen.findByRole('alert')).textContent).toBe('Not found.');
  });
});
