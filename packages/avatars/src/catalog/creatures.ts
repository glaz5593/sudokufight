/**
 * Made-up beings (kind `creature`): a three-eyed alien, a cyclops, a slime, a bedsheet ghost, a furry monster, a
 * baby dragon, an octopus in a top hat, a rusty robot and a shadow.
 *
 * Read docs/avatars/STYLE.md first. Shared drawing helpers: ./draw.ts; gimmick recipes: ../gimmick.ts. Add each
 * character's AvatarDef here and append it to the list below: catalog/index.ts already includes this list.
 *
 * Four of them are soft all over (the slime, the ghost, the furry monster, the shadow): their whole body is the
 * gimmick that holds the face (`z: 'face'`), so the face jiggles, floats, puffs up or looms with it.
 */

import { GIMMICK_RECIPES as R } from '../gimmick';
import { CLOTH, FACE, FUR, HAIR, mix, OBJECT, shade, TILE } from '../palette';
import { f } from '../svg';
import type { AvatarDef, Expression, GimmickDef, GimmickKeyframe } from '../types';
import { circle, ellipse, line, mirrored, P, path, rect, shaded, sx, type Pt, type Side } from './draw';

// ---------------------------------------------------------------------------------------------------------
// Helpers for this file

/** A point on a cubic Bézier, and the unit normal there (the tangent turned 90° clockwise on screen). */
function bezier(p0: Pt, c1: Pt, c2: Pt, p3: Pt, t: number): { at: Pt; n: Pt } {
  const u = 1 - t;
  const at: Pt = [
    u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1],
  ];
  const dx = 3 * u * u * (c1[0] - p0[0]) + 6 * u * t * (c2[0] - c1[0]) + 3 * t * t * (p3[0] - c2[0]);
  const dy = 3 * u * u * (c1[1] - p0[1]) + 6 * u * t * (c2[1] - c1[1]) + 3 * t * t * (p3[1] - c2[1]);
  const len = Math.hypot(dx, dy) || 1;
  return { at, n: [-dy / len, dx / len] };
}

/** One cubic Bézier segment: start, two controls, end. */
type Seg = readonly [Pt, Pt, Pt, Pt];

/** Points along a chain of segments, with the normal there and how far along the chain (0-1) each one is. */
function along(segs: readonly Seg[], steps: number): { at: Pt; n: Pt; g: number }[] {
  const out: { at: Pt; n: Pt; g: number }[] = [];
  segs.forEach(([p0, c1, c2, p3], k) => {
    for (let i = k ? 1 : 0; i <= steps; i++)
      out.push({ ...bezier(p0, c1, c2, p3, i / steps), g: (k * steps + i) / (segs.length * steps) });
  });
  return out;
}

/**
 * A limb that tapers along a chain of Bézier segments (a curling tentacle): `w0` wide at the root, `w1` at its
 * round tip. The root end is cut straight: tuck it under the body. Keep the joints smooth (each segment's
 * first control in line with the previous segment's last).
 */
function taper(segs: readonly Seg[], w0: number, w1: number, steps = 14): string {
  const pts = along(segs, steps);
  const half = (g: number) => (w0 + (w1 - w0) * g) / 2;
  const a = pts.map(({ at, n, g }): Pt => [at[0] + n[0] * half(g), at[1] + n[1] * half(g)]);
  const b = pts.map(({ at, n, g }): Pt => [at[0] - n[0] * half(g), at[1] - n[1] * half(g)]);
  const tip = b[b.length - 1] ?? [0, 0];
  return (
    `M${a.map(P).join('L')}A${f(w1 / 2)} ${f(w1 / 2)} 0 0 0 ${P(tip)}` +
    `L${b.slice(0, -1).reverse().map(P).join('L')}Z`
  );
}

/**
 * A furry outline: an ellipse of `n` pointed tufts, each `depth` deep, leaning a little clockwise (fur that
 * has been stroked one way).
 */
function fluff(cx: number, cy: number, rx: number, ry: number, n: number, depth: number, turn = 0): string {
  const at = (deg: number, k: number): Pt => {
    const a = (deg * Math.PI) / 180;
    return [cx + Math.cos(a) * (rx - k), cy + Math.sin(a) * (ry - k)];
  };
  const step = 360 / n;
  let d = `M${P(at(turn, depth))}`;
  for (let i = 0; i < n; i++) {
    const a0 = turn + i * step;
    d += `Q${P(at(a0 + 0.2 * step, -0.15 * depth))} ${P(at(a0 + 0.62 * step, -0.4 * depth))}`;
    d += `Q${P(at(a0 + 0.78 * step, 0.25 * depth))} ${P(at(a0 + step, depth))}`;
  }
  return `${d}Z`;
}

/** A puff of smoke: three overlapping balls around (x, y). */
const puffShape = (x: number, y: number, s: number, fill: string): string =>
  circle(x, y, 1.25 * s, fill) +
  circle(x + 1.1 * s, y - 0.55 * s, 0.95 * s, fill) +
  circle(x - 1, y - 0.8 * s, 0.85 * s, fill);

/** A gimmick that holds the face and the whole soft body (see the file comment). */
const softBody = (id: string, markup: string, anim: GimmickDef['anim']): GimmickDef => ({
  id,
  z: 'face',
  markup,
  anim,
});

/** Shorthand: keyframes of a squash-and-stretch loop that ends where it starts. */
const jiggle = (amount: number): GimmickKeyframe[] => [
  { t: 0 },
  { t: 0.25, sx: 1 + amount, sy: 1 - amount },
  { t: 0.5 },
  { t: 0.75, sx: 1 - 0.8 * amount, sy: 1 + 0.8 * amount },
  { t: 1 },
];

// ---------------------------------------------------------------------------------------------------------
// Alien: a lime-green bulb head in a space suit, three eyes (the middle one up on the forehead) and two
// antennae. The antennae wave on their own when idle, perk up when surprised and whirl when dizzy.

const lime = { base: '#a6d65c', shade: '#87b941', light: '#c7e992' };
const suit = OBJECT.steel;
const alienHead = 'M50 14C69 14 82 26 82 42C82 58 66 79 50 79C34 79 18 58 18 42C18 26 31 14 50 14Z';

