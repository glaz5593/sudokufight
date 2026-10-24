import {
  type AdminQaRunFilter,
  QA_ID_PATTERN,
  QA_MAX_TEXT_LENGTH,
  QA_MAX_TITLE_LENGTH,
  QA_WHO,
  type QaCatalog,
  type QaWho,
} from '@sudoku-fight/protocol';
import { z } from 'zod';

import { runTakes } from './rules';

/**
 * The QA catalog (docs/handoff/2026-10-23/qa-module/plan.md): the fixed set of test tasks QA runs are opened
 * from, in apps/server/data/qa-catalog.json. Claude edits it, when Moshe asks; a change takes effect with the
 * next deploy, and never changes a run already open (a run copies its tasks: ./store.ts).
 *
 * Read lazily: the file is loaded and checked by the first /qa route that needs it, never at start, so a broken
 * catalog can't keep the game server from starting. Broken, those routes answer 500 `qaCatalogInvalid` with the
 * problems, and the Jest test of the real file (catalog.test.ts) keeps a broken one from being shipped.
 *
 * The rules: ids of lower-case letters, digits and "-" (QA_ID_PATTERN), each category, subcategory and task id
 * once in the whole file; every task with at least one step and one expected result, `who` claude, moshe or
 * both; every text non-blank, a title at most 120 characters, any other text at most 500. Nothing else in it (a
 * misspelt field is an error, not ignored), but a `_doc` note at the top.
 */

const id = z.string().regex(QA_ID_PATTERN, 'not an id: a-z, 0-9 and "-", from a letter or digit, at most 80');
const nonBlank = (max: number) =>
  z
    .string()
    .max(max, `at most ${max} characters`)
    .refine((s) => s.trim() !== '', 'blank');
const title = nonBlank(QA_MAX_TITLE_LENGTH);
const line = nonBlank(QA_MAX_TEXT_LENGTH);

const taskSchema = z.strictObject({
  id,
  title,
  steps: z.array(line).min(1, 'a task needs at least one step'),
  expected: z.array(line).min(1, 'a task needs at least one expected result'),
  who: z.enum(QA_WHO, { error: 'expected claude, moshe or both' }),
  source: line.optional(),
});

const subcategorySchema = z.strictObject({
  id,
  title,
  tasks: z.array(taskSchema).min(1, 'a subcategory needs at least one task'),
});

const categorySchema = z.strictObject({
  id,
  title,
  subcategories: z.array(subcategorySchema).min(1, 'a category needs at least one subcategory'),
});

export const qaCatalogSchema = z
  .strictObject({
    _doc: z.union([z.string(), z.array(z.string())]).optional(),
    catalogVersion: z.number().int().min(1),
    categories: z.array(categorySchema).min(1, 'the catalog needs at least one category'),
  })
  .superRefine((catalog, ctx) => {
    // Each kind of id once in the whole file.
    const seen = { category: new Set<string>(), subcategory: new Set<string>(), task: new Set<string>() };
    const once = (kind: keyof typeof seen, value: string, path: (string | number)[]) => {
      if (seen[kind].has(value))
        ctx.addIssue({ code: 'custom', path, message: `${kind} id "${value}" twice` });
      seen[kind].add(value);
    };
    catalog.categories.forEach((c, ci) => {
      once('category', c.id, ['categories', ci, 'id']);
      c.subcategories.forEach((s, si) => {
        once('subcategory', s.id, ['categories', ci, 'subcategories', si, 'id']);
        s.tasks.forEach((t, ti) =>
          once('task', t.id, ['categories', ci, 'subcategories', si, 'tasks', ti, 'id']),
        );
      });
    });
  });

export type QaCatalogResult = { ok: true; catalog: QaCatalog } | { ok: false; problems: string[] };

/** Checks a catalog (the parsed JSON): the catalog, or every problem as `path: what`. */
export function parseQaCatalog(raw: unknown): QaCatalogResult {
  const parsed = qaCatalogSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map(
        (i) => `${i.path.length > 0 ? i.path.join('.') : '(top)'}: ${i.message}`,
      ),
    };
  }
  const { catalogVersion, categories } = parsed.data;
  return { ok: true, catalog: { catalogVersion, categories } };
}

/** Where a catalog comes from: its JSON, parsed (tests pass their own). It may throw: a file that won't load. */
export type QaCatalogSource = () => unknown;

/* eslint-disable @typescript-eslint/no-require-imports -- lazy on purpose: read on first use, never at start */
/**
 * The shipped catalog, apps/server/data/qa-catalog.json: bundled with the server like blocked-words.json
 * (esbuild inlines it; the image has no data/ folder), but required only when first asked for.
 */
export const bundledQaCatalog: QaCatalogSource = () => require('../../data/qa-catalog.json') as unknown;
/* eslint-enable @typescript-eslint/no-require-imports */

/** The catalog of `source`, read and checked on the first call only; the answer, good or not, is kept. */
export function qaCatalogLoader(source: QaCatalogSource): () => QaCatalogResult {
  let result: QaCatalogResult | undefined;
  return () => {
    if (result === undefined) {
      try {
        result = parseQaCatalog(source());
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        result = { ok: false, problems: [`the catalog could not be read: ${why}`] };
      }
    }
    return result;
  };
}

/** A catalog task as a run keeps it: with its category's and subcategory's ids and titles (qa_items). */
export interface QaSnapshotTask {
  categoryId: string;
  categoryTitle: string;
  subcategoryId: string;
  subcategoryTitle: string;
  taskId: string;
  title: string;
  steps: string[];
  expected: string[];
  who: QaWho;
  source: string | null;
}

export type QaSelection =
  { ok: true; tasks: QaSnapshotTask[]; filter: AdminQaRunFilter } | { ok: false; message: string };

/**
 * The tasks a new run takes, in catalog order: of the chosen categories (null: all), for the chosen testers
 * (runTakes: claude and moshe each get both's tasks too). An unknown category, or a choice that leaves no task,
 * is refused. `filter` is the choice as the run keeps it: the categories once each, in catalog order.
 */
export function selectTasks(
  catalog: QaCatalog,
  choice: { who: AdminQaRunFilter['who']; categories: readonly string[] | null },
): QaSelection {
  const known = new Set(catalog.categories.map((c) => c.id));
  const unknown = (choice.categories ?? []).filter((c) => !known.has(c));
  if (unknown.length > 0) {
    return { ok: false, message: `categories: unknown ${unknown.map((c) => `"${c}"`).join(', ')}` };
  }
  const wanted = choice.categories === null ? null : new Set(choice.categories);
  const categories = catalog.categories.filter((c) => wanted === null || wanted.has(c.id));
  const tasks: QaSnapshotTask[] = [];
  for (const c of categories) {
    for (const s of c.subcategories) {
      for (const t of s.tasks) {
        if (!runTakes(choice.who, t.who)) continue;
        tasks.push({
          categoryId: c.id,
          categoryTitle: c.title,
          subcategoryId: s.id,
          subcategoryTitle: s.title,
          taskId: t.id,
          title: t.title,
          steps: [...t.steps],
          expected: [...t.expected],
          who: t.who,
          source: t.source ?? null,
        });
      }
    }
  }
  if (tasks.length === 0) return { ok: false, message: 'no task matches these categories and testers' };
  return {
    ok: true,
    tasks,
    filter: { who: choice.who, categories: wanted === null ? null : categories.map((c) => c.id) },
  };
}
