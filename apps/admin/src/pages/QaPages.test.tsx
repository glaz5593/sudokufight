import type { AdminPage } from '@sudoku-fight/protocol';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { HOUR, qaCatalogFixture, qaRunDetailFixture, qaRunFixture } from '../testing/fixtures';
import { fakeServer, renderSite, SIGNED_IN } from '../testing/server';

/**
 * The QA module on the admin site (docs/handoff/2026-10-23/qa-module/plan.md): the runs (a new one, the list
 * with its counts) and a run (its tasks, the marks, the filter, the bugs and their fixes, closing it).
 */

const page = <T,>(items: T[]): AdminPage<T> => ({ items, page: 1, pageSize: 50, total: items.length });

const posts = (server: ReturnType<typeof fakeServer>) =>
  server.requests.filter((r) => r.method === 'POST').map((r) => [r.path, r.body]);

describe('the QA runs page', () => {
  function setup() {
    return fakeServer({
      'GET /session': SIGNED_IN,
      'GET /qa/catalog': { body: qaCatalogFixture() },
      'GET /qa/runs': { body: page([qaRunFixture()]) },
    });
  }

  it('lists the runs with their counts', async () => {
    const server = setup();
    renderSite(server, { hash: '#/qa' });
    expect(await screen.findByRole('heading', { level: 1, name: 'QA' })).toBeTruthy();
    expect(screen.getByRole('link', { current: 'page' }).textContent).toBe('QA');
    const runs = screen.getByRole('region', { name: 'Runs' });
    const link = await within(runs).findByRole('link', { name: 'Friends on the Pixel' });
    expect(link.getAttribute('href')).toBe('#/qa/7');
    const cells = [...(link.closest('tr') as HTMLElement).querySelectorAll('td')].map((td) => td.textContent);
    expect(cells.slice(1, 4)).toEqual(['1.0.5', 'Pixel 7 · Android', 'Open']);
    expect(cells[4]).toContain('moshe@example.com');
    // V, partly, failed, untested, open bugs, handled.
    expect(cells.slice(5)).toEqual(['5', '1', '2', '4', '2', '1']);
    expect(server.gets('/qa/runs')).toEqual(['/admin/api/qa/runs?page=1&pageSize=50']);
  });

  it('opens a run with the chosen fields and categories, then goes to it', async () => {
    const server = setup();
    server.on('POST /qa/runs', { status: 201, body: qaRunFixture({ id: 9 }) });
    server.on('GET /qa/runs/9', { body: qaRunDetailFixture({ id: 9 }) });
    renderSite(server, { hash: '#/qa' });
    const form = await screen.findByRole('region', { name: 'New run' });
    await within(form).findByLabelText('אימון בשלבים (1 tasks)');
    fireEvent.click(within(form).getByRole('button', { name: 'Open run' }));
    expect(within(form).getByRole('alert').textContent).toBe('Fill in the title and the app version.');
    expect(posts(server)).toEqual([]);

    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: ' Friends, round 2 ' } });
    fireEvent.change(within(form).getByLabelText('App version'), { target: { value: '1.0.5' } });
    fireEvent.change(within(form).getByLabelText('Device (optional)'), { target: { value: 'Pixel 8' } });
    fireEvent.change(within(form).getByLabelText('Platform'), { target: { value: 'ios' } });
    fireEvent.change(within(form).getByLabelText('Who tests'), { target: { value: 'moshe' } });
    fireEvent.click(within(form).getByLabelText('אימון בשלבים (1 tasks)'));
    fireEvent.click(within(form).getByRole('button', { name: 'Open run' }));

    await waitFor(() => expect(window.location.hash).toBe('#/qa/9'));
    expect(posts(server)).toEqual([
      [
        '/qa/runs',
        {
          title: 'Friends, round 2',
          appVersion: '1.0.5',
          device: 'Pixel 8',
          platform: 'ios',
          who: 'moshe',
          categories: ['friends'],
        },
      ],
    ]);
    expect(await screen.findByRole('heading', { level: 1, name: 'Run 9' })).toBeTruthy();
  });
});

