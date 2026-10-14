import type { AdminAuditEntry, AdminPage } from '@sudoku-fight/protocol';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { auditEntry, DAY, HOUR, USER_A, USER_C } from '../testing/fixtures';
import { fakeServer, renderSite, SIGNED_IN } from '../testing/server';

function auditPage(page = 1, total = 5, now = Date.now()): AdminPage<AdminAuditEntry> {
  return {
    items: [
      // A new account of a deleted suspended account's sign-in: suspended by the server itself.
      auditEntry(
        {
          id: 'a-5',
          adminEmail: 'system',
          targetUserId: USER_A,
          details: { previousUserId: USER_C },
          createdAt: now - HOUR / 2,
        },
        now,
      ),
      auditEntry(
        {
          id: 'a-4',
          action: 'resetName',
          details: { fromName: 'Rude', toName: 'שחקן48213' },
          targetUserId: USER_C,
        },
        now,
      ),
      auditEntry(
        {
          id: 'a-3',
          adminEmail: 'password',
          action: 'dismissReport',
          details: { reportId: 'r-9', reason: 'cheating' },
          createdAt: now - 2 * HOUR,
        },
        now,
      ),
      auditEntry({ id: 'a-2', createdAt: now - DAY }, now),
      // A reset of an account deleted later: its names are gone from the log.
      auditEntry({ id: 'a-1', action: 'resetName', targetUserId: USER_C, createdAt: now - 2 * DAY }, now),
    ],
    page,
    pageSize: 50,
    total,
  };
}

describe('audit log', () => {
  it('lists the actions newest first: when, who, what, on whom, and the details', async () => {
    const server = fakeServer({
      'GET /session': SIGNED_IN,
      'GET /audit': (req) => ({ body: auditPage(Number(req.query.get('page') ?? '1'), 120) }),
    });
    renderSite(server, { hash: '#/audit' });
    const table = await screen.findByRole('table', { name: 'Audit log' });
    expect(server.gets('/audit')).toEqual(['/admin/api/audit?page=1&pageSize=50']);
    expect(screen.getByRole('link', { name: 'Audit log', current: 'page' })).toBeTruthy();

    const rows = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((r) => [...r.querySelectorAll('td')].slice(1).map((td) => td.textContent));
    expect(rows).toEqual([
      [
        'System (account deleted)',
        'Account suspended',
        USER_A.slice(0, 8),
        `A new account with the sign-in of a deleted suspended account (${USER_C.slice(0, 8)})`,
      ],
      ['moshe@example.com', 'Name reset', USER_C.slice(0, 8), 'from Rude to שחקן48213'],
      ['Password sign-in', 'Report dismissed', USER_A.slice(0, 8), 'Report: Cheating'],
      ['moshe@example.com', 'Account suspended', USER_A.slice(0, 8), '—'],
      ['moshe@example.com', 'Name reset', USER_C.slice(0, 8), 'Names removed with the account'],
    ]);
    const links = within(table).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href')).slice(0, 3)).toEqual([
      `#/users/${USER_A}`,
      `#/users/${USER_C}`,
      `#/users/${USER_C}`,
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(server.gets('/audit')[1]).toBe('/admin/api/audit?page=2&pageSize=50'));
    expect(window.location.hash).toBe('#/audit?page=2');
  });

  it('no actions yet: says so', async () => {
    const server = fakeServer({
      'GET /session': SIGNED_IN,
      'GET /audit': { body: { items: [], page: 1, pageSize: 50, total: 0 } },
    });
    renderSite(server, { hash: '#/audit' });
    expect(await screen.findByText('No actions yet.')).toBeTruthy();
  });

  it('in Hebrew', async () => {
    const server = fakeServer({ 'GET /session': SIGNED_IN, 'GET /audit': { body: auditPage() } });
    renderSite(server, { hash: '#/audit', lang: 'he' });
    const table = await screen.findByRole('table', { name: 'יומן פעולות' });
    expect(within(table).getAllByText('איפוס שם')).toHaveLength(2);
    expect(within(table).getByText('כניסה בסיסמה')).toBeTruthy();
    expect(within(table).getByText('דיווח: רמאות')).toBeTruthy();
    expect(within(table).getByText('השמות נמחקו עם החשבון')).toBeTruthy();
  });
});
