import { existsSync } from 'node:fs';
import path from 'node:path';

import type { QaCatalog } from '@sudoku-fight/protocol';

import { testQaCatalog, TEST_QA_TASKS } from '../testing/qa';
import { bundledQaCatalog, parseQaCatalog, qaCatalogLoader, selectTasks } from './catalog';

/**
 * The QA catalog (docs/handoff/2026-10-23/qa-module/plan.md): its rules on fixture catalogs, the run's choice of
 * tasks, the lazy loader, and the shipped file itself (apps/server/data/qa-catalog.json): a broken catalog fails
 * here, in `npm test`, before it can be deployed.
 */

const problemsOf = (raw: unknown): string[] => {
  const result = parseQaCatalog(raw);
  return result.ok ? [] : result.problems;
};

/** The fixture with a change made to it. */
const changed = (change: (c: QaCatalog) => void): QaCatalog => {
  const c = testQaCatalog();
  change(c);
  return c;
};

describe('parseQaCatalog', () => {
  it('takes a well-formed catalog, as it is (and a `_doc` note at the top, left out)', () => {
    expect(parseQaCatalog(testQaCatalog())).toEqual({ ok: true, catalog: testQaCatalog() });
    expect(parseQaCatalog({ _doc: ['how to edit'], ...testQaCatalog() })).toEqual({
      ok: true,
      catalog: testQaCatalog(),
    });
  });

  it('a task needs at least one step and one expected result, each a non-blank text', () => {
    const task = (c: QaCatalog) => c.categories[0]!.subcategories[0]!.tasks[0]!;
    const at = 'categories.0.subcategories.0.tasks.0';
    expect(problemsOf(changed((c) => (task(c).steps = [])))).toEqual([
      `${at}.steps: a task needs at least one step`,
    ]);
    expect(problemsOf(changed((c) => (task(c).expected = [])))).toEqual([
      `${at}.expected: a task needs at least one expected result`,
    ]);
    expect(problemsOf(changed((c) => (task(c).steps = ['פותחים', '  '])))).toEqual([`${at}.steps.1: blank`]);
    const withoutExpected = changed((c) => delete (task(c) as Partial<ReturnType<typeof task>>).expected);
    expect(problemsOf(withoutExpected)).toHaveLength(1);
    expect(problemsOf(withoutExpected)[0]).toMatch(new RegExp(`^${at}.expected: `));
  });

  it('a task needs a subtitle: a non-blank text of at most 140 characters', () => {
    const task = (c: QaCatalog) => c.categories[0]!.subcategories[0]!.tasks[0]!;
    const at = 'categories.0.subcategories.0.tasks.0';
    const withoutSubtitle = changed((c) => delete (task(c) as Partial<ReturnType<typeof task>>).subtitle);
    expect(problemsOf(withoutSubtitle)).toHaveLength(1);
    expect(problemsOf(withoutSubtitle)[0]).toMatch(new RegExp(`^${at}.subtitle: `));
    expect(problemsOf(changed((c) => (task(c).subtitle = '   ')))).toEqual([`${at}.subtitle: blank`]);
    expect(problemsOf(changed((c) => (task(c).subtitle = 'ב'.repeat(141))))).toEqual([
      `${at}.subtitle: at most 140 characters`,
    ]);
    expect(problemsOf(changed((c) => (task(c).subtitle = 'ב'.repeat(140))))).toEqual([]);
  });

  it('refuses bad ids, a bad who, long or blank texts and unknown fields', () => {
    const task = (c: QaCatalog) => c.categories[0]!.subcategories[0]!.tasks[0]!;
    for (const bad of ['', 'Friends', 'friends_room', '-x', 'חברים', 'a'.repeat(81)])
      expect(problemsOf(changed((c) => (task(c).id = bad)))).toHaveLength(1);
    expect(problemsOf(changed((c) => (task(c).who = 'everyone' as never)))[0]).toMatch(
      /tasks\.0\.who: expected claude, moshe or both/,
    );
    expect(problemsOf(changed((c) => (task(c).title = 'א'.repeat(121))))[0]).toMatch(
      /tasks\.0\.title: at most 120 characters/,
    );
    expect(problemsOf(changed((c) => (task(c).title = 'א'.repeat(120))))).toEqual([]);
    expect(problemsOf(changed((c) => (task(c).expected = ['א'.repeat(501)])))[0]).toMatch(/at most 500/);
    expect(problemsOf(changed((c) => (task(c).source = ' ')))[0]).toMatch(/tasks\.0\.source: blank/);
    expect(problemsOf(changed((c) => Object.assign(task(c), { expectd: ['typo'] })))[0]).toMatch(
      /tasks\.0: .*expectd/,
    );
    expect(problemsOf({ ...testQaCatalog(), catalogVersion: 0 })[0]).toMatch(/^catalogVersion: /);
    expect(problemsOf({ catalogVersion: 1, categories: [] })).toEqual([
      'categories: the catalog needs at least one category',
    ]);
    expect(problemsOf(changed((c) => (c.categories[2]!.subcategories[0]!.tasks = [])))[0]).toBe(
      'categories.2.subcategories.0.tasks: a subcategory needs at least one task',
    );
    expect(problemsOf(null)).toHaveLength(1);
    expect(problemsOf('not a catalog')).toHaveLength(1);
  });

  it('every category, subcategory and task id once in the whole file', () => {
    const twice = changed((c) => {
      c.categories[1]!.id = 'friends';
      c.categories[2]!.subcategories[0]!.id = 'friends-room';
      c.categories[2]!.subcategories[0]!.tasks[0]!.id = 'friends-room-join';
    });
    expect(problemsOf(twice)).toEqual([
      'categories.1.id: category id "friends" twice',
      'categories.2.subcategories.0.id: subcategory id "friends-room" twice',
      'categories.2.subcategories.0.tasks.0.id: task id "friends-room-join" twice',
    ]);
  });
});

