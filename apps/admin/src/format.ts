import type { AdminDayCount } from '@sudoku-fight/protocol';

import type { Lang } from './strings';

/**
 * Numbers, dates and times for the admin site, through Intl in the site's language. Pure functions: the
 * current time comes in as `now`.
 */

const LOCALES: Record<Lang, string> = { he: 'he-IL', en: 'en-GB' };

const DAY_MS = 86_400_000;

export function formatNumber(lang: Lang, value: number, maxFractionDigits = 0): string {
  return new Intl.NumberFormat(LOCALES[lang], { maximumFractionDigits: maxFractionDigits }).format(value);
}

/** 0.4 → "40%". */
export function formatPercent(lang: Lang, ratio: number): string {
  return new Intl.NumberFormat(LOCALES[lang], { style: 'percent', maximumFractionDigits: 0 }).format(ratio);
}

/** A signed number: "+12", "-8" with the real minus sign (U+2212), "0". */
export function formatSigned(lang: Lang, value: number, maxFractionDigits = 0): string {
  return new Intl.NumberFormat(LOCALES[lang], {
    maximumFractionDigits: maxFractionDigits,
    signDisplay: 'exceptZero',
  })
    .format(value)
    .replace('-', '\u2212');
}

export function formatDateTime(lang: Lang, ms: number): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
}

export function formatDate(lang: Lang, ms: number): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { dateStyle: 'medium' }).format(ms);
}

/** A 'YYYY-MM-DD' day (already in the admin time zone): "9 Oct" / "9 באוק׳". */
export function formatDay(lang: Lang, day: string): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    dayToUtcMs(day),
  );
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * DAY_MS],
  ['month', 30 * DAY_MS],
  ['week', 7 * DAY_MS],
  ['day', DAY_MS],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/**
 * "לפני 3 ימים" / "3 days ago"; under 45 seconds, "עכשיו" / "now". ICU's Hebrew adds the number after its
 * one-word forms ("לפני שעה (1)", "לפני שעתיים (2)"); that echo is dropped.
 */
export function formatRelative(lang: Lang, ms: number, now: number): string {
  const diff = ms - now;
  const rtf = new Intl.RelativeTimeFormat(LOCALES[lang], { numeric: 'auto' });
  const abs = Math.abs(diff);
  const say = (value: number, unit: Intl.RelativeTimeFormatUnit) =>
    rtf.format(value, unit).replace(/\s*\(\d+\)$/, '');
  if (abs < 45_000) return say(0, 'second');
  for (const [unit, size] of RELATIVE_UNITS) {
    if (abs >= size) return say(Math.round(diff / size), unit);
  }
  return say(Math.round(diff / 1000), 'second');
}

/** A span of time as a clock: "4:05", "1:02:03". Negative spans count as 0. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** A game-clock offset with tenths: "0:07.3", "12:40.0", and before the start "-0:04.3" (real minus). */
export function formatOffset(ms: number): string {
  const tenths = Math.round(Math.abs(ms) / 100);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  const sign = ms < 0 && tenths > 0 ? '\u2212' : '';
  return `${sign}${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}

/** "3 דקות" / "3 minutes" for a wait, in seconds under 90 s and whole minutes (rounded up) above. */
export function formatWait(lang: Lang, ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  const [value, unit] = seconds < 90 ? [seconds, 'second'] : [Math.ceil(seconds / 60), 'minute'];
  return new Intl.NumberFormat(LOCALES[lang], { style: 'unit', unit, unitDisplay: 'long' }).format(value);
}

/** The first 8 characters of a UUID: enough to tell installs apart in a table. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Props or a payload as one line of JSON. */
export function compactJson(value: unknown): string {
  return JSON.stringify(value) ?? '';
}

// ---------------------------------------------------------------------------------------------------------
// Days

export function dayToUtcMs(day: string): number {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function utcMsToDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today in the browser's time zone, 'YYYY-MM-DD' (the admin is in Israel, like the server's default zone). */
export function localDay(now: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * The last `days` days up to `today` (or up to the newest day in `series`, if the server's zone is already a
 * day ahead), oldest first, with 0 for every day the server left out.
 */
export function fillDays(series: readonly AdminDayCount[], days: number, today: string): AdminDayCount[] {
  const counts = new Map(series.map((p) => [p.day, p.count]));
  const last = series.reduce((max, p) => (p.day > max ? p.day : max), today);
  const end = dayToUtcMs(last);
  const out: AdminDayCount[] = [];
  for (let i = Math.max(1, days) - 1; i >= 0; i--) {
    const day = utcMsToDay(end - i * DAY_MS);
    out.push({ day, count: counts.get(day) ?? 0 });
  }
  return out;
}

/**
 * A round top for a y-axis of counts and a whole-number step that splits it into about `target` parts:
 * 37 → top 40, step 10. Nothing (or only zeros) → top 1, step 1.
 */
export function niceScale(max: number, target = 4): { top: number; step: number } {
  if (!(max > 0)) return { top: 1, step: 1 };
  const raw = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = Math.max(1, nice * magnitude);
  return { top: Math.ceil(max / step) * step, step };
}
