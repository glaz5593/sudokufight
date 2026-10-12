/**
 * Things you eat or drink (kind `food`): fruit, bread, sweets, a carton of milk.
 *
 * Read docs/avatars/STYLE.md first. Shared drawing helpers: ./draw.ts; gimmick recipes: ../gimmick.ts. Add each
 * character's AvatarDef here and append it to the list below: catalog/index.ts already includes this list.
 *
 * Two friends from the same batch live here too, with their own kinds: the broom (`object`) and the potted
 * cactus (`nature`).
 */

import { GIMMICK_RECIPES as R } from '../gimmick';
import { CLOTH, FACE, FUR, HAIR, mix, OBJECT, type Ramp, shade, TILE } from '../palette';
import type { AvatarDef, GimmickAnim, GimmickDef, GimmickKeyframe } from '../types';
import { circle, ellipse, lerp, line, P, path, type Pt, rect, shaded } from './draw';

// ---------------------------------------------------------------------------------------------------------
// Colours and helpers of this file

const ramp = (base: string, shadeColor: string, light: string): Ramp => ({ base, shade: shadeColor, light });

/**
 * Food colours the palette does not have yet, mixed from it (move them to palette.ts when another file needs
 * them): an egg yolk, an avocado's skin and flesh, broccoli, a pita, fried dough.
 */
const FOOD_COLOR = {
  yolk: ramp(
    mix(OBJECT.gold.base, OBJECT.orange.base, 0.25),
    mix(OBJECT.gold.shade, OBJECT.orange.shade, 0.4),
    OBJECT.gold.light,
  ),
  avocadoSkin: ramp(shade(FUR.green.shade, -0.5), shade(FUR.green.shade, -0.64), shade(FUR.green.base, -0.3)),
  avocadoRim: ramp(
    mix(OBJECT.green.light, OBJECT.gold.light, 0.3),
    mix(OBJECT.green.base, OBJECT.gold.base, 0.3),
    OBJECT.gold.light,
  ),
  avocadoFlesh: ramp(
    mix(OBJECT.gold.light, OBJECT.green.light, 0.3),
    mix(OBJECT.gold.base, OBJECT.green.base, 0.45),
    OBJECT.cream.light,
  ),
  floret: ramp(mix(OBJECT.green.shade, CLOTH.forest.base, 0.5), CLOTH.forest.shade, OBJECT.green.base),
  stalk: ramp(
    mix(OBJECT.green.light, OBJECT.cream.base, 0.45),
    mix(OBJECT.green.base, OBJECT.cream.shade, 0.45),
    OBJECT.cream.light,
  ),
  pita: ramp(
    mix(FUR.cream.base, FUR.golden.base, 0.42),
    mix(FUR.cream.shade, FUR.golden.shade, 0.55),
    FUR.cream.light,
  ),
  dough: ramp(
    mix(FUR.tawny.base, FUR.golden.base, 0.35),
    mix(FUR.tawny.shade, FUR.golden.shade, 0.3),
    FUR.golden.light,
  ),
} as const;

/** A point at `deg` degrees (0 = right, 90 = down) on a circle, as a point. */
const at = (cx: number, cy: number, r: number, deg: number): Pt => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

/** A small dot: [x, y, r]. */
type Dot = readonly [x: number, y: number, r: number];

/** A drop (the rig's tear shape), pointed end up: its round end centred on (x, y), size `s`. */
const drop = ([x, y]: Pt, s: number, fill: string): string =>
  path(
    `M${P([x, y - 1.6 * s])}C${P([x + 0.35 * s, y - s])} ${P([x + s, y - 0.45 * s])} ${P([x + s, y + 0.1 * s])}` +
      `A${P([s, s])} 0 0 1 ${P([x - s, y + 0.1 * s])}C${P([x - s, y - 0.45 * s])} ${P([x - 0.35 * s, y - s])} ${P([x, y - 1.6 * s])}Z`,
    fill,
  );

/**
 * A smooth closed shape around (cx, cy): each [deg, k] is a point at that angle, k times the radii away; the
 * curve runs through the midpoints between them (a wobbly egg white, a cloud).
 */
const blob = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  pts: readonly (readonly [number, number])[],
) => {
  const p = pts.map(([deg, k]): Pt => {
    const a = (deg * Math.PI) / 180;
    return [cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)];
  });
  const n = p.length;
  const get = (i: number): Pt => p[((i % n) + n) % n] ?? [cx, cy];
  let d = `M${P(lerp(get(-1), get(0), 0.5))}`;
  for (let i = 0; i < n; i++) d += `Q${P(get(i))} ${P(lerp(get(i), get(i + 1), 0.5))}`;
  return `${d}Z`;
};

/**
 * Parallel lines across a convex polygon (a waffle cone's grid), `gap` apart at `deg` degrees, one of them
 * through `through`, each stopping `inset` short of the edges.
 */
const hatch = (
  poly: readonly Pt[],
  deg: number,
  gap: number,
  through: Pt,
  inset: number,
  color: string,
  width: number,
): string => {
  const a = (deg * Math.PI) / 180;
  const dir: Pt = [Math.cos(a), Math.sin(a)];
  const nrm: Pt = [-dir[1], dir[0]];
  const dot = (p: Pt, v: Pt) => p[0] * v[0] + p[1] * v[1];
  const ds = poly.map((p) => dot(p, nrm));
  const d0 = dot(through, nrm);
  let out = '';
  for (let k = Math.ceil((Math.min(...ds) - d0) / gap); d0 + k * gap < Math.max(...ds); k++) {
    const d = d0 + k * gap;
    const hits: Pt[] = [];
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length] ?? p;
      const s1 = dot(p, nrm) - d;
      const s2 = dot(q, nrm) - d;
      if (s1 < 0 !== s2 < 0) hits.push(lerp(p, q, s1 / (s1 - s2)));
    });
    hits.sort((u, v) => dot(u, dir) - dot(v, dir));
    const u = hits[0];
    const v = hits[hits.length - 1];
    if (!u || !v) continue;
    const len = dot(v, dir) - dot(u, dir);
    if (len <= 2 * inset + 1) continue;
    out += line(`M${P(lerp(u, v, inset / len))}L${P(lerp(u, v, 1 - inset / len))}`, color, width);
  }
  return out;
};

