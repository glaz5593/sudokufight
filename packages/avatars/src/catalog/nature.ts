/**
 * Weather, sky and earth (kind `nature`): a rain cloud, a lightning bolt, the sun, the moon, a volcano, a rock
 * with a moustache, a mushroom, a sea wave and a comet. Two things from the boxing ring live here too, as kind
 * `object`: the ring bell and the trophy.
 *
 * Read docs/avatars/STYLE.md first. Shared drawing helpers: ./draw.ts; gimmick recipes: ../gimmick.ts. Add each
 * character's AvatarDef here and append it to the list below: catalog/index.ts already includes this list.
 */

import { GIMMICK_RECIPES as R } from '../gimmick';
import { FACE, FUR, HAIR, mix, OBJECT, shade, TILE } from '../palette';
import { f } from '../svg';
import type { AvatarDef, GimmickAnim, GimmickDef, GimmickKeyframe } from '../types';
import { circle, ellipse, lerp, line, mirrored, P, path, rect, shaded, sx, type Pt } from './draw';

// ---------------------------------------------------------------------------------------------------------
// Helpers for this file

/** A point on a circle (0° = right, 90° = down), as a tuple. */
const on = (cx: number, cy: number, r: number, deg: number): Pt => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

/** A closed polygon whose corners are rounded: each corner is cut up to `cut` units along its two edges. */
const roundPoly = (pts: readonly Pt[], cut: number): string => {
  const at = (i: number): Pt => pts[(i + pts.length) % pts.length] ?? [0, 0];
  const toward = (a: Pt, b: Pt): Pt => lerp(a, b, Math.min(0.45, cut / Math.hypot(b[0] - a[0], b[1] - a[1])));
  return (
    pts
      .map((p, i) => `${i ? 'L' : 'M'}${P(toward(p, at(i - 1)))}Q${P(p)} ${P(toward(p, at(i + 1)))}`)
      .join('') + 'Z'
  );
};

/** A drop (the rig's tear shape), centred on its round part. */
const drop = (x: number, y: number, s: number, fill: string): string =>
  path(
    `M${P([x, y - 1.6 * s])}C${P([x + 0.35 * s, y - s])} ${P([x + s, y - 0.45 * s])} ${P([x + s, y + 0.1 * s])}` +
      `A${f(s)} ${f(s)} 0 0 1 ${P([x - s, y + 0.1 * s])}C${P([x - s, y - 0.45 * s])} ${P([x - 0.35 * s, y - s])} ${P([x, y - 1.6 * s])}Z`,
    fill,
  );

/** A four-point sparkle of radius `s`. */
const sparkle = (x: number, y: number, s: number, fill: string): string => {
  const k = 0.2 * s;
  return path(
    `M${P([x, y - s])}Q${P([x + k, y - k])} ${P([x + s, y])}Q${P([x + k, y + k])} ${P([x, y + s])}` +
      `Q${P([x - k, y + k])} ${P([x - s, y])}Q${P([x - k, y - k])} ${P([x, y - s])}Z`,
    fill,
  );
};

/** A puff of smoke or steam: three overlapping balls. */
const puffShape = (x: number, y: number, s: number, fill: string): string =>
  circle(x, y, 1.3 * s, fill) +
  circle(x + 1.15 * s, y - 0.5 * s, s, fill) +
  circle(x - 0.9 * s, y - 0.75 * s, 0.85 * s, fill);

/**
 * A blob thrown up and out in an arc, landing `dx` to the side (lava, spray). Loop; hidden at both ends, so it
 * needs `rest: 'hidden'`.
 */
const arcKeyframes = (dx: number, rise: number): GimmickKeyframe[] => [
  { t: 0, sx: 0.5, sy: 0.5, opacity: 0, ease: 'standard' },
  { t: 0.1, x: 0.12 * dx, y: -0.3 * rise, opacity: 1, ease: 'standard' },
  { t: 0.45, x: 0.55 * dx, y: -rise, ease: 'exit' },
  { t: 0.85, x: 0.92 * dx, y: -0.15 * rise, sx: 0.9, sy: 0.9 },
  { t: 1, x: dx, y: 0.15 * rise, sx: 0.7, sy: 0.7, opacity: 0 },
];

/** A part that comes and goes in place: fades in, holds, fades out (a flash, a glint). Hidden at the seam. */
const blinkKeyframes = (on1: number, off: number): GimmickKeyframe[] => [
  { t: 0, sx: 0.4, sy: 0.4, opacity: 0, ease: 'emphasized' },
  { t: on1, sx: 1, sy: 1, opacity: 1 },
  { t: off, sx: 0.9, sy: 0.9, opacity: 1, ease: 'exit' },
  { t: Math.min(0.99, off + 0.12), sx: 0.3, sy: 0.3, opacity: 0 },
  { t: 1, sx: 0.3, sy: 0.3, opacity: 0 },
];

/** The anchors every object here shares (STYLE.md §3, the 8's proportions). */
const OBJ_BROWS = { lift: 1.75, length: 1.7, thickness: 2.2 } as const;
const OBJ_CHEEKS = { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 } as const;

// ---------------------------------------------------------------------------------------------------------
// Rain cloud: a heavy grey cloud that cries real rain when it is sad, pours when it is angry, and lets one
// drop go now and then when it idles.

const rain = {
  base: OBJECT.steel.light,
  shade: OBJECT.steel.base,
  light: OBJECT.white.base,
};
/** The cloud as balls over a flat bottom (y 68.5). */
const rainLobes: readonly (readonly [number, number, number])[] = [
  [28, 52.5, 16],
  [47, 37.5, 20.5],
  [67, 43.5, 17],
  [78, 55, 13.5],
];
const cloudBody = (fill: string) =>
  rainLobes.map(([x, y, r]) => circle(x, y, r, fill)).join('') + rect(28, 48, 50, 20.5, fill);

/** Three drops hang under the cloud: they fall when it is sad, pour when it is angry, and one lets go now and then. */
const RAIN_DROPS: readonly Pt[] = [
  [34, 78],
  [50, 83],
  [66, 78],
];
const rainDrop = (i: number): GimmickDef => {
  const [x, y] = RAIN_DROPS[i] ?? [50, 80];
  const origin = { x, y };
  return {
    id: `drop-${i}`,
    markup: drop(x, y, 2.7, FACE.tear),
    anim: [
      { ...R.drip({ fall: 12, ms: 1100 }), delayMs: i * 370, trigger: ['sad'], origin },
      { ...R.drip({ fall: 12, ms: 560 }), delayMs: i * 190, trigger: ['angry'], origin },
      {
        // now and then one lets go, and a new one forms
        trigger: ['idle'],
        durationMs: 6000,
        loop: true,
        delayMs: i * 2000,
        keyframes: [
          { t: 0 },
          { t: 0.62, ease: 'exit' },
          { t: 0.72, y: 12, sy: 1.15 },
          { t: 0.76, y: 13, sx: 1.4, sy: 0.4, opacity: 0 },
          { t: 0.8, sx: 0.3, sy: 0.3, opacity: 0, ease: 'standard' },
          { t: 0.95, opacity: 1 },
          { t: 1 },
        ],
        origin,
      },
    ],
  };
};

