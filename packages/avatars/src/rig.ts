/**
 * The face rig: draws eyes, brows, mouth, cheeks and small extras (a tear, a sweat drop, dizzy stars) for every
 * expression, scaled from an avatar's anchors (types.ts FaceDef). The same rig serves a round human face, a
 * fox and the digit 8, so an expression is described once, in eye radii and mouth widths, never per avatar.
 *
 * Eyes are cut with straight "lids" (svg.ts cutEllipse) instead of skin-coloured patches, so a lid never shows
 * on a background of another colour (fur markings, glasses, an object's stripes).
 */

import { FACE } from './palette';
import { clamp, cutEllipse, type Ellipse, ellipsePath, f, type HalfPlane, pt, sideOf } from './svg';
import type { EyeStyle, Expression, FaceDef, Point } from './types';

/** Under this on-screen size (px) the face is simplified: no brows, cheeks, extras or eye shines. */
export const SMALL_SIZE = 40;
/** The thinnest line the rig draws, in screen pixels. */
const MIN_STROKE_PX = 0.85;

export interface RigOptions {
  /** On-screen size of the whole tile in px. Default 100. */
  size?: number;
}

interface Lod {
  small: boolean;
  /** Minimum stroke width in viewBox units. */
  minStroke: number;
}

function lod(opts: RigOptions | undefined): Lod {
  const size = opts?.size ?? 100;
  return { small: size < SMALL_SIZE, minStroke: (MIN_STROKE_PX * 100) / size };
}

// ---------------------------------------------------------------------------------------------------------
// The expression table

type EyeShape =
  | {
      kind: 'open';
      /** Eye size factor. */
      scale?: number;
      /** Gaze, -1..1 on each axis. */
      look?: Point;
      /** Pupil size factor (round and oval eyes). */
      pupil?: number;
      /** Upper lid: its height at the outer and inner edge, in eye radii from the centre (− = up). */
      lid?: { outer: number; inner: number };
      /** Lower lid (a happy squint): the eye is cut below this height, in eye radii (+ = down). */
      squint?: number;
    }
  | { kind: 'closed' }
  | { kind: 'spiral' };

interface BrowShape {
  /** Extra lift, in eye radii. */
  raise: number;
  /** Degrees; + = the inner end up (sad, worried), − = the inner end down (cross, doubtful). */
  tilt: number;
  /** Curve height, in eye radii. */
  arch: number;
}

type MouthShape = 'rest' | 'smile' | 'open' | 'smirk' | 'o' | 'frown' | 'askew' | 'wave';
type Extra = 'tear' | 'sweat' | 'stars';

interface ExpressionSpec {
  eyes: readonly [EyeShape, EyeShape];
  brows: readonly [BrowShape, BrowShape];
  mouth: MouthShape;
  /** Blush opacity, 0 = none. */
  cheeks: number;
  extra?: Extra;
}

const brow = (raise: number, tilt: number, arch: number): BrowShape => ({ raise, tilt, arch });
const both = <T>(x: T): readonly [T, T] => [x, x];

