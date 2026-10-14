import type { AdminUserDetail } from '@sudoku-fight/protocol';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { moderationResult, USER_A, userDetail, userRow } from '../testing/fixtures';
import { fakeServer, renderSite, SIGNED_IN } from '../testing/server';

/** The user page of USER_A; `user` answers GET /users/USER_A (it may change between calls). */
function setup(user: () => AdminUserDetail) {
  const server = fakeServer({
    'GET /session': SIGNED_IN,
    [`GET /users/${USER_A}`]: () => ({ body: user() }),
  });
  renderSite(server, { hash: `#/users/${USER_A}` });
  return server;
}

const section = () => screen.findByRole('region', { name: 'Moderation' });
const fact = (region: HTMLElement, label: string) => within(region).getByText(label).nextElementSibling;

describe('a user: moderation (spec §3.5)', () => {
  it('shows the state, open reports with the way to them, and suspends after a confirmation', async () => {
    let suspendedAt: number | null = null;
    const server = setup(() => ({ ...userDetail(), suspendedAt }));
    server.on(`POST /users/${USER_A}/suspend`, () => {
      suspendedAt = Date.now();
      return { body: moderationResult({ suspendedAt }, { action: 'suspend' }) };
    });

    const region = await section();
    expect(fact(region, 'Suspension')?.textContent).toBe('Not suspended');
    expect(fact(region, 'Display name')?.textContent).toBe("MosheThe player's own choice");
    const reports = fact(region, 'Open reports about them') as HTMLElement;
    expect(reports.textContent).toContain('3');
    expect(within(reports).getByRole('link', { name: 'Go to the reports' }).getAttribute('href')).toBe(
      '#/reports',
    );
    expect(within(reports).getByRole('link', { name: 'Go to the audit log' }).getAttribute('href')).toBe(
      '#/audit',
    );

    fireEvent.click(within(region).getByRole('button', { name: 'Suspend account (Moshe)' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspend account' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe("Moshe's account is suspended."));
    expect(server.requests.filter((r) => r.method === 'POST').map((r) => [r.path, r.body])).toEqual([
      [`/users/${USER_A}/suspend`, {}],
    ]);

    // Reloaded: suspended since now, a badge by the name, and the button lifts it.
    expect(await within(region).findByRole('button', { name: 'Lift suspension (Moshe)' })).toBeTruthy();
    expect(fact(region, 'Suspension')?.textContent).toMatch(/^Suspended since .*\d/);
    const header = screen.getByRole('heading', { level: 1, name: 'Moshe' }).parentElement as HTMLElement;
    expect(within(header).getByText('Suspended')).toBeTruthy();
  });

  it('a name reset: the new temporary name at the top, and the player is waiting to choose one', async () => {
    let reset = false;
    const server = setup(() =>
      reset ? { ...userDetail(), displayName: 'שחקן48213', nameResetRequired: true } : userDetail(),
    );
    server.on(`POST /users/${USER_A}/reset-name`, () => {
      reset = true;
      return {
        body: moderationResult(
          { displayName: 'שחקן48213', nameResetRequired: true },
          { action: 'resetName', details: { fromName: 'Moshe', toName: 'שחקן48213' } },
        ),
      };
    });
    const region = await section();
    fireEvent.click(within(region).getByRole('button', { name: 'Reset name (Moshe)' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset name' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'שחקן48213' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe("Moshe's name is reset to שחקן48213.");
    expect(screen.getAllByText('Waiting for a new name').length).toBeGreaterThan(0);
    expect(fact(region, 'Display name')?.textContent).toBe(
      'שחקן48213Reset by an admin. The player will be asked to choose a new name.',
    );
  });

  it('a deleted account: no actions, and says why', async () => {
    setup(() => ({ ...userDetail(), deletedAt: Date.now() - 1000 }));
    const region = await section();
    expect(within(region).getByText('The account is deleted, so there are no actions for it.')).toBeTruthy();
    expect(within(region).queryByRole('button')).toBeNull();
  });

  it('an older server without the moderation fields: not suspended, no open reports', async () => {
    const { suspendedAt: _s, nameResetRequired: _n, openReports: _o, ...older } = userDetail();
    setup(() => older);
    const region = await section();
    expect(fact(region, 'Suspension')?.textContent).toBe('Not suspended');
    expect(fact(region, 'Open reports about them')?.textContent).toMatch(/^0/);
  });
});

describe('users list: moderation state', () => {
  it('marks suspended players and names waiting to be chosen, and counts open reports', async () => {
    const server = fakeServer({
      'GET /session': SIGNED_IN,
      'GET /users': {
        body: {
          items: [
            userRow({ openReports: 0 }),
            userRow({
              id: 'u2',
              displayName: 'Rude',
              suspendedAt: 1,
              nameResetRequired: true,
              openReports: 4,
            }),
          ],
          page: 1,
          pageSize: 50,
          total: 2,
        },
      },
    });
    renderSite(server, { hash: '#/users' });
    const table = await screen.findByRole('table', { name: 'Users' });
    const [, moshe, rude] = within(table).getAllByRole('row');
    expect(within(table).getByRole('columnheader', { name: 'Open reports' })).toBeTruthy();
    expect(within(moshe!).queryByText('Suspended')).toBeNull();
    expect(within(rude!).getByText('Suspended')).toBeTruthy();
    expect(within(rude!).getByText('Waiting for a new name')).toBeTruthy();
    const cells = [...rude!.querySelectorAll('td')];
    expect(cells[cells.length - 1]?.textContent).toBe('4');
  });
});
