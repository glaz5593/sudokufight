import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { emptyLevel, emptyLevelsFixture, levelsFixture } from '../testing/fixtures';
import { fakeServer, renderSite, SIGNED_IN } from '../testing/server';
import { isTooHard, needsSoftening, sortLevels } from './LevelsPage';

/** Three chapters are enough for most tests (300 rows render slowly in jsdom); a few take all 300. */
const LIGHT = 30;

function setup(hash = '#/levels', body = levelsFixture(LIGHT), lang: 'he' | 'en' = 'en') {
  const server = fakeServer({ 'GET /session': SIGNED_IN, 'GET /levels': { body } });
  renderSite(server, { hash, lang });
  return server;
}

/**
 * A table by its caption (its accessible name). The levels table has 300 rows: role queries over it are slow in
 * jsdom, so the helpers below walk the DOM; the first test checks the tables' roles and names once.
 */
function tableNamed(name: string): HTMLElement {
  const table = [...document.querySelectorAll('table')].find((t) => t.caption?.textContent === name);
  if (!table) throw new Error(`no table "${name}"`);
  return table;
}
const levelsTable = () => tableNamed('By stage');
const gatesTable = () => tableNamed('Gates');
const rows = (table: HTMLElement) => [...table.querySelectorAll('tbody tr')];
const order = () => rows(levelsTable()).map((row) => row.querySelector('td bdi')?.textContent);
const rowOf = (table: HTMLElement, text: string) =>
  within(table).getByText(text).closest('tr') as HTMLElement;
const header = (name: string) => {
  const th = [...levelsTable().querySelectorAll('th')].find((h) => h.textContent?.startsWith(name));
  if (!th) throw new Error(`no column "${name}"`);
  return th;
};
const sortBy = (name: string) => fireEvent.click(header(name).querySelector('button')!);
/** The page has loaded its data. */
const loaded = () => screen.findByText(/^In this period:/);