describe('selectTasks: what a new run takes', () => {
  const ids = (choice: Parameters<typeof selectTasks>[1]) => {
    const s = selectTasks(testQaCatalog(), choice);
    return s.ok ? s.tasks.map((t) => t.taskId) : s.message;
  };

  it('every task by default, in catalog order, with its category and subcategory', () => {
    const s = selectTasks(testQaCatalog(), { who: 'all', categories: null });
    if (!s.ok) throw new Error(s.message);
    expect(s.tasks.map((t) => t.taskId)).toEqual(TEST_QA_TASKS);
    expect(s.tasks[0]).toEqual({
      categoryId: 'friends',
      categoryTitle: 'חברים',
      subcategoryId: 'friends-room',
      subcategoryTitle: 'חדר עם חברים',
      taskId: 'friends-room-create',
      title: 'פתיחת חדר',
      subtitle: 'בדוק פתיחת חדר חדש מלשונית החברים',
      steps: ['פותחים את לשונית "חברים"', 'לוחצים על "פתח חדר"'],
      expected: ['נפתח חדר עם קוד בן 6 תווים', 'הקוד מוצג משמאל לימין'],
      who: 'both',
      source: 'FRIENDS-DEVICE-CHECKS בדיקה 7',
    });
    expect(s.tasks[1]?.source).toBeNull();
    expect(s.filter).toEqual({ who: 'all', categories: null });
  });

  it("who: claude's tasks and both's, or moshe's and both's", () => {
    expect(ids({ who: 'claude', categories: null })).toEqual([
      'friends-room-create',
      'friends-room-join',
      'practice-gate-open',
    ]);
    expect(ids({ who: 'moshe', categories: null })).toEqual([
      'friends-room-create',
      'friends-invite-link',
      'practice-stars',
      'sound-mute',
    ]);
  });

  it('categories: only those, kept in catalog order; an unknown one or an empty choice is refused', () => {
    const s = selectTasks(testQaCatalog(), { who: 'all', categories: ['sound', 'practice'] });
    if (!s.ok) throw new Error(s.message);
    expect(s.tasks.map((t) => t.taskId)).toEqual(['practice-gate-open', 'practice-stars', 'sound-mute']);
    expect(s.filter).toEqual({ who: 'all', categories: ['practice', 'sound'] });
    expect(ids({ who: 'all', categories: ['practice', 'nope'] })).toBe('categories: unknown "nope"');
    expect(ids({ who: 'claude', categories: ['sound'] })).toBe(
      'no task matches these categories and testers',
    );
  });

  it('copies the steps: a later change of the catalog leaves them', () => {
    const catalog = testQaCatalog();
    const s = selectTasks(catalog, { who: 'all', categories: null });
    catalog.categories[0]!.subcategories[0]!.tasks[0]!.steps.push('צעד חדש');
    expect(s.ok && s.tasks[0]?.steps).toHaveLength(2);
  });
});