const antenna = (s: Side): GimmickDef => {
  const root: Pt = [sx(s, 6.5), 22];
  const tip: Pt = [sx(s, 16), 7.4];
  const origin = { x: root[0], y: root[1] };
  return {
    id: s < 0 ? 'antenna-left' : 'antenna-right',
    z: 'behind',
    markup:
      line(`M${P(root)}Q${P([sx(s, 8), 11])} ${P(tip)}`, lime.shade, 2.4) +
      circle(tip[0], tip[1], 3.4, OBJECT.gold.base) +
      circle(tip[0] - 1, tip[1] - 1.1, 1.1, OBJECT.gold.light),
    anim: [
      // perk up and stay up
      {
        trigger: ['surprised'],
        durationMs: 700,
        keyframes: [
          { t: 0, ease: 'emphasized' },
          { t: 0.4, y: -3 },
          { t: 1, y: -2.4 },
        ],
        origin,
      },
      { ...R.sway({ angle: -s * 16, ms: 700 }), trigger: ['dizzy', 'laugh'], origin },
      { ...R.sway({ angle: -s * 8, ms: 2600 }), trigger: ['idle', 'confused'], origin },
    ],
  };
};

const alien: AvatarDef = {
  id: 'alien',
  kind: 'creature',
  name: { he: 'חייזר', en: 'Alien' },
  tile: TILE.coral,
  layers: {
    back:
      // a silver space suit off the bottom (to y 150: a spin must not show its edge), with a planet badge
      path('M7 150V99Q7 84 30 82H70Q93 84 93 99V150Z', suit.shade) +
      path('M7 150V100Q7 85.5 29.5 83.5H68Q90 85.5 90 100V150Z', suit.base) +
      circle(66, 95, 4.4, OBJECT.red.base) +
      ellipse(66, 95, 8, 2, OBJECT.gold.base, -18) +
      circle(64.9, 93.8, 1.4, OBJECT.red.light) +
      // the neck in a gold collar
      rect(44, 70, 12, 14, lime.shade) +
      rect(38.6, 79.6, 23, 7.4, OBJECT.gold.shade, 3.7) +
      rect(38, 79, 22, 6.4, OBJECT.gold.base, 3.2) +
      // the head: shade, then the lit surface up and left
      shaded(alienHead, lime.base, lime.shade) +
      ellipse(28.5, 29, 2.6, 6.4, lime.light, 40),
  },
  face: {
    ink: FACE.ink,
    eyes: {
      count: 3,
      left: { x: 36, y: 51 },
      right: { x: 64, y: 51 },
      middle: { x: 50, y: 35 },
      r: 6.2,
      style: 'oval',
    },
    brows: { lift: 1.6, length: 1.7, thickness: 2.2, color: shade(lime.shade, -0.55) },
    mouth: { x: 50, y: 66, w: 13 },
    // no blush: on green it turns brown
    halo: { x: 50, y: 9 },
  },
  pivot: { x: 50, y: 47 },
  headBox: { x: 11, y: 5, size: 78 },
  motionBias: ['tilt', 'spin', 'bounce', 'nod'],
  gimmicks: [antenna(-1), antenna(1)],
};

// ---------------------------------------------------------------------------------------------------------
// Cyclops: a pink, bean-shaped monster with one horn and one big eye. Its face glances left and right on its
// own when idle (the gimmick holds the face and the eye socket), and darts about when confused.

const cyc = OBJECT.pink;
const cycHorn = OBJECT.cream;
const cycBody = 'M50 18C71 18 82 32 82 54C82 78 70 91 50 91C30 91 18 78 18 54C18 32 29 18 50 18Z';
const cycSpot = mix(cyc.shade, OBJECT.purple.base, 0.35);
const cycOrigin = { x: 50, y: 49 };

