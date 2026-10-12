/**
 * Things from the house (kind `object`): the kitchen, the bathroom, the laundry. A kettle that steams, a
 * toaster that pops, a washing machine whose drum spins.
 *
 * Read docs/avatars/STYLE.md first. Shared drawing helpers: ./draw.ts; gimmick recipes: ../gimmick.ts. Add each
 * character's AvatarDef here and append it to the list below: catalog/index.ts already includes this list.
 */

import { GIMMICK_RECIPES as R } from '../gimmick';
import { CLOTH, FACE, FUR, mix, OBJECT, shade, TILE } from '../palette';
import { f } from '../svg';
import type { AvatarDef, Expression, GimmickDef, GimmickKeyframe } from '../types';
import { circle, ellipse, line, P, path, polar, rect, shaded, type Pt } from './draw';

// ---------------------------------------------------------------------------------------------------------
// Helpers for this file

/** A drop, the rig's tear shape: round at the bottom, pointed at the top; `s` is its radius. */
const drop = ([x, y]: Pt, s: number, fill: string): string =>
  path(
    `M${f(x)} ${f(y - 1.6 * s)}C${f(x + 0.35 * s)} ${f(y - s)} ${f(x + s)} ${f(y - 0.45 * s)} ${f(x + s)} ${f(y + 0.1 * s)}` +
      `A${f(s)} ${f(s)} 0 0 1 ${f(x - s)} ${f(y + 0.1 * s)}C${f(x - s)} ${f(y - 0.45 * s)} ${f(x - 0.35 * s)} ${f(y - s)} ${f(x)} ${f(y - 1.6 * s)}Z`,
    fill,
  );

/** Markup moved by the offset shade (STYLE.md §5): all of it in shade, then lit, shifted up and left. */
const offsetShade = (draw: (c: string) => string, base: string, shadeColor: string, dx = -1.4, dy = -1.3) =>
  draw(shadeColor) + `<g transform="translate(${f(dx)} ${f(dy)})">${draw(base)}</g>`;

/** `n` + 1 points along a cubic Bézier, both ends included. */
const cubicPoints = (a: Pt, b: Pt, c: Pt, d: Pt, n: number): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return [
      u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
      u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
    ] as const;
  });

/** Fluff: round bumps on some points. */
const bumps = (pts: readonly Pt[], r: number, fill: string) =>
  pts.map(([x, y]) => circle(x, y, r, fill)).join('');

/** Markup scaled by `k` around the point `at` (a face part drawn a size up). */
const scaled = (k: number, [x, y]: Pt, markup: string) =>
  `<g transform="matrix(${f(k)} 0 0 ${f(k)} ${f(x - k * x)} ${f(y - k * y)})">${markup}</g>`;

/** A breathing loop: a slow swell (around the anim's origin, the base) and back. */
const breathe = (sx: number, sy: number): GimmickKeyframe[] => [{ t: 0 }, { t: 0.45, sx, sy }, { t: 1 }];

// ---------------------------------------------------------------------------------------------------------
// Shower head: a hand shower turned up, its "hair" a fountain of water jets. The jets pulse when it laughs
// or is angry (gently when it idles) and shoot up when it is surprised; when it is sad they lose their
// pressure and drops fall from the rim.

const chrome = OBJECT.steel;
const water = { base: OBJECT.blue.light, light: mix(OBJECT.blue.light, OBJECT.white.base, 0.6) };
const plateY = 27;
const showerBowl = `M18 ${plateY}A32 44 0 0 0 82 ${plateY}Z`;
/** A jet on the left half: its root on the plate, the curve's control point, its tip. */
type Jet = readonly [ax: number, ay: number, bx: number, by: number, cx: number, cy: number];
const JETS: readonly Jet[] = [
  [50, 26, 50, 16, 50, 9],
  [45.5, 26, 42.5, 13, 34, 10],
  [40.5, 26.5, 31, 14.5, 21.5, 15.5],
  [35.5, 27.5, 22.5, 20, 14, 25.5],
];
/** Every jet, the left ones mirrored to the right: its path, its tip and the way it points there. */
const jetSet = JETS.flatMap(([ax, ay, bx, by, cx, cy]) => {
  const half = (s: 1 | -1) => {
    const X = (x: number) => 50 + s * (x - 50);
    return {
      d: `M${P([X(ax), ay])}Q${P([X(bx), by])} ${P([X(cx), cy])}`,
      tip: [X(cx), cy] as Pt,
      dir: [s * (cx - bx), cy - by] as Pt,
    };
  };
  return ax === 50 ? [half(1)] : [half(1), half(-1)];
});
const jetsMarkup =
  jetSet.map((j) => line(j.d, water.base, 3.6)).join('') +
  jetSet.map((j) => line(j.d, water.light, 1.2)).join('') +
  // a drop at each tip, a smaller one flying on
  jetSet
    .map((j) => {
      const [dx, dy] = j.dir;
      const k = 3.6 / Math.hypot(dx, dy);
      return (
        circle(j.tip[0], j.tip[1], 2.4, water.base) +
        circle(j.tip[0] + dx * k, j.tip[1] + dy * k, 1.3, water.base)
      );
    })
    .join('');
const showerDrip = (i: number, x: number): GimmickDef => ({
  id: `drip-${i}`,
  rest: 'hidden',
  markup: drop([x, plateY + 4], 2.2, water.base),
  anim: {
    ...R.drip({ fall: 26, ms: 1500 }),
    delayMs: i * 520,
    trigger: ['sad'],
    origin: { x, y: plateY + 4 },
  },
});