const SPECS: Record<Expression, ExpressionSpec> = {
  neutral: {
    eyes: both({ kind: 'open' }),
    brows: both(brow(0, 0, 0.2)),
    mouth: 'rest',
    cheeks: 0.35,
  },
  smile: {
    eyes: both({ kind: 'open', squint: 0.55 }),
    brows: both(brow(0.15, -3, 0.3)),
    mouth: 'smile',
    cheeks: 0.6,
  },
  laugh: {
    eyes: both({ kind: 'closed' }),
    brows: both(brow(0.4, 0, 0.4)),
    mouth: 'open',
    cheeks: 0.75,
  },
  wink: {
    eyes: [{ kind: 'open', squint: 0.6, look: { x: 0.2, y: 0 } }, { kind: 'closed' }],
    brows: [brow(0.4, 0, 0.35), brow(-0.1, -8, 0.15)],
    mouth: 'smirk',
    cheeks: 0.6,
  },
  surprised: {
    eyes: both({ kind: 'open', scale: 1.22, pupil: 0.72 }),
    brows: both(brow(0.8, 4, 0.5)),
    mouth: 'o',
    cheeks: 0,
  },
  sad: {
    eyes: both({ kind: 'open', look: { x: 0, y: 0.45 }, lid: { outer: -0.05, inner: -0.72 } }),
    brows: both(brow(0.2, 17, -0.05)),
    mouth: 'frown',
    cheeks: 0,
    extra: 'tear',
  },
  confused: {
    eyes: [
      { kind: 'open', scale: 1.1, look: { x: 0.45, y: -0.5 } },
      { kind: 'open', scale: 0.95, look: { x: 0.45, y: -0.3 }, lid: { outer: -0.3, inner: -0.3 } },
    ],
    brows: [brow(0.75, -2, 0.45), brow(-0.05, -11, 0.1)],
    mouth: 'askew',
    cheeks: 0,
    extra: 'sweat',
  },
  dizzy: {
    eyes: both({ kind: 'spiral' }),
    brows: [brow(0.35, 14, 0.15), brow(0.35, -6, 0.15)],
    mouth: 'wave',
    cheeks: 0.3,
    extra: 'stars',
  },
};

// ---------------------------------------------------------------------------------------------------------
// Eyes

interface Side {
  c: Point;
  /** −1 for the viewer's left eye (its outer edge is on the left), +1 for the right eye. */
  out: -1 | 1;
}

function sides(face: FaceDef): readonly [Side, Side] {
  return [
    { c: face.eyes.left, out: -1 },
    { c: face.eyes.right, out: 1 },
  ];
}

/** Ellipse proportions of each eye style: [ball rx, ball ry, pupil rx, pupil ry], in eye radii. */
const STYLE_SHAPE: Record<EyeStyle, readonly [number, number, number, number]> = {
  dot: [0.78, 1, 0, 0],
  round: [1, 1, 0.56, 0.56],
  oval: [0.8, 1, 0.5, 0.62],
  button: [0.92, 0.92, 0, 0],
};

function strokeW(base: number, l: Lod): number {
  return Math.max(base, l.minStroke);
}

function inside(cut: HalfPlane | undefined, p: Point): boolean {
  return !cut || cut.n.x * (p.x - cut.at.x) + cut.n.y * (p.y - cut.at.y) >= 0;
}

function shape(e: Ellipse, cut: HalfPlane | undefined, fill: string): string {
  const d = cut ? cutEllipse(e, cut) : ellipsePath(e);
  return d ? `<path d="${d}" fill="${fill}"/>` : '';
}

function circle(c: Point, r: number, fill: string, extra = ''): string {
  return `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(r)}" fill="${fill}"${extra}/>`;
}

function lidCut(side: Side, r: number, s: Extract<EyeShape, { kind: 'open' }>): HalfPlane | undefined {
  const { c, out } = side;
  if (s.lid) {
    const outer = { x: c.x + out * r, y: c.y + s.lid.outer * r };
    const inner = { x: c.x - out * r, y: c.y + s.lid.inner * r };
    return sideOf(outer, inner, 'below');
  }
  if (s.squint !== undefined) {
    const y = c.y + s.squint * r;
    return sideOf({ x: c.x - r, y }, { x: c.x + r, y }, 'above');
  }
  return undefined;
}