const rainCloud: AvatarDef = {
  id: 'rain-cloud',
  kind: 'nature',
  name: { he: 'ענן גשם', en: 'Rain cloud' },
  tile: TILE.cobalt,
  layers: {
    back:
      cloudBody(rain.shade) +
      `<g transform="translate(-1.6 -1.6)">${cloudBody(rain.base)}</g>` +
      // a darker, rain-heavy belly, and highlights on the top lobes
      path(
        'M28 68.5H78Q86 68.5 89.5 62Q86 66.4 78 66.4H28Q19 66.4 14.5 60.5Q17.5 68.5 28 68.5Z',
        rain.shade,
      ) +
      line(
        `M${P(on(45.4, 35.9, 14.5, 200))}A14.5 14.5 0 0 1 ${P(on(45.4, 35.9, 14.5, 250))}`,
        rain.light,
        3.2,
      ) +
      ellipse(18.5, 50, 2, 4.2, rain.light, 25),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 48.5 }, right: { x: 58.5, y: 48.5 }, r: 4.7, style: 'dot' },
    brows: { lift: 1.9, length: 2.1, thickness: 2 },
    mouth: { x: 50, y: 60.5, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.6, dy: 1.45, size: 0.8 },
    halo: { x: 47, y: 9 },
  },
  pivot: { x: 50, y: 50 },
  base: 87,
  squash: true,
  motionBias: ['wobble', 'bounce', 'squash', 'tilt'],
  gimmicks: [rainDrop(0), rainDrop(1), rainDrop(2)],
};

// ---------------------------------------------------------------------------------------------------------
// Lightning bolt: a fat zigzag, all nerves. It crackles with sparks, and the whole bolt flashes white when it
// is angry or startled. The face sits on the upper part, the mouth on the step.

const bolt = OBJECT.gold;
const boltShape = roundPoly(
  [
    [34, 8],
    [74, 8],
    [62, 38],
    [80, 38],
    [36, 95],
    [44, 57],
    [20, 57],
  ],
  3,
);
/** An electric crackle: a short zigzag, white over a pale gold glow, turned `deg`. */
const zig = (x: number, y: number, s: number, deg: number) => {
  const d =
    `M${P([x - s, y + 0.15 * s])}L${P([x - 0.35 * s, y - 0.5 * s])}L${P([x + 0.05 * s, y + 0.45 * s])}` +
    `L${P([x + 0.5 * s, y - 0.4 * s])}L${P([x + s, y + 0.2 * s])}`;
  return (
    `<g transform="rotate(${f(deg)} ${f(x)} ${f(y)})">` +
    line(d, bolt.light, 4.4) +
    line(d, OBJECT.white.base, 2) +
    `</g>`
  );
};
const boltSpark = (i: number, x: number, y: number, deg: number): GimmickDef => ({
  id: `spark-${i}`,
  rest: 'hidden',
  markup: zig(x, y, 6.5, deg),
  anim: [
    {
      ...R.sparks({ ms: 700 }),
      delayMs: i * 230,
      trigger: ['angry', 'surprised', 'shake'],
      origin: { x, y },
    },
    { ...R.sparks({ ms: 900 }), delayMs: i * 300, trigger: ['laugh', 'dizzy'], origin: { x, y } },
    { ...R.sparks({ ms: 2600 }), delayMs: i * 870, trigger: ['idle'], origin: { x, y } },
  ],
});
const flash: GimmickKeyframe[] = [
  { t: 0, opacity: 0 },
  { t: 0.06, opacity: 0.95 },
  { t: 0.14, opacity: 0.1 },
  { t: 0.22, opacity: 0.85 },
  { t: 0.36, opacity: 0 },
  { t: 1, opacity: 0 },
];