/** A jiggle: squish wide, back, squish tall, back. Loop it (a yolk, a belly, jelly). */
const jiggle = (amount: number): GimmickKeyframe[] => [
  { t: 0 },
  { t: 0.25, sx: 1 + amount, sy: 1 - amount },
  { t: 0.5 },
  { t: 0.75, sx: 1 - 0.7 * amount, sy: 1 + 0.7 * amount },
  { t: 1 },
];

// ---------------------------------------------------------------------------------------------------------
// Broom: a straw broom standing on its handle, the loose straw up like a wild hairdo. The face sits on the
// bound straw between two rows of red stitching. The loose straw is its gimmick: it sways, stands on end when
// surprised, bristles when angry and wilts when sad.

const straw = HAIR.honey;
const bound = HAIR.blonde;
const stick = FUR.tawny;
const thread = OBJECT.red;
const ferrule = OBJECT.steel;
const broomHead = 'M27 25H73Q79 25 78.4 31L68.6 77.5Q67.6 82 63 82H37Q32.4 82 31.4 77.5L21.6 31Q21 25 27 25Z';
/**
 * A point of the loose straw: `deg` degrees around its root (50, 44, inside the bound part), `k` times the
 * fan's reach there. The fan reaches 38 straight up and 44 to the sides, a little less toward the sides: a
 * broad bundle that flares out of the top of the bound part.
 */
const strawAt = (deg: number, k: number): Pt => {
  const a = (deg * Math.PI) / 180;
  const reach = k * (0.86 + 0.14 * Math.sin(-a));
  return [50 + 44 * reach * Math.cos(a), 44 + 38 * reach * Math.sin(a)];
};

/** A fan of straw spikes: `tips` tips from `from` to `to` degrees, reaching `tip`, the valleys at `valley`. */
const strawFan = (tips: number, from: number, to: number, tip: number, valley: number, fill: string) => {
  const step = (to - from) / (tips - 1);
  let d = `M${P(strawAt(from - step / 2, 0.42))}`;
  for (let i = 0; i < tips; i++) {
    const a = from + i * step;
    if (i > 0) d += `L${P(strawAt(a - step / 2, valley))}`;
    d += `L${P(strawAt(a, tip * (i % 2 ? 0.96 : 1)))}`;
  }
  return path(`${d}L${P(strawAt(to + step / 2, 0.42))}Z`, fill);
};

/** Straw streaks: a line along each of `degs`, from `from` to `to` of the reach. */
const strawStreaks = (degs: readonly number[], from: number, to: number, color: string) =>
  degs.map((a) => line(`M${P(strawAt(a, from))}L${P(strawAt(a, to))}`, color, 1.3)).join('');

