/**
 * Number and direction helpers for the player components (components.md §0.4, §0.6). Pure, no React.
 * `ltr`, `formatScore` and `scoreText` are worklets too: a count-up formats every frame of it on the UI thread
 * (CountUpText, motion.md §6).
 */

/** U+2212, the minus sign the design uses for negative numbers ("−2"). */
export const MINUS = '−';
const LRI = '⁦';
const PDI = '⁩';

/**
 * An LTR isolate: a cell name, a signed number or a Latin name inside Hebrew text keeps its own order
 * ("בוחרת · ⁦A8⁩", "⁦+3.5⁩").
 */
export function ltr(s: string): string {
  'worklet';
  return `${LRI}${s}${PDI}`;
}

/** A score as the cards show it: Latin digits, one decimal only for halves, U+2212 for a minus (55, 39.5, −2). */
export function formatScore(n: number): string {
  'worklet';
  const abs = Math.abs(n);
  const body = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
  return n < 0 && abs !== 0 ? `${MINUS}${body}` : body;
}

/** A change with its sign: "+3.5", "−2", "0". */
export function formatSigned(n: number): string {
  if (n > 0) return `+${formatScore(n)}`;
  return formatScore(n);
}

/**
 * A score as screen text: a negative one is an LTR isolate, so the minus stays before the number in Hebrew
 * (CLAUDE.md). On Android `writingDirection` is ignored, and "−2" alone in an RTL line would show as "2−".
 */
export function scoreText(n: number): string {
  'worklet';
  return n < 0 ? ltr(formatScore(n)) : formatScore(n);
}

/** A signed change as screen text ("+3.5", "−2"), always an LTR isolate (CLAUDE.md). */
export const signedText = (n: number): string => ltr(formatSigned(n));

/** Seconds as the timers show them: always rounded up, never below 0 (7 while 6.2 s are left). */
export const secondsOf = (ms: number): number => Math.max(0, Math.ceil(ms / 1000));

/** `#rrggbb` at an opacity, for fills the tokens define as "ring at 16%". */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
