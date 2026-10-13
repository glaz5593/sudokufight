/**
 * The face rig: draws eyes, brows, mouth, cheeks and small extras (a tear, a sweat drop, dizzy stars, an anger
 * mark, sleepy z's) for every expression, scaled from an avatar's anchors (types.ts FaceDef). The same rig
 * serves a round human face, a fox, the digit 8 and a cyclops, so an expression is described once, in eye
 * radii and mouth widths, never per avatar.
 *
 * Eyes are cut with straight "lids" (svg.ts cutEllipse) instead of skin-coloured patches, so a lid never shows
 * on a background of another colour (fur markings, glasses, an object's stripes).
 *
 * One, two or three eyes (types.ts EyesDef). Each eye is a slot with a side: the viewer's left eye (−1), the
 * right eye (+1), or a centred eye (0: the one eye of a cyclops, the middle eye of an alien). An expression
 * gives shapes for the left and right eye; a centred eye reads a lid from both sides (its "inner" end is the
 * middle), so sad peaks and angry dips in a V. A lone eye (one eye, or a pair with one covered) and three eyes
 * may override the shapes (`solo`, `trio`): a lone wink is a sly half-closed squint, an alien winks with the
 * outer two.
 */

import { FACE } from './palette';
import { clamp, clipEllipse, type Ellipse, ellipsePath, f, type HalfPlane, pt, sideOf } from './svg';
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
      /**
       * Upper lid: its height at the outer and inner edge, in eye radii from the centre (− = up). On a centred
       * eye "inner" is the middle: inner below outer makes a V (angry), above it a peak (sad).
       */
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

type MouthShape = 'rest' | 'smile' | 'open' | 'smirk' | 'o' | 'frown' | 'askew' | 'wave' | 'grit' | 'small';
type Extra = 'tear' | 'sweat' | 'stars' | 'anger' | 'zzz';

interface ExpressionSpec {
  /** The viewer's left and right eye. */
  eyes: readonly [EyeShape, EyeShape];
  /** A lone eye (one eye, or a pair with one covered). Default: the left eye's shape. */
  solo?: EyeShape;
  /** Three eyes: left, middle, right. Default: the left shape in the middle. */
  trio?: readonly [EyeShape, EyeShape, EyeShape];
  brows: readonly [BrowShape, BrowShape];
  mouth: MouthShape;
  /** Blush opacity, 0 = none. */
  cheeks: number;
  extra?: Extra;
}

const brow = (raise: number, tilt: number, arch: number): BrowShape => ({ raise, tilt, arch });
const both = <T>(x: T): readonly [T, T] => [x, x];

const WINK_OPEN: EyeShape = { kind: 'open', squint: 0.6, look: { x: 0.2, y: 0 } };

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
    eyes: [WINK_OPEN, { kind: 'closed' }],
    // a lone eye cannot close and still look: a sly, half-closed squint
    solo: { kind: 'open', look: { x: 0.35, y: 0.1 }, lid: { outer: 0.12, inner: -0.32 }, squint: 0.62 },
    // three eyes: the outer two close, the middle one keeps looking
    trio: [{ kind: 'closed' }, WINK_OPEN, { kind: 'closed' }],
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
  angry: {
    // a glare: the lid slopes down toward the nose, the brows come down and in
    eyes: both({ kind: 'open', lid: { outer: -0.62, inner: -0.08 } }),
    brows: both(brow(-0.3, -21, -0.05)),
    mouth: 'grit',
    cheeks: 0,
    extra: 'anger',
  },
  sleepy: {
    // heavy lids just under the middle, the gaze sinking
    eyes: both({ kind: 'open', look: { x: 0, y: 0.4 }, lid: { outer: 0.14, inner: 0.04 } }),
    brows: both(brow(-0.1, 6, 0.1)),
    mouth: 'small',
    cheeks: 0.3,
    extra: 'zzz',
  },
};

// ---------------------------------------------------------------------------------------------------------
// Eye slots

