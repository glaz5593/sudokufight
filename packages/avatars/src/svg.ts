/** Small SVG-string helpers shared by the rig and the renderer. Pure functions, no DOM. */

import type { Point } from './types';

/** A number for an SVG attribute: at most 2 decimals, no "-0". */
export function f(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

export function pt(p: Point): string {
  return `${f(p.x)} ${f(p.y)}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Escapes text for an attribute value or text node. */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** A half-plane: the points p with n · (p − at) ≥ 0 are kept. */
export interface HalfPlane {
  at: Point;
  n: Point;
}

export function ellipsePath(e: Ellipse): string {
  const { cx, cy, rx, ry } = e;
  return (
    `M${f(cx - rx)} ${f(cy)}` +
    `a${f(rx)} ${f(ry)} 0 1 0 ${f(2 * rx)} 0` +
    `a${f(rx)} ${f(ry)} 0 1 0 ${f(-2 * rx)} 0Z`
  );
}

/**
 * The part of an ellipse on the kept side of a half-plane, as a path: how the rig cuts an eye with a lid
 * (a sad droop, a happy squint) without a clip path or a skin-coloured patch. Returns '' if nothing is kept.
 */
export function cutEllipse(e: Ellipse, cut: HalfPlane): string {
  const { cx, cy, rx, ry } = e;
  // Work in the unit circle: u = (x − cx) / rx, v = (y − cy) / ry. Normals scale the other way.
  const nx = cut.n.x * rx;
  const ny = cut.n.y * ry;
  const len = Math.hypot(nx, ny);
  if (len === 0) return ellipsePath(e);
  const ux = nx / len;
  const uy = ny / len;
  const c = ux * ((cut.at.x - cx) / rx) + uy * ((cut.at.y - cy) / ry); // kept: u · q ≥ c
  if (c <= -1) return ellipsePath(e);
  if (c >= 1) return '';
  const h = Math.sqrt(1 - c * c);
  const a = { x: c * ux - h * uy, y: c * uy + h * ux };
  const b = { x: c * ux + h * uy, y: c * uy - h * ux };
  const span = 2 * Math.acos(c); // the kept arc, through the direction u
  const tau = 2 * Math.PI;
  const angA = Math.atan2(a.y, a.x);
  const toU = (((Math.atan2(uy, ux) - angA) % tau) + tau) % tau;
  const toB = (((Math.atan2(b.y, b.x) - angA) % tau) + tau) % tau;
  const sweep = toU < toB ? 1 : 0;
  const large = span > Math.PI ? 1 : 0;
  const map = (q: Point): Point => ({ x: cx + q.x * rx, y: cy + q.y * ry });
  return `M${pt(map(a))}A${f(rx)} ${f(ry)} 0 ${large} ${sweep} ${pt(map(b))}Z`;
}

/**
 * The part of an ellipse inside every one of `cuts` (a convex region), as a path: a lid and a squint at once,
 * or a lid that peaks in the middle of a single eye. One cut gives exactly cutEllipse's path; none, the whole
 * ellipse. Returns '' if nothing is kept.
 *
 * Works in the unit circle: the polygon the half-planes leave of a big square is walked in the direction of
 * increasing angle; its edges inside the circle become lines, and the gaps between them arcs of the ellipse.
 */
export function clipEllipse(e: Ellipse, cuts: readonly HalfPlane[]): string {
  const [first] = cuts;
  if (!first) return ellipsePath(e);
  if (cuts.length === 1) return cutEllipse(e, first);
  const { cx, cy, rx, ry } = e;
  // Each cut as u · q ≥ c in unit-circle space.
  const planes = cuts.map((cut) => {
    const nx = cut.n.x * rx;
    const ny = cut.n.y * ry;
    const len = Math.hypot(nx, ny) || 1;
    const u = { x: nx / len, y: ny / len };
    return { u, c: u.x * ((cut.at.x - cx) / rx) + u.y * ((cut.at.y - cy) / ry) };
  });
  let poly: Point[] = [
    { x: -4, y: -4 },
    { x: 4, y: -4 },
    { x: 4, y: 4 },
    { x: -4, y: 4 },
  ];
  for (const { u, c } of planes) {
    const next: Point[] = [];
    const val = (p: Point) => u.x * p.x + u.y * p.y - c;
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length] ?? a;
      const va = val(a);
      const vb = val(b);
      if (va >= 0) next.push(a);
      if (va >= 0 !== vb >= 0) {
        const t = va / (va - vb);
        next.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    });
    poly = next;
    if (poly.length < 3) return '';
  }
  // Walk in the direction of increasing angle (positive signed area with y down), as SVG's sweep flag 1 draws.
  let area = 0;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length] ?? a;
    area += a.x * b.y - b.x * a.y;
  });
  if (area < 0) poly.reverse();
  // The part of each edge inside the circle.
  const runs: { from: Point; to: Point }[] = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length] ?? a;
    const d = { x: b.x - a.x, y: b.y - a.y };
    const A = d.x * d.x + d.y * d.y;
    const B = 2 * (a.x * d.x + a.y * d.y);
    const C = a.x * a.x + a.y * a.y - 1;
    const disc = B * B - 4 * A * C;
    if (A === 0 || disc <= 0) return;
    const s = Math.sqrt(disc);
    const t0 = Math.max(0, (-B - s) / (2 * A));
    const t1 = Math.min(1, (-B + s) / (2 * A));
    if (t1 - t0 < 1e-9) return;
    runs.push({
      from: { x: a.x + d.x * t0, y: a.y + d.y * t0 },
      to: { x: a.x + d.x * t1, y: a.y + d.y * t1 },
    });
  });
  if (!runs.length) {
    // No edge reaches the circle: the circle is wholly inside the polygon, or wholly outside it.
    return planes.every(({ c }) => c <= -1) ? ellipsePath(e) : '';
  }
  const map = (q: Point): Point => ({ x: cx + q.x * rx, y: cy + q.y * ry });
  const tau = 2 * Math.PI;
  const start = runs[0]?.from ?? { x: 0, y: 0 };
  let d = `M${pt(map(start))}`;
  runs.forEach((run, i) => {
    if (Math.hypot(run.to.x - run.from.x, run.to.y - run.from.y) > 1e-9) d += `L${pt(map(run.to))}`;
    const next = runs[(i + 1) % runs.length]?.from ?? start;
    if (Math.hypot(next.x - run.to.x, next.y - run.to.y) < 1e-9) return;
    const sweep = (((Math.atan2(next.y, next.x) - Math.atan2(run.to.y, run.to.x)) % tau) + tau) % tau;
    d += `A${f(rx)} ${f(ry)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${pt(map(next))}`;
  });
  return `${d}Z`;
}

/** The half-plane below (keep = 'below') or above the line through p and q. */
export function sideOf(p: Point, q: Point, keep: 'below' | 'above'): HalfPlane {
  // Normal of the line p→q, pointing down (+y) for 'below'.
  let n = { x: -(q.y - p.y), y: q.x - p.x };
  if ((keep === 'below') !== n.y > 0) n = { x: -n.x, y: -n.y };
  return { at: p, n };
}