describe('a QA run', () => {
  function setup(detail = qaRunDetailFixture()) {
    return fakeServer({ 'GET /session': SIGNED_IN, 'GET /qa/runs/7': { body: detail } });
  }
  const task = (name: string) => screen.getByRole('article', { name });

  it('shows the tasks by category and subcategory: steps, expected, who, mark; and the progress', async () => {
    renderSite(setup(), { hash: '#/qa/7' });
    const friends = await screen.findByRole('region', { name: 'Friends' });
    expect(
      within(friends)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Rooms', 'Joining']);
    expect(screen.getByRole('region', { name: 'Staged practice' })).toBeTruthy();
    const open = task('Open a room');
    const [steps, expected] = within(open).getAllByRole('list');
    expect(
      within(steps!)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Open the app', 'Tap "Play with friends"']);
    expect(steps!.tagName).toBe('OL');
    expect(
      within(expected!)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['A room code shows', 'The share button works']);
    expect(within(open).getByText('Who tests: Moshe')).toBeTruthy();
    expect(within(open).getByText('Untested')).toBeTruthy();
    expect(within(task('Join by code')).getByText('Who tests: Claude')).toBeTruthy();
    expect(within(task('Join by code')).getByText('Passed (V)')).toBeTruthy();
    expect(screen.getByText(/^Tested 2 of 3/).textContent).toBe(
      'Tested 2 of 3 · V: 1 · partly: 0 · failed: 1 · untested: 1 · open bugs: 0 · handled: 1',
    );
  });

  it('V marks the task passed: POST {result: "pass"}, then the run again', async () => {
    const server = setup();
    server.on('POST /qa/runs/7/items/friends-room-open/result', { body: qaRunDetailFixture().items[0] });
    renderSite(server, { hash: '#/qa/7' });
    await screen.findByRole('region', { name: 'Friends' });
    fireEvent.click(within(task('Open a room')).getByRole('button', { name: 'V: passed' }));
    await waitFor(() => expect(server.gets('/qa/runs/7')).toHaveLength(2));
    expect(posts(server)).toEqual([['/qa/runs/7/items/friends-room-open/result', { result: 'pass' }]]);
  });

  it('"V with a note": the note only, no "what actually happened"', async () => {
    const server = setup();
    server.on('POST /qa/runs/7/items/friends-room-open/result', { body: qaRunDetailFixture().items[0] });
    renderSite(server, { hash: '#/qa/7' });
    await screen.findByRole('region', { name: 'Friends' });
    fireEvent.click(within(task('Open a room')).getByRole('button', { name: 'V with a note' }));
    const form = within(task('Open a room')).getByRole('form');
    expect(within(form).queryByLabelText('What actually happened')).toBeNull();
    fireEvent.change(within(form).getByLabelText('Note (optional)'), {
      target: { value: ' slow on a Galaxy A16 ' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(server.gets('/qa/runs/7')).toHaveLength(2));
    expect(posts(server)).toEqual([
      [
        '/qa/runs/7/items/friends-room-open/result',
        { result: 'pass', actual: null, note: 'slow on a Galaxy A16' },
      ],
    ]);
  });

  it('"failed" needs what actually happened; with it, it posts it and the note', async () => {
    const server = setup();
    server.on('POST /qa/runs/7/items/friends-room-open/result', { body: qaRunDetailFixture().items[0] });
    renderSite(server, { hash: '#/qa/7' });
    await screen.findByRole('region', { name: 'Friends' });
    const card = task('Open a room');
    fireEvent.click(within(card).getByRole('button', { name: 'Failed' }));
    const form = within(card).getByRole('form', { name: 'Mark: Failed' });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(within(form).getByRole('alert').textContent).toBe('Write what actually happened.');
    expect(posts(server)).toEqual([]);

    fireEvent.change(within(form).getByLabelText('What actually happened'), {
      target: { value: 'No code\nonly a spinner' },
    });
    fireEvent.change(within(form).getByLabelText('Note (optional)'), { target: { value: 'On Wi-Fi' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(posts(server)).toEqual([
        [
          '/qa/runs/7/items/friends-room-open/result',
          { result: 'fail', actual: 'No code\nonly a spinner', note: 'On Wi-Fi' },
        ],
      ]),
    );
    await waitFor(() => expect(within(card).queryByRole('form')).toBeNull());
  });

  it('a refusal from the server shows on the task', async () => {
    const server = setup();
    server.on('POST /qa/runs/7/items/friends-room-open/result', {
      status: 409,
      body: { error: 'qaRunClosed' },
    });
    renderSite(server, { hash: '#/qa/7' });
    await screen.findByRole('region', { name: 'Friends' });
    const card = task('Open a room');
    fireEvent.click(within(card).getByRole('button', { name: 'V: passed' }));
    expect((await within(card).findByRole('alert')).textContent).toMatch(/The run is closed/);
  });

  it('"bugs only" leaves the bugs', async () => {
    const server = setup();
    renderSite(server, { hash: '#/qa/7' });
    await screen.findByRole('region', { name: 'Friends' });
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'bugs' } });
    await waitFor(() => expect(window.location.hash).toBe('#/qa/7?show=bugs'));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Friends' })).toBeNull());
    expect(screen.getAllByRole('article').map((a) => a.querySelector('h4')?.textContent)).toEqual([
      'Pass a gate',
    ]);
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'untested' } });
    await waitFor(() =>
      expect(screen.getAllByRole('article').map((a) => a.querySelector('h4')?.textContent)).toEqual([
        'Open a room',
      ]),
    );
  });

  it('a handled bug: its state, what actually happened, the fix and its version isolated', async () => {
    renderSite(setup(), { hash: '#/qa/7' });
    await screen.findByRole('region', { name: 'Staged practice' });
    const bug = task('Pass a gate');
    expect(within(bug).getByText('Bug: Handled')).toBeTruthy();
    expect(within(bug).getByText('Failed', { selector: '.badge' })).toBeTruthy();
    const texts = [...bug.querySelectorAll('p.qa-text')].map((p) => p.textContent);
    // Line breaks kept (white-space: pre-wrap).
    expect(texts).toEqual([
      'The gate stayed shut\nafter three stars',
      'Counted the stars again\non the server',
    ]);
    const version = within(bug).getByText('1.0.6');
    expect(version.tagName).toBe('BDI');
    expect(version.getAttribute('dir')).toBe('ltr');
    expect(version.parentElement?.textContent).toMatch(/^The fix · Fixed in 1\.0\.6 · .+, by Claude$/);
  });

  it('a closed run: marks only on the bugs', async () => {
    const detail = qaRunDetailFixture({
      status: 'closed',
      closedAt: Date.now() - HOUR,
      closedBy: 'moshe@example.com',
    });
    renderSite(setup(detail), { hash: '#/qa/7' });
    await screen.findByRole('region', { name: 'Friends' });
    expect(
      screen.getByText('The run is closed. Only the tasks with a bug can be tested again.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close run' })).toBeNull();
    const marks = (name: string) =>
      within(within(task(name)).getByRole('group', { name: 'Mark the task' }))
        .getAllByRole('button')
        .map((b) => (b as HTMLButtonElement).disabled);
    expect(marks('Open a room')).toEqual([true, true, true, true]);
    expect(marks('Join by code')).toEqual([true, true, true, true, true]);
    expect(marks('Pass a gate')).toEqual([false, false, false, false, false]);
  });

  it('closes the run after a confirmation', async () => {
    const server = setup();
    server.on('POST /qa/runs/7/close', { body: qaRunFixture({ status: 'closed' }) });
    renderSite(server, { hash: '#/qa/7' });
    await screen.findByRole('region', { name: 'Friends' });
    fireEvent.click(screen.getByRole('button', { name: 'Close run' }));
    const dialog = screen.getByRole('dialog', { name: 'Close the run?' });
    // Not an audited action.
    expect(within(dialog).queryByText(/audit log/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close run' }));
    await waitFor(() => expect(screen.getByText('The run is closed.')).toBeTruthy());
    expect(posts(server)).toEqual([['/qa/runs/7/close', {}]]);
  });

  it('in Hebrew: the marks, the bug state and the filter', async () => {
    renderSite(setup(), { hash: '#/qa/7', lang: 'he' });
    expect(await screen.findByRole('heading', { level: 1, name: 'תהליך 7' })).toBeTruthy();
    const bug = await screen.findByRole('article', { name: 'Pass a gate' });
    expect(within(bug).getByText('באג: טופל')).toBeTruthy();
    expect(within(bug).getByRole('button', { name: 'V: עבר' }).textContent).toBe('V');
    expect(within(bug).getByRole('button', { name: 'עבר חלקית' })).toBeTruthy();
    expect(within(bug).getByRole('button', { name: 'לא עבר' })).toBeTruthy();
    expect(within(bug).getByRole('button', { name: 'נקה' })).toBeTruthy();
    const show = screen.getByLabelText<HTMLSelectElement>('הצג');
    expect([...show.options].map((o) => o.textContent)).toEqual(['הכל', 'לא נבדק', 'באגים בלבד']);
  });
});