/** One eye's place: where it is, its size, and how the rig treats it. */
export interface EyeSlot {
  c: Point;
  r: number;
  /** −1 the viewer's left eye (its outer edge on the left), +1 the right eye, 0 a centred eye. */
  out: -1 | 0 | 1;
  /** False for an eye the art covers (a patch): brows, cheeks and extras still use its place. */
  drawn: boolean;
  /** The middle eye of three: no brow. */
  middle: boolean;
}

/** Every eye place, covered ones included, from the viewer's left (or the one centred eye). */
export function eyeSlots(face: FaceDef): EyeSlot[] {
  const e = face.eyes;
  const side = (c: Point, out: -1 | 1, drawn = true): EyeSlot => ({ c, r: e.r, out, drawn, middle: false });
  if (e.count === 1) return [{ c: e.middle, r: e.r, out: 0, drawn: true, middle: false }];
  if (e.count === 3)
    return [
      side(e.left, -1),
      { c: e.middle, r: e.r * (e.middleScale ?? 1), out: 0, drawn: true, middle: true },
      side(e.right, 1),
    ];
  return [side(e.left, -1, e.covered !== 'left'), side(e.right, 1, e.covered !== 'right')];
}

/** The shape of each slot's eye for an expression, in eyeSlots() order. */
function shapes(face: FaceDef, spec: ExpressionSpec): EyeShape[] {
  const e = face.eyes;
  const [left, right] = spec.eyes;
  const solo = spec.solo ?? left;
  if (e.count === 1) return [solo];
  if (e.count === 3) return [...(spec.trio ?? [left, left, right])];
  if (e.covered) return [solo, solo];
  return [left, right];
}

/** The centres of the eyes the rig draws (a covered eye is left out): each blinks around its own. */
export function eyeCentres(face: FaceDef): Point[] {
  return eyeSlots(face)
    .filter((s) => s.drawn)
    .map((s) => s.c);
}

/** The left- and right-most eye places (covered or not), and the largest radius: for extras and the halo. */
function span(face: FaceDef): { left: EyeSlot; right: EyeSlot; r: number } {
  const all = eyeSlots(face);
  const first = all[0] ?? { c: { x: 50, y: 50 }, r: face.eyes.r, out: 0, drawn: true, middle: false };
  let left = first;
  let right = first;
  for (const s of all) {
    if (s.c.x < left.c.x) left = s;
    if (s.c.x > right.c.x) right = s;
  }
  return { left, right, r: face.eyes.r };
}

// ---------------------------------------------------------------------------------------------------------
// Eyes

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

/** What lids leave of an eye: a union of convex pieces, each the intersection of its half-planes. */
type Region = readonly (readonly HalfPlane[])[];

function inside(region: Region | undefined, p: Point): boolean {
  return (
    !region ||
    region.some((piece) => piece.every((h) => h.n.x * (p.x - h.at.x) + h.n.y * (p.y - h.at.y) >= 0))
  );
}

function shape(e: Ellipse, region: Region | undefined, fill: string): string {
  if (!region) return `<path d="${ellipsePath(e)}" fill="${fill}"/>`;
  return region
    .map((piece) => {
      const d = clipEllipse(e, piece);
      return d ? `<path d="${d}" fill="${fill}"/>` : '';
    })
    .join('');
}

function circle(c: Point, r: number, fill: string, extra = ''): string {
  return `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(r)}" fill="${fill}"${extra}/>`;
}

function lidRegion(slot: EyeSlot, k: number, s: Extract<EyeShape, { kind: 'open' }>): Region | undefined {
  const { c, out } = slot;
  const low: HalfPlane[] = [];
  if (s.squint !== undefined) {
    const y = c.y + s.squint * k;
    low.push(sideOf({ x: c.x - k, y }, { x: c.x + k, y }, 'above'));
  }
  if (s.lid) {
    if (out !== 0) {
      const outer = { x: c.x + out * k, y: c.y + s.lid.outer * k };
      const inner = { x: c.x - out * k, y: c.y + s.lid.inner * k };
      return [[sideOf(outer, inner, 'below'), ...low]];
    }
    // A centred eye: the lid comes in from both sides and meets in the middle.
    const mid = { x: c.x, y: c.y + s.lid.inner * k };
    const left = sideOf({ x: c.x - k, y: c.y + s.lid.outer * k }, mid, 'below');
    const right = sideOf(mid, { x: c.x + k, y: c.y + s.lid.outer * k }, 'below');
    // Peaked (the middle higher): under both lines. A V (the middle lower): under either line.
    return s.lid.inner <= s.lid.outer
      ? [[left, right, ...low]]
      : [
          [left, ...low],
          [right, ...low],
        ];
  }
  return low.length ? [low] : undefined;
}

