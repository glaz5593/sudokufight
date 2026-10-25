import { ENGINE_VERSION } from '@sudoku-fight/engine';
import type {
  AdminPage,
  AdminQaBug,
  AdminQaItem,
  AdminQaRun,
  AdminQaRunCounts,
  AdminQaRunDetail,
  QaBugFilter,
  QaCatalog,
  QaPlatform,
  QaResult,
  QaRunWho,
} from '@sudoku-fight/protocol';
import { and, asc, desc, eq, inArray, isNotNull, type SQL, sql } from 'drizzle-orm';

import type { Db } from '../db';
import { qaItems, type QaItemRow, qaRuns, type QaRunRow } from '../db/schema';
import { selectTasks } from './catalog';
import { isBugResult, mayMarkClosedRun, nextBugStatus } from './rules';

/**
 * The QA runs in the database (qa_runs, qa_items; docs/handoff/2026-10-23/qa-module/plan.md), for the admin
 * API's /qa routes (admin/qa.ts). `actor` is who did it (an admin's address, `password`, or `claude`); `now`
 * epoch ms. Only the latest mark of a task is kept.
 */

/** Rows inserted per statement when a run opens (a few hundred tasks: well under Postgres's 65,535 values). */
const ITEMS_PER_INSERT = 200;

const countWhere = (condition: SQL) =>
  sql<number>`(count(*) filter (where ${condition}))::int`.mapWith(Number);

/** A run's tasks by their marks (AdminQaRunCounts), per run. */
const COUNTS = {
  runId: qaItems.runId,
  total: sql<number>`count(*)::int`.mapWith(Number),
  untested: countWhere(sql`${qaItems.result} = 'untested'`),
  pass: countWhere(sql`${qaItems.result} = 'pass'`),
  partial: countWhere(sql`${qaItems.result} = 'partial'`),
  fail: countWhere(sql`${qaItems.result} = 'fail'`),
  openBugs: countWhere(sql`${qaItems.bugStatus} in ('open', 'reopened')`),
  handled: countWhere(sql`${qaItems.bugStatus} = 'handled'`),
};

const NO_COUNTS: AdminQaRunCounts = {
  total: 0,
  untested: 0,
  pass: 0,
  partial: 0,
  fail: 0,
  openBugs: 0,
  handled: 0,
};

async function countsOf(db: Db, runIds: number[]): Promise<Map<number, AdminQaRunCounts>> {
  if (runIds.length === 0) return new Map();
  const rows = await db
    .select(COUNTS)
    .from(qaItems)
    .where(inArray(qaItems.runId, runIds))
    .groupBy(qaItems.runId);
  return new Map(rows.map(({ runId, ...counts }) => [runId, counts]));
}

const msOf = (d: Date | null): number | null => d?.getTime() ?? null;

function toRun(row: QaRunRow, counts: AdminQaRunCounts | undefined): AdminQaRun {
  return {
    id: row.id,
    title: row.title,
    appVersion: row.appVersion,
    device: row.device,
    platform: row.platform,
    engineVersion: row.engineVersion,
    catalogVersion: row.catalogVersion,
    filter: { who: row.filter.who, categories: row.filter.categories },
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt.getTime(),
    closedBy: row.closedBy,
    closedAt: msOf(row.closedAt),
    counts: counts ?? NO_COUNTS,
  };
}

function toItem(row: QaItemRow): AdminQaItem {
  return {
    taskId: row.taskId,
    position: row.position,
    categoryId: row.categoryId,
    categoryTitle: row.categoryTitle,
    subcategoryId: row.subcategoryId,
    subcategoryTitle: row.subcategoryTitle,
    title: row.title,
    subtitle: row.subtitle,
    steps: row.steps,
    expected: row.expected,
    who: row.who,
    source: row.source,
    result: row.result,
    actual: row.actual,
    note: row.note,
    testedBy: row.testedBy,
    testedAt: msOf(row.testedAt),
    bugStatus: row.bugStatus,
    fixNote: row.fixNote,
    fixedIn: row.fixedIn,
    handledBy: row.handledBy,
    handledAt: msOf(row.handledAt),
  };
}

// ---- runs ---------------------------------------------------------------------------------------------------

export interface OpenRunInput {
  title: string;
  appVersion: string;
  device: string | null;
  platform: QaPlatform | null;
  /** null: every category. */
  categories: string[] | null;
  who: QaRunWho;
}

export type OpenRunResult = { ok: true; run: AdminQaRun } | { ok: false; message: string };

/**
 * Opens a run: copies the chosen tasks of the catalog (catalog.ts selectTasks) into qa_items, untested, in one
 * transaction with the run. Stamped with the catalog's version and the server's engine.
 */
