import type { AdminReportedPlayer } from '@sudoku-fight/protocol';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import type { FetchLike } from '../api';
import {
  GAME_A,
  HOUR,
  moderationResult,
  report,
  reportedPlayers,
  reportsPage,
  USER_A,
  USER_B,
  USER_C,
} from '../testing/fixtures';
import { fakeServer, type FakeServer, type Reply, renderSite, SIGNED_IN } from '../testing/server';

/** The site on the reports page; `reports` answers GET /reports (it may change between calls). */
function setup({
  reports = () => reportsPage(),
  hash = '#/reports',
  lang = 'en',
}: {
  reports?: () => ReturnType<typeof reportsPage>;
  hash?: string;
  lang?: 'he' | 'en';
} = {}) {
  const server = fakeServer({
    'GET /session': SIGNED_IN,
    'GET /reports': () => ({ body: reports() }),
  });
  // The site calls server.fetch when it asks, so a test may wrap it after the render (holdPosts).
  renderSite({ ...server, fetch: (url, init) => server.fetch(url, init) }, { hash, lang });
  return server;
}

/** Holds every POST's answer until release() is called, so a test can look at the dialog while it runs. */
function holdPosts(server: FakeServer): { release: () => void } {
  const fetch: FetchLike = server.fetch;
  let release = () => {};
  server.fetch = (url, init) => {
    const answer = fetch(url, init);
    if (init.method !== 'POST') return answer;
    return new Promise((resolve) => {
      release = () => resolve(answer);
    });
  };
  return { release: () => release() };
}

/**
 * An accessible name with a name inside it (a <bdi>): jsdom lays the <bdi> out as a block, so the name
 * computation puts a space after it ("Moshe 's"); a browser does not. Compares without those spaces.
 */