function openEye(face: FaceDef, slot: EyeSlot, s: Extract<EyeShape, { kind: 'open' }>, l: Lod): string {
  const { style } = face.eyes;
  const r = slot.r;
  const ink = face.eyes.ink ?? face.ink;
  const white = face.eyes.white ?? FACE.white;
  const k = (s.scale ?? 1) * r;
  const look = s.look ?? { x: 0, y: 0 };
  const cut = lidRegion(slot, k, s);
  const [bx, by, px, py] = STYLE_SHAPE[style];
  const shine = (c: Point, rr: number) => (inside(cut, c) ? circle(c, rr, FACE.white) : '');

  if (style === 'dot' || style === 'button') {
    const c = { x: slot.c.x + look.x * 0.15 * r, y: slot.c.y + look.y * 0.15 * r };
    let out = shape({ cx: c.x, cy: c.y, rx: bx * k, ry: by * k }, cut, ink);
    if (!l.small || style === 'button') {
      const big = style === 'button' ? 0.34 : 0.3;
      out += shine({ x: c.x + 0.3 * bx * k, y: c.y - 0.36 * by * k }, big * k);
      if (style === 'button' && !l.small) out += shine({ x: c.x - 0.32 * k, y: c.y + 0.36 * k }, 0.14 * k);
    }
    return out;
  }

  // round / oval: an eyeball and a pupil that follows the gaze.
  const ball = { cx: slot.c.x, cy: slot.c.y, rx: bx * k, ry: by * k };
  const pk = (s.pupil ?? 1) * r;
  const free = { x: bx * k - px * pk, y: by * k - py * pk }; // how far the pupil can travel
  const pc = { x: slot.c.x + look.x * free.x * 0.7, y: slot.c.y + look.y * free.y * 0.7 };
  let out = shape(ball, cut, white);
  out += shape({ cx: pc.x, cy: pc.y, rx: px * pk, ry: py * pk }, cut, ink);
  if (!l.small) out += shine({ x: pc.x + 0.32 * px * pk, y: pc.y - 0.38 * py * pk }, 0.34 * px * pk);
  return out;
}