describe('qaCatalogLoader: read on first use, once', () => {
  it('reads nothing until asked, then keeps the answer', () => {
    const source = jest.fn(() => testQaCatalog());
    const load = qaCatalogLoader(source);
    expect(source).not.toHaveBeenCalled();
    expect(load()).toEqual({ ok: true, catalog: testQaCatalog() });
    expect(load().ok).toBe(true);
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('a catalog that does not load, or is not valid: a failure with the problems, kept too', () => {
    const missing = jest.fn((): unknown => {
      throw new Error("Cannot find module '../../data/qa-catalog.json'");
    });
    const load = qaCatalogLoader(missing);
    expect(load()).toEqual({
      ok: false,
      problems: ["the catalog could not be read: Cannot find module '../../data/qa-catalog.json'"],
    });
    expect(load().ok).toBe(false);
    expect(missing).toHaveBeenCalledTimes(1);
    expect(qaCatalogLoader(() => ({ catalogVersion: 1 }))()).toEqual({
      ok: false,
      problems: [expect.stringMatching(/^categories: /)],
    });
  });
});

describe('the shipped catalog (apps/server/data/qa-catalog.json)', () => {
  const FILE = path.join(__dirname, '..', '..', 'data', 'qa-catalog.json');
  const HEBREW = /\p{Script=Hebrew}/u;

  it('exists, and the server bundles it from there', () => {
    expect(existsSync(FILE)).toBe(true);
  });

  it('is valid: ids once each, every task with steps and an expected result, a known who', () => {
    const result = parseQaCatalog(bundledQaCatalog());
    // On failure, the problems say what to fix.
    expect(result.ok ? [] : result.problems).toEqual([]);
  });

  it('is in Hebrew: every title, subtitle, step and expected result has a Hebrew letter', () => {
    const result = parseQaCatalog(bundledQaCatalog());
    if (!result.ok) throw new Error(result.problems.join('\n'));
    const notHebrew: string[] = [];
    const check = (where: string, text: string) => {
      if (!HEBREW.test(text)) notHebrew.push(`${where}: ${text}`);
    };
    for (const c of result.catalog.categories) {
      check(c.id, c.title);
      for (const s of c.subcategories) {
        check(s.id, s.title);
        for (const t of s.tasks) {
          check(t.id, t.title);
          check(`${t.id} subtitle`, t.subtitle);
          t.steps.forEach((step, i) => check(`${t.id} step ${i + 1}`, step));
          t.expected.forEach((line, i) => check(`${t.id} expected ${i + 1}`, line));
        }
      }
    }
    expect(notHebrew).toEqual([]);
  });

  it('every subtitle starts with "בדוק"', () => {
    const result = parseQaCatalog(bundledQaCatalog());
    if (!result.ok) throw new Error(result.problems.join('\n'));
    const tasks = result.catalog.categories.flatMap((c) => c.subcategories.flatMap((s) => s.tasks));
    expect(tasks.filter((t) => !t.subtitle.startsWith('בדוק')).map((t) => `${t.id}: ${t.subtitle}`)).toEqual(
      [],
    );
  });

  it('opens a run for each tester: every run choice finds tasks', () => {
    const result = parseQaCatalog(bundledQaCatalog());
    if (!result.ok) throw new Error(result.problems.join('\n'));
    for (const who of ['all', 'claude', 'moshe'] as const)
      expect([who, selectTasks(result.catalog, { who, categories: null }).ok]).toEqual([who, true]);
  });
});