const lightning: AvatarDef = {
  id: 'lightning',
  kind: 'nature',
  name: { he: 'ברק', en: 'Lightning' },
  tile: TILE.slate,
  layers: {
    back:
      shaded(boltShape, bolt.base, bolt.shade, -1.6, -1.4) +
      // a glint down the left edge of the top
      line('M31.5 15L25.5 37', bolt.light, 3),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 37.5, y: 32 }, right: { x: 54.5, y: 32 }, r: 5.2, style: 'round' },
    brows: OBJ_BROWS,
    mouth: { x: 47, y: 46, w: 14 },
    cheeks: OBJ_CHEEKS,
    halo: { x: 53, y: 6 },
  },
  pivot: { x: 50, y: 48 },
  base: 95,
  motionBias: ['shake', 'bounce', 'spin', 'flip'],
  gimmicks: [
    {
      id: 'flash',
      z: 'back',
      rest: 'hidden',
      markup: path(boltShape, mix(bolt.light, OBJECT.white.base, 0.7), ' transform="translate(-1.6 -1.4)"'),
      anim: [
        {
          durationMs: 1300,
          loop: true,
          ease: 'linear',
          keyframes: flash,
          trigger: ['angry'],
          origin: { x: 50, y: 50 },
        },
        {
          durationMs: 900,
          ease: 'linear',
          keyframes: flash,
          trigger: ['surprised', 'shake'],
          origin: { x: 50, y: 50 },
        },
      ],
    },
    boltSpark(0, 17, 25, -62),
    boltSpark(1, 87, 52, 58),
    boltSpark(2, 21, 79, 64),
    boltSpark(3, 63, 85, -55),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Sun: a round sun with its sunglasses pushed up on its head. Smiling, it slides them down (cool); sleepy, it
// slides them down for a nap. Its rays turn slowly while it idles, and fast when it laughs.

const sunDisc = OBJECT.gold;
const sunRay = OBJECT.orange;
const shadesInk = HAIR.black;
const SUN: Pt = [50, 55];
const sunRays = Array.from({ length: 12 }, (_, i) => {
  const deg = -90 + i * 30;
  const tip = on(SUN[0], SUN[1], i % 2 ? 34.5 : 39, deg);
  return path(
    roundPoly([on(SUN[0], SUN[1], 25, deg - 10), tip, on(SUN[0], SUN[1], 25, deg + 10)], 2.4),
    sunRay.base,
  );
}).join('');
/** A lens: flat on top, round below, with a glint. */
const lens = (cx: number, cy: number) =>
  path(
    `M${P([cx - 6.6, cy - 5.6])}H${f(cx + 6.6)}Q${P([cx + 7.6, cy - 5.6])} ${P([cx + 7.5, cy - 4])}` +
      `Q${P([cx + 7.2, cy + 5.8])} ${P([cx, cy + 5.8])}Q${P([cx - 7.2, cy + 5.8])} ${P([cx - 7.5, cy - 4])}` +
      `Q${P([cx - 7.6, cy - 5.6])} ${P([cx - 6.6, cy - 5.6])}Z`,
    shadesInk.base,
  ) +
  path(`M${P([cx - 4.6, cy - 2.6])}L${P([cx - 1.2, cy - 2.6])}L${P([cx - 3.8, cy + 2.4])}Z`, shadesInk.light);
/** The sunglasses rest on the forehead, and slide down by exactly this much to sit on the eyes. */
const SHADES_Y = 34;
const SUN_EYES = 58.5;

const sun: AvatarDef = {
  id: 'sun',
  kind: 'nature',
  name: { he: 'שמש', en: 'Sun' },
  tile: TILE.leaf,
  layers: {
    back:
      circle(SUN[0], SUN[1], 26, sunDisc.shade) +
      circle(SUN[0] - 1.3, SUN[1] - 1.3, 24.6, sunDisc.base) +
      ellipse(30, 55, 2.4, 6.4, sunDisc.light, 14),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: SUN_EYES }, right: { x: 58.5, y: SUN_EYES }, r: 5.4, style: 'round' },
    brows: OBJ_BROWS,
    mouth: { x: 50, y: 72, w: 15 },
    cheeks: OBJ_CHEEKS,
    halo: { x: 50, y: 9 },
  },
  pivot: { x: 50, y: 55 },
  base: 94,
  squash: true,
  motionBias: ['spin', 'bounce', 'squash', 'nod'],
  gimmicks: [
    {
      id: 'rays',
      z: 'behind',
      markup: sunRays,
      anim: [
        { ...R.spin({ ms: 2600 }), trigger: ['laugh', 'dizzy'], origin: { x: SUN[0], y: SUN[1] } },
        { ...R.spin({ ms: 36000 }), trigger: ['idle'], origin: { x: SUN[0], y: SUN[1] } },
      ],
    },
    {
      id: 'shades',
      markup:
        // the bridge, the two lenses, and the arms running back over the head
        line(
          `M${P([46, SHADES_Y - 3.4])}Q50 ${f(SHADES_Y - 5.6)} ${P([54, SHADES_Y - 3.4])}`,
          shadesInk.base,
          2.2,
        ) +
        mirrored((s) =>
          line(`M${P([sx(s, 15.5), SHADES_Y - 4])}L${P([sx(s, 21.5), SHADES_Y - 6.5])}`, shadesInk.base, 2.2),
        ) +
        lens(41.5, SHADES_Y) +
        lens(58.5, SHADES_Y),
      anim: {
        trigger: ['smile', 'sleepy'],
        durationMs: 650,
        keyframes: [
          { t: 0, ease: 'standard' },
          { t: 0.75, y: SUN_EYES - SHADES_Y + 0.6 },
          { t: 0.88, y: SUN_EYES - SHADES_Y - 0.3 },
          { t: 1, y: SUN_EYES - SHADES_Y },
        ],
        origin: { x: 50, y: SHADES_Y },
      },
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Moon: a fat crescent in a night cap, always about to yawn. The face sits on the thick part; the z's float in
// the bite. When sleepy it yawns, and now and then it yawns when it idles; the pompom sways.

const moon = {
  base: mix(OBJECT.gold.light, OBJECT.cream.base, 0.5),
  shade: mix(OBJECT.gold.base, OBJECT.cream.shade, 0.5),
  light: OBJECT.white.base,
};
const cap = OBJECT.blue;
const capStar = OBJECT.gold;
/** The crescent: a disc (46, 55, r 33) with a bite (74, 38, r 24) out of its upper right. */
const crescent = (() => {
  const [x1, y1, r1, x2, y2, r2] = [46, 55, 33, 74, 38, 24];
  const d = Math.hypot(x2 - x1, y2 - y1);
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(r1 * r1 - a * a);
  const ux = (x2 - x1) / d;
  const uy = (y2 - y1) / d;
  const m: Pt = [x1 + a * ux, y1 + a * uy];
  const top: Pt = [m[0] + h * uy, m[1] - h * ux];
  const tip: Pt = [m[0] - h * uy, m[1] + h * ux];
  return `M${P(top)}A${r1} ${r1} 0 1 0 ${P(tip)}A${r2} ${r2} 0 0 1 ${P(top)}Z`;
})();
/** A crater: a dent in shade, its floor a little lighter, lit from the upper left. */
const crater = (x: number, y: number, r: number, surface: { base: string; shade: string }) =>
  circle(x, y, r, surface.shade) +
  circle(x + 0.15 * r, y + 0.35 * r, 0.7 * r, mix(surface.base, surface.shade, 0.45));
const MOON_MOUTH: Pt = [36.5, 70.5];

const moonChar: AvatarDef = {
  id: 'moon',
  kind: 'nature',
  name: { he: 'ירח', en: 'Moon' },
  tile: TILE.violet,
  layers: {
    back:
      shaded(crescent, moon.base, moon.shade) +
      crater(20, 72, 3.4, moon) +
      crater(57, 79, 4.2, moon) +
      crater(67, 66, 2.6, moon) +
      // the night cap: a long stocking cap whose tail flops down into the bite, with stars on it
      path('M16.5 38C15 21 29 9.5 46 9.5C62 9.5 74 19 77.5 38C72.5 28 64 22.5 55.5 22Z', cap.shade) +
      path('M16.5 38C15.5 22.5 29 11 45.5 11C60 11 70.5 19.5 74.6 33C69 26 62 22.4 55.5 22Z', cap.base) +
      sparkle(31, 24, 3, capStar.light) +
      sparkle(47, 16.5, 2.4, capStar.light) +
      sparkle(62.5, 18.5, 1.9, capStar.light) +
      line('M16.4 39.8L56.4 21', cap.light, 4.6),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 28.5, y: 57 }, right: { x: 44.5, y: 57 }, r: 4.6, style: 'dot' },
    brows: { lift: 1.9, length: 2.1, thickness: 2 },
    mouth: { x: MOON_MOUTH[0], y: MOON_MOUTH[1], w: 13 },
    cheeks: { color: FACE.blush, dx: 0.6, dy: 1.45, size: 0.8 },
    halo: { x: 40, y: 8 },
  },
  pivot: { x: 46, y: 55 },
  base: 88,
  motionBias: ['tilt', 'nod', 'wobble', 'flip'],
  gimmicks: [
    {
      id: 'pompom',
      markup: circle(77.4, 40.6, 4.8, capStar.base) + circle(76.8, 40, 4.1, capStar.light),
      anim: [
        { ...R.sway({ angle: 26, ms: 3000 }), trigger: ['idle', 'sleepy'], origin: { x: 76.5, y: 35.5 } },
        {
          ...R.sway({ angle: 40, ms: 700 }),
          trigger: ['laugh', 'dizzy', 'shake'],
          origin: { x: 76.5, y: 35.5 },
        },
      ],
    },
    {
      id: 'yawn',
      rest: 'hidden',
      markup:
        ellipse(MOON_MOUTH[0], MOON_MOUTH[1] + 3.6, 4.4, 5.8, FACE.mouth) +
        ellipse(MOON_MOUTH[0], MOON_MOUTH[1] + 7, 3, 2.2, FACE.tongue),
      anim: [
        {
          trigger: ['sleepy'],
          durationMs: 4200,
          loop: true,
          keyframes: [
            { t: 0, sx: 0.3, sy: 0.2, opacity: 0 },
            { t: 0.08, sx: 0.35, sy: 0.3, opacity: 1, ease: 'standard' },
            { t: 0.32, sx: 1, sy: 1 },
            { t: 0.56, sx: 1.04, sy: 1.08 },
            { t: 0.72, sx: 0.45, sy: 0.3 },
            { t: 0.78, sx: 0.3, sy: 0.2, opacity: 0 },
            { t: 1, sx: 0.3, sy: 0.2, opacity: 0 },
          ],
          origin: { x: MOON_MOUTH[0], y: MOON_MOUTH[1] },
        },
        {
          trigger: ['idle'],
          durationMs: 9000,
          loop: true,
          keyframes: [
            { t: 0, sx: 0.3, sy: 0.2, opacity: 0 },
            { t: 0.6, sx: 0.3, sy: 0.2, opacity: 0 },
            { t: 0.63, sx: 0.35, sy: 0.3, opacity: 1, ease: 'standard' },
            { t: 0.74, sx: 1, sy: 1 },
            { t: 0.84, sx: 1.04, sy: 1.08 },
            { t: 0.9, sx: 0.45, sy: 0.3 },
            { t: 0.93, sx: 0.3, sy: 0.2, opacity: 0 },
            { t: 1, sx: 0.3, sy: 0.2, opacity: 0 },
          ],
          origin: { x: MOON_MOUTH[0], y: MOON_MOUTH[1] },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Volcano: a stout cone with lava running over its rim. It smokes when it idles; angry, it erupts: smoke and
// lava blobs fly.

const rock = {
  base: mix(FUR.tawny.base, FUR.grey.base, 0.5),
  shade: mix(FUR.tawny.shade, FUR.grey.shade, 0.5),
  light: mix(FUR.tawny.light, FUR.grey.light, 0.5),
};
const lava = OBJECT.red;
const glow = OBJECT.orange;
const coneShape = 'M8 93Q20 74 31 34Q33 26 40 26H60Q67 26 69 34Q80 74 92 93Z';
const lavaCap =
  'M30.6 37L31.4 33Q33 26 40 26H60Q67 26 68.6 33L69.4 37Q67 38.6 64.6 37.8V39.6Q64.6 42 62.4 42Q60.2 42 60.2 39.6' +
  'V38Q55.5 37.2 52.6 38.4V43.8Q52.6 46.2 50.2 46.2Q47.8 46.2 47.8 43.8V38.6Q44 37.4 41.2 38.2V39.8Q41.2 42.2 39 42.2' +
  'Q36.8 42.2 36.8 39.8V38.4Q33.4 38.8 30.6 37Z';
const smoke = (i: number): GimmickDef => {
  const at: Pt = [50 + (i - 1) * 4, 20];
  return {
    id: `smoke-${i}`,
    rest: 'hidden',
    markup: puffShape(at[0], at[1], 4, OBJECT.white.base),
    anim: [
      {
        ...R.steam({ rise: 15, ms: 1300 }),
        delayMs: i * 433,
        trigger: ['angry'],
        origin: { x: at[0], y: at[1] },
      },
      {
        ...R.steam({ rise: 13, ms: 2700 }),
        delayMs: i * 900,
        trigger: ['idle', 'surprised'],
        origin: { x: at[0], y: at[1] },
      },
    ],
  };
};
const lavaBlob = (i: number, dx: number): GimmickDef => ({
  id: `lava-${i}`,
  rest: 'hidden',
  markup: circle(50, 26, 4, lava.base) + circle(49, 25, 2, glow.light),
  anim: {
    trigger: ['angry'],
    durationMs: 1150,
    loop: true,
    delayMs: i * 380,
    keyframes: arcKeyframes(dx, 17),
    origin: { x: 50, y: 26 },
  },
});
/** The eruption: a fountain of lava out of the crater, behind the rim, that surges and sinks. */
const plume =
  path('M41 31Q39.5 21 45 15.5Q47.6 12.6 50 6.5Q52.4 12.6 55 15.5Q60.5 21 59 31Z', lava.base) +
  path('M44.5 31Q43.5 23 47 18.5Q48.8 15.8 50 12Q51.2 15.8 53 18.5Q56.5 23 55.5 31Z', glow.base) +
  path('M47.6 31Q47 25 48.8 21.6Q49.6 19.6 50 17.8Q50.4 19.6 51.2 21.6Q53 25 52.4 31Z', OBJECT.gold.light);

const volcano: AvatarDef = {
  id: 'volcano',
  kind: 'nature',
  name: { he: 'הר געש', en: 'Volcano' },
  tile: TILE.teal,
  layers: {
    back:
      shaded(coneShape, rock.base, rock.shade) +
      // a lit facet down the left flank, a shaded one down the right
      path('M29.6 38Q21 70 8.4 91.7H15.5Q25 70 32.6 40Z', rock.light) +
      path('M69.3 40Q76 70 90.6 91.7H83Q72 74 66.4 42Z', rock.shade) +
      // a few stones at the foot
      ellipse(22, 89.6, 4.2, 2.4, rock.shade) +
      ellipse(70, 90, 3.4, 2, rock.shade) +
      // the crater's glow, then the lava over the rim
      ellipse(50, 27, 9.5, 2.6, OBJECT.gold.base) +
      path(lavaCap, lava.shade) +
      path(lavaCap, lava.base, ' transform="translate(-0.9 -0.9)"') +
      ellipse(39, 30, 3.4, 1.3, glow.light, -8),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 62 }, right: { x: 58.5, y: 62 }, r: 5.6, style: 'round' },
    brows: OBJ_BROWS,
    mouth: { x: 50, y: 76, w: 15 },
    cheeks: OBJ_CHEEKS,
    halo: { x: 50, y: 14 },
  },
  pivot: { x: 50, y: 62 },
  base: 93,
  // a mountain: it rumbles (shake, wobble) but does not squash; its foot fills the tile's width
  motionBias: ['shake', 'wobble', 'bounce', 'tilt'],
  gimmicks: [
    {
      id: 'plume',
      z: 'behind',
      rest: 'hidden',
      markup: plume,
      anim: {
        trigger: ['angry'],
        durationMs: 1000,
        loop: true,
        keyframes: [
          { t: 0, sx: 0.7, sy: 0.15, opacity: 0, ease: 'emphasized' },
          { t: 0.08, sx: 0.8, sy: 0.4, opacity: 1, ease: 'emphasized' },
          { t: 0.3, sx: 1.05, sy: 1.08 },
          { t: 0.55, sx: 0.95, sy: 0.78 },
          { t: 0.78, sx: 1, sy: 1 },
          { t: 0.94, sx: 0.8, sy: 0.4, opacity: 1 },
          { t: 1, sx: 0.7, sy: 0.15, opacity: 0 },
        ],
        origin: { x: 50, y: 30 },
      },
    },
    smoke(0),
    smoke(1),
    smoke(2),
    lavaBlob(0, -18),
    lavaBlob(1, 16),
    lavaBlob(2, -7),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Rock: a boulder with a moss cap and a big, serious moustache. The moustache is its moving part: it twitches,
// bristles when angry, jumps when surprised, bounces when it laughs and tilts when confused.

const stone = FUR.grey;
const tache = HAIR.espresso;
const moss = FUR.green;
const boulder =
  'M14 92Q7.5 92 8.5 82Q10 62 18 48Q24 34 36 28Q46 22 58 24Q72 26 82 38Q92 52 91.5 72Q91.5 92 82 92Z';
/** Half the moustache (the left one), mirrored for the right. */
const TACHE: Pt = [50, 65.5];
const tacheHalf = (s: -1 | 1) => {
  const y = (v: number) => v + TACHE[1] - 62;
  return (
    `M${P([50, y(59.6)])}C${P([sx(s, 4), y(57.2)])} ${P([sx(s, 9), y(57)])} ${P([sx(s, 13.5), y(58.8)])}` +
    `C${P([sx(s, 18), y(60.6)])} ${P([sx(s, 20.5), y(61)])} ${P([sx(s, 23), y(58.6)])}` +
    `C${P([sx(s, 24.6), y(57.2)])} ${P([sx(s, 25.8), y(58.4)])} ${P([sx(s, 25.2), y(60.4)])}` +
    `C${P([sx(s, 23.4), y(65)])} ${P([sx(s, 18), y(67.2)])} ${P([sx(s, 12), y(66.4)])}` +
    `C${P([sx(s, 7), y(65.8)])} ${P([sx(s, 3), y(64.6)])} ${P([50, y(65.6)])}Z`
  );
};

const rockChar: AvatarDef = {
  id: 'rock',
  kind: 'nature',
  name: { he: 'סלע', en: 'Rock' },
  tile: TILE.coral,
  layers: {
    back:
      shaded(boulder, stone.base, stone.shade, -1.6, -1.4) +
      // a crack, two speckles, a highlight
      line('M85.4 57.5L81.2 63.2L83.2 66.4L79.6 72.4', stone.shade, 1.7) +
      circle(22, 78, 1.5, stone.shade) +
      circle(76, 82, 1.3, stone.shade) +
      ellipse(19.5, 60, 2.2, 6.4, stone.light, 24) +
      // moss over the top
      path(
        'M24.5 39Q30 26 42 23.6Q52 21.6 61 24.4Q57 28 52 28.4Q46 29 42 31.6Q37.5 35 33 34.6Q28.6 38 24.5 39Z',
        moss.shade,
      ) +
      path(
        'M24.5 37.6Q30 25.6 42 23Q51 21.4 59.6 23.8Q56 26.8 51.5 27.2Q46 27.8 41.6 30.4Q37.4 33.6 33 33.2Q28.6 36.6 24.5 37.6Z',
        moss.base,
      ) +
      ellipse(36, 27.5, 3, 1.3, moss.light, -24),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 40.5, y: 48.5 }, right: { x: 59.5, y: 48.5 }, r: 4.4, style: 'dot' },
    brows: { lift: 1.7, length: 2.7, thickness: 3.2, color: tache.base },
    mouth: { x: 50, y: 76, w: 15 },
    halo: { x: 50, y: 13 },
  },
  pivot: { x: 50, y: 58 },
  base: 92,
  motionBias: ['nod', 'wobble', 'shake', 'tilt'],
  gimmicks: [
    {
      id: 'moustache',
      markup:
        mirrored((s) => path(tacheHalf(s), tache.shade)) +
        `<g transform="translate(-0.8 -0.8)">${mirrored((s) => path(tacheHalf(s), tache.base))}</g>` +
        line(`M44 ${f(TACHE[1] - 1.6)}Q38.5 ${f(TACHE[1] - 2.4)} 34 ${f(TACHE[1] - 0.6)}`, tache.light, 1.4),
      anim: [
        {
          trigger: ['angry'],
          durationMs: 260,
          loop: true,
          keyframes: [
            { t: 0, sx: 1.04, sy: 1.12 },
            { t: 0.5, y: -0.5, sx: 1.08, sy: 1.22 },
            { t: 1, sx: 1.04, sy: 1.12 },
          ],
          origin: { x: TACHE[0], y: TACHE[1] },
        },
        {
          trigger: ['laugh'],
          durationMs: 420,
          loop: true,
          keyframes: [{ t: 0 }, { t: 0.5, y: -1.8, sy: 1.08 }, { t: 1 }],
          origin: { x: TACHE[0], y: TACHE[1] },
        },
        {
          trigger: ['surprised'],
          durationMs: 600,
          keyframes: [
            { t: 0, ease: 'emphasized' },
            { t: 0.5, y: -2.6, sy: 1.12 },
            { t: 1, y: -2.2, sy: 1.08 },
          ],
          origin: { x: TACHE[0], y: TACHE[1] },
        },
        {
          trigger: ['confused'],
          durationMs: 700,
          keyframes: [
            { t: 0, ease: 'emphasized' },
            { t: 0.6, rotate: -10 },
            { t: 1, rotate: -8 },
          ],
          origin: { x: TACHE[0], y: TACHE[1] },
        },
        {
          trigger: ['idle'],
          durationMs: 5200,
          loop: true,
          keyframes: [
            { t: 0 },
            { t: 0.8 },
            { t: 0.83, y: -1, sy: 1.1 },
            { t: 0.86 },
            { t: 0.89, y: -1, sy: 1.1 },
            { t: 0.92 },
            { t: 1 },
          ],
          origin: { x: TACHE[0], y: TACHE[1] },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Mushroom: a red cap with white spots on a chubby stem; the face sits on the stem. Its spots move: they
// drift when it idles, swell when it is surprised, hop when it laughs and swirl when it is dizzy.

const capRed = OBJECT.red;
const stem = OBJECT.cream;
const capShape = 'M15 45Q9 45 11.2 37.6Q19 9.5 50 9.5Q81 9.5 88.8 37.6Q91 45 85 45Z';
const stemShape = 'M32 43Q25.5 72 28 87Q29.5 94 37 94H63Q70.5 94 72 87Q74.5 72 68 43Z';
const MUSH_CAP: Pt = [50, 30];
const spot = (i: number, x: number, y: number, r: number): GimmickDef => ({
  id: `spot-${i}`,
  z: 'back',
  markup: circle(x, y, r, OBJECT.white.shade) + circle(x - 0.4, y - 0.4, r - 0.5, OBJECT.white.base),
  anim: [
    { ...R.inflate({ scale: 1.35, ms: 900 }), delayMs: i * 70, trigger: ['surprised'], origin: { x, y } },
    {
      trigger: ['laugh'],
      durationMs: 460,
      loop: true,
      delayMs: i * 90,
      keyframes: [{ t: 0 }, { t: 0.5, y: -1.8 }, { t: 1 }],
      origin: { x, y },
    },
    {
      ...R.sway({ angle: 9, ms: 1100 }),
      trigger: ['dizzy'],
      origin: { x: MUSH_CAP[0], y: MUSH_CAP[1] + 12 },
    },
    {
      trigger: ['idle'],
      durationMs: 3600 + i * 500,
      loop: true,
      delayMs: i * 400,
      keyframes: [
        { t: 0 },
        { t: 0.25, x: 1, y: -0.6 },
        { t: 0.5, y: -1.2 },
        { t: 0.75, x: -1, y: -0.6 },
        { t: 1 },
      ],
      origin: { x, y },
    },
  ],
});

const mushroom: AvatarDef = {
  id: 'mushroom',
  kind: 'nature',
  name: { he: 'פטרייה', en: 'Mushroom' },
  tile: TILE.leaf,
  layers: {
    back:
      shaded(stemShape, stem.base, stem.shade) +
      // the shadow under the cap, the gills, the cap
      ellipse(50, 46, 19, 3.6, stem.shade) +
      ellipse(50, 44.5, 34.5, 4.6, mix(stem.shade, capRed.shade, 0.25)) +
      shaded(capShape, capRed.base, capRed.shade) +
      line(`M${P(on(48.5, 40, 31, 200))}A31 31 0 0 1 ${P(on(48.5, 40, 31, 228))}`, capRed.light, 3) +
      ellipse(30, 75, 2, 6, stem.light, 4),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 42, y: 64.5 }, right: { x: 58, y: 64.5 }, r: 4.4, style: 'dot' },
    brows: { lift: 1.9, length: 2.1, thickness: 2 },
    mouth: { x: 50, y: 77.5, w: 13 },
    cheeks: { color: FACE.blush, dx: 0.6, dy: 1.45, size: 0.8 },
    halo: { x: 50, y: 6 },
  },
  pivot: { x: 50, y: 52 },
  base: 94,
  squash: true,
  motionBias: ['squash', 'bounce', 'wobble', 'tilt'],
  gimmicks: [
    spot(0, 29, 30, 5.6),
    spot(1, 51, 18.5, 4.8),
    spot(2, 71, 29, 6.2),
    spot(3, 42, 36.5, 3.2),
    spot(4, 18, 39.5, 2.6),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Sea wave: a swell that breaks into a curl over its own head, the hollow of the barrel open under it, foam on
// its crest and at its feet. In the barrel the water churns: fast on a spin, when dizzy or laughing, slowly
// when it idles. When it laughs or is startled, spray flies off the crest.

const water = {
  base: OBJECT.blue.light,
  shade: OBJECT.blue.base,
  deep: OBJECT.blue.shade,
  light: mix(OBJECT.blue.light, OBJECT.white.base, 0.45),
};
const foam = OBJECT.white;
/** The curl: a band between two circles round CURL, from 200° over the top to 70° (its tip). */
const CURL: Pt = [64, 38];
const CURL_OUT = 24;
const CURL_IN = 12;
const waveBody = (() => {
  const at = (r: number, deg: number) => on(CURL[0], CURL[1], r, deg);
  const tipR = (CURL_OUT - CURL_IN) / 2;
  const s1 = at(CURL_OUT, 200);
  const s2 = at(CURL_IN, 200);
  return (
    `M12 93Q7.5 93 7.5 86C8 62 ${P([s1[0] - 4.8, s1[1] + 13.2])} ${P(s1)}` +
    `A${CURL_OUT} ${CURL_OUT} 0 1 1 ${P(at(CURL_OUT, 70))}A${tipR} ${tipR} 0 0 1 ${P(at(CURL_IN, 70))}` +
    `A${CURL_IN} ${CURL_IN} 0 1 0 ${P(s2)}C${P([s2[0] - 4.1, s2[1] + 11.3])} 54 66 66 73C74 78 82 82 88.5 85` +
    `Q92.5 87 91.5 90.5Q90.5 93 87 93Z`
  );
})();
/** Foam along the bottom: a scalloped band, rounded at its right end. */
const waveFoam = (dy: number) => {
  const n = 8;
  const w = 82 / n;
  const xs = Array.from({ length: n + 1 }, (_, i) => 7.5 + i * w);
  return (
    `M7.5 ${f(93 + dy)}V${f(87 + dy)}` +
    xs
      .slice(1)
      .map((x, i) => `Q${f(x - w / 2)} ${f(82.4 + dy)} ${f(x)} ${f(87 + dy - (i % 2) * 0.6)}`)
      .join('') +
    `Q${f(93.5)} ${f(88 + dy)} ${f(91.5)} ${f(91 + dy)}Q${f(90.5)} ${f(93 + dy)} ${f(87)} ${f(93 + dy)}Z`
  );
};
/** The water churning in the barrel: a spiral. */
const churn = (() => {
  const pts: Pt[] = [];
  for (let i = 0; i <= 22; i++)
    pts.push(on(CURL[0], CURL[1], 1 + (i / 22) * 6.4, (i / 22) * 1.25 * 360 + 120));
  return pts.map((p, i) => `${i ? 'L' : 'M'}${P(p)}`).join('');
})();
const sprayDrop = (i: number, dx: number): GimmickDef => {
  const [x, y] = on(CURL[0], CURL[1], CURL_OUT - 3, -60 + i * 24);
  return {
    id: `spray-${i}`,
    rest: 'hidden',
    markup: circle(x, y, 2.9, foam.base),
    anim: {
      trigger: ['laugh', 'surprised'],
      durationMs: 950,
      loop: true,
      delayMs: i * 310,
      keyframes: arcKeyframes(dx, 8),
      origin: { x, y },
    },
  };
};

const wave: AvatarDef = {
  id: 'wave',
  kind: 'nature',
  name: { he: 'גל', en: 'Wave' },
  tile: TILE.mustard,
  layers: {
    back:
      shaded(waveBody, water.base, water.shade) +
      // depth inside the curl, foam on its crest
      line(
        `M${P(on(CURL[0], CURL[1], CURL_IN + 1.2, 205))}A${CURL_IN + 1.2} ${CURL_IN + 1.2} 0 1 1 ${P(on(CURL[0], CURL[1], CURL_IN + 1.2, 62))}`,
        water.deep,
        2.4,
      ) +
      line(
        `M${P(on(CURL[0], CURL[1], CURL_OUT - 4, 218))}A${CURL_OUT - 4} ${CURL_OUT - 4} 0 0 1 ${P(on(CURL[0], CURL[1], CURL_OUT - 4, 352))}`,
        foam.base,
        5.6,
      ) +
      circle(...on(CURL[0], CURL[1], CURL_OUT - 4.4, 8), 2.4, foam.base) +
      circle(...on(CURL[0], CURL[1], CURL_OUT - 5, 22), 1.6, foam.base) +
      ellipse(16, 66, 2.2, 7, water.light, 16) +
      // foam at its feet
      path(waveFoam(0.8), foam.shade) +
      path(waveFoam(0), foam.base),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 27, y: 61 }, right: { x: 43.5, y: 61 }, r: 5.2, style: 'round' },
    brows: OBJ_BROWS,
    mouth: { x: 35.25, y: 74.5, w: 14 },
    cheeks: OBJ_CHEEKS,
    halo: { x: 40, y: 7 },
  },
  pivot: { x: 50, y: 56 },
  base: 93,
  squash: true,
  motionBias: ['spin', 'wobble', 'squash', 'bounce'],
  gimmicks: [
    {
      id: 'churn',
      z: 'back',
      markup: line(churn, water.light, 2.2),
      anim: [
        { ...R.spin({ ms: 900 }), trigger: ['spin', 'dizzy', 'laugh'], origin: { x: CURL[0], y: CURL[1] } },
        { ...R.spin({ ms: 6000 }), trigger: ['idle'], origin: { x: CURL[0], y: CURL[1] } },
      ],
    },
    sprayDrop(0, -10),
    sprayDrop(1, 8),
    sprayDrop(2, 13),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Comet: an icy head with a tail that streams behind it to the upper right. The tail flickers and sparkles
// trail off it when it idles, laughs or spins.

const ice = {
  base: mix(OBJECT.white.base, OBJECT.blue.light, 0.18),
  shade: mix(OBJECT.white.shade, OBJECT.blue.light, 0.42),
  light: OBJECT.white.base,
};
const HEAD: Pt = [40, 61];
const TAIL_DEG = -38;
/** A tapering streak from the head's centre out at `deg`, `len` long, `w` wide at the head: a soft flame. */
const streak = (deg: number, len: number, w: number, fill: string) => {
  const along = (d: number, side: number): Pt => on(...on(HEAD[0], HEAD[1], d, deg), side, deg + 90);
  const tip = along(len, 0);
  return path(
    `M${P(along(0, -w))}C${P(along(0.42 * len, -w))} ${P(along(0.75 * len, -0.3 * w))} ${P(tip)}` +
      `C${P(along(0.75 * len, 0.3 * w))} ${P(along(0.42 * len, w))} ${P(along(0, w))}Z`,
    fill,
  );
};
/** A layer of the tail: it streams (grows a little along its length and settles) on a loop. */
const tail = (i: number, markup: string, ms: number): GimmickDef => ({
  id: `tail-${i}`,
  z: 'behind',
  markup,
  anim: [
    {
      trigger: ['laugh', 'spin', 'bounce', 'surprised', 'flip'],
      durationMs: ms / 3,
      loop: true,
      delayMs: (i * ms) / 9,
      keyframes: [{ t: 0 }, { t: 0.5, sx: 1.09, sy: 1.09, rotate: 2.5 }, { t: 1 }],
      origin: { x: HEAD[0], y: HEAD[1] },
    },
    {
      trigger: ['idle'],
      durationMs: ms,
      loop: true,
      delayMs: (i * ms) / 3,
      keyframes: [{ t: 0 }, { t: 0.5, sx: 1.05, sy: 1.05, rotate: 1.6 }, { t: 1 }],
      origin: { x: HEAD[0], y: HEAD[1] },
    },
  ],
});
const trail = (i: number, at: Pt): GimmickDef => ({
  id: `trail-${i}`,
  rest: 'hidden',
  markup: sparkle(at[0], at[1], 4, OBJECT.gold.light),
  anim: {
    trigger: ['idle', 'laugh', 'spin', 'smile'],
    durationMs: 1500,
    loop: true,
    delayMs: i * 500,
    keyframes: [
      // drifting off along the tail, the way the comet came
      { t: 0, sx: 0.3, sy: 0.3, opacity: 0 },
      { t: 0.2, x: 2.4, y: -1.9, sx: 1, sy: 1, opacity: 1 },
      { t: 0.75, x: 9.5, y: -7.4, sx: 0.8, sy: 0.8, opacity: 0.8 },
      { t: 1, x: 12.6, y: -9.8, sx: 0.3, sy: 0.3, opacity: 0 },
    ],
    origin: { x: at[0], y: at[1] },
  },
});

const comet: AvatarDef = {
  id: 'comet',
  kind: 'nature',
  name: { he: 'כוכב שביט', en: 'Comet' },
  tile: TILE.orchid,
  layers: {
    back:
      circle(HEAD[0], HEAD[1], 23, ice.shade) +
      circle(HEAD[0] - 1.3, HEAD[1] - 1.3, 21.7, ice.base) +
      crater(25.5, 72, 2.6, ice) +
      crater(51, 78.5, 1.9, ice) +
      ellipse(24, 52, 2.2, 5.4, ice.light, 30),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 32, y: 59 }, right: { x: 48.5, y: 59 }, r: 4.6, style: 'dot' },
    brows: { lift: 1.9, length: 2.1, thickness: 2 },
    mouth: { x: 40.25, y: 71.5, w: 13 },
    cheeks: { color: FACE.blush, dx: 0.6, dy: 1.45, size: 0.8 },
    halo: { x: 38, y: 30 },
  },
  pivot: { x: 44, y: 56 },
  base: 84,
  motionBias: ['spin', 'flip', 'bounce', 'tilt'],
  gimmicks: [
    tail(
      0,
      streak(TAIL_DEG - 17, 50, 10, OBJECT.blue.light) + streak(TAIL_DEG + 17, 50, 10, OBJECT.blue.light),
      2100,
    ),
    tail(1, streak(TAIL_DEG, 66, 21, OBJECT.blue.light), 2100),
    tail(2, streak(TAIL_DEG, 54, 13, mix(OBJECT.blue.light, OBJECT.white.base, 0.5)), 2100),
    tail(3, streak(TAIL_DEG, 40, 6.5, OBJECT.white.base), 2100),
    trail(0, [48, 27]),
    trail(1, [74, 58]),
    trail(2, [62, 22]),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Ring bell (kind object): the brass hand bell of the boxing ring. The bell holds the face (`z: 'face'`), so
// when it rings (on a bounce or a laugh) the whole bell shivers, the clapper swings under its lip and sound
// waves flash on both sides.

const brass = {
  base: mix(OBJECT.gold.base, OBJECT.orange.base, 0.4),
  shade: mix(OBJECT.gold.shade, OBJECT.orange.shade, 0.45),
  light: OBJECT.gold.light,
};
const handle = OBJECT.red;
const bellShape =
  'M50 21C37.5 21 31.5 29 30.5 42L29 63Q28 73 21 78Q16.5 80.5 18 84Q18.5 86 21 86H79Q81.5 86 82 84Q83.5 80.5 79 78' +
  'Q72 73 71 63L69.5 42C68.5 29 62.5 21 50 21Z';
const BELL_TOP: Pt = [50, 20];
const ring = (shiver: number, ms: number): Omit<GimmickAnim, 'trigger'> => ({
  ...R.sway({ angle: shiver, ms }),
  origin: { x: BELL_TOP[0], y: BELL_TOP[1] },
});
const ding: GimmickKeyframe[] = [
  { t: 0 },
  { t: 0.12, rotate: 7 },
  { t: 0.3, rotate: -5 },
  { t: 0.5, rotate: 3 },
  { t: 0.72, rotate: -1.5 },
  { t: 1 },
];
const soundWaves = (s: -1 | 1, i: number): GimmickDef => ({
  id: `sound-${s < 0 ? 'l' : 'r'}`,
  rest: 'hidden',
  markup:
    line(`M${P([sx(s, 37), 44])}Q${P([sx(s, 41.5), 51])} ${P([sx(s, 37), 58])}`, OBJECT.white.base, 2.4) +
    line(`M${P([sx(s, 42.5), 40])}Q${P([sx(s, 48.5), 51])} ${P([sx(s, 42.5), 62])}`, OBJECT.white.base, 2.4),
  anim: [
    {
      ...R.sparks({ ms: 640 }),
      delayMs: i * 320,
      trigger: ['bounce', 'laugh'],
      origin: { x: sx(s, 40), y: 51 },
    },
    {
      durationMs: 900,
      keyframes: blinkKeyframes(0.1, 0.5),
      trigger: ['surprised'],
      origin: { x: sx(s, 40), y: 51 },
    },
  ],
});

const ringBell: AvatarDef = {
  id: 'ring-bell',
  kind: 'object',
  name: { he: 'פעמון זירה', en: 'Ring bell' },
  tile: TILE.teal,
  layers: {
    back:
      // the wooden handle
      rect(45, 16, 10, 8, handle.shade, 2) +
      ellipse(50, 14, 7.4, 5.4, handle.shade) +
      ellipse(49.3, 13.3, 6.6, 4.7, handle.base) +
      ellipse(46.8, 11.8, 2.2, 1.2, handle.light, -15),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 51.5 }, right: { x: 58.5, y: 51.5 }, r: 5.4, style: 'round' },
    brows: OBJ_BROWS,
    mouth: { x: 50, y: 65.5, w: 15 },
    cheeks: OBJ_CHEEKS,
    halo: { x: 50, y: 6 },
  },
  pivot: { x: 50, y: 55 },
  base: 93.5,
  motionBias: ['bounce', 'shake', 'wobble', 'tilt'],
  gimmicks: [
    {
      id: 'clapper',
      z: 'behind',
      markup:
        line('M50 60V86', shade(brass.shade, -0.25), 2.4) +
        circle(50, 89, 4.6, brass.shade) +
        circle(49.3, 88.3, 3.6, brass.base),
      anim: [
        {
          ...R.sway({ angle: 16, ms: 320 }),
          delayMs: 80,
          trigger: ['bounce', 'laugh'],
          origin: { x: 50, y: 60 },
        },
        {
          durationMs: 1000,
          keyframes: ding.map((k) => ({ ...k, rotate: -2.2 * (k.rotate ?? 0) })),
          trigger: ['surprised'],
          origin: { x: 50, y: 60 },
        },
      ],
    },
    {
      id: 'bell',
      z: 'face',
      markup:
        shaded(bellShape, brass.base, brass.shade, -1.6, -1.2) +
        // the lip, a raised band, a shine
        path(
          'M18 84Q18.5 86 21 86H79Q81.5 86 82 84Q83.5 80.5 79 78Q50 84 21 78Q16.5 80.5 18 84Z',
          brass.shade,
        ) +
        line('M32.4 32Q50 27 67.6 32', brass.shade, 2) +
        ellipse(31.8, 66.5, 1.9, 7.2, brass.light, 12),
      anim: [
        { ...ring(4, 300), trigger: ['bounce', 'laugh'] },
        {
          durationMs: 1000,
          keyframes: ding,
          trigger: ['surprised'],
          origin: { x: BELL_TOP[0], y: BELL_TOP[1] },
        },
      ],
    },
    soundWaves(-1, 0),
    soundWaves(1, 1),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Trophy (kind object): the winner's cup on a wooden base. It sparkles when it idles, smiles, laughs or winks.

const gold = OBJECT.gold;
const wood = FUR.brown;
const cupShape = 'M22 14H78V24C78 50 64 61 50 61C36 61 22 50 22 24Z';
const glint = (i: number, x: number, y: number, s: number): GimmickDef => ({
  id: `glint-${i}`,
  rest: 'hidden',
  markup: sparkle(x, y, s, OBJECT.white.base),
  anim: [
    { ...R.sparks({ ms: 1100 }), delayMs: i * 360, trigger: ['smile', 'laugh', 'wink'], origin: { x, y } },
    { ...R.sparks({ ms: 2600 }), delayMs: i * 860, trigger: ['idle'], origin: { x, y } },
  ],
});

const trophy: AvatarDef = {
  id: 'trophy',
  kind: 'object',
  name: { he: 'גביע', en: 'Trophy' },
  tile: TILE.berry,
  layers: {
    back:
      // handles, behind the cup
      mirrored((s) =>
        line(
          `M${P([sx(s, 27), 21])}C${P([sx(s, 41), 19])} ${P([sx(s, 43), 39])} ${P([sx(s, 25), 45])}`,
          gold.shade,
          5.4,
        ),
      ) +
      mirrored((s) =>
        line(
          `M${P([sx(s, 27), 20.4])}C${P([sx(s, 39.6), 18.8])} ${P([sx(s, 41.4), 37.6])} ${P([sx(s, 25), 43.6])}`,
          gold.base,
          2.6,
        ),
      ) +
      // the base, the foot, the stem
      rect(28.6, 77, 44, 16.5, wood.shade, 3) +
      rect(27.4, 76, 43, 15.6, wood.base, 3) +
      rect(38, 80.4, 24, 8, gold.shade, 1.6) +
      rect(37.6, 80, 23.2, 7.2, gold.base, 1.6) +
      path('M38 77Q43 72 46.4 70H53.6Q57 72 62 77Z', gold.shade) +
      path('M45 59H55Q53 64 53.4 70H46.6Q47 64 45 59Z', gold.shade) +
      ellipse(50, 68.6, 6.2, 2.6, gold.base) +
      // the cup and its rim
      shaded(cupShape, gold.base, gold.shade) +
      rect(19.6, 10.4, 60.8, 7, gold.shade, 3.5) +
      rect(19.6, 10, 59.6, 6, gold.light, 3) +
      ellipse(29, 30, 2.4, 8, gold.light, 10),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 34.5 }, right: { x: 58.5, y: 34.5 }, r: 5.4, style: 'round' },
    brows: { lift: 1.65, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 48, w: 14 },
    cheeks: OBJ_CHEEKS,
    halo: { x: 50, y: 5.5 },
  },
  pivot: { x: 50, y: 50 },
  base: 93.5,
  motionBias: ['bounce', 'spin', 'nod', 'tilt'],
  gimmicks: [glint(0, 85, 16, 6.5), glint(1, 13, 58, 5.5), glint(2, 74.5, 69, 5), glint(3, 30, 23, 4.6)],
};

export const NATURE: readonly AvatarDef[] = [
  rainCloud,
  lightning,
  sun,
  moonChar,
  volcano,
  rockChar,
  mushroom,
  wave,
  comet,
  ringBell,
  trophy,
];