describe('stages (staged practice)', () => {
  it('asks for the default period and sums it up', async () => {
    const server = setup('#/levels', levelsFixture());
    await screen.findByRole('table', { name: 'By stage' });
    expect(screen.getByRole('table', { name: 'Gates' })).toBeTruthy();
    expect(server.gets('/levels')).toEqual(['/admin/api/levels?days=30']);
    expect(screen.getByRole('heading', { name: 'Stages', level: 1 })).toBeTruthy();
    expect(screen.getByText('In this period: 43 plays and 48 starts, in 4 of the 300 stages.')).toBeTruthy();
  });

  it('"כל הגרסאות" asks for every rev, and keeps the period and the chapter (1.0.3, D73)', async () => {
    const server = setup('#/levels?days=90&chapter=2');
    await loaded();
    expect(server.gets('/levels')).toEqual(['/admin/api/levels?days=90']);
    expect(screen.getByText(/^Only plays of each stage’s current version\./)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Stage versions'), { target: { value: 'all' } });
    await waitFor(() => expect(window.location.hash).toBe('#/levels?days=90&chapter=2&allRevs=1'));
    await waitFor(() =>
      expect(server.gets('/levels')).toEqual([
        '/admin/api/levels?days=90',
        '/admin/api/levels?days=90&allRevs=1',
      ]),
    );
    expect(await screen.findByText(/^Every version of each stage together/)).toBeTruthy();
    expect(screen.getByLabelText<HTMLSelectElement>('Stage versions').value).toBe('all');
  });

  it('lists every stage, in order', async () => {
    setup('#/levels', levelsFixture());
    await loaded();
    expect(order()).toHaveLength(300);
    expect(order().slice(0, 3)).toEqual(['L001', 'L002', 'L003']);
    expect(order().at(-1)).toBe('L300');
    expect(header('Stage').getAttribute('aria-sort')).toBe('ascending');
  });

  it('sorts by a column on a click, and the other way on a second', async () => {
    setup();
    await loaded();
    sortBy('Plays');
    expect(order().slice(0, 5)).toEqual(['L001', 'L002', 'L010', 'L014', 'L003']);
    sortBy('0 stars on the first try');
    expect(order().slice(0, 4)).toEqual(['L014', 'L001', 'L002', 'L010']);
    // Ascending: still the stages without first tries last.
    sortBy('0 stars on the first try');
    expect(order().slice(0, 5)).toEqual(['L010', 'L002', 'L001', 'L014', 'L003']);
  });

  it('shows every share as text: the stars beside their bar, the rates, the median time', async () => {
    setup();
    await loaded();
    const l1 = rowOf(levelsTable(), 'L001');
    // 8, 4, 6 and 2 of 20 plays.
    expect([...l1.querySelectorAll('.stars-text bdi')].map((b) => b.textContent)).toEqual([
      '0★ 40%',
      '1★ 20%',
      '2★ 30%',
      '3★ 10%',
    ]);
    expect(within(l1).getByText('0 stars: 40%, 1 star: 20%, 2 stars: 30%, 3 stars: 10%')).toBeTruthy();
    const segments = [...l1.querySelectorAll<HTMLElement>('.stars-seg')];
    expect(segments.map((s) => s.style.flexGrow)).toEqual(['8', '4', '6', '2']);
    expect(segments[0]?.title).toBe('8 plays with 0 stars (40%)');
    expect(within(l1).getByText('10 s')).toBeTruthy();
    expect(within(l1).getByText('25%')).toBeTruthy(); // replays
    expect(within(l1).getByText('75%')).toBeTruthy(); // 0 stars on the first try…
    expect(within(l1).getByText('of 12')).toBeTruthy(); // …of 12 first tries
    expect(within(l1).getByText('Pinpoint')).toBeTruthy(); // [D79] find's name, as in the app
    // A boss, and a stage nobody played: dashes, no bar.
    expect(within(rowOf(levelsTable(), 'L010')).getByText('Boss')).toBeTruthy();
    const l3 = rowOf(levelsTable(), 'L003');
    expect(l3.querySelector('.stars-meter')).toBeNull();
    expect(within(l3).getAllByText('—').length).toBeGreaterThan(5);
  });

  it('"too hard": a badge and a callout for more than 60% at 0 stars on the first try (60% itself is not)', async () => {
    setup();
    await loaded();
    for (const [id, hard] of [
      ['L001', true],
      ['L014', true],
      ['L002', false],
      ['L010', false],
    ] as const) {
      const row = rowOf(levelsTable(), id);
      expect({ id, badge: within(row).queryByText('Too hard') !== null, stop: row.className }).toEqual({
        id,
        badge: hard,
        stop: hard ? 'row-stop' : '',
      });
    }
    expect(screen.getByText(/^Too hard:/).textContent).toBe(
      'Too hard: L001 (75% of 12), L014 (80% of 5). More than 60% of first tries got 0 stars.',
    );
  });

  it('gates: the ones someone reached, "soften" for more than 30% stuck after 3 tries (30% itself is not)', async () => {
    setup();
    await loaded();
    expect(rows(gatesTable())).toHaveLength(3);
    const toThree = rowOf(gatesTable(), 'Chapter 2 to 3');
    expect(within(toThree).getByText('Soften')).toBeTruthy();
    expect(within(toThree).getByText('40%')).toBeTruthy();
    expect(toThree.className).toBe('row-stop');
    expect(within(rowOf(gatesTable(), 'Chapter 3 to 4')).queryByText('Soften')).toBeNull();
    expect(within(rowOf(gatesTable(), 'Chapter 1 to 2')).queryByText('Soften')).toBeNull();
    expect(within(gatesTable()).getByRole('columnheader', { name: 'Stuck after 3 tries' })).toBeTruthy();
    expect(screen.getByText(/^Soften the chapter:/).textContent).toBe(
      'Soften the chapter: chapter 2 (40%). More than 30% of the players who reached the gate at its end are stuck there after 3 tries.',
    );
  });

  it('the chapter filter shows one chapter, and keeps it in the address', async () => {
    const server = setup();
    await loaded();
    fireEvent.change(screen.getByLabelText('Chapter'), { target: { value: '2' } });
    await waitFor(() => expect(window.location.hash).toBe('#/levels?chapter=2'));
    await waitFor(() => expect(order()).toHaveLength(10));
    expect(order()[0]).toBe('L011');
    expect(order()).toContain('L014');
    // The data is the same: no new request for a chapter.
    expect(server.gets('/levels')).toEqual(['/admin/api/levels?days=30']);
    // Back to every chapter.
    fireEvent.change(screen.getByLabelText('Chapter'), { target: { value: '0' } });
    await waitFor(() => expect(order()).toHaveLength(LIGHT));
  });

  it('opens on a chapter and a period from the address; another period asks again', async () => {
    const server = setup('#/levels?days=90&chapter=3');
    await loaded();
    expect(server.gets('/levels')).toEqual(['/admin/api/levels?days=90']);
    expect(order()).toEqual(Array.from({ length: 10 }, (_, k) => `L0${21 + k}`));
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '7' } });
    await waitFor(() => expect(server.gets('/levels')).toContain('/admin/api/levels?days=7'));
    expect(window.location.hash).toBe('#/levels?days=7&chapter=3');
  });

  it('empty: nobody played a stage nor reached a gate', async () => {
    setup('#/levels', emptyLevelsFixture());
    expect(await screen.findByText('No stages played in this period yet.')).toBeTruthy();
    expect(screen.getByText('No player has reached a gate yet.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(/^Too hard/)).toBeNull();
    expect(screen.queryByText(/^Soften/)).toBeNull();
  });

  it('in Hebrew: the same page, right to left, in its words', async () => {
    setup('#/levels', levelsFixture(LIGHT), 'he');
    await screen.findByText(/^בתקופה:/);
    const table = tableNamed('לפי שלב');
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('heading', { name: 'שלבים', level: 1 })).toBeTruthy();
    expect(within(rowOf(table, 'L001')).getByText('קשה מדי')).toBeTruthy();
    expect(within(rowOf(table, 'L001')).getByText('מיקום מדויק')).toBeTruthy();
    expect(within(rowOf(table, 'L001')).getByText('10 ש׳')).toBeTruthy();
    const gates = tableNamed('שערים');
    expect(within(rowOf(gates, 'מפרק 2 לפרק 3')).getByText('לרכך')).toBeTruthy();
    expect(screen.getByText(/^לרכך את הפרק:/).textContent).toContain('פרק 2 (40%)');
  });

  it('the rules compare strictly, and sorting keeps empty values last', () => {
    expect(isTooHard({ ...emptyLevel(1), firstTryZeroRate: 0.6 }, 0.6)).toBe(false);
    expect(isTooHard({ ...emptyLevel(1), firstTryZeroRate: 0.61 }, 0.6)).toBe(true);
    expect(isTooHard(emptyLevel(1), 0.6)).toBe(false);
    const gate = { chapter: 2, reached: 10, opened: 7, stuck: 3, stuckAfter3: 3, stuckAfter3Rate: 0.3 };
    expect(needsSoftening(gate, 0.3)).toBe(false);
    expect(needsSoftening({ ...gate, stuckAfter3: 4, stuckAfter3Rate: 0.4 }, 0.3)).toBe(true);
    const levels = [
      { ...emptyLevel(3), medianMs: 9000 },
      emptyLevel(1),
      { ...emptyLevel(2), medianMs: 12000 },
    ];
    expect(sortLevels(levels, { column: 'medianMs', dir: 'desc' }).map((l) => l.levelId)).toEqual([
      'L002',
      'L003',
      'L001',
    ]);
    expect(sortLevels(levels, { column: 'medianMs', dir: 'asc' }).map((l) => l.levelId)).toEqual([
      'L003',
      'L002',
      'L001',
    ]);
    expect(sortLevels(levels, { column: 'nonsense', dir: 'asc' }).map((l) => l.levelId)).toEqual([
      'L001',
      'L002',
      'L003',
    ]);
  });
});