function closedEye(face: FaceDef, slot: EyeSlot, l: Lod): string {
  const { c, r } = slot;
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

function spiralEye(face: FaceDef, slot: EyeSlot, l: Lod): string {
  const { style } = face.eyes;
  const r = slot.r;
  const ink = face.eyes.ink ?? face.ink;
  const withBall = style === 'round' || style === 'oval';
  const [bx, by] = STYLE_SHAPE[style];
  const R = (withBall ? 0.74 : 1.05) * r * (l.small ? 1.1 : 1);
  const sw = l.small ? Math.max(0.28 * r, 0.75 * l.minStroke) : strokeW(clamp(0.28 * r, 1.1, 2), l);
  // As many turns as the line width leaves room for: tight turns at a thick line fill in to a blot.
  const turns = clamp(R / (1.5 * sw), 1.1, 2.2);
  const steps = Math.round(16 * turns);
  const max = turns * 2 * Math.PI;
  const dir = slot.out === 0 ? 1 : slot.out; // mirror the two spirals
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * max;
    const rad = (R * a) / max;
    points.push({ x: slot.c.x + dir * Math.cos(a) * rad, y: slot.c.y + Math.sin(a) * rad });
  }
  const ball = withBall
    ? shape({ cx: slot.c.x, cy: slot.c.y, rx: bx * r, ry: by * r }, undefined, face.eyes.white ?? FACE.white)
    : '';
  return `${ball}<path d="${smooth(points)}" fill="none" stroke="${ink}" stroke-width="${f(sw)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** One eye the rig draws: its centre (a blink scales the eye around it) and its markup. */
export interface EyePart {
  c: Point;
  markup: string;
}

/**
 * Every drawn eye (a covered one is left out), in eyeCentres() order. drawEyes wraps each in a group for CSS;
 * the app draws each as a layer of its own (native.ts).
 */
export function eyeParts(face: FaceDef, expression: Expression, opts?: RigOptions): EyePart[] {
  const l = lod(opts);
  const list = shapes(face, SPECS[expression]);
  const out: EyePart[] = [];
  eyeSlots(face).forEach((slot, i) => {
    if (!slot.drawn) return;
    const s = list[i] ?? { kind: 'open' };
    const markup =
      s.kind === 'closed'
        ? closedEye(face, slot, l)
        : s.kind === 'spiral'
          ? spiralEye(face, slot, l)
          : openEye(face, slot, s, l);
    out.push({ c: slot.c, markup });
  });
  return out;
}

/**
 * Every drawn eye, each in its own `<g class="sfa-eye">` whose `--sfa-eyes` is that eye's centre: a blink
 * (motion.ts, target `eyes`) scales each eye around it.
 */
export function drawEyes(face: FaceDef, expression: Expression, opts?: RigOptions): string {
  return eyeParts(face, expression, opts)
    .map((e) => `<g class="sfa-eye" style="--sfa-eyes:${f(e.c.x)}px ${f(e.c.y)}px">${e.markup}</g>`)
    .join('');
}

// ---------------------------------------------------------------------------------------------------------
// Brows

export function drawBrows(face: FaceDef, expression: Expression, opts?: RigOptions): string {
  const l = lod(opts);
  const brows = face.brows;
  if (!brows || l.small) return '';
  const { r } = face.eyes;
  const lift = brows.lift ?? 1.8;
  const length = brows.length ?? 2.2;
  const half = (length * r) / 2;
  const sw = strokeW(brows.thickness ?? clamp(0.5 * r, 1.6, 2.6), l);
  const color = brows.color ?? face.ink;
  const spec = SPECS[expression];
  const line = (d: string) =>
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f(sw)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return eyeSlots(face)
    .map((slot) => {
      if (slot.middle) return '';
      if (slot.out !== 0) {
        const b = spec.brows[slot.out < 0 ? 0 : 1];
        const cy = slot.c.y - (lift + b.raise) * r;
        const dy = Math.tan((b.tilt * Math.PI) / 180) * half;
        const outer = { x: slot.c.x + slot.out * half, y: cy + dy };
        const inner = { x: slot.c.x - slot.out * half, y: cy - dy };
        const ctrl = { x: slot.c.x, y: cy - 2 * b.arch * r };
        return line(`M${pt(outer)}Q${pt(ctrl)} ${pt(inner)}`);
      }
      // One centred eye: a unibrow, its left half from the left brow and its right half from the right one,
      // so it dips in a V when angry and peaks when sad.
      const sr = slot.r;
      const uh = (length * sr) / 2;
      const end = (i: 0 | 1, sign: -1 | 1) => {
        const b = spec.brows[i];
        const cy = slot.c.y - (lift + b.raise) * sr;
        const dy = (Math.tan((b.tilt * Math.PI) / 180) * uh) / 2;
        return { outer: { x: slot.c.x + sign * uh, y: cy + dy }, inner: cy - dy, arch: b.arch };
      };
      const a = end(0, -1);
      const b = end(1, 1);
      const mid = { x: slot.c.x, y: (a.inner + b.inner) / 2 - ((a.arch + b.arch) / 2) * sr };
      if (mid.y > Math.max(a.outer.y, b.outer.y) + 0.25 * sr)
        return line(`M${pt(a.outer)}L${pt(mid)}L${pt(b.outer)}`); // a sharp V
      const ctrl = { x: 2 * mid.x - (a.outer.x + b.outer.x) / 2, y: 2 * mid.y - (a.outer.y + b.outer.y) / 2 };
      return line(`M${pt(a.outer)}Q${pt(ctrl)} ${pt(b.outer)}`);
    })
    .join('');
}

// ---------------------------------------------------------------------------------------------------------
// Mouth

export function drawMouth(face: FaceDef, expression: Expression, opts?: RigOptions): string {
  const m = face.mouth;
  if (!m) return '';
  const l = lod(opts);
  const { x, y, w } = m;
  const ink = m.ink ?? face.ink;
  const inner = m.inner ?? FACE.mouth;
  const sw = strokeW(clamp(0.11 * w, 1.4, 2.8), l);
  const line = (d: string, width = sw) =>
    `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${f(width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
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
    case 'small': {
      // a small, slack mouth: just open
      const rr = Math.max(0.1 * w, 0.6 * l.minStroke);
      const e = { cx: x, cy: y + 0.06 * w, rx: rr, ry: rr * 1.08 };
      return `<path d="${ellipsePath(e)}" fill="${inner}"/>`;
    }
    case 'grit': {
      // Gritted teeth, the corners pulled down. Small sizes: a tight, flat grimace.
      if (l.small) return line(`M${P(-0.26, 0.09)}Q${P(0, -0.07)} ${P(0.26, 0.09)}`);
      const top = (s: number) => `M${P(-0.3, 0.06 + s)}Q${P(0, -0.1 + s)} ${P(0.3, 0.06 + s)}`;
      const h = 0.2; // the bar's height, in mouth widths
      const bar = `${top(0)}L${P(0.3, 0.06 + h)}Q${P(0, -0.1 + h)} ${P(-0.3, 0.06 + h)}Z`;
      const gap = Math.max(0.42 * sw, l.minStroke);
      const teeth = [-0.15, 0, 0.15]
        .map((t) => {
          const yt = -0.02 + 0.08 * (t / 0.3) ** 2; // the top edge's height here: the gaps follow the arch
          return line(`M${P(t, yt + 0.035)}L${P(t, yt + h - 0.035)}`, gap);
        })
        .join('');
      return (
        `<path d="${bar}" fill="${FACE.teeth}" stroke="${ink}" stroke-width="${f(sw * 0.8)}" stroke-linejoin="round"/>` +
        line(top(h / 2), gap) +
        teeth
      );
    }
    case 'open': {
      const top = y - 0.08 * w;
      const e = { cx: x, cy: top, rx: 0.44 * w, ry: 0.5 * w };
      const mouth = clipEllipse(e, [sideOf({ x: x - 1, y: top }, { x: x + 1, y: top }, 'below')]);
      const tongueTop = top + 0.6 * e.ry;
      const tongue = clipEllipse({ ...e, rx: e.rx * 0.98, ry: e.ry * 0.98 }, [
        sideOf({ x: x - 1, y: tongueTop }, { x: x + 1, y: tongueTop }, 'below'),
      ]);
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
  const dx = ch.dx ?? 0.9;
  const dy = ch.dy ?? 1.5;
  const cheek = (c: Point) =>
    `<ellipse cx="${f(c.x)}" cy="${f(c.y)}" rx="${f(size)}" ry="${f(size * 0.62)}" fill="${ch.color}" opacity="${f(opacity)}"/>`;
  const list = eyeSlots(face);
  const one = face.eyes.count === 1 ? list[0] : undefined;
  if (one) {
    // One eye: a cheek on each side of it, below.
    const c = one.c;
    return [-1, 1].map((s) => cheek({ x: c.x + s * (1 + dx * 0.6) * r, y: c.y + dy * r })).join('');
  }
  return list
    .filter((s) => s.out !== 0)
    .map((s) => cheek({ x: s.c.x + s.out * dx * r, y: s.c.y + dy * r }))
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

/**
 * A comic mark drawn as a sticker: the coloured stroke over a white one `edge` wider, so it reads on any
 * surface (dark hair, white fur, the tile).
 */
function sticker(d: string, color: string, sw: number, edge: number): string {
  const stroke = (c: string, w: number) =>
    `<path d="${d}" fill="none" stroke="${c}" stroke-width="${f(w)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return stroke(FACE.markEdge, sw + edge) + stroke(color, sw);
}

/** The comic anger mark: four bent strokes whose corners point at the middle. */
function angerMark(c: Point, s: number): string {
  const sw = clamp(0.32 * s, 1.1, 2);
  const k = 0.3 * s;
  const d = [-1, 1]
    .flatMap((qx) => [-1, 1].map((qy) => [qx, qy] as const))
    .map(
      ([qx, qy]) =>
        `M${f(c.x + qx * k)} ${f(c.y + qy * s)}Q${f(c.x + qx * k)} ${f(c.y + qy * k)} ${f(c.x + qx * s)} ${f(c.y + qy * k)}`,
    )
    .join('');
  return sticker(d, FACE.anger, sw, 1.4);
}

/** A "z" of height `s`. */
function zee(c: Point, s: number): string {
  const h = s / 2;
  const w = 0.42 * s;
  const d = `M${f(c.x - w)} ${f(c.y - h)}H${f(c.x + w)}L${f(c.x - w)} ${f(c.y + h)}H${f(c.x + w)}`;
  return sticker(d, FACE.zzz, clamp(0.24 * s, 1.1, 1.9), 1.5);
}

/** Where dizzy stars circle when the avatar does not say. */
export function haloOf(face: FaceDef): Point {
  if (face.halo) return face.halo;
  const { left, right, r } = span(face);
  const top = Math.min(...eyeSlots(face).map((s) => s.c.y));
  return { x: (left.c.x + right.c.x) / 2, y: Math.max(7, top - 4.2 * r) };
}

/** Keeps an extra on the canvas, `m` units from the edges. */
const onCanvas = (p: Point, m: number): Point => ({ x: clamp(p.x, m, 100 - m), y: clamp(p.y, m, 100 - m) });

export function drawExtras(face: FaceDef, expression: Expression, opts?: RigOptions): string {
  const l = lod(opts);
  const extra = SPECS[expression].extra;
  if (!extra || l.small) return '';
  const { left, right, r } = span(face);
  // Offsets are in eye radii, but a big single eye would push them off the tile: past 7, they stop growing.
  const rs = Math.min(r, 7);
  /** Up and out beside the right-most eye: where a sweat drop runs or an anger mark pops. */
  const temple = { x: right.c.x + right.r + 1.7 * rs, y: right.c.y - right.r - 1.1 * rs };
  switch (extra) {
    case 'tear': {
      // under the left-most eye the rig draws
      const drawn = eyeSlots(face).filter((s) => s.drawn);
      const eye = drawn.reduce((a, b) => (b.c.x < a.c.x ? b : a), drawn[0] ?? left);
      const s = Math.max(0.5 * Math.min(eye.r, 7), 1.7);
      // A centred eye has the mouth right below it: its tear runs from the lower-left edge instead.
      const c =
        eye.out === 0
          ? { x: eye.c.x - 0.82 * eye.r, y: eye.c.y + 0.9 * eye.r + 1.6 * s }
          : { x: eye.c.x - 0.45 * eye.r, y: eye.c.y + 1.45 * eye.r + 1.6 * s };
      return drop(c, s, FACE.tear);
    }
    case 'sweat': {
      const s = Math.max(0.48 * rs, 1.6);
      return drop(onCanvas(temple, 2.5 * s), s, FACE.tear);
    }
    case 'anger': {
      const s = clamp(0.62 * rs, 2.4, 4.4);
      return angerMark(onCanvas({ x: temple.x, y: temple.y - 0.2 * rs }, 1.3 * s), s);
    }
    case 'zzz': {
      const s = clamp(0.8 * rs, 3, 5.2);
      const a = onCanvas({ x: temple.x - 0.4 * rs, y: temple.y + 0.4 * rs }, 1.6 * s);
      const b = onCanvas({ x: a.x + 1.15 * s, y: a.y - 1.55 * s }, 2.2 * s);
      return zee(a, s) + zee(b, 1.4 * s);
    }
    case 'stars': {
      const h = haloOf(face);
      const gap = Math.max(right.c.x - left.c.x, 10) * 0.75;
      const s = clamp(gap * 0.26, 2.4, 4.6);
      return (
        sparkle({ x: h.x - gap, y: h.y + 1.5 }, s * 0.8, FACE.sparkle) +
        sparkle({ x: h.x, y: h.y - 1.5 }, s, FACE.sparkle) +
        sparkle({ x: h.x + gap, y: h.y + 1.5 }, s * 0.8, FACE.sparkle)
      );
    }
  }
}
