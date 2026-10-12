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

/** The half-plane below (keep = 'below') or above the line through p and q. */
export function sideOf(p: Point, q: Point, keep: 'below' | 'above'): HalfPlane {
  // Normal of the line p→q, pointing down (+y) for 'below'.
  let n = { x: -(q.y - p.y), y: q.x - p.x };
  if ((keep === 'below') !== n.y > 0) n = { x: -n.x, y: -n.y };
  return { at: p, n };
}