const cyclops: AvatarDef = {
  id: 'cyclops',
  kind: 'creature',
  name: { he: 'קיקלופ', en: 'Cyclops' },
  tile: TILE.sky,
  layers: {
    back:
      // little arms and feet
      ellipse(18, 63, 4.6, 8, cyc.shade, 25) +
      ellipse(82, 63, 4.6, 8, cyc.shade, -25) +
      ellipse(38.5, 91, 8.5, 4.4, cyc.shade) +
      ellipse(61.5, 91, 8.5, 4.4, cyc.shade) +
      // the horn
      path('M42.5 23Q42.5 10 52.5 5Q49.5 13.5 57.5 22Z', cycHorn.shade) +
      path('M42.5 23Q42.5 10 52.5 5Q47 14 51.5 22.6Z', cycHorn.base) +
      // the body: shade, then the lit surface up and left
      shaded(cycBody, cyc.base, cyc.shade) +
      circle(27, 74, 3.2, cycSpot) +
      circle(33.5, 82.5, 2.1, cycSpot) +
      circle(74.5, 70, 2.6, cycSpot) +
      ellipse(28, 35, 2.6, 6.6, cyc.light, 35),
  },
  face: {
    ink: FACE.ink,
    eyes: { count: 1, middle: { x: 50, y: 49 }, r: 11, style: 'round' },
    brows: { lift: 1.45, length: 2, thickness: 3, color: shade(cyc.shade, -0.5) },
    mouth: { x: 50, y: 74, w: 17 },
    cheeks: { color: FACE.blush, dx: 0.9, dy: 1.35, size: 0.55 },
    halo: { x: 50, y: 6 },
  },
  pivot: { x: 50, y: 55 },
  base: 95,
  squash: true,
  motionBias: ['squash', 'wobble', 'bounce', 'tilt'],
  gimmicks: [
    {
      id: 'glance',
      z: 'face',
      markup: ellipse(50, 49.6, 14.6, 14.2, mix(cyc.base, cyc.shade, 0.6)),
      anim: [
        {
          trigger: ['confused'],
          durationMs: 1600,
          loop: true,
          keyframes: [
            { t: 0 },
            { t: 0.2, x: -4 },
            { t: 0.45, x: -4 },
            { t: 0.65, x: 4 },
            { t: 0.9, x: 4 },
            { t: 1 },
          ],
          origin: cycOrigin,
        },
        {
          trigger: ['idle'],
          durationMs: 6000,
          loop: true,
          keyframes: [
            { t: 0 },
            { t: 0.1, x: -4, ease: 'standard' },
            { t: 0.38, x: -4 },
            { t: 0.48, x: 4, ease: 'standard' },
            { t: 0.76, x: 4 },
            { t: 0.86, ease: 'standard' },
            { t: 1 },
          ],
          origin: cycOrigin,
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Slime: a dome of aqua jelly on a little puddle of itself. The jelly holds the face: it wobbles when idle,
// jiggles when it laughs, stretches up when surprised, trembles when angry and melts into a puddle when sad.

const goo = { base: '#5ccfc0', shade: '#3fb2a3', light: '#a1e8de' };
/** A tall dome of jelly with a flared foot. */
const slimeBody =
  'M15.5 89C8 89 7.5 81 13.5 78.5C14.5 58 26 19 50 19C74 19 85.5 58 86.5 78.5C92.5 81 92 89 84.5 89Z';
const slimeBase = { x: 50, y: 89 };
/** Something it swallowed, seen through the jelly: a coin. */
const sunk = (c: string) => mix(c, goo.base, 0.45);

const slime: AvatarDef = {
  id: 'slime',
  kind: 'creature',
  name: { he: 'סליים', en: 'Slime' },
  tile: TILE.berry,
  layers: {
    // the puddle and a drop on the floor stay put while the jelly moves
    back: ellipse(50, 89.4, 38.5, 3.6, goo.shade) + ellipse(82, 93.6, 3.4, 1.6, goo.shade),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 40.5, y: 54 }, right: { x: 59.5, y: 54 }, r: 5.6, style: 'round' },
    brows: { lift: 1.75, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 68, w: 15 },
    // no blush: on aqua it turns grey
    halo: { x: 50, y: 10 },
  },
  pivot: { x: 50, y: 56 },
  base: 89,
  squash: true,
  motionBias: ['squash', 'wobble', 'bounce'],
  gimmicks: [
    softBody(
      'jelly',
      shaded(slimeBody, goo.base, goo.shade, -1.6, -1.4) +
        // a swallowed coin, bubbles in the jelly, and the shine
        circle(70, 78, 4.4, sunk(OBJECT.gold.shade)) +
        circle(69.5, 77.5, 3.4, sunk(OBJECT.gold.base)) +
        rect(68.8, 75.4, 1.4, 4.2, sunk(OBJECT.gold.shade), 0.7) +
        circle(77, 66, 1.6, goo.light) +
        circle(25, 79, 2.2, goo.light) +
        circle(30, 72.5, 1.2, goo.light) +
        ellipse(31.5, 41, 2.8, 7.6, goo.light, 30) +
        circle(39.5, 30, 1.7, goo.light),
      [
        {
          trigger: ['sad'],
          durationMs: 1600,
          keyframes: [
            { t: 0, ease: 'standard' },
            { t: 0.6, sx: 1.1, sy: 0.86 },
            { t: 1, sx: 1.14, sy: 0.8 },
          ],
          origin: slimeBase,
        },
        {
          trigger: ['surprised'],
          durationMs: 900,
          keyframes: [
            { t: 0, ease: 'emphasized' },
            { t: 0.3, sx: 0.88, sy: 1.16 },
            { t: 0.6, sx: 0.96, sy: 1.06, ease: 'standard' },
            { t: 1, sx: 0.93, sy: 1.1 },
          ],
          origin: slimeBase,
        },
        {
          trigger: ['angry'],
          durationMs: 260,
          loop: true,
          ease: 'linear',
          keyframes: [{ t: 0 }, { t: 0.25, x: 0.9 }, { t: 0.75, x: -0.9 }, { t: 1 }],
          origin: slimeBase,
        },
        {
          durationMs: 560,
          loop: true,
          keyframes: jiggle(0.07),
          trigger: ['laugh', 'bounce'],
          origin: slimeBase,
        },
        { ...R.sway({ angle: 5, ms: 1300 }), trigger: ['dizzy'], origin: slimeBase },
        { durationMs: 2800, loop: true, keyframes: jiggle(0.03), trigger: ['idle'], origin: slimeBase },
      ],
    ),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Ghost: a bedsheet ghost with a scalloped hem and its arms up under the sheet. It floats: the sheet holds the
// face and bobs when idle, jumps when surprised and sinks when sad; its shadow on the floor shrinks as it rises.

const sheet = OBJECT.white;
const ghostShape =
  'M50 9C67.5 9 78 22 78 40V60Q78 72 82 82Q83.5 86.5 79 86Q74 92 68.5 86.5Q63 92.5 57.5 86.5Q52 92.5 46.5 86.5' +
  'Q41 92.5 35.5 86.5Q30 92 25 86Q19.5 86.5 18.5 82Q22 72 22 60V40C22 22 32.5 9 50 9Z';
const ghostFloor = { x: 50, y: 94 };
const ghostBase = { x: 50, y: 88 };
/** The float, shared by the sheet and its shadow so they stay in step. */
const float = (y: number, ms: number) => ({
  durationMs: ms,
  loop: true,
  keyframes: [{ t: 0 }, { t: 0.5, y }, { t: 1 }],
});

const ghost: AvatarDef = {
  id: 'ghost',
  kind: 'creature',
  name: { he: 'רוח רפאים', en: 'Ghost' },
  tile: TILE.cobalt,
  layers: { back: '' },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 41 }, right: { x: 58.5, y: 41 }, r: 5, style: 'dot' },
    brows: false,
    mouth: { x: 50, y: 55, w: 12 },
    cheeks: { color: FACE.blush, dx: 0.5, dy: 1.6, size: 0.8 },
    halo: { x: 50, y: 6 },
  },
  pivot: { x: 50, y: 48 },
  base: 88,
  squash: true,
  motionBias: ['bounce', 'wobble', 'spin', 'squash'],
  gimmicks: [
    {
      id: 'floor-shadow',
      z: 'behind',
      markup: ellipse(50, 94, 19, 2.8, shade(TILE.cobalt, -0.3)),
      anim: [
        {
          trigger: ['surprised'],
          durationMs: 900,
          keyframes: [
            { t: 0, ease: 'emphasized' },
            { t: 0.3, sx: 0.66, sy: 0.66 },
            { t: 1, sx: 0.72, sy: 0.72 },
          ],
          origin: ghostFloor,
        },
        {
          trigger: ['sad'],
          durationMs: 1600,
          keyframes: [
            { t: 0, ease: 'standard' },
            { t: 1, sx: 1.12, sy: 1.12 },
          ],
          origin: ghostFloor,
        },
        {
          durationMs: 1000,
          loop: true,
          keyframes: [{ t: 0 }, { t: 0.5, sx: 0.84, sy: 0.84 }, { t: 1 }],
          trigger: ['laugh'],
          origin: ghostFloor,
        },
        {
          durationMs: 2800,
          loop: true,
          keyframes: [{ t: 0 }, { t: 0.5, sx: 0.84, sy: 0.84 }, { t: 1 }],
          trigger: ['idle'],
          origin: ghostFloor,
        },
      ],
    },
    softBody(
      'sheet',
      // arms raised under the sheet, then the sheet and two soft folds by the hem
      mirrored((s) =>
        path(
          `M${P([sx(s, 27), 47])}Q${P([sx(s, 38), 43])} ${P([sx(s, 39.5), 52])}Q${P([sx(s, 39), 60])} ${P([sx(s, 27), 62])}Z`,
          sheet.shade,
        ),
      ) +
        mirrored((s) =>
          path(
            `M${P([sx(s, 27), 47.5])}Q${P([sx(s, 37), 44])} ${P([sx(s, 38.5), 51.5])}Q${P([sx(s, 37.5), 58])} ${P([sx(s, 27), 60.5])}Z`,
            sheet.base,
          ),
        ) +
        shaded(ghostShape, sheet.base, sheet.shade, -1.6, -1.4) +
        path('M33 86Q32 76 35.5 66Q35 77 37 86.5Z', sheet.shade) +
        path('M62 86.5Q63.5 78 61 70Q65.5 77 65.5 86Z', sheet.shade),
      [
        {
          trigger: ['surprised'],
          durationMs: 900,
          keyframes: [
            { t: 0, ease: 'emphasized' },
            { t: 0.3, y: -7 },
            { t: 1, y: -5.5 },
          ],
          origin: ghostBase,
        },
        {
          trigger: ['sad'],
          durationMs: 1600,
          keyframes: [
            { t: 0, ease: 'standard' },
            { t: 1, y: 3, sx: 1.02, sy: 0.96 },
          ],
          origin: ghostBase,
        },
        { ...float(-2.5, 1000), trigger: ['laugh'], origin: ghostBase },
        { ...float(-3, 2800), trigger: ['idle'], origin: ghostBase },
      ],
    ),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Furry monster: a purple ball of fur with two little horns and orange feet. Only its eyes peek out, from a
// tufted gap in the fur; a mouth shows only when it laughs, gasps, yawns or snarls (face art). The fur
// holds the face: it breathes when idle and stands on end when surprised or angry.

const fur = OBJECT.purple;
const furGap = shade(fur.shade, -0.06);
const furMouth = shade(fur.shade, -0.62);
const furFeet = OBJECT.orange;
const furBase = { x: 50, y: 88 };
/** The gap in the fur the eyes look out of: tufts hang into it from above and poke up from below. */
const furHole =
  'M27 52.5Q27.5 44.5 34.5 43.5L37.5 47.5L41 42.5L44.5 47L49 41.5L53 46.5L57.5 42L61.5 47.5L65.5 43.5' +
  'Q72.5 44.5 73 52.5Q72.5 60.5 65.5 61.5L62 58L58 63L54 59L50 64L46 59L42 63L38 58L34.5 61.5Q27.5 60.5 27 52.5Z';
/** A tuft of fur: a thin leaf from (x, y), `len` long, turned `deg`. */
const tuft = (x: number, y: number, len: number, deg: number, fill: string) =>
  ellipse(x, y, len / 2, len / 7, fill, deg);
const fang = (x: number, y: number, s: number, down = true) =>
  path(`M${P([x - s, y])}L${P([x + s, y])}L${P([x, y + (down ? 1.6 : -1.6) * s])}Z`, FACE.teeth);

const furArt: Partial<Record<Expression, string>> = {
  smile: path('M44 67Q50 68.5 56 67Q55 72.5 50 72.5Q45 72.5 44 67Z', furMouth) + fang(46.5, 67.6, 1.3),
  wink: path('M45 67.5Q51 68.5 56.5 66.5Q55.5 72 50.5 72.2Q46 72 45 67.5Z', furMouth) + fang(53.5, 67.6, 1.3),
  laugh:
    path('M40.5 66Q50 65 59.5 66Q58.5 78 50 78Q41.5 78 40.5 66Z', furMouth) +
    ellipse(50, 74.8, 5.4, 2.8, FACE.tongue) +
    fang(44.2, 66.3, 1.6) +
    fang(55.8, 66.3, 1.6),
  surprised: ellipse(50, 70, 3.8, 4.8, furMouth),
  sad: path('M44.5 72Q50 66.5 55.5 72Q50 69.6 44.5 72Z', furMouth),
  angry:
    path('M40 67.5Q50 64 60 67.5L59 73Q50 70.5 41 73Z', furMouth) +
    fang(44, 66.6, 1.5) +
    fang(50, 65.6, 1.5) +
    fang(56, 66.6, 1.5) +
    fang(46.8, 72.1, 1.4, false) +
    fang(53.2, 72.1, 1.4, false),
  sleepy: ellipse(50, 69.5, 2.2, 2.6, furMouth),
};

const furryMonster: AvatarDef = {
  id: 'furry-monster',
  kind: 'creature',
  name: { he: 'מפלצת פרוותית', en: 'Furry monster' },
  tile: TILE.mustard,
  layers: {
    back:
      ellipse(38.5, 89.5, 8.4, 4.8, furFeet.shade) +
      ellipse(61.5, 89.5, 8.4, 4.8, furFeet.shade) +
      ellipse(37.8, 88.6, 7.4, 3.8, furFeet.base) +
      ellipse(60.8, 88.6, 7.4, 3.8, furFeet.base),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 40.5, y: 53 }, right: { x: 59.5, y: 53 }, r: 6.4, style: 'round' },
    brows: false,
    mouth: false,
    art: { default: '', ...furArt },
    halo: { x: 50, y: 8 },
  },
  pivot: { x: 50, y: 55 },
  base: 93,
  squash: true,
  motionBias: ['squash', 'bounce', 'shake', 'wobble'],
  gimmicks: [
    softBody(
      'fur',
      // horns, the ball of fur, the gap the eyes look out of, a few tufts
      mirrored((s) =>
        path(
          `M${P([sx(s, 9), 27])}Q${P([sx(s, 14), 15])} ${P([sx(s, 20), 12])}Q${P([sx(s, 16.5), 21])} ${P([sx(s, 17.5), 29])}Z`,
          OBJECT.cream.base,
        ),
      ) +
        path(fluff(50, 55, 34, 33, 24, 4.5, 4), fur.shade) +
        path(fluff(48.8, 53.8, 32.6, 31.8, 24, 4.5, 4), fur.base) +
        path(furHole, furGap) +
        tuft(31, 33, 9, -50, fur.light) +
        tuft(36.5, 29, 7, -62, fur.light) +
        tuft(68, 70, 8, -55, fur.shade) +
        tuft(63, 76, 6, -65, fur.shade),
      [
        {
          trigger: ['surprised'],
          durationMs: 800,
          keyframes: [
            { t: 0, ease: 'emphasized' },
            { t: 0.3, sx: 1.11, sy: 1.11 },
            { t: 1, sx: 1.08, sy: 1.08 },
          ],
          origin: furBase,
        },
        {
          trigger: ['angry'],
          durationMs: 520,
          loop: true,
          keyframes: [
            { t: 0 },
            { t: 0.3, sx: 1.08, sy: 1.08, rotate: 1.5 },
            { t: 0.65, sx: 1.05, sy: 1.05, rotate: -1.5 },
            { t: 1 },
          ],
          origin: furBase,
        },
        { durationMs: 500, loop: true, keyframes: jiggle(0.05), trigger: ['laugh'], origin: furBase },
        {
          durationMs: 3200,
          loop: true,
          keyframes: [{ t: 0 }, { t: 0.5, sx: 1.02, sy: 1.035 }, { t: 1 }],
          trigger: ['idle', 'sleepy'],
          origin: furBase,
        },
      ],
    ),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Baby dragon: orange, with small ivory horns, frilled ears, a round snout, a cream belly and little bat
// wings. It snorts smoke from its nostrils when angry and sneezes a puff when surprised; its wings flap when
// idle and when it laughs.

const scale = FUR.fox;
const belly = FUR.cream;
const dragonHorn = OBJECT.cream;
const smoke = mix(OBJECT.white.base, FUR.grey.base, 0.12);
const dragonHead = 'M50 25C67 25 79 36 79 50C79 62 70 71 50 71C30 71 21 62 21 50C21 36 33 25 50 25Z';
const muzzle = 'M50 53C62 53 69 58 69 65.5C69 72.5 61 77 50 77C39 77 31 72.5 31 65.5C31 58 38 53 50 53Z';
const nostril = (s: Side): Pt => [sx(s, 5), 58.5];

const wing = (s: Side): GimmickDef => {
  const root: Pt = [sx(s, 27), 88];
  const origin = { x: root[0], y: root[1] };
  return {
    id: s < 0 ? 'wing-left' : 'wing-right',
    z: 'behind',
    markup:
      path(
        `M${P([sx(s, 24), 93])}Q${P([sx(s, 29), 74])} ${P([sx(s, 43), 63])}Q${P([sx(s, 40), 70.5])} ${P([sx(s, 41), 77])}` +
          `Q${P([sx(s, 36.5), 76])} ${P([sx(s, 35), 82])}Q${P([sx(s, 31), 81.5])} ${P([sx(s, 29.5), 88])}Z`,
        scale.shade,
      ) + line(`M${P([sx(s, 26.5), 86])}Q${P([sx(s, 30.5), 73.5])} ${P([sx(s, 42.5), 63.6])}`, scale.base, 2),
    anim: [
      { ...R.sway({ angle: s * 16, ms: 520 }), trigger: ['laugh', 'bounce'], origin },
      { ...R.sway({ angle: s * 10, ms: 1800 }), trigger: ['idle'], origin },
    ],
  };
};

/**
 * Smoke from one nostril: a snort that drifts out to the side and up. Two per nostril, staggered. It starts
 * small and leaves the cheeks quickly, so it grows only once it is past the side of the head.
 */
const snort = (s: Side, i: number): GimmickDef => {
  const [x, y] = nostril(s);
  return {
    id: `smoke-${s < 0 ? 'left' : 'right'}-${i}`,
    rest: 'hidden',
    markup: puffShape(x, y, 3.8, smoke),
    anim: [
      {
        trigger: ['angry'],
        durationMs: 1400,
        delayMs: i * 700,
        loop: true,
        ease: 'linear',
        keyframes: [
          { t: 0, sx: 0.35, sy: 0.35, opacity: 0 },
          { t: 0.12, x: s * 5, y: 3, sx: 0.6, sy: 0.6, opacity: 1 },
          { t: 0.42, x: s * 21, y: 2.5, sx: 0.95, sy: 0.95, opacity: 0.9 },
          { t: 1, x: s * 33, y: -12, sx: 1.4, sy: 1.4, opacity: 0 },
        ],
        origin: { x, y },
      },
      {
        // the sneeze: one quick burst
        trigger: ['surprised'],
        durationMs: 900,
        delayMs: i * 120,
        ease: 'standard',
        keyframes: [
          { t: 0, sx: 0.4, sy: 0.4, opacity: 0 },
          { t: 0.12, x: s * 6, y: 2.5, sx: 1, sy: 1, opacity: 1 },
          { t: 1, x: s * (20 + 5 * i), y: 1 - 4 * i, sx: 1.6, sy: 1.6, opacity: 0 },
        ],
        origin: { x, y },
      },
    ],
  };
};

const babyDragon: AvatarDef = {
  id: 'baby-dragon',
  kind: 'creature',
  name: { he: 'דרקון תינוק', en: 'Baby dragon' },
  tile: TILE.iris,
  layers: {
    back:
      // shoulders off the bottom, the neck, the striped cream belly up to the chin
      path('M10 150V104Q12 84 50 82Q88 84 90 104V150Z', scale.base) +
      rect(36, 62, 28, 26, scale.base) +
      path('M40.5 150V74H59.5V150Z', belly.base) +
      line('M41.5 84H58.5M41.5 92H58.5M41.5 100H58.5', belly.shade, 1.5) +
      ellipse(50, 77.5, 13, 3.4, belly.shade) +
      // horns and frilled ears, behind the head
      mirrored(
        (s) =>
          path(
            `M${P([sx(s, 15), 31])}Q${P([sx(s, 17), 21])} ${P([sx(s, 21), 13])}Q${P([sx(s, 13), 18.5])} ${P([sx(s, 8), 28])}Z`,
            dragonHorn.shade,
          ) +
          path(
            `M${P([sx(s, 14.4), 30.4])}Q${P([sx(s, 16.4), 21])} ${P([sx(s, 21), 13])}Q${P([sx(s, 13.6), 19])} ${P([sx(s, 9.2), 28])}Z`,
            dragonHorn.base,
          ) +
          path(
            `M${P([sx(s, 26), 43])}L${P([sx(s, 39), 37])}L${P([sx(s, 34), 45])}L${P([sx(s, 40), 50])}L${P([sx(s, 33), 53])}` +
              `L${P([sx(s, 36), 59])}L${P([sx(s, 26), 57])}Z`,
            scale.shade,
          ),
      ) +
      // the head with a little crest, the muzzle and nostrils
      path('M44 27.5L46.5 20.5L49.5 26.5Z', scale.shade) +
      path('M50.5 26.5L53.5 19.5L56 27.5Z', scale.shade) +
      shaded(dragonHead, scale.base, scale.shade) +
      shaded(muzzle, scale.base, scale.shade, -1.3, -1.3) +
      mirrored((s) => ellipse(nostril(s)[0], nostril(s)[1], 1.25, 1.8, shade(scale.shade, -0.3), s * -25)) +
      ellipse(30, 38, 2.4, 5.4, scale.light, 45),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 38.5, y: 45 }, right: { x: 61.5, y: 45 }, r: 5.6, style: 'oval' },
    brows: { lift: 1.7, length: 1.8, thickness: 2.2, color: shade(scale.shade, -0.45) },
    mouth: { x: 50, y: 68, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.6, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 9 },
  },
  pivot: { x: 50, y: 52 },
  headBox: { x: 13, y: 10, size: 74 },
  motionBias: ['bounce', 'tilt', 'shake', 'nod'],
  gimmicks: [wing(-1), wing(1), snort(-1, 0), snort(1, 0), snort(-1, 1), snort(1, 1)],
};

// ---------------------------------------------------------------------------------------------------------
// Octopus in a top hat: a coral octopus, very proper. Its four outer arms wave on their own when idle and
// wildly when it laughs; it tips its hat when it winks, and the hat jumps when it is surprised.

const octo = { base: '#f07a6c', shade: '#d65c50', light: '#f8a59a' };
const sucker = mix(octo.light, OBJECT.cream.base, 0.5);
const topHat = HAIR.black;
const hatBand = OBJECT.blue;
const mantle = 'M50 23C67 23 78 35 78 50C78 63 69 72 50 72C31 72 22 63 22 50C22 35 33 23 50 23Z';

const mirrorX = ([x, y]: Pt): Pt => [100 - x, y];
const mirrorSegs = (segs: readonly Seg[]): Seg[] =>
  segs.map(([a, b, c, d]) => [mirrorX(a), mirrorX(b), mirrorX(c), mirrorX(d)] as const);

/** One arm: a tapering curl, with suckers along the inside of the curl. `s`: the side it curls on. */
const arm = (segs: readonly Seg[], s: Side, w0 = 11, w1 = 3.2): string => {
  const pts = along(segs, 14);
  const sk = (g: number) => {
    const p = pts.reduce((best, q) => (Math.abs(q.g - g) < Math.abs(best.g - g) ? q : best));
    const h = (w0 + (w1 - w0) * p.g) / 2;
    return circle(
      p.at[0] + s * p.n[0] * h * 0.3,
      p.at[1] + s * p.n[1] * h * 0.3,
      1.2 * (1.15 - 0.6 * p.g),
      sucker,
    );
  };
  return path(taper(segs, w0, w1), octo.shade) + sk(0.62) + sk(0.75) + sk(0.88);
};

/** The left arms (the right ones mirror them): outer, inner, middle. */
const outerArm: Seg[] = [
  [
    [34, 60],
    [28, 67],
    [18, 70],
    [14, 79],
  ],
  [
    [14, 79],
    [12, 83.5],
    [14, 92],
    [20, 91.5],
  ],
  [
    [20, 91.5],
    [24, 91.2],
    [25, 85],
    [21.5, 85.5],
  ],
];
const innerArm: Seg[] = [
  [
    [41, 66],
    [38, 74],
    [32, 79],
    [30, 86],
  ],
  [
    [30, 86],
    [29.2, 89],
    [31, 95],
    [35.5, 94],
  ],
  [
    [35.5, 94],
    [39, 93.2],
    [39.5, 89],
    [36.5, 88.5],
  ],
];
const middleArm: Seg[] = [
  [
    [46.5, 66],
    [46, 75],
    [44.5, 82],
    [42.8, 87],
  ],
  [
    [42.8, 87],
    [41.8, 90],
    [43.5, 94.5],
    [47, 93.5],
  ],
  [
    [47, 93.5],
    [49.5, 92.8],
    [49.5, 89.5],
    [47.2, 89.2],
  ],
];

const waving = (id: string, segs: readonly Seg[], s: Side, delay: number): GimmickDef => {
  const root = segs[0]?.[0] ?? [50, 60];
  const origin = { x: root[0], y: root[1] };
  return {
    id,
    z: 'behind',
    markup: arm(segs, s),
    anim: [
      { ...R.sway({ angle: -s * 14, ms: 760 }), delayMs: delay / 3, trigger: ['laugh', 'dizzy'], origin },
      { ...R.sway({ angle: -s * 7, ms: 2600 }), delayMs: delay, trigger: ['idle'], origin },
    ],
  };
};

const octopus: AvatarDef = {
  id: 'octopus',
  kind: 'creature',
  name: { he: 'תמנון', en: 'Octopus' },
  tile: TILE.teal,
  layers: {
    back:
      // the two middle arms, then the head
      arm(middleArm, -1, 10, 3) +
      arm(mirrorSegs(middleArm), 1, 10, 3) +
      shaded(mantle, octo.base, octo.shade) +
      ellipse(30.5, 40, 2.6, 6.4, octo.light, 40),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 40, y: 47.5 }, right: { x: 60, y: 47.5 }, r: 5.4, style: 'round' },
    brows: { lift: 1.75, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 61, w: 13 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 7 },
  },
  pivot: { x: 50, y: 50 },
  base: 94,
  squash: true,
  motionBias: ['wobble', 'squash', 'bounce', 'tilt'],
  gimmicks: [
    waving('arm-1', outerArm, -1, 0),
    waving('arm-2', innerArm, -1, 650),
    waving('arm-3', mirrorSegs(innerArm), 1, 1300),
    waving('arm-4', mirrorSegs(outerArm), 1, 1950),
    {
      id: 'hat',
      markup:
        `<g transform="rotate(-8 50 25)">` +
        rect(37.5, 7, 25, 18.5, topHat.shade, 2) +
        rect(37.5, 7, 22, 18.5, topHat.base, 2) +
        rect(37.5, 18.5, 25, 4.2, hatBand.base) +
        rect(37.5, 18.5, 3, 4.2, hatBand.light) +
        rect(40.5, 9.5, 2.4, 8, topHat.light, 1.2) +
        ellipse(50, 25.6, 19.5, 3.8, topHat.shade) +
        ellipse(49.5, 25, 18.8, 3.2, topHat.base) +
        `</g>`,
      anim: [
        {
          // a gentleman tips his hat
          trigger: ['wink'],
          durationMs: 1300,
          keyframes: [
            { t: 0, ease: 'emphasized' },
            { t: 0.3, y: -4, rotate: -16 },
            { t: 0.7, y: -4, rotate: -16, ease: 'standard' },
            { t: 1 },
          ],
          origin: { x: 36, y: 26 },
        },
        { ...R.popUp({ height: 10, ms: 1100 }), trigger: ['surprised'], origin: { x: 50, y: 25 } },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Rusty robot: a boxy old robot, patched with rust, with lens eyes and a crooked antenna. When it is confused
// or dizzy a spring pops out of its head and wobbles; when it is angry, sparks fly.

const metal = OBJECT.steel;
const rust = { base: '#bf7340', shade: '#9a5628', light: '#d8915c' };
const robotDark = CLOTH.charcoal;
const robotHead = { x: 16, y: 19, w: 66, h: 45 };

const robot: AvatarDef = {
  id: 'rusty-robot',
  kind: 'creature',
  name: { he: 'רובוט חלוד', en: 'Rusty robot' },
  tile: TILE.leaf,
  layers: {
    back:
      // legs and feet, arms, the body with its panel
      rect(35, 85, 7, 7, metal.shade) +
      rect(58, 85, 7, 7, metal.shade) +
      rect(31, 90, 14, 5.5, robotDark.base, 2.5) +
      rect(55, 90, 14, 5.5, robotDark.base, 2.5) +
      line('M30 72Q21 74 21 83', metal.shade, 4.6) +
      line('M70 72Q79 74 79 83', metal.shade, 4.6) +
      circle(21, 84.5, 3.2, robotDark.base) +
      circle(79, 84.5, 3.2, robotDark.base) +
      rect(43, 62, 14, 6, metal.shade) +
      rect(29.4, 67.4, 42, 20, metal.shade, 5) +
      rect(28, 66, 42, 20, metal.base, 5) +
      rect(37, 70.5, 19, 10, robotDark.base, 2) +
      circle(41.5, 75.5, 2, OBJECT.red.base) +
      circle(47.5, 75.5, 2, OBJECT.green.base) +
      rect(51, 73, 2.2, 5, OBJECT.gold.base, 1) +
      path('M60 86Q61 79 66 77Q70 78 70 82V86Z', rust.base) +
      // ear bolts, the head
      rect(10, 35, 7, 13, robotDark.base, 2) +
      rect(83, 35, 7, 13, robotDark.base, 2) +
      rect(robotHead.x + 1.4, robotHead.y + 1.4, robotHead.w, robotHead.h, metal.shade, 9) +
      rect(robotHead.x, robotHead.y, robotHead.w, robotHead.h, metal.base, 9) +
      // rust: the lower left corner, the top right, a streak
      path('M16 51Q22 49 25 55Q28 60 25 64H25Q16 64 16 56Z', rust.base) +
      path('M68 19H73Q82 19 82 28V31Q78 28 75 30Q70 27 68 19Z', rust.base) +
      path('M30 19H36Q35 23 32 23Q30 22 30 19Z', rust.shade) +
      // a dent, rivets, the lens housings
      path('M46 19.4Q50 23 54 19.4Z', metal.shade) +
      [
        [21.5, 24],
        [76.5, 24],
        [21.5, 59],
        [76.5, 59],
      ]
        .map(([x = 0, y = 0]) => circle(x, y, 1.5, metal.shade))
        .join('') +
      mirrored((s) => circle(sx(s, 11), 40, 9.2, metal.shade) + circle(sx(s, 11), 40, 7.9, metal.light)) +
      rect(21, 24, 3, 22, metal.light, 1.5),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 39, y: 40 }, right: { x: 61, y: 40 }, r: 6.2, style: 'round', white: FACE.sparkle },
    brows: { lift: 1.75, length: 1.8, thickness: 2.6, color: robotDark.base },
    mouth: { x: 50, y: 55, w: 15 },
    halo: { x: 50, y: 7 },
  },
  pivot: { x: 50, y: 52 },
  base: 95.5,
  motionBias: ['shake', 'wobble', 'tilt', 'nod'],
  gimmicks: [
    {
      id: 'antenna',
      z: 'behind',
      markup:
        line('M34 24L33 14.5L29 10.5', metal.shade, 2.2) +
        circle(29, 9.5, 3.2, OBJECT.red.base) +
        circle(28, 8.5, 1, OBJECT.red.light),
      anim: [
        { ...R.sway({ angle: 14, ms: 600 }), trigger: ['dizzy', 'shake'], origin: { x: 34, y: 22 } },
        { ...R.sway({ angle: 5, ms: 2400 }), trigger: ['idle'], origin: { x: 34, y: 22 } },
      ],
    },
    {
      id: 'spring',
      z: 'behind',
      markup:
        line('M58.5 36L67.5 34.4L58.5 32.4L67.5 30.4L58.5 28.4L67.5 26.4L58.5 24.6', metal.light, 2.3) +
        circle(63, 22.4, 3, OBJECT.gold.base) +
        circle(62, 21.4, 1, OBJECT.gold.light),
      anim: {
        trigger: ['confused', 'dizzy'],
        durationMs: 1400,
        keyframes: [
          { t: 0, ease: 'emphasized' },
          { t: 0.18, y: -16 },
          { t: 0.32, y: -14, rotate: 12 },
          { t: 0.46, y: -15, rotate: -9 },
          { t: 0.6, y: -14.5, rotate: 6 },
          { t: 0.76, y: -15, rotate: -3 },
          { t: 1, y: -15 },
        ],
        origin: { x: 63, y: 36 },
      },
    },
    {
      id: 'sparks',
      rest: 'hidden',
      markup:
        line('M90 25L84.5 31.5L89.5 32.5L85 40', OBJECT.gold.base, 2.4) +
        line('M10 26L15 31L10.5 32.5L14 38.5', OBJECT.gold.base, 2.4),
      anim: { ...R.sparks({ ms: 700 }), trigger: ['angry'], origin: { x: 50, y: 33 } },
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Shadow: a wisp of darkness with glowing eyes and nothing else, until it grins (face art: the mouth glows
// only when it smiles, laughs, gasps or snarls). The darkness holds the face: it flickers like a flame when
// idle, looms when angry, stretches when surprised and shrinks when sad.

const dark = { base: '#2b2643', shade: '#1c1830', light: '#3e3860' };
const glow = OBJECT.gold.light;
/** A dark flame: three tongues on top, a round middle, and a tail of smoke that curls away at the bottom. */
const shadowShape =
  'M50 8C52 13 55 17 58 19C60 15 64 12 69 11C67 16 69 21 73 25C79 32 83 42 83 53C83 68 74 80 62 86' +
  'C56 89 50 91 44 93C38 95 31 95.5 26.5 92.5C31 92.5 35.5 90.5 37 87C29 85 21.5 77 19 66C16.5 54 18 40 25 30' +
  'C29 24 31 18 30 12C35 14 39 17 42 20C45 16 48 12 50 8Z';
const shadowBase = { x: 50, y: 90 };
/** Its middle: it looms and stretches from here, so it stays in the tile. */
const shadowMiddle = { x: 50, y: 54 };
const glowLine = (d: string, w = 2.6) => line(d, glow, w);

const shadowArt: Partial<Record<Expression, string>> = {
  smile: path('M41 61Q50 70 59 61Q50 65.5 41 61Z', glow),
  wink: path('M42 63Q52 69 59.5 60Q52 66 42 63Z', glow),
  laugh: path('M39 59Q50 77 61 59Q50 63.5 39 59Z', glow),
  surprised: `<ellipse cx="50" cy="65" rx="3.4" ry="4.4" fill="none" stroke="${glow}" stroke-width="2.4"/>`,
  sad: glowLine('M45 67Q50 63.5 55 67'),
  dizzy: glowLine('M43 65Q45.3 63 47.6 65T52.4 65T57 65'),
  angry: path('M39 60L42.5 64L46 60.5L50 64.5L54 60.5L57.5 64L61 60Q60 69 50 69Q40 69 39 60Z', glow),
};

const shadow: AvatarDef = {
  id: 'shadow',
  kind: 'creature',
  name: { he: 'צל', en: 'Shadow' },
  tile: TILE.tangerine,
  layers: { back: '' },
  face: {
    ink: glow,
    eyes: { left: { x: 40.5, y: 47 }, right: { x: 59.5, y: 47 }, r: 6.4, style: 'dot' },
    brows: false,
    mouth: false,
    art: { default: '', ...shadowArt },
    halo: { x: 50, y: 7 },
  },
  pivot: { x: 50, y: 52 },
  base: 90,
  squash: true,
  motionBias: ['wobble', 'squash', 'tilt', 'shake'],
  gimmicks: [
    softBody(
      'darkness',
      shaded(shadowShape, dark.base, dark.shade, -1.6, -1.4) +
        path('M27 30Q24 38 24.5 48Q27 38 31 31Z', dark.light),
      [
        {
          trigger: ['angry'],
          durationMs: 900,
          keyframes: [
            { t: 0, ease: 'emphasized' },
            { t: 0.35, sx: 1.12, sy: 1.12 },
            { t: 1, sx: 1.09, sy: 1.09 },
          ],
          origin: shadowMiddle,
        },
        {
          trigger: ['surprised'],
          durationMs: 800,
          keyframes: [
            { t: 0, ease: 'emphasized' },
            { t: 0.3, sx: 0.9, sy: 1.09 },
            { t: 1, sx: 0.93, sy: 1.06 },
          ],
          origin: shadowMiddle,
        },
        {
          trigger: ['sad'],
          durationMs: 1500,
          keyframes: [
            { t: 0, ease: 'standard' },
            { t: 1, sx: 0.9, sy: 0.86 },
          ],
          origin: shadowBase,
        },
        {
          trigger: ['idle', 'sleepy'],
          durationMs: 2600,
          loop: true,
          keyframes: [
            { t: 0 },
            { t: 0.25, rotate: 2, sx: 1.02 },
            { t: 0.5, sy: 1.02 },
            { t: 0.75, rotate: -2, sx: 1.02 },
            { t: 1 },
          ],
          origin: shadowBase,
        },
      ],
    ),
  ],
};

export const CREATURES: readonly AvatarDef[] = [
  alien,
  cyclops,
  slime,
  ghost,
  furryMonster,
  babyDragon,
  octopus,
  robot,
  shadow,
];
