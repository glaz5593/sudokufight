/**
 * Small SVG-string helpers for drawing characters, shared by the catalog files (the first files keep their own
 * copies). Pure functions that return markup; numbers go through `f` (2 decimals, no "-0").
 *
 * Do not change what these return: every character drawn with them would move. Need another helper? Keep it
 * in your own catalog file.
 */

import { f } from '../svg';

export type Pt = readonly [x: number, y: number];
/** −1 = the viewer's left, +1 = the right. */
export type Side = -1 | 1;

/** "x y" of a point. */
export const P = ([x, y]: Pt): string => `${f(x)} ${f(y)}`;
/** The point `t` of the way from `a` to `b`. */
export const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
/** x of a point `dx` from the middle line (x 50), on side `s`. */
export const sx = (s: Side, dx: number): number => 50 + s * dx;
/** Draws a symmetric part once per side: `draw(-1) + draw(1)`. */
export const mirrored = (draw: (s: Side) => string): string => draw(-1) + draw(1);

/** A point at `deg` degrees (0 = right, 90 = down) on a circle, as "x y". */
export const polar = (cx: number, cy: number, r: number, deg: number): string => {
  const a = (deg * Math.PI) / 180;
  return `${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`;
};

/** A filled path. `extra` adds attributes, e.g. ' transform="translate(-1.4 -1.3)"' for the offset shade. */
export const path = (d: string, fill: string, extra = ''): string =>
  `<path d="${d}" fill="${fill}"${extra}/>`;

/** A round-capped line, for things that are lines in real life (a handle, a whisker, steam, a ray). */
export const line = (d: string, color: string, width: number): string =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f(width)}" stroke-linecap="round" stroke-linejoin="round"/>`;

export const circle = (x: number, y: number, r: number, fill: string): string =>
  `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${fill}"/>`;

/** An ellipse, optionally turned `rotate` degrees around its centre. */
export const ellipse = (x: number, y: number, rx: number, ry: number, fill: string, rotate = 0): string =>
  `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}"` +
  (rotate ? ` transform="rotate(${f(rotate)} ${f(x)} ${f(y)})"` : '') +
  ` fill="${fill}"/>`;

/** A rectangle with rounded corners `r`. */
export const rect = (x: number, y: number, w: number, h: number, fill: string, r = 0): string =>
  `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${r ? ` rx="${f(r)}"` : ''} fill="${fill}"/>`;

/**
 * The offset shade (STYLE.md §5): the silhouette in `shade`, then the lit surface in `base` shifted up and left
 * by `dx`, `dy`, so a crescent of shade shows on the lower right.
 */
export const shaded = (d: string, base: string, shadeColor: string, dx = -1.4, dy = -1.3): string =>
  path(d, shadeColor) + path(d, base, ` transform="translate(${f(dx)} ${f(dy)})"`);
