// Formatting helpers for game values. Scores can be fractional (x.5) — see spec §14.
import { fmtNum } from './i18n.js';

/** 12 → "12", 3.5 → "3.5", -2 → "−2" */
export function fmtScore(n) {
  const v = Math.round(Number(n) * 10) / 10;
  return fmtNum(v, { decimals: Number.isInteger(v) ? 0 : 1 });
}

/** +3.5 / −2 with a real minus sign (for popups and deltas) */
export function fmtSigned(n) {
  const v = Math.round(Number(n) * 10) / 10;
  return fmtNum(v, { decimals: Number.isInteger(v) ? 0 : 1, signed: true });
}

/** 83000 → "1:23" ; 3723000 → "1:02:03" */
export function fmtClock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (x) => String(x).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}

/** Seconds left, ceil, for countdown rings: 4200 → "5" */
export const fmtSecs = (ms) => String(Math.max(0, Math.ceil(ms / 1000)));

/** Relative day label for history lists. */
export function fmtDate(iso, lang = 'he') {
  const d = new Date(iso);
  return d.toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short' });
}