const nameIs = (text: string) => (name: string) => name.replace(/\s+(?=['?.,)])/g, '') === text;

const groups = async () =>
  within(await screen.findByRole('list', { name: 'Reported players' })).getAllByRole('article');

const posts = (server: FakeServer) =>
  server.requests.filter((r) => r.method === 'POST').map((r) => ({ path: r.path, body: r.body }));

describe('reports: the list', () => {
  it('asks for the open reports and shows each reported player with reasons, counts, reporters and state', async () => {
    const server = setup();
    const [moshe, rude] = await groups();
    expect(server.gets('/reports')).toEqual(['/admin/api/reports?status=open&page=1&pageSize=20']);

    // The player: name (to their user page), avatar beside it, their state.
    const heading = within(moshe!).getByRole('heading', { level: 2, name: 'Moshe' });
    expect(within(heading).getByRole('link').getAttribute('href')).toBe(`#/users/${USER_A}`);
    expect(moshe!.querySelector('svg[data-avatar="lava-lamp"]')).toBeTruthy();
    // The oldest open report is 50 hours old: past the 48-hour promise.
    expect(within(moshe!).getByText('Waiting over 48 hours')).toBeTruthy();
    expect(within(rude!).queryByText('Waiting over 48 hours')).toBeNull();
    expect(within(rude!).getByText('Suspended')).toBeTruthy();
    expect(within(rude!).getByText('Waiting for a new name')).toBeTruthy();

    // Reasons with their counts, the totals, first and last.
    const chips = within(moshe!)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(chips).toEqual(['Offensive name 2', 'Cheating 1', 'Other 0']);
    expect(within(moshe!).getByText('Different reporters').nextElementSibling?.textContent).toBe('3');
    expect(within(moshe!).getByText('First report').nextElementSibling?.textContent).toBe('2 days ago');
    expect(within(moshe!).getByText('Latest report').nextElementSibling?.textContent).toBe('3 hours ago');

    // Each report: when, why, who (a deleted reporter as such), and the game it is about.
    const table = within(moshe!).getByRole('table', { name: 'Reports about Moshe' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.querySelectorAll('td')[1]?.textContent)).toEqual([
      'Offensive name',
      'Cheating',
      'Offensive name',
    ]);
    expect(within(rows[0]!).getByRole('link', { name: 'Dana' }).getAttribute('href')).toBe(
      `#/users/${USER_B}`,
    );
    expect(
      within(rows[0]!)
        .getByRole('link', { name: GAME_A.slice(0, 8) })
        .getAttribute('href'),
    ).toBe(`#/games/${GAME_A}`);
    expect(within(rows[1]!).getByRole('link', { name: 'Deleted account' })).toBeTruthy();
    expect(within(rows[1]!).getByText('—')).toBeTruthy();
    // With the "open" filter the status column would say nothing.
    expect(within(table).queryByRole('columnheader', { name: 'Status' })).toBeNull();

    // The actions, each named with what it acts on.
    expect(
      within(rows[0]!).getByRole('button', { name: 'Mark resolved (Offensive name, from Dana)' }),
    ).toBeTruthy();
    expect(
      within(rows[1]!).getByRole('button', { name: 'Dismiss (Cheating, from Deleted account)' }),
    ).toBeTruthy();
    expect(within(moshe!).getByRole('button', { name: 'Reset name (Moshe)' })).toBeTruthy();
    expect(within(moshe!).getByRole('button', { name: 'Suspend account (Moshe)' })).toBeTruthy();
    expect(within(rude!).getByRole('button', { name: 'Lift suspension (Rude)' })).toBeTruthy();
  });

  it('the status filter asks the server, and closed reports say who closed them and when', async () => {
    const now = Date.now();
    const closed: AdminReportedPlayer = {
      ...reportedPlayers(now)[0]!,
      counts: { offensiveName: 1, cheating: 1, other: 1, total: 3, reporters: 1 },
      open: 0,
      oldestOpenAt: null,
      reports: [
        report({ status: 'resolved', resolvedAt: now - HOUR, resolvedBy: 'moshe@example.com' }, now),
        report(
          { id: 'r-5', reason: 'cheating', status: 'dismissed', resolvedAt: now, resolvedBy: 'system' },
          now,
        ),
        report(
          { id: 'r-6', reason: 'other', status: 'dismissed', resolvedAt: now, resolvedBy: 'password' },
          now,
        ),
      ],
    };
    const server = setup({ reports: () => reportsPage([closed]) });
    await groups();
    fireEvent.change(screen.getByLabelText('Report status'), { target: { value: 'all' } });
    await waitFor(() =>
      expect(server.gets('/reports')).toEqual([
        '/admin/api/reports?status=open&page=1&pageSize=20',
        '/admin/api/reports?status=all&page=1&pageSize=20',
      ]),
    );
    expect(window.location.hash).toBe('#/reports?status=all');

    const table = await screen.findByRole('table', { name: 'Reports about Moshe' });
    const status = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.querySelectorAll('td')[4]?.textContent);
    expect(status).toEqual([
      'Resolvedmoshe@example.com1 hour ago',
      'DismissedSystem (account deleted)now',
      'DismissedPassword sign-innow',
    ]);
    // Nothing open: no report actions (the player's own stay).
    expect(within(table).queryByRole('button')).toBeNull();
    expect(screen.getByRole('button', { name: 'Suspend account (Moshe)' })).toBeTruthy();
  });

  it('nothing open: says so', async () => {
    setup({ reports: () => reportsPage([]) });
    expect(await screen.findByText('No open reports. All caught up.')).toBeTruthy();
  });

  it('another filter with nothing in it says that', async () => {
    const server = setup({ reports: () => reportsPage([]), hash: '#/reports?status=dismissed' });
    expect(await screen.findByText('No reports with this status.')).toBeTruthy();
    expect(server.gets('/reports')).toEqual(['/admin/api/reports?status=dismissed&page=1&pageSize=20']);
    expect(screen.getByLabelText('Report status')).toHaveProperty('value', 'dismissed');
  });

  it('a deleted reported player: named as such with a short id, and no account actions', async () => {
    const now = Date.now();
    const gone: AdminReportedPlayer = {
      ...reportedPlayers(now)[0]!,
      player: {
        ...reportedPlayers(now)[0]!.player,
        displayName: null,
        avatarId: null,
        deletedAt: now - HOUR,
      },
      reports: [report({ status: 'dismissed', resolvedAt: now, resolvedBy: 'system' }, now)],
    };
    setup({ reports: () => reportsPage([gone]), hash: '#/reports?status=all' });
    const [group] = await groups();
    expect(within(group!).getByRole('heading', { level: 2, name: 'Deleted account' })).toBeTruthy();
    expect(within(group!).getByText(USER_A.slice(0, 8))).toBeTruthy();
    expect(within(group!).getByText('Deleted')).toBeTruthy();
    expect(within(group!).queryByRole('button')).toBeNull();
  });

  it('the 48-hour badge comes from the oldest open report, even one past the reports listed', async () => {
    const now = Date.now();
    const [moshe] = reportedPlayers(now);
    // Only the newest report is listed (3 hours old); the oldest open one, not listed, is 60 hours old.
    const listed: AdminReportedPlayer = {
      ...moshe!,
      counts: { ...moshe!.counts, total: 60 },
      open: 60,
      oldestOpenAt: now - 60 * HOUR,
      reports: [report({}, now)],
    };
    const recent: AdminReportedPlayer = { ...listed, oldestOpenAt: now - 3 * HOUR };
    let answer = listed;
    setup({ reports: () => reportsPage([answer]) });
    const [group] = await groups();
    expect(within(group!).getByText('Waiting over 48 hours')).toBeTruthy();
    answer = recent;
    fireEvent.change(screen.getByLabelText('Report status'), { target: { value: 'all' } });
    await waitFor(() => expect(screen.queryByText('Waiting over 48 hours')).toBeNull());
  });

  it('long lists say how many reports are shown, and page through players', async () => {
    const now = Date.now();
    const many: AdminReportedPlayer = {
      ...reportedPlayers(now)[0]!,
      counts: { offensiveName: 70, cheating: 0, other: 0, total: 70, reporters: 40 },
    };
    const server = setup({ reports: () => reportsPage([many], 1, 45) });
    await groups();
    expect(screen.getByText('Showing the latest 3 of 70 reports.')).toBeTruthy();
    // Only some of the reports are here, so the first one is not known.
    expect(screen.queryByText('First report')).toBeNull();
    expect(screen.getByText('Page 1 of 3 · 45 in all')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(server.gets('/reports')[1]).toBe('/admin/api/reports?status=open&page=2&pageSize=20'),
    );
  });
});

describe('reports: closing a report', () => {
  it('asks first (cancel sends nothing), then posts {}, is off while it runs, says what it did and reloads', async () => {
    let resolved = false;
    const server = setup({
      reports: () => {
        const [moshe, rude] = reportedPlayers();
        return reportsPage([
          { ...moshe!, reports: moshe!.reports.filter((r) => !resolved || r.id !== 'r-1') },
          rude!,
        ]);
      },
    });
    server.on('POST /reports/r-1/resolve', () => {
      resolved = true;
      return { body: report({ status: 'resolved', resolvedAt: Date.now(), resolvedBy: 'password' }) };
    });
    const hold = holdPosts(server);
    await groups();

    const open = screen.getByRole('button', { name: 'Mark resolved (Offensive name, from Dana)' });
    open.focus();
    fireEvent.click(open);
    const dialog = screen.getByRole('dialog', { name: 'Mark the report as resolved?' });
    expect(dialog.textContent).toContain(
      "Dana's report about Moshe (Offensive name) will be closed as resolved.",
    );
    expect(dialog.textContent).toContain('The action goes into the audit log under your sign-in.');
    // The safe choice has the focus.
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));

    // Cancel: nothing sent, the focus goes back to the button.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(open);
    expect(posts(server)).toEqual([]);

    // Escape cancels too.
    fireEvent.click(open);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    // Confirm: the buttons are off and Escape does nothing while it runs.
    fireEvent.click(open);
    const again = screen.getByRole('dialog');
    fireEvent.click(within(again).getByRole('button', { name: 'Mark resolved' }));
    const working = within(again).getByRole('button', { name: 'Working…' });
    expect(working).toHaveProperty('disabled', true);
    expect(within(again).getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true);
    fireEvent.keyDown(again, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBe(again);
    expect(posts(server)).toEqual([{ path: '/reports/r-1/resolve', body: {} }]);
    const post = server.requests.find((r) => r.method === 'POST');
    expect(post?.headers).toMatchObject({ 'Content-Type': 'application/json' });

    hold.release();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status').textContent).toBe('The report about Moshe is marked resolved.');
    // Reloaded: the report left the open list, and the focus, without its button, went to the message.
    await waitFor(() => expect(server.gets('/reports')).toHaveLength(2));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Mark resolved (Offensive name, from Dana)' })).toBeNull(),
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('status')));

    fireEvent.click(screen.getByRole('button', { name: 'Hide the message' }));
    expect(screen.getByRole('status').textContent).toBe('');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Reports' }));
  });

  it('a report closed meanwhile (409 notOpen): says so, offers only "close", and reloads', async () => {
    const server = setup();
    server.on('POST /reports/r-2/dismiss', { status: 409, body: { error: 'notOpen' } });
    await groups();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss (Offensive name, from Gil)' }));
    const dialog = screen.getByRole('dialog', { name: 'Dismiss the report?' });
    expect(dialog.textContent).toContain('with no action against the player');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss report' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'The report is closed already, maybe by another admin. The list is updated.',
    );
    expect(within(dialog).queryByRole('button', { name: 'Dismiss report' })).toBeNull();
    await waitFor(() => expect(server.gets('/reports')).toHaveLength(2));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('a password session where actions want Google (403 googleRequired): says so, offers only "close"', async () => {
    const server = setup();
    server.on('POST /reports/r-2/dismiss', { status: 403, body: { error: 'googleRequired' } });
    await groups();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss (Offensive name, from Gil)' }));
    const dialog = screen.getByRole('dialog', { name: 'Dismiss the report?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss report' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Moderation actions need a Google sign-in, so the audit log names you. Sign out and sign in with Google.',
    );
    expect(within(dialog).queryByRole('button', { name: 'Dismiss report' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('a server error: says so and lets the admin try again, without reloading', async () => {
    let calls = 0;
    const server = setup();
    server.on('POST /reports/r-1/resolve', (): Reply => {
      calls++;
      return calls === 1
        ? { status: 500, body: { error: 'internal' } }
        : { body: report({ status: 'resolved' }) };
    });
    await groups();
    fireEvent.click(screen.getByRole('button', { name: 'Mark resolved (Offensive name, from Dana)' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark resolved' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Something went wrong on the server.',
    );
    expect(server.gets('/reports')).toHaveLength(1);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark resolved' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status').textContent).toBe('The report about Moshe is marked resolved.');
  });
});

describe('reports: the player actions', () => {
  it('suspend: a red confirmation, then the account shows suspended and the button lifts it', async () => {
    let suspended = false;
    const server = setup({
      reports: () => {
        const [moshe, rude] = reportedPlayers();
        const player = { ...moshe!.player, suspendedAt: suspended ? Date.now() : null };
        return reportsPage([{ ...moshe!, player }, rude!]);
      },
    });
    server.on(`POST /users/${USER_A}/suspend`, () => {
      suspended = true;
      return { body: moderationResult({ suspendedAt: Date.now() }, { action: 'suspend' }) };
    });
    await groups();
    const button = screen.getByRole('button', { name: 'Suspend account (Moshe)' });
    button.focus();
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: nameIs("Suspend Moshe's account?") });
    expect(dialog.textContent).toContain(
      "the account can't join ranked games, send reports or change its details",
    );
    const confirm = within(dialog).getByRole('button', { name: 'Suspend account' });
    expect(confirm.className).toContain('btn-danger');
    fireEvent.click(confirm);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status').textContent).toBe("Moshe's account is suspended.");
    expect(posts(server)).toEqual([{ path: `/users/${USER_A}/suspend`, body: {} }]);
    // The same button, now lifting the suspension, keeps the focus.
    const lift = await screen.findByRole('button', { name: 'Lift suspension (Moshe)' });
    expect(lift).toBe(button);
    expect(document.activeElement).toBe(lift);
    const [moshe] = await groups();
    expect(within(moshe!).getByText('Suspended')).toBeTruthy();
  });

  it('suspending a suspended account changes nothing, and says so', async () => {
    const server = setup();
    server.on(`POST /users/${USER_A}/suspend`, {
      body: moderationResult({ suspendedAt: Date.now() - HOUR }, null),
    });
    await groups();
    fireEvent.click(screen.getByRole('button', { name: 'Suspend account (Moshe)' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Suspend account' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        "Moshe's account was suspended already. Nothing changed.",
      ),
    );
  });

  it('lift a suspension', async () => {
    const server = setup();
    server.on(`POST /users/${USER_C}/unsuspend`, {
      body: moderationResult(
        { id: USER_C, displayName: 'Rude' },
        { action: 'unsuspend', targetUserId: USER_C },
      ),
    });
    await groups();
    fireEvent.click(screen.getByRole('button', { name: 'Lift suspension (Rude)' }));
    const dialog = screen.getByRole('dialog', { name: nameIs("Lift Rude's suspension?") });
    expect(within(dialog).getByRole('button', { name: 'Lift suspension' }).className).toContain(
      'btn-primary',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lift suspension' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe("Rude's suspension is lifted."));
    expect(posts(server)).toEqual([{ path: `/users/${USER_C}/unsuspend`, body: {} }]);
  });

  it('reset name: warns it is final, then says the new name', async () => {
    const server = setup();
    server.on(`POST /users/${USER_A}/reset-name`, {
      body: moderationResult(
        { displayName: 'שחקן48213', nameResetRequired: true },
        { action: 'resetName', details: { fromName: 'Moshe', toName: 'שחקן48213' } },
      ),
    });
    await groups();
    fireEvent.click(screen.getByRole('button', { name: 'Reset name (Moshe)' }));
    const dialog = screen.getByRole('dialog', { name: nameIs("Reset Moshe's name?") });
    expect(dialog.textContent).toContain("The old name can't be restored from here.");
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset name' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe("Moshe's name is reset to שחקן48213."),
    );
    // The names are isolated, so a Hebrew name keeps its place in an English sentence.
    expect(screen.getByRole('status').querySelectorAll('bdi')).toHaveLength(2);
  });

  it('an account deleted meanwhile (409 accountDeleted): says so and reloads', async () => {
    const server = setup();
    server.on(`POST /users/${USER_A}/reset-name`, { status: 409, body: { error: 'accountDeleted' } });
    await groups();
    fireEvent.click(screen.getByRole('button', { name: 'Reset name (Moshe)' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset name' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      "The account is deleted, so there's nothing to reset or suspend.",
    );
    await waitFor(() => expect(server.gets('/reports')).toHaveLength(2));
  });
});

describe('reports in Hebrew', () => {
  it('reasons, states, the promise and the dialog in Hebrew, right to left', async () => {
    setup({ lang: 'he' });
    expect(await screen.findByRole('heading', { level: 1, name: 'דיווחים' })).toBeTruthy();
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByText(/התחייבנו לבדוק כל דיווח תוך 48 שעות/)).toBeTruthy();
    const list = await screen.findByRole('list', { name: 'השחקנים שדווחו' });
    const [moshe] = within(list).getAllByRole('article');
    expect(within(moshe!).getByText('מחכה יותר מ־48 שעות')).toBeTruthy();
    expect(
      within(moshe!)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['שם פוגעני 2', 'רמאות 1', 'אחר 0']);
    fireEvent.click(within(moshe!).getByRole('button', { name: 'השעיית חשבון (Moshe)' }));
    const dialog = screen.getByRole('dialog', { name: nameIs('להשעות את החשבון של Moshe?') });
    expect(within(dialog).getByRole('button', { name: 'חזרה' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'השעיית החשבון' })).toBeTruthy();
  });
});
