import type { AdminPage } from '@sudoku-fight/protocol';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { HOUR, qaCatalogFixture, qaItemFixture, qaRunDetailFixture, qaRunFixture } from '../testing/fixtures';
import { fakeServer, renderSite, SIGNED_IN } from '../testing/server';

/**
 * The QA module on the admin site (docs/handoff/2026-10-23/qa-module/plan.md): the runs (a new one, the list
 * with its counts) and a run (its tasks as a tree that opens a level at a time, the marks, the filter, the bugs
 * and their fixes, closing it).
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
  /** The rows' headings of a level (3: categories, 4: subcategories), with their "+" or "−". */
  const headings = (level: 3 | 4) => screen.queryAllByRole('heading', { level }).map((h) => h.textContent);
  const articles = () =>
    screen.queryAllByRole('article').map((a) => a.querySelector('.qa-row-title')?.textContent);
  /** A category's or a subcategory's tally: done %, V, partial, fail, open bugs. */
  const tally = (name: string) =>
    [...screen.getByRole('button', { name }).closest('.qa-row')!.querySelectorAll('.qa-count')].map(
      (count) => count.textContent,
    );
  /** Clicks the rows' toggles in turn: a category, a subcategory, a task. */
  const open = async (...names: string[]) => {
    for (const name of names) fireEvent.click(await screen.findByRole('button', { name }));
  };

  it('at first only the categories, each with how far it got: done %, V, partial, fail, open bugs', async () => {
    const detail = qaRunDetailFixture();
    const practice = { categoryId: 'practice', categoryTitle: 'Staged practice' };
    detail.items.push(
      qaItemFixture({
        ...practice,
        taskId: 'practice-stars',
        position: 3,
        subcategoryId: 'gates',
        subcategoryTitle: 'Gates',
        title: 'Three stars',
        result: 'partial',
        actual: 'Two stars',
        bugStatus: 'open',
      }),
      qaItemFixture({
        ...practice,
        taskId: 'practice-boss',
        position: 4,
        subcategoryId: 'boss',
        subcategoryTitle: 'Boss',
        title: 'Beat the boss',
      }),
    );
    renderSite(setup(detail), { hash: '#/qa/7' });
    await screen.findByRole('button', { name: 'Friends' });
    expect(
      screen.getByText('Every task: a phone with the staging APK, signed in, unless it says otherwise.'),
    ).toBeTruthy();
    expect(headings(3)).toEqual(['+Friends', '+Staged practice']);
    expect(screen.getByRole('button', { name: 'Friends' }).getAttribute('aria-expanded')).toBe('false');
    expect([headings(4), articles()]).toEqual([[], []]);
    expect(tally('Friends')).toEqual(['Done 50%', 'V 1', 'Partly passed 0', 'Failed 0', 'Open bugs 0']);
    // 2 of 3 tested: 66%, rounded down (100% only when every task is tested).
    expect(tally('Staged practice')).toEqual([
      'Done 66%',
      'V 0',
      'Partly passed 1',
      'Failed 1',
      'Open bugs 1',
    ]);
    // The run's progress line stays.
    expect(screen.getByText(/^Tested 2 of 3/).textContent).toBe(
      'Tested 2 of 3 · V: 1 · partly: 0 · failed: 1 · untested: 1 · open bugs: 0 · handled: 1',
    );
  });

  it('"+" opens one level: a category its subcategories (tallied too), a subcategory its tasks; "−" closes', async () => {
    renderSite(setup(), { hash: '#/qa/7' });
    await open('Friends');
    expect(screen.getByRole('button', { name: 'Friends' }).getAttribute('aria-expanded')).toBe('true');
    expect(headings(3)).toEqual(['−Friends', '+Staged practice']);
    expect([headings(4), articles()]).toEqual([['+Rooms', '+Joining'], []]);
    expect(tally('Rooms')).toEqual(['Done 0%', 'V 0', 'Partly passed 0', 'Failed 0', 'Open bugs 0']);
    expect(tally('Joining')).toEqual(['Done 100%', 'V 1', 'Partly passed 0', 'Failed 0', 'Open bugs 0']);
    await open('Rooms');
    expect([headings(4), articles()]).toEqual([['−Rooms', '+Joining'], ['Open a room']]);
    await open('Friends');
    expect([headings(3), headings(4), articles()]).toEqual([['+Friends', '+Staged practice'], [], []]);
  });

  it('a task row is closed: its mark, title, subtitle and a quick V that posts {result: "pass"}', async () => {
    const server = setup();
    server.on('POST /qa/runs/7/items/friends-room-open/result', { body: qaRunDetailFixture().items[0] });
    renderSite(server, { hash: '#/qa/7' });
    await open('Friends', 'Rooms');
    const row = task('Open a room');
    const toggle = within(row).getByRole('button', { name: 'Open a room' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(row).getByText('Untested', { selector: '.badge' })).toBeTruthy();
    expect(within(row).getByText('Check that a room opens with a code').className).toBe('qa-subtitle');
    expect(within(row).queryAllByRole('list')).toEqual([]);
    fireEvent.click(within(row).getByRole('button', { name: 'V: passed' }));
    await waitFor(() => expect(server.gets('/qa/runs/7')).toHaveLength(2));
    expect(posts(server)).toEqual([['/qa/runs/7/items/friends-room-open/result', { result: 'pass' }]]);
  });

  it('opened, a task shows who, its steps, expected and every mark; closed again, only its row', async () => {
    renderSite(setup(), { hash: '#/qa/7' });
    await open('Friends', 'Rooms', 'Open a room');
    const card = task('Open a room');
    expect(within(card).getByRole('button', { name: 'Open a room' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    const [steps, expected] = within(card).getAllByRole('list');
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
    expect(within(card).getByText('Who tests: Moshe')).toBeTruthy();
    // The V is with the other marks now: one V only.
    const marks = within(card).getByRole('group', { name: 'Mark the task' });
    expect(
      within(marks)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['V', 'V with a note', 'Partly passed', 'Failed']);
    expect(within(card).getAllByRole('button', { name: 'V: passed' })).toHaveLength(1);
    await open('Open a room');
    expect(within(card).queryAllByRole('list')).toEqual([]);
    expect(within(card).queryByRole('group')).toBeNull();
    expect(within(card).getByRole('button', { name: 'V: passed' })).toBeTruthy();
  });

  it('"V with a note": the note only, no "what actually happened"', async () => {
    const server = setup();
    server.on('POST /qa/runs/7/items/friends-room-open/result', { body: qaRunDetailFixture().items[0] });
    renderSite(server, { hash: '#/qa/7' });
    await open('Friends', 'Rooms', 'Open a room');
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
    await open('Friends', 'Rooms', 'Open a room');
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

  it('a refusal from the server shows on the task, closed or not', async () => {
    const server = setup();
    server.on('POST /qa/runs/7/items/friends-room-open/result', {
      status: 409,
      body: { error: 'qaRunClosed' },
    });
    renderSite(server, { hash: '#/qa/7' });
    await open('Friends', 'Rooms');
    const card = task('Open a room');
    fireEvent.click(within(card).getByRole('button', { name: 'V: passed' }));
    expect((await within(card).findByRole('alert')).textContent).toMatch(/The run is closed/);
  });

  it('a filter shows only the branches with a matching task, opened; the counts stay the run’s', async () => {
    const server = setup();
    renderSite(server, { hash: '#/qa/7' });
    await screen.findByRole('button', { name: 'Friends' });
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'bugs' } });
    await waitFor(() => expect(window.location.hash).toBe('#/qa/7?show=bugs'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Friends' })).toBeNull());
    expect([headings(3), headings(4), articles()]).toEqual([
      ['−Staged practice'],
      ['−Gates'],
      ['Pass a gate'],
    ]);
    // The task itself stays closed.
    expect(screen.getByRole('button', { name: 'Pass a gate' }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'untested' } });
    await waitFor(() => expect(articles()).toEqual(['Open a room']));
    expect([headings(3), headings(4)]).toEqual([['−Friends'], ['−Rooms']]);
    // Friends' tally is its two tasks', the one the filter hides too.
    expect(tally('Friends')).toEqual(['Done 50%', 'V 1', 'Partly passed 0', 'Failed 0', 'Open bugs 0']);
    // An opened branch may be closed under a filter too.
    await open('Rooms');
    expect([headings(4), articles()]).toEqual([['+Rooms'], []]);
  });

  it('a handled bug: its state, what actually happened, the fix and its version isolated', async () => {
    renderSite(setup(), { hash: '#/qa/7' });
    await open('Staged practice', 'Gates', 'Pass a gate');
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

  it('a closed run: marks only on the bugs, the quick V too', async () => {
    const detail = qaRunDetailFixture({
      status: 'closed',
      closedAt: Date.now() - HOUR,
      closedBy: 'moshe@example.com',
    });
    renderSite(setup(detail), { hash: '#/qa/7' });
    await open('Friends', 'Rooms', 'Joining', 'Staged practice', 'Gates');
    expect(
      screen.getByText('The run is closed. Only the tasks with a bug can be tested again.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close run' })).toBeNull();
    const quickV = (name: string) =>
      within(task(name)).getByRole<HTMLButtonElement>('button', { name: 'V: passed' }).disabled;
    expect([quickV('Open a room'), quickV('Join by code'), quickV('Pass a gate')]).toEqual([
      true,
      true,
      false,
    ]);
    await open('Open a room', 'Join by code', 'Pass a gate');
    const marks = (name: string) =>
      within(within(task(name)).getByRole('group', { name: 'Mark the task' }))
        .getAllByRole('button')
        .map((b) => (b as HTMLButtonElement).disabled);
    expect(marks('Open a room')).toEqual([true, true, true, true]);
    expect(marks('Join by code')).toEqual([true, true, true, true, true]);
    expect(marks('Pass a gate')).toEqual([false, false, false, false, false]);
  });

  it('a task of a run opened before subtitles shows just its title', async () => {
    const detail = qaRunDetailFixture();
    detail.items = detail.items.map((item) => ({ ...item, subtitle: null }));
    renderSite(setup(detail), { hash: '#/qa/7' });
    await open('Friends', 'Rooms');
    const row = task('Open a room');
    expect(row.querySelector('.qa-subtitle')).toBeNull();
    const toggle = within(row).getByRole('button', { name: 'Open a room' });
    expect(toggle.getAttribute('aria-describedby')?.split(' ')).toHaveLength(1);
    await open('Open a room');
    expect(within(row).getByText('Who tests: Moshe')).toBeTruthy();
  });

  it('closes the run after a confirmation', async () => {
    const server = setup();
    server.on('POST /qa/runs/7/close', { body: qaRunFixture({ status: 'closed' }) });
    renderSite(server, { hash: '#/qa/7' });
    await screen.findByRole('button', { name: 'Friends' });
    fireEvent.click(screen.getByRole('button', { name: 'Close run' }));
    const dialog = screen.getByRole('dialog', { name: 'Close the run?' });
    // Not an audited action.
    expect(within(dialog).queryByText(/audit log/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close run' }));
    await waitFor(() => expect(screen.getByText('The run is closed.')).toBeTruthy());
    expect(posts(server)).toEqual([['/qa/runs/7/close', {}]]);
  });

  it('in Hebrew: the setup line, the tally, the marks, the bug state and the filter', async () => {
    renderSite(setup(), { hash: '#/qa/7', lang: 'he' });
    expect(await screen.findByRole('heading', { level: 1, name: 'תהליך 7' })).toBeTruthy();
    expect(
      await screen.findByText('כל הבדיקות: טלפון עם ה־APK של staging, מחובר לחשבון, אלא אם כתוב אחרת.'),
    ).toBeTruthy();
    expect(tally('Staged practice')).toEqual([
      'בוצע 100%',
      'V 0',
      'עבר חלקית 0',
      'לא עבר 1',
      'באגים פתוחים 0',
    ]);
    await open('Staged practice', 'Gates', 'Pass a gate');
    const bug = task('Pass a gate');
    expect(within(bug).getByText('באג: טופל')).toBeTruthy();
    expect(within(bug).getByRole('button', { name: 'V: עבר' }).textContent).toBe('V');
    expect(within(bug).getByRole('button', { name: 'עבר חלקית' })).toBeTruthy();
    expect(within(bug).getByRole('button', { name: 'לא עבר' })).toBeTruthy();
    expect(within(bug).getByRole('button', { name: 'נקה' })).toBeTruthy();
    const show = screen.getByLabelText<HTMLSelectElement>('הצג');
    expect([...show.options].map((o) => o.textContent)).toEqual(['הכל', 'לא נבדק', 'באגים בלבד']);
  });
});