function openEye(face: FaceDef, side: Side, s: Extract<EyeShape, { kind: 'open' }>, l: Lod): string {
  const { r, style } = face.eyes;
  const ink = face.eyes.ink ?? face.ink;
  const white = face.eyes.white ?? FACE.white;
  const k = (s.scale ?? 1) * r;
  const look = s.look ?? { x: 0, y: 0 };
  const cut = lidCut(side, k, s);
  const [bx, by, px, py] = STYLE_SHAPE[style];
  const shine = (c: Point, rr: number) => (inside(cut, c) ? circle(c, rr, FACE.white) : '');

  if (style === 'dot' || style === 'button') {
    const c = { x: side.c.x + look.x * 0.15 * r, y: side.c.y + look.y * 0.15 * r };
    let out = shape({ cx: c.x, cy: c.y, rx: bx * k, ry: by * k }, cut, ink);
    if (!l.small || style === 'button') {
      const big = style === 'button' ? 0.34 : 0.3;
      out += shine({ x: c.x + 0.3 * bx * k, y: c.y - 0.36 * by * k }, big * k);
      if (style === 'button' && !l.small) out += shine({ x: c.x - 0.32 * k, y: c.y + 0.36 * k }, 0.14 * k);
    }
    return out;
  }

  // round / oval: an eyeball and a pupil that follows the gaze.
  const ball = { cx: side.c.x, cy: side.c.y, rx: bx * k, ry: by * k };
  const pk = (s.pupil ?? 1) * r;
  const free = { x: bx * k - px * pk, y: by * k - py * pk }; // how far the pupil can travel
  const pc = { x: side.c.x + look.x * free.x * 0.7, y: side.c.y + look.y * free.y * 0.7 };
  let out = shape(ball, cut, white);
  out += shape({ cx: pc.x, cy: pc.y, rx: px * pk, ry: py * pk }, cut, ink);
  if (!l.small) out += shine({ x: pc.x + 0.32 * px * pk, y: pc.y - 0.38 * py * pk }, 0.34 * px * pk);
  return out;
}

function closedEye(face: FaceDef, side: Side, l: Lod): string {
  const { r } = face.eyes;
  const { c } = side;
  const w = 0.95 * r;
  const sw = strokeW(clamp(0.46 * r, 1.5, 3.2), l);
  const d = `M${f(c.x - w)} ${f(c.y + 0.32 * r)}Q${f(c.x)} ${f(c.y - 0.95 * r)} ${f(c.x + w)} ${f(c.y + 0.32 * r)}`;
  return `<path d="${d}" fill="none" stroke="${face.eyes.ink ?? face.ink}" stroke-width="${f(sw)}" stroke-linecap="round"/>`;
}

/** A smooth path through points (quadratic curves through the midpoints). */
function smooth(points: readonly Point[]): string {
  const [first, ...rest] = points;
  if (!first) return '';
  let d = `M${pt(first)}`;
  for (let i = 0; i < rest.length - 1; i++) {
    const p = rest[i];
    const q = rest[i + 1];
    if (p && q) d += `Q${pt(p)} ${f((p.x + q.x) / 2)} ${f((p.y + q.y) / 2)}`;
  }
  const last = rest[rest.length - 1];
  if (last) d += `L${pt(last)}`;
  return d;
}

