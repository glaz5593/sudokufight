import type { StyleProp } from 'react-native';

/**
 * Prop comparisons for `memo` on the game screen (spec §22: 55 fps). The screen re-reads the time 4 times a
 * second and builds its view models again each time; these let a component skip a render when what it shows
 * did not change. Pure, no React.
 */

/** Deep equality of plain data (view models): numbers, strings, booleans, null, arrays and objects. */
export function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => sameData(x, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const rb = b as Record<string, unknown>;
  const ra = a as Record<string, unknown>;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(rb, k) && sameData(ra[k], rb[k]));
}

/** The same style, or the same styles in a new array (`[styles.a, styles.b]` written in a render). */
export function sameStyle<S>(a: StyleProp<S>, b: StyleProp<S>): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

type Comparators<P> = { [K in keyof P]?: (a: P[K], b: P[K]) => boolean };

/**
 * `memo`'s comparison: every prop the same (Object.is), except the ones given their own comparison (a view
 * model compared by what it shows, a style array by its parts).
 */
export function sameProps<P extends object>(a: P, b: P, compare: Comparators<P> = {}): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof P)[]);
  for (const key of keys) {
    const same = compare[key];
    if (same ? !same(a[key], b[key]) : !Object.is(a[key], b[key])) return false;
  }
  return true;
}
