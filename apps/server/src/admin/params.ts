import { ADMIN_DEFAULT_PAGE_SIZE, ADMIN_MAX_PAGE_SIZE, ADMIN_REPORT_FILTERS } from '@sudoku-fight/protocol';
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

export const gamesQuerySchema = pageQuerySchema.extend({ mode: text(32) });
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
