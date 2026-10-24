import {
  ADMIN_DEFAULT_PAGE_SIZE,
  ADMIN_MAX_PAGE_SIZE,
  ADMIN_REPORT_FILTERS,
  ADMIN_USER_KINDS,
  QA_BUG_FILTERS,
  QA_ID_PATTERN,
  QA_RESULTS,
  QA_RUN_WHO,
} from '@sudoku-fight/protocol';
import { z } from 'zod';

import { DEFAULT_STATS_DAYS, MAX_SEARCH_LENGTH, MAX_STATS_DAYS } from './constants';

/**
 * The query strings of the admin API, checked. A bad value is a 400 with a short message, never a guess; a
 * missing or blank one takes its default. A repeated parameter (?page=1&page=2) arrives as an array and is
 * refused.
 */

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const int = (min: number, max: number, fallback: number) =>
  z.preprocess(
    blankToUndefined,
    z
      .string({ error: 'expected one value' })
      .regex(/^\d{1,9}$/, 'expected a whole number')
      .transform(Number)
      .pipe(z.number().min(min, `at least ${min}`).max(max, `at most ${max}`))
      .default(fallback),
  );
const text = (max: number) =>
  z.preprocess(
    blankToUndefined,
    z
      .string({ error: 'expected one value' })
      .transform((s) => s.trim())
      .pipe(z.string().max(max, `at most ${max} characters`))
      .optional(),
  );

export const pageQuerySchema = z.object({
  page: int(1, 1_000_000, 1),
  pageSize: int(1, ADMIN_MAX_PAGE_SIZE, ADMIN_DEFAULT_PAGE_SIZE),
  search: text(MAX_SEARCH_LENGTH),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

/**
 * GET /admin/api/users: `kind` person (the default: the people), persona (the stealth bot's personas,
 * stealth-bot.md §8) or all.
 */
export const usersQuerySchema = pageQuerySchema.extend({
  kind: z.preprocess(
    blankToUndefined,
    z.enum(ADMIN_USER_KINDS, { error: 'expected person, persona or all' }).default('person'),
  ),
});
export type UsersQuery = z.infer<typeof usersQuerySchema>;

/**
 * GET /admin/api/games: `mode`, and `stealth` (stealth-bot.md §8): '1' only the games against a stealth bot,
 * '0' only the others; missing or blank, every game.
 */
export const gamesQuerySchema = pageQuerySchema.extend({
  mode: text(32),
  stealth: z.preprocess(
    blankToUndefined,
    z
      .enum(['0', '1'], { error: 'expected 1 or 0' })
      .transform((v) => v === '1')
      .optional(),
  ),
});
export type GamesQuery = z.infer<typeof gamesQuerySchema>;

export const daysQuerySchema = z.object({ days: int(1, MAX_STATS_DAYS, DEFAULT_STATS_DAYS) });
export type DaysQuery = z.infer<typeof daysQuerySchema>;

/** A yes/no switch: '1' or 'true' is on; missing, blank, '0' or 'false' is off; anything else is refused. */
const flag = z
  .preprocess(blankToUndefined, z.enum(['0', '1', 'true', 'false'], { error: 'expected 1 or 0' }).optional())
  .transform((v) => v === '1' || v === 'true');

/**
 * GET /admin/api/levels (1.0.3, spec §27.3): the period, and `allRevs` to count every rev of a level together
 * (the plays from before a rebuild too, e.g. 1.0.2's for the D74 calibration); by default only the rev each
 * level has now.
 */
export const levelsQuerySchema = daysQuerySchema.extend({ allRevs: flag });
export type LevelsQueryParams = z.infer<typeof levelsQuerySchema>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function parseQuery<T>(schema: z.ZodType<T>, query: unknown): ParseResult<T> {
  const parsed = schema.safeParse(query ?? {});
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
  return { ok: false, message: `${where}${issue?.message ?? 'invalid'}` };
}

/** `%search%` for ILIKE, with the pattern characters of the search itself taken literally. */
export function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** GET /admin/api/reports (spec §3.5): a page of reported players, by the reports' status. */
export const reportsQuerySchema = z.object({
  page: int(1, 1_000_000, 1),
  pageSize: int(1, ADMIN_MAX_PAGE_SIZE, ADMIN_DEFAULT_PAGE_SIZE),
  status: z.preprocess(blankToUndefined, z.enum(ADMIN_REPORT_FILTERS).default('open')),
});
export type ReportsQuery = z.infer<typeof reportsQuerySchema>;

/** GET /admin/api/audit: a page of the audit log. */
export const auditQuerySchema = z.object({
  page: int(1, 1_000_000, 1),
  pageSize: int(1, ADMIN_MAX_PAGE_SIZE, ADMIN_DEFAULT_PAGE_SIZE),
});

/** GET /admin/api/qa/runs: a page of QA runs, newest first. */
export const qaRunsQuerySchema = z.object({
  page: int(1, 1_000_000, 1),
  pageSize: int(1, ADMIN_MAX_PAGE_SIZE, ADMIN_DEFAULT_PAGE_SIZE),
});

/**
 * GET /admin/api/qa/runs/:runId: which of its tasks to show (all by default): by `result`, by `who` (claude:
 * claude's and both's; moshe: moshe's and both's; all), by `category` (its id: QA_ID_PATTERN, else a 400), and
 * `bugs` (1: only the tasks that are or were a bug).
 */
export const qaRunQuerySchema = z.object({
  result: z.preprocess(
    blankToUndefined,
    z.enum(QA_RESULTS, { error: 'expected untested, pass, partial or fail' }).optional(),
  ),
  who: z.preprocess(
    blankToUndefined,
    z.enum(QA_RUN_WHO, { error: 'expected claude, moshe or all' }).optional(),
  ),
  category: z.preprocess(
    blankToUndefined,
    z.string({ error: 'expected one value' }).trim().regex(QA_ID_PATTERN, 'not a category id').optional(),
  ),
  bugs: flag,
});
export type QaRunQuery = z.infer<typeof qaRunQuerySchema>;

/** GET /admin/api/qa/bugs: a page of bugs by state; active (open and reopened) by default. */
export const qaBugsQuerySchema = z.object({
  status: z.preprocess(
    blankToUndefined,
    z
      .enum(QA_BUG_FILTERS, { error: 'expected active, open, handled, verified, reopened or all' })
      .default('active'),
  ),
  page: int(1, 1_000_000, 1),
  pageSize: int(1, ADMIN_MAX_PAGE_SIZE, ADMIN_DEFAULT_PAGE_SIZE),
});