const showerHead: AvatarDef = {
  id: 'shower-head',
  kind: 'object',
  name: { he: 'ראש מקלחת', en: 'Shower head' },
  tile: TILE.tangerine,
  layers: {
    back:
      // the handle (to y 150: a spin must not show its end) and the collar under the bowl
      `<g transform="rotate(-12 50 64)">` +
      shaded('M43.5 58H56.5V150H43.5Z', chrome.base, chrome.shade) +
      rect(45.2, 78, 2.2, 30, chrome.light, 1.1) +
      rect(41.2, 68.6, 18.4, 7.4, chrome.shade, 2.4) +
      rect(40.6, 68, 17.6, 6.2, chrome.base, 2.4) +
      `</g>` +
      // the bowl: shade, then the lit surface up and left; a shine
      shaded(showerBowl, chrome.base, chrome.shade) +
      ellipse(25.5, 41, 2.3, 7, chrome.light, 30) +
      // the nozzle plate: a light rim, the plate, a ring of holes
      ellipse(50, plateY, 32, 5.6, chrome.light) +
      ellipse(50, plateY + 0.5, 28, 4.1, OBJECT.white.shade) +
      [-21, -14, -7, 0, 7, 14, 21].map((dx) => circle(50 + dx, plateY + 1.3, 0.9, chrome.shade)).join(''),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41, y: 47.5 }, right: { x: 59, y: 47.5 }, r: 5.2, style: 'round' },
    brows: { lift: 1.72, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 60.5, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 6.5 },
  },
  pivot: { x: 50, y: 50 },
  motionBias: ['shake', 'tilt', 'nod', 'bounce'],
  gimmicks: [
    {
      id: 'jets',
      z: 'back',
      markup: jetsMarkup,
      anim: [
        {
          // the pressure drops: the fountain sinks into the plate and stays low
          trigger: ['sad'],
          durationMs: 1300,
          keyframes: [
            { t: 0, ease: 'standard' },
            { t: 0.6, y: 1, sx: 0.92, sy: 0.4 },
            { t: 1, y: 1.2, sx: 0.9, sy: 0.32 },
          ],
          origin: { x: 50, y: plateY },
        },
        {
          trigger: ['surprised'],
          durationMs: 900,
          keyframes: [
            { t: 0, ease: 'emphasized' },
            { t: 0.35, sx: 1.05, sy: 1.16 },
            { t: 1, sx: 1.02, sy: 1.08 },
          ],
          origin: { x: 50, y: plateY },
        },
        {
          trigger: ['laugh', 'angry', 'bounce'],
          durationMs: 560,
          loop: true,
          keyframes: [{ t: 0 }, { t: 0.5, sx: 1.03, sy: 1.1 }, { t: 1 }],
          origin: { x: 50, y: plateY },
        },
        {
          trigger: ['idle'],
          durationMs: 2200,
          loop: true,
          keyframes: [{ t: 0 }, { t: 0.5, sx: 0.99, sy: 1.04 }, { t: 1 }],
          origin: { x: 50, y: plateY },
        },
      ],
    },
    showerDrip(0, 18.5),
    showerDrip(1, 81.5),
    showerDrip(2, 18.5),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Slipper: a plush house slipper, side on, toe to the left, a fluffy collar round its opening, its tongue
// out. It hops when it laughs or is surprised: the whole slipper holds the face (`z: 'face'`), and its
// shadow stays on the floor.

const slipperFur = {
  base: OBJECT.purple.light,
  shade: mix(OBJECT.purple.light, OBJECT.purple.base, 0.6),
  light: mix(OBJECT.purple.light, OBJECT.white.base, 0.4),
};
const trim = FUR.white;
const lining = mix(OBJECT.purple.shade, CLOTH.plum.shade, 0.55);
const sole = CLOTH.cream;
/** The near side of the upper: the toe, the instep, down the collar to the heel, round the heel. */
const slipperUpper =
  'M11 84C5 74 7 58 19 52C30 46.5 42 35 53 33C58 42 63 52 70 54C77 55.5 84 51 88 49C93 55 94 76 91 84Z';
/** The opening: between the near collar edge and the far one. */
const slipperOpening =
  'M53 33C58 42 63 52 70 54C77 55.5 84 51 88 49C84 44.5 76 44 70 45.5C63 47 57 40 53 33Z';
const nearCollar = [
  ...cubicPoints([53, 33], [58, 42], [63, 52], [70, 54], 5),
  ...cubicPoints([70, 54], [77, 55.5], [84, 51], [88, 49], 5).slice(1),
];
const farCollar = cubicPoints([88, 49], [84, 44.5], [76, 44], [70, 45.5], 3).concat(
  cubicPoints([70, 45.5], [63, 47], [57, 40], [53, 33], 3).slice(1),
);
const slipperMouth = { x: 38, y: 72.5, w: 13 };
/** The tongue out, hanging under the mouth line (art over the rig's mouth). */
const tongue = (dx: number, top: number, depth: number) => {
  const x = slipperMouth.x + dx;
  const y = slipperMouth.y + top;
  return (
    path(
      `M${f(x - 2.5)} ${f(y)}C${f(x - 2.7)} ${f(y + depth)} ${f(x + 2.7)} ${f(y + depth)} ${f(x + 2.5)} ${f(y - 0.3)}Z`,
      FACE.tongue,
    ) + line(`M${f(x + 0.1)} ${f(y + 0.7)}V${f(y + depth * 0.55)}`, shade(FACE.tongue, -0.22), 0.8)
  );
};

const slipperBody =
  // the sole
  path('M12 83.5H90Q94 83.5 93.6 87.6Q93.2 91.5 88 91.5H14Q8.5 91.5 8.8 87.6Q9.1 83.5 12 83.5Z', sole.shade) +
  path('M12 83.5H90Q93.5 83.5 93 86.2Q92.6 88.6 88 88.6H14Q9.2 88.6 9.4 86.2Q9.6 83.5 12 83.5Z', sole.base) +
  // the far side of the collar, the lining inside
  bumps(farCollar, 2.6, trim.shade) +
  path(slipperOpening, lining) +
  // the near side of the upper, then the fluffy collar along its edge
  shaded(slipperUpper, slipperFur.base, slipperFur.shade) +
  offsetShade((c) => bumps(nearCollar, 3.4, c), trim.base, trim.shade, -0.8, -0.9) +
  ellipse(16.5, 63, 2.2, 7, slipperFur.light, 28) +
  ellipse(31, 45.5, 4.2, 1.9, slipperFur.light, -32);

const slipper: AvatarDef = {
  id: 'slipper',
  kind: 'object',
  name: { he: 'נעל בית', en: 'Slipper' },
  tile: TILE.teal,
  layers: {
    // the shadow on the floor: it stays when the slipper hops
    back: ellipse(51, 92.4, 40, 3, shade(TILE.teal, -0.2)),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 30, y: 60 }, right: { x: 46, y: 60 }, r: 5, style: 'button' },
    brows: { lift: 1.85, length: 1.8, thickness: 2.1 },
    mouth: slipperMouth,
    cheeks: { color: FACE.blush, dx: 0.6, dy: 1.45, size: 0.8 },
    halo: { x: 40, y: 20 },
    art: {
      default: '',
      neutral: tongue(1.2, 0.75, 6.2),
      smile: tongue(0.6, 2.6, 6.6),
      wink: tongue(1.8, 1.9, 6.4),
    },
  },
  pivot: { x: 50, y: 64 },
  base: 91.5,
  squash: true,
  motionBias: ['bounce', 'squash', 'wobble', 'tilt'],
  gimmicks: [
    {
      id: 'hop',
      z: 'face',
      markup: slipperBody,
      anim: [
        {
          trigger: ['laugh'],
          durationMs: 760,
          loop: true,
          keyframes: [
            { t: 0, ease: 'standard' },
            { t: 0.16, sx: 1.06, sy: 0.92 },
            { t: 0.48, y: -9, sx: 0.97, sy: 1.05, ease: 'exit' },
            { t: 0.8, sx: 1.05, sy: 0.93 },
            { t: 1 },
          ],
          origin: { x: 50, y: 91.5 },
        },
        {
          trigger: ['surprised'],
          durationMs: 900,
          keyframes: [
            { t: 0, ease: 'standard' },
            { t: 0.14, sx: 1.06, sy: 0.92 },
            { t: 0.42, y: -11, sx: 0.96, sy: 1.06, ease: 'exit' },
            { t: 0.72, sx: 1.05, sy: 0.94, ease: 'standard' },
            { t: 1 },
          ],
          origin: { x: 50, y: 91.5 },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Lonely sock: an odd sock, standing on its foot. When it is confused it leans out left and right, looking
// for its pair (the sock holds the face, so the face goes with it).

const sockWool = OBJECT.blue;
const sockTrim = OBJECT.white;
const sockOutline =
  'M28 10H67V57Q67 65 75 66.5L83 68Q93 70 93 80.5Q93 92 81 92H38Q25 92 24.5 80Q24 72 28 64Z';
const sockHeel = 'M27.4 66Q38.5 68.5 41 79Q42 87 39 92H38Q25 92 24.5 80Q24.2 72.5 27.4 66Z';
const sockToe = 'M80.4 67.6Q75.4 74 76.4 83Q77.2 89 80.6 92H81Q93 92 93 80.5Q93 70 83 68Z';

const sockBody =
  path(sockOutline, sockWool.shade) +
  path(sockHeel, sockTrim.shade) +
  path(sockToe, sockTrim.shade) +
  `<g transform="translate(-1.4 -1.3)">` +
  path(sockOutline, sockWool.base) +
  path(sockHeel, sockTrim.base) +
  path(sockToe, sockTrim.base) +
  // the ribbed cuff with a red band
  rect(28, 10, 39, 13, sockTrim.base) +
  rect(28, 18.2, 39, 2.6, OBJECT.red.base) +
  [33, 39, 45, 51, 57, 63].map((x) => line(`M${x} 12.5V16.4`, sockTrim.shade, 1)).join('') +
  // a hole in the toe
  ellipse(85.6, 79.5, 2.4, 1.7, TILE.mustard, -20) +
  `</g>` +
  // the opening at the top, a shine
  ellipse(46.1, 9.4, 18.4, 2.2, shade(sockWool.shade, -0.35)) +
  ellipse(31.8, 44, 1.6, 7.5, sockWool.light);

const sock: AvatarDef = {
  id: 'sock',
  kind: 'object',
  name: { he: 'גרב בודדה', en: 'Lonely sock' },
  tile: TILE.mustard,
  layers: {
    back: ellipse(58, 92.5, 34, 2.6, shade(TILE.mustard, -0.2)),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 38.5, y: 41 }, right: { x: 55, y: 41 }, r: 5.4, style: 'round' },
    brows: { lift: 1.7, length: 1.7, thickness: 2.2 },
    mouth: { x: 46.75, y: 55, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 47, y: 7 },
  },
  pivot: { x: 48, y: 52 },
  base: 92,
  squash: true,
  motionBias: ['tilt', 'wobble', 'squash', 'nod'],
  gimmicks: [
    {
      id: 'sock',
      z: 'face',
      markup: sockBody,
      anim: {
        // leans out to the left, looks, leans out to the right, looks: where is my pair?
        trigger: ['confused'],
        durationMs: 2800,
        loop: true,
        keyframes: [
          { t: 0 },
          { t: 0.16, x: -2, rotate: -7 },
          { t: 0.4, x: -2, rotate: -7 },
          { t: 0.58, x: 2, rotate: 6 },
          { t: 0.82, x: 2, rotate: 6 },
          { t: 1 },
        ],
        origin: { x: 58, y: 92 },
      },
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Washing machine: the face sits on the porthole glass. Behind it the drum turns the laundry, slowly when
// idle and fast when dizzy, spinning or laughing; the water sloshes when it shakes; bubbles rise when it
// laughs.

const enamel = OBJECT.white;
const glassW = OBJECT.blue.light;
const waterW = mix(OBJECT.blue.base, OBJECT.blue.light, 0.4);
const hub: Pt = [50, 59];
const glassR = 21;
/** The point `dist` from the drum's axle at `deg`. */
const onDrum = (deg: number, dist: number): Pt => {
  const [x = 0, y = 0] = polar(hub[0], hub[1], dist, deg).split(' ').map(Number);
  return [x, y];
};
const waterLevel = 72.5;
const waterHalf = Math.sqrt(glassR ** 2 - (waterLevel - hub[1]) ** 2);
const washBubble = (i: number, at: Pt): GimmickDef => ({
  id: `bubble-${i}`,
  z: 'back',
  rest: 'hidden',
  markup: circle(at[0], at[1], 2.5, OBJECT.white.base) + circle(at[0] - 0.8, at[1] - 0.8, 0.8, glassW),
  anim: {
    ...R.bubble({ rise: 20, ms: 1800 }),
    delayMs: i * 600,
    trigger: ['laugh'],
    origin: { x: at[0], y: at[1] },
  },
});
const [sockAt, towelAt] = [onDrum(72, 17.4), onDrum(104, 17.6)];

const washingMachine: AvatarDef = {
  id: 'washing-machine',
  kind: 'object',
  name: { he: 'מכונת כביסה', en: 'Washing machine' },
  tile: TILE.rose,
  layers: {
    back:
      // feet, the cabinet
      rect(22, 86, 9, 7, CLOTH.charcoal.base, 2) +
      rect(69, 86, 9, 7, CLOTH.charcoal.base, 2) +
      rect(17.6, 11.4, 66, 79, enamel.shade, 8) +
      rect(16.2, 10.1, 66, 79, enamel.base, 8) +
      // the control panel: a drawer, two lights, the dial
      rect(16.2, 24.6, 66, 1.6, enamel.shade) +
      rect(21.5, 14.2, 15, 7, enamel.shade, 1.6) +
      rect(23, 16.6, 12, 1.4, CLOTH.white.shade, 0.7) +
      circle(44, 17.6, 1.9, OBJECT.green.base) +
      circle(50, 17.6, 1.9, OBJECT.gold.base) +
      circle(71.2, 18.2, 5, chrome.shade) +
      circle(70.6, 17.6, 4.4, chrome.base) +
      line('M70.6 17.6L73 15', CLOTH.charcoal.base, 1.4) +
      // the porthole: a steel ring, its inner shade, the glass
      circle(hub[0] + 0.9, hub[1] + 0.9, 27, chrome.shade) +
      circle(hub[0], hub[1], 26.2, chrome.base) +
      circle(hub[0] - 6.5, hub[1] - 15.5, 3, chrome.light) +
      circle(hub[0], hub[1], glassR + 1.2, chrome.shade) +
      circle(hub[0], hub[1], glassR, glassW) +
      // the door handle
      rect(74.6, 52.6, 5, 13, chrome.shade, 2.5) +
      rect(74, 52, 4.4, 12, chrome.light, 2.2),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 55 }, right: { x: 58.5, y: 55 }, r: 5, style: 'round' },
    brows: { lift: 1.75, length: 1.7, thickness: 2.1 },
    mouth: { x: 50, y: 67.5, w: 13 },
    cheeks: { color: FACE.blush, dx: 0.5, dy: 1.4, size: 0.7 },
    halo: { x: 50, y: 6.5 },
  },
  pivot: { x: 50, y: 52 },
  base: 93,
  squash: true,
  motionBias: ['shake', 'spin', 'wobble', 'squash'],
  gimmicks: [
    {
      id: 'water',
      z: 'back',
      markup: path(
        `M${f(hub[0] - waterHalf)} ${waterLevel}A${glassR} ${glassR} 0 0 0 ${f(hub[0] + waterHalf)} ${waterLevel}Z`,
        waterW,
      ),
      anim: [
        { ...R.sway({ angle: 16, ms: 520 }), trigger: ['shake', 'wobble'], origin: { x: hub[0], y: hub[1] } },
        { ...R.sway({ angle: 7, ms: 2600 }), trigger: ['idle'], origin: { x: hub[0], y: hub[1] } },
      ],
    },
    {
      id: 'drum',
      z: 'back',
      markup:
        ellipse(sockAt[0], sockAt[1], 5, 2.3, OBJECT.red.base, -20) +
        ellipse(sockAt[0] + 3.4, sockAt[1] - 1.6, 2, 2.3, OBJECT.red.base, -20) +
        ellipse(towelAt[0], towelAt[1], 4.8, 2.6, OBJECT.gold.base, 26),
      anim: [
        { ...R.spin({ ms: 1000 }), trigger: ['dizzy', 'spin', 'laugh'], origin: { x: hub[0], y: hub[1] } },
        { ...R.spin({ ms: 9000 }), trigger: ['idle'], origin: { x: hub[0], y: hub[1] } },
      ],
    },
    washBubble(0, [34, 70]),
    washBubble(1, [66, 70]),
    washBubble(2, [42, 73]),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Kettle: an enamel whistling kettle with a wooden grip. Steam blasts from the spout and the whistle flutters
// when it is angry; softer steam when it laughs or idles; the lid jumps when it is surprised and rattles when
// it is angry.

const kettleEnamel = CLOTH.mustard;
const kettleBody = 'M24 82Q22 88.5 30 88.5H78Q86 88.5 84 82Q82 54 68 44Q61 40 54 40Q47 40 40 44Q26 54 24 82Z';
const spoutTip: Pt = [12.5, 34.5];
const kettlePuff = (i: number): GimmickDef => ({
  id: `steam-${i}`,
  rest: 'hidden',
  markup:
    circle(spoutTip[0], spoutTip[1], 5, OBJECT.white.base) +
    circle(spoutTip[0] + 4.2, spoutTip[1] - 2, 3.8, OBJECT.white.base) +
    circle(spoutTip[0] - 3.2, spoutTip[1] - 2.8, 3.2, OBJECT.white.base),
  anim: [
    {
      ...R.steam({ rise: 22, ms: 1100 }),
      delayMs: i * 367,
      trigger: ['angry'],
      origin: { x: spoutTip[0], y: spoutTip[1] },
    },
    {
      ...R.steam({ rise: 16, ms: 2400 }),
      delayMs: i * 800,
      trigger: ['laugh', 'idle'],
      origin: { x: spoutTip[0], y: spoutTip[1] },
    },
  ],
});

const kettle: AvatarDef = {
  id: 'kettle',
  kind: 'object',
  name: { he: 'קומקום', en: 'Kettle' },
  tile: TILE.cobalt,
  layers: {
    back:
      // the grip on two posts
      line('M42 43L39.5 25', CLOTH.charcoal.base, 3.6) +
      line('M66 43L68.5 25', CLOTH.charcoal.base, 3.6) +
      rect(33.4, 18.6, 41.6, 8, FUR.tawny.shade, 4) +
      rect(33, 18, 40.6, 6.8, FUR.tawny.base, 3.4) +
      rect(37, 19.6, 14, 1.6, FUR.tawny.light, 0.8) +
      // the spout, rising to the left
      path('M33 73L14.5 44Q12.6 40.6 16 39.6L20 39.4L37 61Z', kettleEnamel.shade) +
      path('M32 72L14 44Q12.4 40.8 15.6 39.8L19 39.6L36 61Z', kettleEnamel.base) +
      // the body, a steel base ring, shine
      rect(23, 84, 62, 6.4, chrome.shade, 3) +
      shaded(kettleBody, kettleEnamel.base, kettleEnamel.shade) +
      rect(25, 80.6, 57, 3, kettleEnamel.shade, 1.5) +
      ellipse(29.5, 63, 2.4, 8.5, kettleEnamel.light, 14),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 45, y: 61 }, right: { x: 63, y: 61 }, r: 5.4, style: 'round' },
    brows: { lift: 1.72, length: 1.7, thickness: 2.2 },
    mouth: { x: 54, y: 74.5, w: 15 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 54, y: 7.5 },
  },
  pivot: { x: 52, y: 62 },
  base: 90.4,
  squash: true,
  motionBias: ['shake', 'bounce', 'squash', 'tilt'],
  gimmicks: [
    {
      id: 'lid',
      z: 'back',
      markup:
        ellipse(54, 41.6, 14, 3.8, kettleEnamel.shade) +
        ellipse(53.4, 40.8, 13.2, 3.2, kettleEnamel.light) +
        circle(54, 36.8, 3.4, CLOTH.charcoal.base) +
        circle(53, 35.8, 1.1, CLOTH.charcoal.light),
      anim: [
        { ...R.lid(), trigger: ['surprised'], origin: { x: 67, y: 41.6 } },
        {
          ...R.lid({ angle: -9, lift: 1.6, ms: 480 }),
          loop: true,
          trigger: ['angry'],
          origin: { x: 67, y: 41.6 },
        },
      ],
    },
    {
      id: 'whistle',
      markup:
        rect(10.2, 36.4, 7.6, 4.6, CLOTH.charcoal.base, 1.6) +
        rect(8.4, 33.6, 5.4, 2.8, CLOTH.charcoal.light, 1.2),
      anim: {
        trigger: ['angry'],
        durationMs: 300,
        loop: true,
        keyframes: [{ t: 0 }, { t: 0.5, rotate: -26 }, { t: 1 }],
        origin: { x: 13.8, y: 36.4 },
      },
    },
    kettlePuff(0),
    kettlePuff(1),
    kettlePuff(2),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Toaster: a retro red toaster with two slices peeking out. They pop up when it is surprised or laughs, one
// a beat after the other; when it is angry, smoke curls out of the slots (burnt!).

const toasterBody = OBJECT.red;
const toasterShape = 'M20 88Q15 88 15 83V58Q15 40.5 33 40.5H67Q85 40.5 85 58V83Q85 88 80 88Z';
const slice = (cx: number, tilt: number) =>
  `<g transform="rotate(${f(tilt)} ${f(cx)} 52)">` +
  path(
    `M${f(cx - 10)} 60V36Q${f(cx - 12.5)} 29 ${f(cx - 5.5)} 28.2Q${f(cx)} 25.4 ${f(cx + 5.5)} 28.2Q${f(cx + 12.5)} 29 ${f(cx + 10)} 36V60Z`,
    FUR.tawny.base,
  ) +
  path(
    `M${f(cx - 7.6)} 60V37Q${f(cx - 9.4)} 31.6 ${f(cx - 4.6)} 31Q${f(cx)} 28.8 ${f(cx + 4.6)} 31Q${f(cx + 9.4)} 31.6 ${f(cx + 7.6)} 37V60Z`,
    FUR.golden.light,
  ) +
  `</g>`;
const smoke = (i: number, x: number): GimmickDef => ({
  id: `smoke-${i}`,
  rest: 'hidden',
  markup:
    circle(x, 30, 4.4, FUR.grey.base) +
    circle(x + 3.6, 28.4, 3.4, FUR.grey.base) +
    circle(x - 3, 27.4, 2.9, FUR.grey.base),
  anim: { ...R.steam({ rise: 18, ms: 1700 }), delayMs: i * 560, trigger: ['angry'], origin: { x, y: 30 } },
});

const toaster: AvatarDef = {
  id: 'toaster',
  kind: 'object',
  name: { he: 'טוסטר', en: 'Toaster' },
  tile: TILE.leaf,
  layers: {
    back:
      rect(23, 86, 8, 6, CLOTH.charcoal.base, 2) +
      rect(69, 86, 8, 6, CLOTH.charcoal.base, 2) +
      shaded(toasterShape, toasterBody.base, toasterBody.shade) +
      // a chrome band, the lever
      rect(13.6, 76, 70, 6.4, chrome.base) +
      rect(13.6, 80.6, 70, 1.8, chrome.shade) +
      rect(84, 56, 6.6, 5.2, CLOTH.charcoal.base, 2) +
      rect(83.6, 52, 2, 14, shade(toasterBody.shade, -0.2), 1) +
      ellipse(22, 55, 2.2, 7, toasterBody.light, 16),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 40.5, y: 57.5 }, right: { x: 59.5, y: 57.5 }, r: 5.6, style: 'round' },
    brows: { lift: 1.7, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 70.5, w: 15 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 7.5 },
  },
  pivot: { x: 50, y: 62 },
  base: 92,
  squash: true,
  motionBias: ['bounce', 'shake', 'squash', 'nod'],
  gimmicks: [
    {
      id: 'toast-left',
      z: 'behind',
      markup: slice(37, -4),
      anim: {
        ...R.popUp({ height: 19, ms: 1300 }),
        trigger: ['surprised', 'laugh'],
        origin: { x: 37, y: 60 },
      },
    },
    {
      id: 'toast-right',
      z: 'behind',
      markup: slice(63, 4),
      anim: {
        ...R.popUp({ height: 16, ms: 1300 }),
        delayMs: 110,
        trigger: ['surprised', 'laugh'],
        origin: { x: 63, y: 60 },
      },
    },
    smoke(0, 37),
    smoke(1, 63),
    smoke(2, 50),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Wall socket: an Israeli (type H) socket whose three holes are its face: the two top holes are the eyes,
// the bottom one the mouth, drawn per expression (at rest the upright earth slot). No brows: it is a plate.
// Sparks fly when it is angry or dizzy.

const plate = OBJECT.white;
const hole = FACE.ink;
const MOUTH_AT: Pt = [50, 61];
const socketMouth: Record<Expression, string> = {
  neutral: rect(47.7, 56.5, 4.6, 9, hole, 2.3),
  smile: path('M41.5 57.5Q50 68.5 58.5 57.5Q50 62 41.5 57.5Z', hole),
  laugh: path('M41 56.5H59Q59.5 69 50 69Q40.5 69 41 56.5Z', hole) + ellipse(50, 66, 5.2, 2.4, FACE.tongue),
  wink: path('M42.5 60Q51.5 66.5 58.5 56.5Q51.5 62 42.5 60Z', hole),
  surprised: ellipse(50, 61.5, 4.4, 5.2, hole),
  sad: path('M42 65Q50 55 58 65Q50 59.5 42 65Z', hole),
  confused: line('M46.5 64L54 57.5', hole, 4.4),
  dizzy: line('M42 61.5Q44 58 46 61.5T50 61.5T54 61.5T58 61.5', hole, 3),
  angry:
    rect(41.5, 57.5, 17, 7, hole, 1.8) +
    path(
      'M43 58.6H57L55.4 61.4L53.8 58.6L52.2 61.4L50.6 58.6L49 61.4L47.4 58.6L45.8 61.4L44.2 58.6Z',
      FACE.teeth,
    ),
  sleepy: circle(50, 61.5, 2.3, hole),
};
const socketArt = Object.fromEntries(
  Object.entries(socketMouth).map(([e, m]) => [e, scaled(1.2, MOUTH_AT, m)]),
) as Record<Expression, string>;
const zap = (i: number, x: number, y: number, flip: 1 | -1): GimmickDef => ({
  id: `zap-${i}`,
  rest: 'hidden',
  markup: scaled(
    1.5,
    [x, y],
    path(
      `M${f(x + flip * 2)} ${f(y - 9)}L${f(x - flip * 4)} ${f(y + 1)}H${f(x)}L${f(x - flip * 3)} ${f(y + 9)}` +
        `L${f(x + flip * 5)} ${f(y - 2)}H${f(x + flip * 1)}L${f(x + flip * 4)} ${f(y - 9)}Z`,
      OBJECT.gold.base,
    ),
  ),
  anim: { ...R.sparks({ ms: 900 }), delayMs: i * 300, trigger: ['angry', 'dizzy'], origin: { x, y } },
});

const wallSocket: AvatarDef = {
  id: 'wall-socket',
  kind: 'object',
  name: { he: 'שקע חשמל', en: 'Wall socket' },
  tile: TILE.slate,
  layers: {
    back:
      // the plate, then the round recess: shade on its upper-left inner wall
      rect(16.4, 16.4, 69, 69, plate.shade, 12) +
      rect(15, 15, 69, 69, plate.base, 12) +
      circle(49.5, 49.5, 27, plate.shade) +
      circle(50.7, 50.7, 25.6, plate.base) +
      ellipse(23.5, 26, 2.2, 5, plate.light, 40),
  },
  face: {
    ink: hole,
    eyes: { left: { x: 40.5, y: 44.5 }, right: { x: 59.5, y: 44.5 }, r: 5.2, style: 'dot' },
    brows: false,
    mouth: false,
    cheeks: { color: FACE.blush, dx: 0.6, dy: 1.6, size: 0.85 },
    halo: { x: 50, y: 9 },
    art: { default: socketArt.neutral, ...socketArt },
  },
  pivot: { x: 50, y: 50 },
  base: 85,
  squash: true,
  motionBias: ['shake', 'nod', 'tilt', 'squash'],
  gimmicks: [zap(0, 9.5, 37, 1), zap(1, 90.5, 65, -1)],
};

// ---------------------------------------------------------------------------------------------------------
// Dish sponge: a yellow sponge with a green scrubber on top, a little foam on it. Soap bubbles rise when it
// laughs; it drips when it is sad or squeezed.

const spongeY = OBJECT.gold;
const scrub = CLOTH.forest;
const spongeFront = 'M16 46Q16 42 20 42H70Q73 42 73 46V84Q73 88 69 88H20Q16 88 16 84Z';
const spongeSide = 'M72 42L84 31V77Q84 80 81.5 82L72 88Z';
const scrubFront = 'M16 34Q16 32 18 32H71Q73 32 73 34V43H16Z';
const scrubTop = 'M16 32.4L28.5 21H84L72.5 32.4Z';
const scrubSide = 'M72.5 32.4L84 21V31.6L72.5 43Z';
const pore = (x: number, y: number, s = 1) => ellipse(x, y, 1.5 * s, 1.1 * s, spongeY.shade);
const soapBubble = (i: number, at: Pt): GimmickDef => ({
  id: `bubble-${i}`,
  rest: 'hidden',
  markup:
    circle(at[0], at[1], 3, OBJECT.white.base) +
    circle(at[0], at[1], 2.1, mix(OBJECT.blue.light, OBJECT.white.base, 0.5)) +
    circle(at[0] - 1, at[1] - 1, 0.8, OBJECT.white.base),
  anim: {
    ...R.bubble({ rise: 16, ms: 1700 }),
    delayMs: i * 570,
    trigger: ['laugh'],
    origin: { x: at[0], y: at[1] },
  },
});
const spongeDrip = (i: number, x: number): GimmickDef => ({
  id: `drip-${i}`,
  rest: 'hidden',
  markup: drop([x, 88.5], 1.9, FACE.tear),
  anim: {
    ...R.drip({ fall: 7, ms: 1100 }),
    delayMs: i * 460,
    trigger: ['sad', 'squash'],
    origin: { x, y: 88.5 },
  },
});

const sponge: AvatarDef = {
  id: 'sponge',
  kind: 'object',
  name: { he: 'ספוג כלים', en: 'Dish sponge' },
  tile: TILE.orchid,
  layers: {
    back:
      // the sponge: the side in shade, the front face
      path(spongeSide, spongeY.shade) +
      path(spongeFront, spongeY.base) +
      // pores, kept off the face
      pore(21, 48) +
      pore(26.5, 84, 0.8) +
      pore(67.5, 48.5, 0.9) +
      pore(66, 83.5) +
      pore(19.6, 70, 0.8) +
      pore(69, 67, 0.8) +
      pore(78, 52, 0.8) +
      pore(79, 70) +
      // the scrubber: top, front, side
      path(scrubTop, scrub.light) +
      path(scrubFront, scrub.base) +
      path(scrubSide, scrub.shade) +
      [22, 31, 40, 49, 58, 67].map((x) => line(`M${x} 35.5L${x + 3} 39.5`, scrub.shade, 1.1)).join('') +
      // foam on top
      circle(36, 24, 4.4, OBJECT.white.shade) +
      circle(35.4, 23.4, 4, OBJECT.white.base) +
      circle(42.5, 25.4, 3.2, OBJECT.white.base) +
      circle(64, 23.8, 2.6, OBJECT.white.base) +
      ellipse(20, 62, 1.6, 8, spongeY.light),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 35.5, y: 60.5 }, right: { x: 53.5, y: 60.5 }, r: 5.5, style: 'round' },
    brows: { lift: 1.65, length: 1.7, thickness: 2.2 },
    mouth: { x: 44.5, y: 74, w: 15 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 8 },
  },
  pivot: { x: 50, y: 58 },
  base: 88,
  squash: true,
  motionBias: ['squash', 'bounce', 'wobble'],
  gimmicks: [
    soapBubble(0, [33, 22]),
    soapBubble(1, [52, 20]),
    soapBubble(2, [70, 22]),
    spongeDrip(0, 30),
    spongeDrip(1, 58),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Pillow: a soft pillow with pinched corners and a sleep mask pushed up on its forehead. It breathes slowly
// when idle and deeper when sleepy, when it yawns (its own mouth: a big yawn over the rig's). Feathers fly
// out when it laughs or is surprised.

const pillowCloth = {
  base: mix(OBJECT.blue.light, OBJECT.white.base, 0.62),
  shade: mix(OBJECT.blue.light, OBJECT.white.base, 0.28),
  light: OBJECT.white.base,
};
/** Pinched corners, the edges pulled in between them. */
const pillowShape =
  'M13 21Q15.5 18.5 19 19.6Q50 27 81 19.6Q84.5 18.5 87 21Q89 24 87.6 27.4Q80.5 54 87.6 80.6Q89 84 87 87Q84.5 89.5 81 88.4' +
  'Q50 81 19 88.4Q15.5 89.5 13 87Q11 84 12.4 80.6Q19.5 54 12.4 27.4Q11 24 13 21Z';
const mask = OBJECT.pink;
const feather = (x: number, y: number, deg: number) =>
  `<g transform="rotate(${f(deg)} ${f(x)} ${f(y)})">` +
  path(
    `M${f(x)} ${f(y - 6)}Q${f(x + 3.4)} ${f(y - 1)} ${f(x)} ${f(y + 5)}Q${f(x - 3.4)} ${f(y - 1)} ${f(x)} ${f(y - 6)}Z`,
    OBJECT.white.base,
  ) +
  line(`M${f(x)} ${f(y - 4)}V${f(y + 6.5)}`, OBJECT.white.shade, 0.8) +
  `</g>`;
const featherFloat = (dir: 1 | -1): GimmickKeyframe[] => [
  { t: 0, opacity: 0 },
  { t: 0.12, x: dir * 3, y: -5, rotate: dir * 10, opacity: 1 },
  { t: 0.4, x: dir * 5, y: -2, rotate: dir * -18 },
  { t: 0.68, x: dir * 3, y: 4, rotate: dir * 14 },
  { t: 0.9, x: dir * 5, y: 9, rotate: dir * -8, opacity: 1 },
  { t: 1, x: dir * 5, y: 11, opacity: 0 },
];
const yawn =
  path('M44.6 63.8Q50 58.8 55.4 63.8Q56.6 73.6 50 74Q43.4 73.6 44.6 63.8Z', FACE.mouth) +
  ellipse(50, 71.4, 3.8, 2, FACE.tongue);

const pillow: AvatarDef = {
  id: 'pillow',
  kind: 'object',
  name: { he: 'כרית', en: 'Pillow' },
  tile: TILE.berry,
  layers: { back: '' },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 40, y: 55 }, right: { x: 60, y: 55 }, r: 4.4, style: 'dot' },
    brows: { lift: 1.9, length: 2.1, thickness: 2 },
    mouth: { x: 50, y: 67, w: 13 },
    cheeks: { color: FACE.blush, dx: 0.6, dy: 1.45, size: 0.85 },
    halo: { x: 50, y: 10 },
    art: { default: '', sleepy: yawn },
  },
  pivot: { x: 50, y: 54 },
  base: 88.5,
  squash: true,
  motionBias: ['squash', 'wobble', 'nod'],
  gimmicks: [
    {
      id: 'pillow',
      z: 'face',
      markup:
        shaded(pillowShape, pillowCloth.base, pillowCloth.shade, -1.6, -1.6) +
        // creases from the pinched corners
        line('M17.5 24Q22.5 27.5 24.5 32', pillowCloth.shade, 1.4) +
        line('M82.5 24Q77.5 27.5 75.5 32', pillowCloth.shade, 1.4) +
        line('M17.5 84Q22.5 80.5 24.5 76', pillowCloth.shade, 1.4) +
        line('M82.5 84Q77.5 80.5 75.5 76', pillowCloth.shade, 1.4) +
        // the sleep mask, pushed up
        line('M18 35Q50 27.5 82 35', mask.shade, 2) +
        path(
          'M33.5 33Q41.5 28.8 49 32.2Q50 32.8 51 32.2Q58.5 28.8 66.5 33Q67 39.6 59 40Q53 39.8 50 37.4Q47 39.8 41 40Q33 39.6 33.5 33Z',
          mask.base,
        ) +
        line('M37.5 35.4Q41 37.2 44.5 35.4M55.5 35.4Q59 37.2 62.5 35.4', mask.shade, 1.2) +
        ellipse(24, 50, 2, 7, pillowCloth.light, 6),
      anim: [
        {
          trigger: ['sleepy'],
          durationMs: 3600,
          loop: true,
          keyframes: breathe(1.04, 0.95),
          origin: { x: 50, y: 88 },
        },
        {
          trigger: ['idle'],
          durationMs: 4200,
          loop: true,
          keyframes: breathe(1.02, 0.975),
          origin: { x: 50, y: 88 },
        },
      ],
    },
    {
      id: 'feather-1',
      rest: 'hidden',
      markup: feather(85, 22, 30),
      anim: {
        trigger: ['laugh', 'surprised'],
        durationMs: 2400,
        loop: true,
        keyframes: featherFloat(1),
        origin: { x: 85, y: 22 },
      },
    },
    {
      id: 'feather-2',
      rest: 'hidden',
      markup: feather(15, 22, -30),
      anim: {
        trigger: ['laugh', 'surprised'],
        durationMs: 2400,
        delayMs: 900,
        loop: true,
        keyframes: featherFloat(-1),
        origin: { x: 15, y: 22 },
      },
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Lava lamp: a glass of yellow liquid on a metal cone, red wax pooled at the bottom and stuck under the cap.
// When it idles the blobs drift up and down behind the face; faster when it laughs, is dizzy or spins.

const lampMetal = OBJECT.purple;
const liquid = { base: OBJECT.gold.light, shade: mix(OBJECT.gold.light, OBJECT.gold.base, 0.6) };
const wax = { base: OBJECT.red.base, light: OBJECT.red.light };
const lampGlass =
  'M39 19H61Q62.6 19 63 20.6L74.8 67.6Q76 73 70.6 73H29.4Q24 73 25.2 67.6L37 20.6Q37.4 19 39 19Z';
/** A soft wax blob, a little taller than wide, with a glint. */
const blob = (cx: number, cy: number, rx: number, ry: number) =>
  path(
    `M${f(cx)} ${f(cy - ry)}C${f(cx + rx * 0.8)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ry * 0.2)} ${f(cx + rx)} ${f(cy + ry * 0.25)}` +
      `C${f(cx + rx)} ${f(cy + ry * 0.8)} ${f(cx + rx * 0.5)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)}` +
      `C${f(cx - rx * 0.5)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ry * 0.8)} ${f(cx - rx)} ${f(cy + ry * 0.25)}` +
      `C${f(cx - rx)} ${f(cy - ry * 0.2)} ${f(cx - rx * 0.8)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)}Z`,
    wax.base,
  ) + ellipse(cx - rx * 0.35, cy - ry * 0.35, rx * 0.28, ry * 0.24, wax.light, -20);
/** A blob's slow loop: out by (dx, dy), stretched `s` times taller (and thinner) on the way, and back. */
const drift = (dx: number, dy: number, s: number): GimmickKeyframe[] => [
  { t: 0 },
  { t: 0.5, x: dx, y: dy, sx: 1 / s, sy: s },
  { t: 1 },
];

const lavaLamp: AvatarDef = {
  id: 'lava-lamp',
  kind: 'object',
  name: { he: 'מנורת לבה', en: 'Lava lamp' },
  tile: TILE.sky,
  layers: {
    back:
      // the cap
      path('M43.5 8.5H56.5Q58 8.5 58.5 10L61.6 19.6H38.4L41.5 10Q42 8.5 43.5 8.5Z', lampMetal.shade) +
      path('M43.5 8.5H55Q56.5 8.5 57 10L59.8 18.4H38.4L41.5 10Q42 8.5 43.5 8.5Z', lampMetal.base) +
      // the glass
      shaded(lampGlass, liquid.base, liquid.shade, -1.6, 0) +
      // the pool of wax at the bottom
      path(
        'M26 69.5Q29.5 63.5 37 64Q43 61.5 49 64Q56 61 62 63.6Q70 62.4 74 68.5L74.6 70.6Q74.4 73 70.6 73H29.4Q25.6 73 25.4 70.6Z',
        wax.base,
      ) +
      ellipse(34, 66, 2.6, 0.9, wax.light, -6) +
      // the base: a cone, wider at the bottom
      path('M30.5 72.5H69.5L76.6 90.2Q77.5 93.5 73.6 93.5H26.4Q22.5 93.5 23.4 90.2Z', lampMetal.shade) +
      path('M30.5 72.5H68.4L75 89.6Q75.6 92 73 92H26.4Q22.8 92 23.6 89.4Z', lampMetal.base) +
      rect(29.4, 72.2, 41.2, 2.4, shade(lampMetal.shade, -0.18), 1.2) +
      ellipse(30.5, 83, 1.5, 6, lampMetal.light, 21) +
      ellipse(40.6, 28.5, 1.2, 6, OBJECT.white.base, 14),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 42.5, y: 46 }, right: { x: 57.5, y: 46 }, r: 4.5, style: 'dot' },
    brows: { lift: 1.85, length: 2.1, thickness: 2 },
    mouth: { x: 50, y: 58, w: 13 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 5.5 },
  },
  pivot: { x: 50, y: 52 },
  base: 93.5,
  squash: true,
  motionBias: ['wobble', 'tilt', 'spin', 'squash'],
  gimmicks: [
    {
      id: 'blob-rise',
      z: 'back',
      markup: blob(34.5, 61.5, 4.4, 5.2),
      anim: [
        {
          trigger: ['idle'],
          durationMs: 8000,
          loop: true,
          keyframes: drift(8, -33, 1.15),
          origin: { x: 34.5, y: 61.5 },
        },
        {
          trigger: ['laugh', 'dizzy', 'spin'],
          durationMs: 2600,
          loop: true,
          keyframes: drift(8, -33, 1.15),
          origin: { x: 34.5, y: 61.5 },
        },
      ],
    },
    {
      id: 'blob-top',
      z: 'back',
      markup: blob(51, 23.8, 7.6, 3.4),
      anim: [
        {
          trigger: ['idle'],
          durationMs: 6400,
          loop: true,
          keyframes: drift(0, 5, 1.3),
          origin: { x: 51, y: 21 },
        },
        {
          trigger: ['laugh', 'dizzy', 'spin'],
          durationMs: 2000,
          loop: true,
          keyframes: drift(0, 5, 1.3),
          origin: { x: 51, y: 21 },
        },
      ],
    },
  ],
};

export const HOME: readonly AvatarDef[] = [
  showerHead,
  slipper,
  sock,
  washingMachine,
  kettle,
  toaster,
  wallSocket,
  sponge,
  pillow,
  lavaLamp,
];