const broom: AvatarDef = {
  id: 'broom',
  kind: 'object',
  name: { he: 'מטאטא', en: 'Broom' },
  tile: TILE.iris,
  layers: {
    back:
      // the handle, down out of the tile (a spin must not show its end), and the metal cap on it
      rect(45, 84, 10, 70, stick.shade) +
      rect(45, 84, 7.6, 70, stick.base) +
      rect(46.6, 90, 1.8, 60, stick.light) +
      rect(39.6, 78.6, 21.4, 9.4, ferrule.shade, 2.6) +
      rect(39.6, 78.6, 19.6, 8.2, ferrule.base, 2.4) +
      rect(41, 80.6, 16.8, 1.4, ferrule.light, 0.7) +
      // the bound straw: shade, then the lit surface up and left; straw streaks down its sides
      shaded(broomHead, bound.base, bound.shade) +
      line('M23.2 35.4L30.4 70.6', bound.shade, 1.2) +
      line('M26.6 35L34 69', bound.light, 1.4) +
      line('M72.2 35L65.4 69', bound.shade, 1.3) +
      line('M75.4 35.4L68.6 70.4', bound.shade, 1.2) +
      // two rows of stitching
      path('M21.4 28.6H77.2L76.7 32H21.9Z', thread.base) +
      path('M21.9 32H76.7L76.5 33.2H22.1Z', thread.shade) +
      path('M30.1 72.4H68.1L67.5 75.8H30.8Z', thread.base) +
      path('M30.8 75.8H67.5L67.3 77H31Z', thread.shade),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 51 }, right: { x: 58.5, y: 51 }, r: 5.4, style: 'round' },
    brows: { lift: 1.75, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 64.5, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 12 },
  },
  pivot: { x: 50, y: 52 },
  headBox: { x: 12, y: 6, size: 76 },
  motionBias: ['spin', 'tilt', 'bounce', 'shake'],
  gimmicks: [
    {
      id: 'straw',
      z: 'behind',
      markup:
        strawFan(12, -150.5, -29.5, 1, 0.68, straw.shade) +
        strawFan(13, -156, -24, 0.97, 0.74, straw.base) +
        strawStreaks([-145, -123, -101, -79, -57, -35], 0.5, 0.86, straw.shade) +
        strawStreaks([-134, -112, -68, -46], 0.5, 0.84, straw.light),
      anim: [
        {
          // stands on end
          trigger: ['surprised'],
          durationMs: 700,
          keyframes: [
            { t: 0, ease: 'emphasized' },
            { t: 0.35, sx: 1.12, sy: 1.24 },
            { t: 1, sx: 1.1, sy: 1.2 },
          ],
          origin: { x: 50, y: 30 },
        },
        {
          // bristles
          trigger: ['angry'],
          durationMs: 420,
          loop: true,
          keyframes: [{ t: 0 }, { t: 0.5, sx: 1.05, sy: 1.1 }, { t: 1 }],
          origin: { x: 50, y: 30 },
        },
        {
          // wilts
          trigger: ['sad'],
          durationMs: 1300,
          keyframes: [
            { t: 0, ease: 'standard' },
            { t: 1, sx: 0.96, sy: 0.82 },
          ],
          origin: { x: 50, y: 30 },
        },
        { ...R.sway({ angle: 7, ms: 1100 }), trigger: ['dizzy'], origin: { x: 50, y: 30 } },
        { ...R.sway({ angle: 2.5, ms: 2800 }), trigger: ['idle'], origin: { x: 50, y: 30 } },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Potted cactus: a plump cactus with two arms in a terracotta pot, a pink flower on top. The face sits on the
// body, between two ribs. The flower is its gimmick: it sways, blooms when it smiles, twirls when it laughs
// and closes when it is sad.

const cactus = OBJECT.green;
const pot = CLOTH.brick;
const bloom = OBJECT.pink;
const cactusBody = 'M29 74V41Q29 18 50 18Q71 18 71 41V74Z';
const cactusArmL = 'M31 62H24.5Q17 62 17 54.5V41.5Q17 36 21.75 36Q26.5 36 26.5 41.5V52.5H31Z';
const cactusArmR = 'M69 53H75.5Q83 53 83 45.5V31.5Q83 26 78.25 26Q73.5 26 73.5 31.5V43.5H69Z';
const flowerAt: Pt = [50, 17.5];

/** A tuft of three spines at `p`, pointing out at `deg`. */
const spines = (p: Pt, deg: number) =>
  [-32, 0, 32]
    .map((d) => line(`M${P(p)}L${P(at(p[0], p[1], 2.8, deg + d))}`, OBJECT.cream.light, 1))
    .join('');

const pottedCactus: AvatarDef = {
  id: 'cactus',
  kind: 'nature',
  name: { he: 'קקטוס בעציץ', en: 'Potted cactus' },
  tile: TILE.mustard,
  layers: {
    back:
      // the pot: its body, the soil, the cactus, then the rim over the cactus's foot
      shaded('M27.5 77H72.5L68.6 91.6Q68 94.4 65 94.4H35Q32 94.4 31.4 91.6Z', pot.base, pot.shade) +
      ellipse(50, 71, 24, 3.2, FUR.chocolate.base) +
      shaded(cactusArmL, cactus.base, cactus.shade) +
      shaded(cactusArmR, cactus.base, cactus.shade) +
      shaded(cactusBody, cactus.base, cactus.shade) +
      // ribs, and the spines
      line('M35.6 26Q31.6 40 32.2 70', cactus.light, 1.6) +
      line('M64.4 27Q68.2 40 67.8 70', cactus.shade, 1.6) +
      spines([31.5, 31], -140) +
      spines([67.5, 31], -40) +
      spines([29.6, 62], 180) +
      spines([69.4, 64], 0) +
      spines([16.4, 46], 180) +
      spines([21.5, 35.6], -90) +
      spines([83.4, 36], 0) +
      spines([78.3, 25.6], -90) +
      // the rim
      rect(24.4, 69.8, 53.4, 9, pot.shade, 2.8) +
      rect(23.2, 68.6, 52.8, 8.6, pot.base, 2.6) +
      rect(25.4, 70.2, 13, 1.8, pot.light, 0.9),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 44 }, right: { x: 58.5, y: 44 }, r: 5.3, style: 'round' },
    brows: { lift: 1.75, length: 1.7, thickness: 2.2, color: shade(cactus.shade, -0.55) },
    mouth: { x: 50, y: 57.5, w: 14 },
    // no cheeks: blush on green turns brown
    halo: { x: 50, y: 9 },
  },
  pivot: { x: 50, y: 52 },
  base: 94,
  squash: true,
  motionBias: ['wobble', 'squash', 'tilt', 'bounce'],
  gimmicks: [
    {
      id: 'flower',
      markup:
        [0, 1, 2, 3, 4]
          .map((i) => {
            const deg = -90 + i * 72;
            const [x, y] = at(...flowerAt, 4.2, deg);
            return (
              ellipse(x + 0.6, y + 0.6, 3, 4.4, bloom.shade, deg + 90) +
              ellipse(x, y, 3, 4.4, bloom.base, deg + 90)
            );
          })
          .join('') +
        circle(...flowerAt, 2.8, OBJECT.gold.base) +
        circle(flowerAt[0] - 0.8, flowerAt[1] - 0.8, 1, OBJECT.gold.light),
      anim: [
        { ...R.spin({ ms: 1500 }), trigger: ['laugh'], origin: { x: flowerAt[0], y: flowerAt[1] } },
        { ...R.spin({ ms: 900 }), trigger: ['dizzy'], origin: { x: flowerAt[0], y: flowerAt[1] } },
        { ...R.inflate({ scale: 1.3 }), trigger: ['smile', 'surprised'], origin: { x: 50, y: 19 } },
        { ...R.deflate({ scale: 0.72, droop: 2 }), trigger: ['sad'], origin: { x: 50, y: 20 } },
        { ...R.sway({ angle: 8, ms: 2600 }), trigger: ['idle'], origin: { x: 50, y: 21 } },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Falafel: a pita pocket stuffed with falafel balls, lettuce and tomato. The face sits on the pita; the middle
// ball pops up when it is surprised or laughs.

const pita = FOOD_COLOR.pita;
const falafelBall = FUR.brown;
const lettuce = OBJECT.green;
const pitaFront = 'M14 52Q14 45.5 20.5 45Q50 48 79.5 45Q86 45.5 86 52Q86 94 50 94Q14 94 14 52Z';

/** The dark crumbs of a falafel ball's crust, in ball radii from its centre. */
const crumbs: readonly Dot[] = [
  [0.38, 0.12, 0.11],
  [-0.12, 0.48, 0.1],
  [0.18, -0.42, 0.09],
  [-0.5, 0.05, 0.08],
  [0.52, -0.2, 0.07],
];

/** A falafel ball: shade, the lit ball, a few dark crumbs and a shine. */
const ballAt = (x: number, y: number, r: number) =>
  circle(x + 0.9, y + 0.9, r, falafelBall.shade) +
  circle(x - 0.3, y - 0.3, r - 1, falafelBall.base) +
  crumbs.map(([dx, dy, k]) => circle(x + dx * r, y + dy * r, k * r, falafelBall.shade)).join('') +
  ellipse(x - 0.42 * r, y - 0.42 * r, 0.15 * r, 0.26 * r, falafelBall.light, 45);

/** A lettuce leaf sticking out of the pita: a frilly oval at `p`, turned `deg`. */
const leaf = ([x, y]: Pt, rx: number, deg: number) =>
  ellipse(x + 0.6, y + 0.8, rx, 0.5 * rx, lettuce.shade, deg) +
  ellipse(x, y, rx, 0.46 * rx, lettuce.base, deg);

const falafel: AvatarDef = {
  id: 'falafel',
  kind: 'food',
  name: { he: 'פלאפל', en: 'Falafel' },
  tile: TILE.tangerine,
  layers: {
    back:
      // lettuce out of the corners, the balls at the sides, a slice of tomato, the lettuce in front of the
      // balls, then the pita
      leaf([15.5, 42.5], 7.4, -28) +
      leaf([84.5, 41.5], 7, 26) +
      ballAt(30.5, 39.5, 12.5) +
      ballAt(69.5, 39.5, 12.5) +
      circle(79.6, 45, 5.6, OBJECT.red.shade) +
      circle(79.2, 44.6, 4.8, OBJECT.red.base) +
      circle(78.2, 43.4, 1, OBJECT.red.light) +
      [19, 24.4, 29.8, 35.2, 40.6, 46, 51.4, 56.8, 62.2, 67.6, 73]
        .map(
          (x, i) =>
            circle(x + 0.7, 46.2, 3.8, lettuce.shade) + circle(x, 45.4 - (i % 2) * 0.9, 3.6, lettuce.base),
        )
        .join('') +
      shaded(pitaFront, pita.base, pita.shade) +
      line('M17.4 46.4Q50 49.4 82.6 46.4', pita.light, 2.4) +
      // toasted spots
      ellipse(22, 60, 3.4, 2.1, FUR.golden.base, -24) +
      ellipse(79, 62, 2.6, 1.8, FUR.golden.base, 20) +
      ellipse(28.5, 84, 3, 1.8, FUR.golden.base, 30) +
      ellipse(71.5, 84.5, 2.2, 1.5, FUR.golden.base, -30) +
      ellipse(21, 72, 1.6, 1.1, FUR.golden.base, 10),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 65 }, right: { x: 58.5, y: 65 }, r: 5.2, style: 'round' },
    brows: { lift: 1.7, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 78, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 9 },
  },
  pivot: { x: 50, y: 62 },
  base: 94,
  squash: true,
  motionBias: ['bounce', 'squash', 'wobble', 'nod'],
  gimmicks: [
    {
      // the middle ball, behind the others: it pops up
      id: 'ball',
      z: 'behind',
      markup: ballAt(50, 33.5, 13),
      anim: { ...R.popUp({ height: 13 }), trigger: ['surprised', 'laugh'], origin: { x: 50, y: 46 } },
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Fried egg: a wobbly egg white with a crisp golden edge, and a big yolk that is the face. The yolk holds the
// face (`z: 'face'`): it jiggles when it laughs or bounces, boings when surprised and slides when dizzy.

const yolk = FOOD_COLOR.yolk;
const eggWhite = OBJECT.white;
const eggOutline: readonly (readonly [number, number])[] = [
  [-90, 1],
  [-60, 0.9],
  [-30, 1.02],
  [0, 0.94],
  [30, 1.03],
  [60, 0.92],
  [90, 1],
  [120, 0.9],
  [150, 1.04],
  [180, 0.93],
  [210, 1],
  [240, 0.91],
];
const yolkAt: Pt = [50, 53];

const friedEgg: AvatarDef = {
  id: 'fried-egg',
  kind: 'food',
  name: { he: 'ביצת עין', en: 'Fried egg' },
  tile: TILE.leaf,
  layers: {
    back:
      // the crisp edge, then the white: shade, and the lit surface up and left
      path(blob(50, 52, 41.6, 38.6, eggOutline), FUR.golden.light) +
      path(blob(50, 52, 40, 37, eggOutline), eggWhite.shade) +
      path(blob(48.6, 50.7, 39.4, 36.4, eggOutline), eggWhite.base) +
      ellipse(22, 40, 2.4, 6, eggWhite.light, 30) +
      // the yolk's shadow on the white
      circle(yolkAt[0] + 2.2, yolkAt[1] + 2.4, 23.2, eggWhite.shade),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 52 }, right: { x: 58.5, y: 52 }, r: 5.2, style: 'round' },
    brows: { lift: 1.75, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 65.5, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 9 },
  },
  pivot: { x: 50, y: 52 },
  base: 89,
  squash: true,
  motionBias: ['flip', 'wobble', 'squash', 'spin'],
  gimmicks: [
    {
      id: 'yolk',
      z: 'face',
      markup:
        circle(yolkAt[0] + 0.9, yolkAt[1] + 0.9, 23, yolk.shade) +
        circle(yolkAt[0] - 0.5, yolkAt[1] - 0.5, 21.6, yolk.base) +
        line(`M${P(at(...yolkAt, 19.2, 202))}A19.2 19.2 0 0 1 ${P(at(...yolkAt, 19.2, 234))}`, yolk.light, 3),
      anim: [
        {
          trigger: ['laugh', 'squash', 'bounce'],
          durationMs: 520,
          loop: true,
          keyframes: jiggle(0.06),
          origin: { x: 50, y: 76 },
        },
        {
          trigger: ['surprised'],
          durationMs: 900,
          keyframes: [
            { t: 0, ease: 'emphasized' },
            { t: 0.2, sx: 0.92, sy: 1.1 },
            { t: 0.45, sx: 1.06, sy: 0.95 },
            { t: 0.7, sx: 0.98, sy: 1.02 },
            { t: 1 },
          ],
          origin: { x: 50, y: 76 },
        },
        {
          trigger: ['dizzy', 'wobble'],
          durationMs: 1100,
          loop: true,
          keyframes: [{ t: 0 }, { t: 0.25, x: 2.4, rotate: 4 }, { t: 0.75, x: -2.4, rotate: -4 }, { t: 1 }],
          origin: { x: 50, y: 76 },
        },
        {
          trigger: ['idle'],
          durationMs: 2400,
          loop: true,
          keyframes: jiggle(0.025),
          origin: { x: 50, y: 76 },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Avocado: half an avocado, the cut side out. The face sits on the flesh; the pit is its belly, and it bounces
// when it laughs, swells when surprised and breathes when idle.

const avoSkin = FOOD_COLOR.avocadoSkin;
const avoRim = FOOD_COLOR.avocadoRim;
const avoFlesh = FOOD_COLOR.avocadoFlesh;
const avoPit = FUR.brown;
const avoOutline =
  'M50 7.5C63.5 7.5 69.5 21 73.5 35C78 50.5 85.5 59 85.5 72C85.5 87 70 95 50 95C30 95 14.5 87 14.5 72' +
  'C14.5 59 22 50.5 26.5 35C30.5 21 36.5 7.5 50 7.5Z';
const avoRimShape =
  'M50 11.5C61 11.5 66 23 69.8 36.2C74.4 52 81.5 60.4 81.5 72C81.5 84.6 68 91 50 91C32 91 18.5 84.6 18.5 72' +
  'C18.5 60.4 25.6 52 30.2 36.2C34 23 39 11.5 50 11.5Z';
const avoCore =
  'M50 14.8C59 14.8 63.4 25 66.8 37.4C71.4 53.4 78.2 61.4 78.2 72C78.2 82.6 66.4 87.8 50 87.8C33.6 87.8 21.8 82.6' +
  ' 21.8 72C21.8 61.4 28.6 53.4 33.2 37.4C36.6 25 41 14.8 50 14.8Z';
const pitAt: Pt = [50, 74.5];

const avocado: AvatarDef = {
  id: 'avocado',
  kind: 'food',
  name: { he: 'אבוקדו', en: 'Avocado' },
  tile: TILE.rose,
  layers: {
    back:
      shaded(avoOutline, avoSkin.base, avoSkin.shade) +
      ellipse(24.5, 50, 2, 6, avoSkin.light, 22) +
      path(avoRimShape, avoRim.base) +
      path(avoCore, avoFlesh.base, ' transform="translate(-0.6 -0.6)"') +
      // the hollow the pit sits in
      circle(pitAt[0] + 1.4, pitAt[1] + 1.4, 14.6, avoFlesh.shade),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.6, y: 41 }, right: { x: 58.4, y: 41 }, r: 5, style: 'round' },
    brows: { lift: 1.7, length: 1.7, thickness: 2.1 },
    mouth: { x: 50, y: 53, w: 13.5 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 7 },
  },
  pivot: { x: 50, y: 55 },
  base: 95,
  squash: true,
  motionBias: ['wobble', 'squash', 'nod', 'bounce'],
  gimmicks: [
    {
      id: 'pit',
      z: 'back',
      markup:
        circle(pitAt[0] + 0.8, pitAt[1] + 0.8, 13, avoPit.shade) +
        circle(pitAt[0] - 0.4, pitAt[1] - 0.4, 11.8, avoPit.base) +
        ellipse(pitAt[0] - 5.4, pitAt[1] - 5, 2.2, 3.6, avoPit.light, 40),
      anim: [
        {
          trigger: ['laugh'],
          durationMs: 560,
          loop: true,
          keyframes: [{ t: 0 }, { t: 0.3, y: -1.6, sx: 1.04, sy: 0.96 }, { t: 0.6, y: 0.4 }, { t: 1 }],
          origin: { x: 50, y: 87 },
        },
        {
          ...R.inflate({ scale: 1.1, ms: 900 }),
          trigger: ['surprised'],
          origin: { x: pitAt[0], y: pitAt[1] },
        },
        {
          trigger: ['idle'],
          durationMs: 3200,
          loop: true,
          keyframes: [{ t: 0 }, { t: 0.5, sx: 1.03, sy: 1.03 }, { t: 1 }],
          origin: { x: pitAt[0], y: pitAt[1] },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Sufganiya: a Hanukkah jelly doughnut with its pale belt, powdered sugar and a dollop of jam on top. The face
// sits on the fried dough. The jam drips down its sides when it is sad and quivers when it is angry.

const dough = FOOD_COLOR.dough;
const belt = FUR.cream;
const sugar = OBJECT.white;
const jam = OBJECT.red;
/** The jam on top: a glossy dollop. */
const jamDollop =
  'M40 29Q38.6 23.6 43.6 22.4Q46 18.6 50.8 19.6Q55.6 18.8 57.8 22.6Q62 24 60.6 28.6Q59.6 31.8 50 31.8Q40.8 32 40 29Z';
/** The round ends of the jam's two drips down the sugar: a drop falls from each when it is sad. */
const jamEnds: readonly Pt[] = [
  [42.6, 33.8],
  [57.4, 32.6],
];
/** The dollop and its drips, in one colour, shifted by (dx, dy). */
const jamShape = (fill: string, dx: number, dy: number) =>
  path(jamDollop, fill, dx || dy ? ` transform="translate(${P([dx, dy])})"` : '') +
  jamEnds.map(([x, y], i) => drop([x + dx, y + dy], i ? 1.6 : 1.9, fill)).join('');
/** Grains of sugar around the dusted patch. */
const sugarGrains: readonly Dot[] = [
  [27.5, 43.6, 0.9],
  [33.8, 42.4, 0.7],
  [67.2, 43, 0.9],
  [72.6, 42, 0.7],
  [61.5, 42.2, 0.6],
  [21.5, 47.5, 0.7],
  [78.2, 47.6, 0.6],
];
const jamDrip = (i: number): GimmickDef => {
  const [x, y] = jamEnds[i] ?? [50, 34];
  return {
    id: `drip-${i}`,
    rest: 'hidden',
    markup: drop([x, y + 1.2], 1.9, jam.base),
    anim: { ...R.drip({ fall: 8, ms: 1400 }), delayMs: i * 700, trigger: ['sad'], origin: { x, y: y + 1.2 } },
  };
};

const sufganiya: AvatarDef = {
  id: 'sufganiya',
  kind: 'food',
  name: { he: 'סופגנייה', en: 'Sufganiya' },
  tile: TILE.teal,
  layers: {
    back:
      // the doughnut: shade, then the lit dough up and left
      ellipse(50, 60.5, 37, 32, dough.shade) +
      ellipse(48.8, 59.2, 35.6, 30.8, dough.base) +
      // the pale belt round its middle
      path('M14.6 69.6Q50 95.6 85.2 69.6Q83.6 75.4 80.4 78.4Q50 100.6 19.2 78Q16 75 14.6 69.6Z', belt.base) +
      path('M19.2 78Q50 100.6 80.4 78Q78 83 74.6 85.4Q50 99.6 25.2 85.2Q21.4 82 19.2 78Z', belt.shade) +
      ellipse(20.5, 52, 2.4, 6.4, dough.light, 18) +
      // powdered sugar on top: a dusty patch with a ragged edge, and a few grains around it
      path(
        'M24 38.6Q27 30.4 38 28Q50 25.8 62 28Q73 30.4 76 38.6Q73.4 37.2 71.6 39.4Q68.6 36.8 65.8 39.8Q62.6 37.6' +
          ' 59.6 39.2Q56.4 36.4 52.8 39.6Q49.6 37.6 46.4 39Q43 36.6 40 39.6Q36.8 37.8 34 39.2Q30.6 36.8 28.2 39.6Q26' +
          ' 37.4 24 38.6Z',
        sugar.base,
      ) +
      sugarGrains.map(([x, y, r]) => circle(x, y, r, sugar.base)).join(''),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 60 }, right: { x: 58.5, y: 60 }, r: 5.6, style: 'round' },
    brows: { lift: 1.75, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 73, w: 15 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 10 },
  },
  pivot: { x: 50, y: 60 },
  base: 92,
  squash: true,
  motionBias: ['squash', 'bounce', 'wobble', 'spin'],
  gimmicks: [
    {
      id: 'jam',
      z: 'back',
      markup:
        jamShape(jam.shade, 0, 0) +
        jamShape(jam.base, -0.8, -0.9) +
        ellipse(45.6, 23.6, 2.6, 1.3, jam.light, -18) +
        circle(53.2, 22.2, 0.9, jam.light),
      anim: {
        trigger: ['angry'],
        durationMs: 380,
        loop: true,
        keyframes: [{ t: 0 }, { t: 0.5, sx: 1.1, sy: 0.9 }, { t: 1 }],
        origin: { x: 50, y: 32 },
      },
    },
    jamDrip(0),
    jamDrip(1),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Bourekas: a puffy pastry triangle, its edges puffed pale and flaky, its top egg-washed golden, sesame on top
// and sesame freckles on its cheeks. Steam rises from its tip: fresh from the oven (idle), hot-headed (angry).

const pastry = FUR.golden;
/** The egg-washed top, browner than the puffed edges. */
const glaze = ramp(
  mix(FUR.golden.base, FUR.tawny.base, 0.45),
  FUR.tawny.shade,
  mix(FUR.golden.base, FUR.golden.light, 0.6),
);
const sesame = OBJECT.cream.light;
/** A puffy pillow of a triangle. */
const bourekasShape = 'M43 17.5Q50 7.5 57 17.5Q75 41.5 86 70Q91 87 75 87H25Q9 87 14 70Q25 41.5 43 17.5Z';
/** Its egg-washed top, inside the puffed edges. */
const bourekasTop =
  'M45.2 22.4Q50 15.6 54.8 22.4Q70.6 43.6 79.8 68.4Q83.2 80.2 72.4 80.2H27.6Q16.8 80.2 20.2 68.4Q29.4 43.6 45.2 22.4Z';
/** Sesame seeds: [x, y, deg]. */
const sesameSeeds: readonly (readonly [number, number, number])[] = [
  [49.5, 22, -20],
  [44.6, 29, 30],
  [55, 28.5, -40],
  [39, 36.4, 10],
  [61.5, 36, -15],
  // freckles
  [32.2, 66.5, 25],
  [35.8, 71.5, -35],
  [29.6, 72.4, 70],
  [67.8, 66.5, -25],
  [64.2, 71.5, 35],
  [70.4, 72.4, -70],
];
const steamPuff = (i: number, p: Pt): GimmickDef => ({
  id: `steam-${i}`,
  rest: 'hidden',
  markup:
    circle(p[0], p[1], 3.4, OBJECT.white.base) +
    circle(p[0] + 3, p[1] - 1.4, 2.6, OBJECT.white.base) +
    circle(p[0] - 2.4, p[1] - 2, 2.3, OBJECT.white.base),
  anim: {
    ...R.steam({ rise: 10, ms: 2000 }),
    delayMs: i * 667,
    trigger: ['idle', 'angry'],
    origin: { x: p[0], y: p[1] },
  },
});

const bourekas: AvatarDef = {
  id: 'bourekas',
  kind: 'food',
  name: { he: 'בורקס', en: 'Bourekas' },
  tile: TILE.violet,
  layers: {
    back:
      // the puffed pastry: shade, then the lit edges up and left; flaky layers along the bottom edge
      shaded(bourekasShape, pastry.light, pastry.shade) +
      line('M24 84H76', pastry.base, 1.1) +
      line('M17.4 79.6Q20 82.4 26 82.4', pastry.base, 1) +
      line('M82.6 79.6Q80 82.4 74 82.4', pastry.base, 1) +
      // the egg-washed top, a shine on it, the sesame (and its freckles)
      path(bourekasTop, glaze.base) +
      line('M44.2 27.6Q35.6 40 30.4 53', glaze.light, 2.6) +
      sesameSeeds.map(([x, y, deg]) => ellipse(x, y, 1.1, 2, sesame, deg)).join(''),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 57 }, right: { x: 58.5, y: 57 }, r: 5.5, style: 'round' },
    brows: { lift: 1.75, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 70.5, w: 15 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 8 },
  },
  pivot: { x: 50, y: 56 },
  base: 88,
  squash: true,
  motionBias: ['squash', 'nod', 'wobble', 'tilt'],
  gimmicks: [steamPuff(0, [44.5, 17]), steamPuff(1, [55.5, 16]), steamPuff(2, [50, 12.5])],
};

// ---------------------------------------------------------------------------------------------------------
// Pizza slice: a slice with a puffy crust on top and pepperoni, standing on its tip. The face sits on the
// cheese. Its gimmick is the cheese: two drips and a string at the tip that stretch when it squashes and
// bounces (the string stays stuck to the plate), and ooze slowly when idle.

const crust = FUR.golden;
const cheese = OBJECT.gold;
const sauce = OBJECT.red;
const pepperoni = OBJECT.red;
const sliceCheese = 'M14.6 25.6Q50 11 85.4 25.6L53.4 89.6Q50 95 46.6 89.6Z';

/** A capsule hanging from (x, y): `w` wide, `len` long, its bottom end round. */
const capsule = (x: number, y: number, w: number, len: number) => {
  const h = w / 2;
  return `M${P([x - h, y])}L${P([x - h, y + len - h])}A${P([h, h])} 0 0 0 ${P([x + h, y + len - h])}L${P([x + h, y])}Z`;
};
/** A cheese drip hanging from (x, y): its shade, and the lit cheese a little narrower on the left. */
const cheeseDrip = (x: number, y: number, w: number, len: number) =>
  path(capsule(x, y, w, len), cheese.base) + path(capsule(x - 0.6, y, w - 1.2, len - 0.7), cheese.light);
const pepperoniAt = (x: number, y: number, r: number) =>
  circle(x + 0.6, y + 0.6, r, pepperoni.shade) +
  circle(x - 0.2, y - 0.2, r - 0.6, pepperoni.base) +
  circle(x - 0.35 * r, y - 0.3 * r, 0.18 * r, pepperoni.light) +
  circle(x + 0.3 * r, y + 0.25 * r, 0.14 * r, pepperoni.shade);

/**
 * The cheese stretching down from where it hangs, `amount` longer at the most: with the squash motion
 * (1100 ms) and the bounce (1000 ms), in step with their jumps, and slowly when idle.
 */
const stretch = (amount: number, [x, y]: Pt): GimmickAnim[] => [
  {
    trigger: ['squash'],
    durationMs: 1100,
    keyframes: [
      { t: 0 },
      { t: 0.13, sy: 0.9 },
      { t: 0.3, sy: 1 + 0.75 * amount },
      { t: 0.44, sy: 1 + amount },
      { t: 0.58, sy: 1.1, ease: 'emphasized' },
      { t: 0.66, sy: 0.85 },
      { t: 0.78, sy: 1.12 },
      { t: 0.88 },
      { t: 1 },
    ],
    origin: { x, y },
  },
  {
    trigger: ['bounce'],
    durationMs: 1000,
    keyframes: [
      { t: 0 },
      { t: 0.28, sy: 1 + 0.9 * amount },
      { t: 0.52, sy: 0.9 },
      { t: 0.68, sy: 1 + 0.4 * amount },
      { t: 0.82 },
      { t: 1 },
    ],
    origin: { x, y },
  },
  {
    trigger: ['idle'],
    durationMs: 3200,
    loop: true,
    keyframes: [{ t: 0 }, { t: 0.5, sy: 1.18 }, { t: 1 }],
    origin: { x, y },
  },
];

const pizza: AvatarDef = {
  id: 'pizza',
  kind: 'food',
  name: { he: 'משולש פיצה', en: 'Pizza slice' },
  tile: TILE.jade,
  layers: {
    back:
      shaded(sliceCheese, cheese.light, cheese.base) +
      // bubbles in the cheese
      circle(30.5, 48, 1.6, cheese.base) +
      circle(69.5, 36, 1.5, cheese.base) +
      circle(64.5, 56, 1.2, cheese.base) +
      circle(43.5, 80, 1.1, cheese.base) +
      pepperoniAt(25, 33.5, 4.6) +
      pepperoniAt(47, 70.5, 5) +
      pepperoniAt(52.6, 81.4, 2.9) +
      // the sauce under the crust, the crust
      line('M16.5 27.4Q50 13.5 83.5 27.4', sauce.base, 4) +
      line('M15.6 23.4Q50 6.6 84.4 23.4', crust.shade, 12.4) +
      line('M15 22.2Q50 5.4 83.8 22.2', crust.base, 10) +
      line('M22 17.6Q35 12 46 10.6', crust.light, 2.6) +
      circle(62, 13, 1.1, FUR.tawny.base) +
      circle(72, 16, 1, FUR.tawny.base),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 42, y: 41 }, right: { x: 58, y: 41 }, r: 5.2, style: 'round' },
    brows: { lift: 1.75, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 54, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 7 },
  },
  pivot: { x: 50, y: 45 },
  base: 92,
  squash: true,
  motionBias: ['squash', 'spin', 'bounce', 'tilt'],
  gimmicks: [
    { id: 'drip-left', z: 'back', markup: cheeseDrip(24.5, 42, 5.6, 10), anim: stretch(1.4, [24.5, 42]) },
    { id: 'drip-right', z: 'back', markup: cheeseDrip(71.5, 51, 5, 8), anim: stretch(1.4, [71.5, 51]) },
    { id: 'string', z: 'back', markup: cheeseDrip(50, 88, 3, 7), anim: stretch(1.6, [50, 88]) },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Ice-cream cone: a strawberry scoop with sprinkles and a cherry on a waffle cone. The scoop holds the face
// (`z: 'face'`): it melts down when it is sad, and drops drip off it when it is sad or angry.

const scoop = OBJECT.pink;
const cone = FUR.golden;
const conePoly: readonly Pt[] = [
  [30, 60],
  [70, 60],
  [50, 95],
];
const scoopShape =
  'M23.5 48A28 28 0 1 1 76.5 48Q79 56 73.5 59.5Q70.5 64.5 65.5 61.5Q61 66.5 56 62.5Q51 67 46 62.5Q41.5 66 37.5' +
  ' 62Q34 70.5 29 67Q26.4 64.5 27.6 60Q21.6 56 23.5 48Z';
/** A sprinkle: a short capsule at (x, y), turned `deg`. */
const sprinkle = (x: number, y: number, deg: number, color: string) =>
  line(`M${P(at(x, y, 1.6, deg + 180))}L${P(at(x, y, 1.6, deg))}`, color, 1.8);
const meltDrop = (i: number, p: Pt): GimmickDef => ({
  id: `drop-${i}`,
  rest: 'hidden',
  markup: drop(p, 2.2, scoop.base),
  anim: {
    ...R.drip({ fall: 16, ms: 1500 }),
    delayMs: i * 750,
    trigger: ['sad', 'angry'],
    origin: { x: p[0], y: p[1] },
  },
});

const iceCream: AvatarDef = {
  id: 'ice-cream',
  kind: 'food',
  name: { he: 'גלידה', en: 'Ice-cream cone' },
  tile: TILE.cobalt,
  layers: {
    back:
      shaded('M30 59H70L52.6 92.6Q50 96.6 47.4 92.6Z', cone.base, cone.shade) +
      hatch(conePoly, 60, 6, [50, 95], 1.2, cone.shade, 1.3) +
      hatch(conePoly, 120, 6, [50, 95], 1.2, cone.shade, 1.3),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 37 }, right: { x: 58.5, y: 37 }, r: 5.6, style: 'round' },
    brows: { lift: 1.75, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 50.5, w: 15 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 6 },
  },
  pivot: { x: 50, y: 50 },
  base: 95,
  squash: true,
  motionBias: ['wobble', 'squash', 'bounce', 'spin'],
  gimmicks: [
    {
      id: 'scoop',
      z: 'face',
      markup:
        path(scoopShape, scoop.shade) +
        path(scoopShape, scoop.base, ' transform="translate(-1.4 -1.4)"') +
        ellipse(29.5, 36, 2.6, 6, scoop.light, 22) +
        sprinkle(31, 25.5, 40, OBJECT.blue.base) +
        sprinkle(38.5, 17.6, -30, OBJECT.gold.base) +
        sprinkle(63, 18, 25, OBJECT.white.base) +
        sprinkle(70, 27, -45, OBJECT.green.base) +
        // the cherry
        line('M51.5 10.5Q52.5 5.5 57 4.5', FUR.chocolate.base, 1.4) +
        circle(50.6, 13.6, 4.4, OBJECT.red.shade) +
        circle(50, 13, 3.9, OBJECT.red.base) +
        circle(48.6, 11.6, 1.1, OBJECT.red.light),
      anim: {
        // melts
        trigger: ['sad'],
        durationMs: 1600,
        keyframes: [
          { t: 0, ease: 'standard' },
          { t: 0.6, sx: 1.05, sy: 0.9 },
          { t: 1, sx: 1.07, sy: 0.87 },
        ],
        origin: { x: 50, y: 63 },
      },
    },
    meltDrop(0, [29, 69]),
    meltDrop(1, [72.5, 62]),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Broccoli: a little tree with a face. The face sits on the thick, pale stalk; the crown of florets on top is
// its gimmick: it rustles when idle, hops up like a hat when surprised, shakes when it laughs.

const floret = FOOD_COLOR.floret;
const stalk = FOOD_COLOR.stalk;
const stalkShape = 'M31 42H69Q69.5 66 73.5 84Q75.5 93 67 93H33Q24.5 93 26.5 84Q30.5 66 31 42Z';
/** The florets, back to front. */
const florets: readonly Dot[] = [
  [30, 26, 11],
  [70, 26, 11],
  [50, 21, 12],
  [19.5, 38, 9.5],
  [80.5, 38, 9.5],
  [39, 31.5, 11],
  [61, 31.5, 11],
  [36, 36.5, 8.5],
  [64, 36.5, 8.5],
  [50, 35, 10],
];

const broccoli: AvatarDef = {
  id: 'broccoli',
  kind: 'food',
  name: { he: 'ברוקולי', en: 'Broccoli' },
  tile: TILE.orchid,
  layers: {
    back:
      // a leaf out of the stalk's side
      path('M30 77Q21 79 15.5 70.5Q22.5 65 30.5 70.5Z', floret.shade) +
      path('M29.6 76Q21.4 77.6 16.6 70.4Q23 66 29.8 70.6Z', floret.base) +
      // the branches under the crown (they show when it hops)
      path('M35 44L30 32H36L42 44Z', stalk.shade) +
      path('M65 44L70 32H64L58 44Z', stalk.shade) +
      path('M46 44L47 30H53L54 44Z', stalk.shade) +
      shaded(stalkShape, stalk.base, stalk.shade) +
      line('M34.4 50Q34 70 31 86', stalk.light, 1.6),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 42, y: 62 }, right: { x: 58, y: 62 }, r: 5, style: 'round' },
    brows: { lift: 1.7, length: 1.7, thickness: 2.1, color: floret.shade },
    mouth: { x: 50, y: 75, w: 13 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 8 },
  },
  pivot: { x: 50, y: 55 },
  base: 93,
  squash: true,
  motionBias: ['nod', 'wobble', 'bounce', 'squash'],
  gimmicks: [
    {
      id: 'crown',
      z: 'back',
      markup: florets
        .map(
          ([x, y, r]) =>
            circle(x + 1, y + 1, r, floret.shade) +
            circle(x - 0.3, y - 0.3, r - 0.9, floret.base) +
            circle(x - 0.38 * r, y - 0.38 * r, 0.2 * r, floret.light) +
            circle(x + 0.1 * r, y - 0.5 * r, 0.14 * r, floret.light),
        )
        .join(''),
      anim: [
        { ...R.popUp({ height: 7, ms: 1100 }), trigger: ['surprised'], origin: { x: 50, y: 46 } },
        {
          trigger: ['laugh'],
          durationMs: 420,
          loop: true,
          keyframes: [{ t: 0 }, { t: 0.5, y: -1.6, rotate: 1.5 }, { t: 1 }],
          origin: { x: 50, y: 46 },
        },
        { ...R.sway({ angle: 6, ms: 1000 }), trigger: ['dizzy'], origin: { x: 50, y: 46 } },
        { ...R.sway({ angle: 2, ms: 3200 }), trigger: ['idle'], origin: { x: 50, y: 46 } },
      ],
    },
  ],
};

export const FOOD: readonly AvatarDef[] = [
  broom,
  pottedCactus,
  falafel,
  friedEgg,
  avocado,
  sufganiya,
  bourekas,
  pizza,
  iceCream,
  broccoli,
];