export async function openRun(
  db: Db,
  catalog: QaCatalog,
  input: OpenRunInput,
  actor: string,
  now: number,
): Promise<OpenRunResult> {
  const selection = selectTasks(catalog, { who: input.who, categories: input.categories });
  if (!selection.ok) return selection;
  const { tasks, filter } = selection;
  const run = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(qaRuns)
      .values({
        title: input.title,
        appVersion: input.appVersion,
        device: input.device,
        platform: input.platform,
        engineVersion: ENGINE_VERSION,
        catalogVersion: catalog.catalogVersion,
        filter,
        createdBy: actor,
        createdAt: new Date(now),
      })
      .returning();
    if (row === undefined) throw new Error('insert into qa_runs returned nothing');
    const items = tasks.map((task, position) => ({ runId: row.id, position, ...task }));
    for (let i = 0; i < items.length; i += ITEMS_PER_INSERT) {
      await tx.insert(qaItems).values(items.slice(i, i + ITEMS_PER_INSERT));
    }
    return row;
  });
  return { ok: true, run: toRun(run, { ...NO_COUNTS, total: tasks.length, untested: tasks.length }) };
}

/** GET /admin/api/qa/runs: newest first, each with its counts. */
export async function listRuns(
  db: Db,
  q: { page: number; pageSize: number },
): Promise<AdminPage<AdminQaRun>> {
  const [rows, counted] = await Promise.all([
    db
      .select()
      .from(qaRuns)
      .orderBy(desc(qaRuns.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ n: sql<number>`count(*)::int`.mapWith(Number) }).from(qaRuns),
  ]);
  const counts = await countsOf(
    db,
    rows.map((r) => r.id),
  );
  return {
    items: rows.map((r) => toRun(r, counts.get(r.id))),
    page: q.page,
    pageSize: q.pageSize,
    total: counted[0]?.n ?? 0,
  };
}

/** What GET /admin/api/qa/runs/:runId keeps of the run's tasks (all of them by default). */
export interface RunItemsFilter {
  result?: QaResult;
  /** claude: claude's and both's; moshe: moshe's and both's; all (or absent): every task. */
  who?: QaRunWho;
  category?: string;
  /** Only the tasks that are or were a bug (any bug state). */
  bugs?: boolean;
}

/** A run and its tasks in catalog order (the ones the filter keeps); the counts are the whole run's. Null: none. */
export async function getRun(
  db: Db,
  runId: number,
  filter: RunItemsFilter = {},
): Promise<AdminQaRunDetail | null> {
  const [row] = await db.select().from(qaRuns).where(eq(qaRuns.id, runId));
  if (row === undefined) return null;
  const where: SQL[] = [eq(qaItems.runId, runId)];
  if (filter.result !== undefined) where.push(eq(qaItems.result, filter.result));
  if (filter.who !== undefined && filter.who !== 'all')
    where.push(inArray(qaItems.who, [filter.who, 'both']));
  if (filter.category !== undefined) where.push(eq(qaItems.categoryId, filter.category));
  if (filter.bugs === true) where.push(isNotNull(qaItems.bugStatus));
  const [items, counts] = await Promise.all([
    db
      .select()
      .from(qaItems)
      .where(and(...where))
      .orderBy(asc(qaItems.position)),
    countsOf(db, [runId]),
  ]);
  return { ...toRun(row, counts.get(runId)), items: items.map(toItem) };
}

/** Closes a run. A closed one stays as it was (who closed it, and when). Null: no such run. */
export async function closeRun(
  db: Db,
  runId: number,
  actor: string,
  now: number,
): Promise<AdminQaRun | null> {
  const [closed] = await db
    .update(qaRuns)
    .set({ status: 'closed', closedBy: actor, closedAt: new Date(now) })
    .where(and(eq(qaRuns.id, runId), eq(qaRuns.status, 'open')))
    .returning();
  const row = closed ?? (await db.select().from(qaRuns).where(eq(qaRuns.id, runId)))[0];
  if (row === undefined) return null;
  const counts = await countsOf(db, [runId]);
  return toRun(row, counts.get(runId));
}

// ---- marks and fixes ----------------------------------------------------------------------------------------

export interface MarkInput {
  result: QaResult;
  /** "מה קרה בפועל": required (non-null) for partial and fail (the route checks); dropped on untested. */
  actual: string | null;
  note: string | null;
}

export type MarkResult = { ok: true; item: AdminQaItem } | { ok: false; error: 'notFound' | 'runClosed' };

/**
 * Marks a task (replacing its previous mark), and moves its bug state (rules.ts nextBugStatus). On a closed run,
 * only a bug not verified yet may be marked (a test of its fix). The fix's note and version stay.
 */