function spiralEye(face: FaceDef, side: Side, l: Lod): string {
  const { r, style } = face.eyes;
  const ink = face.eyes.ink ?? face.ink;
  const withBall = style === 'round' || style === 'oval';
  const [bx, by] = STYLE_SHAPE[style];
  const R = (withBall ? 0.74 : 1.05) * r * (l.small ? 1.1 : 1);
  const sw = l.small ? Math.max(0.28 * r, 0.75 * l.minStroke) : strokeW(clamp(0.28 * r, 1.1, 2), l);
  // As many turns as the line width leaves room for: tight turns at a thick line fill in to a blot.
  const turns = clamp(R / (1.5 * sw), 1.1, 2.2);
  const steps = Math.round(16 * turns);
  const max = turns * 2 * Math.PI;
  const dir = side.out; // mirror the two spirals
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * max;
    const rad = (R * a) / max;
    points.push({ x: side.c.x + dir * Math.cos(a) * rad, y: side.c.y + Math.sin(a) * rad });
  }
  const ball = withBall
    ? shape({ cx: side.c.x, cy: side.c.y, rx: bx * r, ry: by * r }, undefined, face.eyes.white ?? FACE.white)
    : '';
  return `${ball}<path d="${smooth(points)}" fill="none" stroke="${ink}" stroke-width="${f(sw)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

export function drawEyes(face: FaceDef, expression: Expression, opts?: RigOptions): string {
  const l = lod(opts);
  const spec = SPECS[expression];
  return sides(face)
    .map((side, i) => {
      const s = spec.eyes[i] ?? { kind: 'open' };
      if (s.kind === 'closed') return closedEye(face, side, l);
      if (s.kind === 'spiral') return spiralEye(face, side, l);
      return openEye(face, side, s, l);
    })
    .join('');
}

// ---------------------------------------------------------------------------------------------------------
// Brows

export function drawBrows(face: FaceDef, expression: Expression, opts?: RigOptions): string {
  const l = lod(opts);
  if (!face.brows || l.small) return '';
  const { r } = face.eyes;
  const lift = face.brows.lift ?? 1.8;
  const half = ((face.brows.length ?? 2.2) * r) / 2;
  const sw = strokeW(face.brows.thickness ?? clamp(0.5 * r, 1.6, 2.6), l);
  const color = face.brows.color ?? face.ink;
  const spec = SPECS[expression];
  return sides(face)
    .map((side, i) => {
      const b = spec.brows[i] ?? brow(0, 0, 0);
      const cy = side.c.y - (lift + b.raise) * r;
      const dy = Math.tan((b.tilt * Math.PI) / 180) * half;
      const outer = { x: side.c.x + side.out * half, y: cy + dy };
      const inner = { x: side.c.x - side.out * half, y: cy - dy };
      const ctrl = { x: side.c.x, y: cy - 2 * b.arch * r };
      return `<path d="M${pt(outer)}Q${pt(ctrl)} ${pt(inner)}" fill="none" stroke="${color}" stroke-width="${f(sw)}" stroke-linecap="round"/>`;
    })
    .join('');
}

// ---------------------------------------------------------------------------------------------------------
// Mouth

export function drawMouth(face: FaceDef, expression: Expression, opts?: RigOptions): string {
  const l = lod(opts);
  const m = face.mouth;
  const { x, y, w } = m;
  const ink = m.ink ?? face.ink;
  const inner = m.inner ?? FACE.mouth;
  const sw = strokeW(clamp(0.11 * w, 1.4, 2.8), l);
  const line = (d: string) =>
    `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${f(sw)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const P = (dx: number, dy: number) => `${f(x + dx * w)} ${f(y + dy * w)}`;

  switch (SPECS[expression].mouth) {
    case 'rest':
      return line(`M${P(-0.26, -0.02)}Q${P(0, 0.13)} ${P(0.26, -0.02)}`);
    case 'smile':
      return line(`M${P(-0.42, -0.07)}Q${P(0, 0.4)} ${P(0.42, -0.07)}`);
    case 'smirk':
      return line(`M${P(-0.34, 0.02)}Q${P(0.04, 0.3)} ${P(0.4, -0.12)}`);
    case 'frown':
      return line(`M${P(-0.28, 0.13)}Q${P(0, -0.13)} ${P(0.28, 0.13)}`);
    case 'askew':
      return line(`M${P(-0.25, 0.08)}Q${P(0.02, 0.1)} ${P(0.25, -0.06)}`);
    case 'wave': {
      const a = 0.08;
      return line(`M${P(-0.36, 0)}Q${P(-0.27, -a)} ${P(-0.18, 0)}T${P(0, 0)}T${P(0.18, 0)}T${P(0.36, 0)}`);
    }
    case 'o': {
      const e = { cx: x, cy: y + 0.07 * w, rx: 0.16 * w, ry: 0.21 * w };
      return `<path d="${ellipsePath(e)}" fill="${inner}"/>`;
    }
    case 'open': {
      const top = y - 0.08 * w;
      const e = { cx: x, cy: top, rx: 0.44 * w, ry: 0.5 * w };
      const mouth = cutEllipse(e, sideOf({ x: x - 1, y: top }, { x: x + 1, y: top }, 'below'));
      const tongueTop = top + 0.6 * e.ry;
      const tongue = cutEllipse(
        { ...e, rx: e.rx * 0.98, ry: e.ry * 0.98 },
        sideOf({ x: x - 1, y: tongueTop }, { x: x + 1, y: tongueTop }, 'below'),
      );
      return (
        `<path d="${mouth}" fill="${inner}"/>` +
        (l.small ? '' : `<path d="${tongue}" fill="${m.tongue ?? FACE.tongue}"/>`)
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// Cheeks and extras

export function drawCheeks(face: FaceDef, expression: Expression, opts?: RigOptions): string {
  const l = lod(opts);
  const opacity = SPECS[expression].cheeks;
  const ch = face.cheeks;
  if (!ch || l.small || opacity <= 0) return '';
  const { r } = face.eyes;
  const size = (ch.size ?? 0.95) * r;
  return sides(face)
    .map((side) => {
      const c = { x: side.c.x + side.out * (ch.dx ?? 0.9) * r, y: side.c.y + (ch.dy ?? 1.5) * r };
      return `<ellipse cx="${f(c.x)}" cy="${f(c.y)}" rx="${f(size)}" ry="${f(size * 0.62)}" fill="${ch.color}" opacity="${f(opacity)}"/>`;
    })
    .join('');
}

function drop(c: Point, s: number, fill: string): string {
  const { x, y } = c;
  const d =
    `M${f(x)} ${f(y - 1.6 * s)}` +
    `C${f(x + 0.35 * s)} ${f(y - s)} ${f(x + s)} ${f(y - 0.45 * s)} ${f(x + s)} ${f(y + 0.1 * s)}` +
    `A${f(s)} ${f(s)} 0 0 1 ${f(x - s)} ${f(y + 0.1 * s)}` +
    `C${f(x - s)} ${f(y - 0.45 * s)} ${f(x - 0.35 * s)} ${f(y - s)} ${f(x)} ${f(y - 1.6 * s)}Z`;
  return `<path d="${d}" fill="${fill}"/>`;
}

function sparkle(c: Point, s: number, fill: string): string {
  const { x, y } = c;
  const k = 0.18 * s; // waist of the four-point star
  const d =
    `M${f(x)} ${f(y - s)}Q${f(x + k)} ${f(y - k)} ${f(x + s)} ${f(y)}` +
    `Q${f(x + k)} ${f(y + k)} ${f(x)} ${f(y + s)}` +
    `Q${f(x - k)} ${f(y + k)} ${f(x - s)} ${f(y)}` +
    `Q${f(x - k)} ${f(y - k)} ${f(x)} ${f(y - s)}Z`;
  return `<path d="${d}" fill="${fill}"/>`;
}

/** Where dizzy stars circle when the avatar does not say. */
export function haloOf(face: FaceDef): Point {
  if (face.halo) return face.halo;
  const { left, right, r } = face.eyes;
  return { x: (left.x + right.x) / 2, y: Math.max(7, Math.min(left.y, right.y) - 4.2 * r) };
}

export function drawExtras(face: FaceDef, expression: Expression, opts?: RigOptions): string {
  const l = lod(opts);
  const extra = SPECS[expression].extra;
  if (!extra || l.small) return '';
  const { left, right, r } = face.eyes;
  switch (extra) {
    case 'tear': {
      const s = Math.max(0.5 * r, 1.7);
      return drop({ x: left.x - 0.45 * r, y: left.y + 1.45 * r + 1.6 * s }, s, FACE.tear);
    }
    case 'sweat': {
      const s = Math.max(0.48 * r, 1.6);
      return drop({ x: right.x + 2.7 * r, y: right.y - 2.1 * r }, s, FACE.tear);
    }
    case 'stars': {
      const h = haloOf(face);
      const gap = Math.max(right.x - left.x, 10) * 0.75;
      const s = clamp(gap * 0.26, 2.4, 4.6);
      return (
        sparkle({ x: h.x - gap, y: h.y + 1.5 }, s * 0.8, FACE.sparkle) +
        sparkle({ x: h.x, y: h.y - 1.5 }, s, FACE.sparkle) +
        sparkle({ x: h.x + gap, y: h.y + 1.5 }, s * 0.8, FACE.sparkle)
      );
    }
  }
}