export async function markResult(
  db: Db,
  runId: number,
  taskId: string,
  input: MarkInput,
  actor: string,
  now: number,
): Promise<MarkResult> {
  return db.transaction(async (tx): Promise<MarkResult> => {
    const [found] = await tx
      .select({ item: qaItems, runStatus: qaRuns.status })
      .from(qaItems)
      .innerJoin(qaRuns, eq(qaRuns.id, qaItems.runId))
      .where(and(eq(qaItems.runId, runId), eq(qaItems.taskId, taskId)))
      .for('update');
    if (found === undefined) return { ok: false, error: 'notFound' };
    const { item, runStatus } = found;
    if (runStatus === 'closed' && !mayMarkClosedRun(item.bugStatus)) return { ok: false, error: 'runClosed' };
    const [row] = await tx
      .update(qaItems)
      .set({
        result: input.result,
        actual: input.result === 'untested' ? null : input.actual,
        note: input.note,
        testedBy: actor,
        testedAt: new Date(now),
        bugStatus: nextBugStatus(item.bugStatus, input.result),
      })
      .where(eq(qaItems.id, item.id))
      .returning();
    if (row === undefined) throw new Error('update of qa_items returned nothing');
    return { ok: true, item: toItem(row) };
  });
}

export interface FixInput {
  fixNote: string;
  fixedIn: string;
}

export type FixResult = { ok: true; item: AdminQaItem } | { ok: false; error: 'notFound' | 'notBug' };

/**
 * Marks a bug handled ("טופל"): what was done and in which version, by whom and when. Only a task marked fail
 * or partial; on a closed run too. Again, it replaces the fix (the bug stays handled).
 */
export async function markFixed(
  db: Db,
  runId: number,
  taskId: string,
  input: FixInput,
  actor: string,
  now: number,
): Promise<FixResult> {
  return db.transaction(async (tx): Promise<FixResult> => {
    const [item] = await tx
      .select()
      .from(qaItems)
      .where(and(eq(qaItems.runId, runId), eq(qaItems.taskId, taskId)))
      .for('update');
    if (item === undefined) return { ok: false, error: 'notFound' };
    if (!isBugResult(item.result)) return { ok: false, error: 'notBug' };
    const [row] = await tx
      .update(qaItems)
      .set({
        bugStatus: 'handled',
        fixNote: input.fixNote,
        fixedIn: input.fixedIn,
        handledBy: actor,
        handledAt: new Date(now),
      })
      .where(eq(qaItems.id, item.id))
      .returning();
    if (row === undefined) throw new Error('update of qa_items returned nothing');
    return { ok: true, item: toItem(row) };
  });
}

// ---- bugs ---------------------------------------------------------------------------------------------------

function bugsWhere(status: QaBugFilter): SQL {
  if (status === 'all') return isNotNull(qaItems.bugStatus);
  if (status === 'active') return inArray(qaItems.bugStatus, ['open', 'reopened']);
  return eq(qaItems.bugStatus, status);
}

/**
 * GET /admin/api/qa/bugs: the bugs of every run in that state (active: open and reopened), the latest marked
 * first, each whole (AdminQaBug: its run, its task's steps and expected result, the mark, the fix).
 */
export async function listBugs(
  db: Db,
  q: { status: QaBugFilter; page: number; pageSize: number },
): Promise<AdminPage<AdminQaBug>> {
  const where = bugsWhere(q.status);
  const [rows, counted] = await Promise.all([
    db
      .select({
        item: qaItems,
        run: {
          id: qaRuns.id,
          title: qaRuns.title,
          appVersion: qaRuns.appVersion,
          device: qaRuns.device,
          platform: qaRuns.platform,
          status: qaRuns.status,
        },
      })
      .from(qaItems)
      .innerJoin(qaRuns, eq(qaRuns.id, qaItems.runId))
      .where(where)
      .orderBy(sql`${qaItems.testedAt} desc nulls last`, desc(qaItems.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db
      .select({ n: sql<number>`count(*)::int`.mapWith(Number) })
      .from(qaItems)
      .where(where),
  ]);
  const items = rows.flatMap(({ item, run }) => {
    const bug = toBug(item, run);
    return bug === null ? [] : [bug];
  });
  return { items, page: q.page, pageSize: q.pageSize, total: counted[0]?.n ?? 0 };
}

function toBug(row: QaItemRow, run: AdminQaBug['run']): AdminQaBug | null {
  if (row.bugStatus === null) return null;
  const item = toItem(row);
  return {
    run,
    taskId: item.taskId,
    categoryTitle: item.categoryTitle,
    subcategoryTitle: item.subcategoryTitle,
    title: item.title,
    subtitle: item.subtitle,
    steps: item.steps,
    expected: item.expected,
    result: item.result,
    actual: item.actual,
    note: item.note,
    testedBy: item.testedBy,
    testedAt: item.testedAt,
    bugStatus: row.bugStatus,
    fixNote: item.fixNote,
    fixedIn: item.fixedIn,
    handledBy: item.handledBy,
    handledAt: item.handledAt,
  };
}
