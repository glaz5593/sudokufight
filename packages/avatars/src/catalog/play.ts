/**
 * Toys, games, music and sport (kind `object`): a puzzle cube, an hourglass, a horseshoe magnet, a cassette,
 * an accordion, a balloon, a bowling pin, a joystick, a microphone and a boxing glove. Each is the whole
 * object, standing in the tile with room for squash and stretch, and most have a moving part of their own
 * (a gimmick): the cube's front layer turns, the sand runs, paper clips fly to the magnet, the reels turn.
 *
 * Read docs/avatars/STYLE.md first. Shared drawing helpers: ./draw.ts; gimmick recipes: ../gimmick.ts.
 */

import { GIMMICK_RECIPES as R } from '../gimmick';
import { CLOTH, FACE, FUR, HAIR, mix, OBJECT, type Ramp, TILE } from '../palette';
import { f } from '../svg';
import type { AvatarDef, GimmickAnim, GimmickDef, GimmickKeyframe } from '../types';
import { circle, ellipse, lerp, line, P, path, polar, type Pt, rect, shaded } from './draw';

// ---------------------------------------------------------------------------------------------------------
// Helpers for this file

/** A corner of a polygon, with how much to round it (default: the polygon's radius). */
type Corner = readonly [x: number, y: number, r?: number];
/** A corner that is not rounded. */
const sharp = ([x, y]: Pt): Corner => [x, y, 0];

/** A closed polygon whose corners are rounded (a quadratic curve through each corner). */
function roundPoly(pts: readonly Corner[], r: number): string {
  const n = pts.length;
  const at = (i: number): Corner => pts[((i % n) + n) % n] ?? [0, 0];
  const toward = (p: Corner, q: Corner, rr: number): Pt => {
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    return lerp([p[0], p[1]], [q[0], q[1]], Math.min(rr, l / 2) / l);
  };
  return (
    pts
      .map((p, i) => {
        const rr = p[2] ?? r;
        const a = toward(p, at(i - 1), rr);
        const b = toward(p, at(i + 1), rr);
        return `${i ? 'L' : 'M'}${P(a)}Q${P([p[0], p[1]])} ${P(b)}`;
      })
      .join('') + 'Z'
  );
}

/** The right half of a symmetric outline as cubic segments [c1, c2, end], from `top` down. */
type Seg = readonly [Pt, Pt, Pt];
const flipX = ([x, y]: Pt): Pt => [100 - x, y];

/** A closed outline, symmetric about x 50: the right half as given, the left half mirrored. */
function symmetric(top: Pt, segs: readonly Seg[]): string {
  const starts: Pt[] = [top, ...segs.map((s) => s[2])];
  let d = `M${P(top)}`;
  for (const [c1, c2, end] of segs) d += `C${P(c1)} ${P(c2)} ${P(end)}`;
  d += `L${P(flipX(starts[segs.length] ?? top))}`;
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    if (s) d += `C${P(flipX(s[1]))} ${P(flipX(s[0]))} ${P(flipX(starts[i] ?? top))}`;
  }
  return d + 'Z';
}

/** The half-width of a symmetric outline at height `y` (sampled from its right half). */
function halfWidth(top: Pt, segs: readonly Seg[], y: number): number {
  const pts: Pt[] = [top];
  let from = top;
  for (const [c1, c2, end] of segs) {
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      const u = 1 - t;
      const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
      pts.push([
        k[0] * from[0] + k[1] * c1[0] + k[2] * c2[0] + k[3] * end[0],
        k[0] * from[1] + k[1] * c1[1] + k[2] * c2[1] + k[3] * end[1],
      ]);
    }
    from = end;
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a && b && (a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1])
      return lerp(a, b, (y - a[1]) / (b[1] - a[1]))[0] - 50;
  }
  return 0;
}

/** x where a horizontal line at `y` meets an ellipse, on the left (−1) or right (+1). */
const chordX = (cx: number, cy: number, rx: number, ry: number, y: number, s: -1 | 1) =>
  cx + s * rx * Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2));

/** A music note (an eighth note) whose head sits at (x, y). */
const note = (x: number, y: number, color: string) =>
  ellipse(x, y, 2.7, 2.05, color, -22) +
  line(`M${P([x + 2.25, y - 0.7])}V${f(y - 10)}`, color, 1.3) +
  line(
    `M${P([x + 2.25, y - 10])}C${P([x + 4.4, y - 8.8])} ${P([x + 6.4, y - 7.6])} ${P([x + 5.2, y - 4.4])}`,
    color,
    1.3,
  );

/** Two eighth notes on a beam, the first head at (x, y). */
const notePair = (x: number, y: number, color: string) =>
  ellipse(x, y, 2.5, 1.95, color, -22) +
  ellipse(x + 7.2, y - 1.6, 2.5, 1.95, color, -22) +
  line(`M${P([x + 2.1, y - 0.7])}V${f(y - 9.6)}`, color, 1.3) +
  line(`M${P([x + 9.3, y - 2.3])}V${f(y - 11.2)}`, color, 1.3) +
  path(
    `M${P([x + 1.45, y - 10.6])}L${P([x + 9.95, y - 12.2])}V${f(y - 9.6)}L${P([x + 1.45, y - 8])}Z`,
    color,
  );

/** A note rising and swaying, then gone (loops; rest hidden). */
const riseKeys = (rise: number, sway: number): GimmickKeyframe[] => [
  { t: 0, sx: 0.6, sy: 0.6, rotate: -10, opacity: 0 },
  { t: 0.15, y: -0.15 * rise, rotate: 0, opacity: 1 },
  { t: 0.5, x: sway, y: -0.5 * rise, rotate: 10 },
  { t: 0.8, x: -0.4 * sway, y: -0.8 * rise, rotate: -4, opacity: 1 },
  { t: 1, y: -rise, opacity: 0 },
];

/** A gimmick anim: what plays it, its fixed point (a hinge, an axle), how long, its keyframes, and the rest. */
const anim = (
  trigger: GimmickAnim['trigger'],
  origin: Pt,
  durationMs: number,
  keyframes: readonly GimmickKeyframe[],
  more: Partial<GimmickAnim> = {},
): GimmickAnim => ({ trigger, origin: { x: origin[0], y: origin[1] }, durationMs, keyframes, ...more });

// ---------------------------------------------------------------------------------------------------------
// Puzzle cube: a 3 x 3 cube seen from the front and a little above, its front side solved (yellow, where the
// face sits) and the rest scrambled. The front layer holds the face (`z: 'face'`) and turns like a real move:
// a quarter turn when it spins, a fidget now and then when idle, a half-turned tilt when confused.

const cubeBody = FUR.black;
const cubeFront = OBJECT.gold;
/** The front face: (13, 32) to (69, 88); the depth goes (15, −13) up and to the right. */
const CUBE = { x: 13, y: 32, s: 56, dx: 15, dy: -13 } as const;
/** A point on the top: `u` along the front edge, `v` into the depth (0-1). */
const cubeTop = (u: number, v: number): Pt => [CUBE.x + CUBE.s * u + CUBE.dx * v, CUBE.y + CUBE.dy * v];
/** A point on the right side: `v` into the depth, `w` down (0-1). */
const cubeSide = (v: number, w: number): Pt => [
  CUBE.x + CUBE.s + CUBE.dx * v,
  CUBE.y + CUBE.dy * v + CUBE.s * w,
];
const DEPTH = Math.hypot(CUBE.dx, CUBE.dy);
/** One sticker: cell (i, j) of a 3 x 3 side drawn by `at`, inset `ga` and `gb` (fractions of the side). */
const sticker = (
  at: (a: number, b: number) => Pt,
  i: number,
  j: number,
  ga: number,
  gb: number,
  fill: string,
) =>
  path(
    roundPoly(
      [
        at(i / 3 + ga, j / 3 + gb),
        at((i + 1) / 3 - ga, j / 3 + gb),
        at((i + 1) / 3 - ga, (j + 1) / 3 - gb),
        at(i / 3 + ga, (j + 1) / 3 - gb),
      ],
      0.9,
    ),
    fill,
  );
/** Stickers on the top (lit) and on the side (in shade): column `i` from the front, row `j` from the top. */
const topSticker = (i: number, j: number, c: Ramp) => sticker(cubeTop, i, j, 1.2 / CUBE.s, 1 / DEPTH, c.base);
const sideSticker = (i: number, j: number, c: Ramp) =>
  sticker(cubeSide, i, j, 1 / DEPTH, 1.2 / CUBE.s, c.shade);
const { red, white, blue, green, orange, gold } = OBJECT;
/**
 * The scramble. TOP[row from the front edge back][column from the left];
 * SIDE[row from the top][column from the front].
 */
const TOP: readonly (readonly Ramp[])[] = [
  [red, white, blue],
  [green, orange, gold],
  [white, blue, red],
];
const SIDE: readonly (readonly Ramp[])[] = [
  [orange, green, white],
  [red, blue, gold],
  [green, white, orange],
];
const cubeR = 3.4;
const third = 1 / 3;
/** The front panel's grooves: short cuts in from each edge, so the face sits on a calm yellow middle. */
const g1 = CUBE.x + CUBE.s / 3;
const g2 = CUBE.x + (2 * CUBE.s) / 3;
const h1 = CUBE.y + CUBE.s / 3;
const h2 = CUBE.y + (2 * CUBE.s) / 3;
const cubeGrooves =
  `M${f(g1)} 34.6V39.4M${f(g2)} 34.6V39.4M${f(g1)} 81V85.4M${f(g2)} 81V85.4` +
  `M15.6 ${f(h1)}H20.4M15.6 ${f(h2)}H20.4M61.6 ${f(h1)}H66.4M61.6 ${f(h2)}H66.4`;
const frontLayer =
  // the layer's own body: the front square, a third of the top, a third of the side
  path(
    roundPoly(
      [
        [CUBE.x, CUBE.y + CUBE.s],
        [CUBE.x, CUBE.y],
        cubeTop(0, third),
        cubeTop(1, third),
        cubeSide(third, 1),
        cubeSide(0, 1),
      ],
      cubeR,
    ),
    cubeBody.base,
  ) +
  path(
    roundPoly([sharp(cubeTop(0, 0)), cubeTop(0, third), cubeTop(1, third), sharp(cubeTop(1, 0))], cubeR),
    cubeBody.light,
  ) +
  path(
    roundPoly([sharp(cubeSide(0, 0)), cubeSide(third, 0), cubeSide(third, 1), sharp(cubeSide(0, 1))], cubeR),
    cubeBody.shade,
  ) +
  (TOP[0] ?? []).map((c, i) => topSticker(i, 0, c)).join('') +
  SIDE.map((row, j) => sideSticker(0, j, row[0] ?? white)).join('') +
  // the solved yellow front, its grooves and a shine
  path(
    roundPoly(
      [
        [15.2, 34.2],
        [66.8, 34.2],
        [66.8, 85.8],
        [15.2, 85.8],
      ],
      2.6,
    ),
    cubeFront.shade,
  ) +
  path(
    roundPoly(
      [
        [15.2, 34.2],
        [65.6, 34.2],
        [65.6, 84.6],
        [15.2, 84.6],
      ],
      2.6,
    ),
    cubeFront.base,
  ) +
  line(cubeGrooves, cubeFront.shade, 1.3) +
  ellipse(19.8, 41, 1.8, 3.4, cubeFront.light);
const cubeTurn: Pt = [41, 60];

const puzzleCube: AvatarDef = {
  id: 'puzzle-cube',
  kind: 'object',
  name: { he: 'קוביה הונגרית', en: 'Puzzle cube' },
  tile: TILE.violet,
  layers: {
    back:
      // the body behind the front layer: black, its top lit and its side in shade, and their stickers
      path(
        roundPoly(
          [
            [CUBE.x, CUBE.y + CUBE.s],
            [CUBE.x, CUBE.y],
            cubeTop(0, 1),
            cubeTop(1, 1),
            cubeSide(1, 1),
            cubeSide(0, 1),
          ],
          cubeR,
        ),
        cubeBody.base,
      ) +
      path(
        roundPoly([sharp(cubeTop(0, third)), cubeTop(0, 1), cubeTop(1, 1), sharp(cubeTop(1, third))], cubeR),
        cubeBody.light,
      ) +
      path(
        roundPoly(
          [sharp(cubeSide(third, 0)), cubeSide(1, 0), cubeSide(1, 1), sharp(cubeSide(third, 1))],
          cubeR,
        ),
        cubeBody.shade,
      ) +
      TOP.slice(1)
        .map((row, j) => row.map((c, i) => topSticker(i, j + 1, c)).join(''))
        .join('') +
      SIDE.map((row, j) =>
        row
          .slice(1)
          .map((c, i) => sideSticker(i + 1, j, c))
          .join(''),
      ).join(''),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 31.5, y: 60 }, right: { x: 50.5, y: 60 }, r: 5.6, style: 'round' },
    brows: { lift: 1.75, length: 1.7, thickness: 2.3 },
    mouth: { x: 41, y: 74.5, w: 16 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 48, y: 8 },
  },
  pivot: { x: 48.5, y: 53.5 },
  base: 88,
  squash: true,
  motionBias: ['spin', 'tilt', 'bounce', 'squash'],
  gimmicks: [
    {
      id: 'front-layer',
      z: 'face',
      markup: frontLayer,
      anim: [
        anim(['spin'], cubeTurn, 1300, [
          { t: 0, ease: 'emphasized' },
          { t: 0.32, rotate: -90 },
          { t: 0.58, rotate: -90, ease: 'emphasized' },
          { t: 0.88 },
          { t: 1 },
        ]),
        {
          ...R.sway({ angle: 18, ms: 1400 }),
          trigger: ['dizzy'],
          origin: { x: cubeTurn[0], y: cubeTurn[1] },
        },
        anim(['confused'], cubeTurn, 600, [
          { t: 0, ease: 'emphasized' },
          { t: 1, rotate: -15 },
        ]),
        anim(
          ['idle'],
          cubeTurn,
          5600,
          [
            { t: 0 },
            { t: 0.7, ease: 'emphasized' },
            { t: 0.78, rotate: -16 },
            { t: 0.9, rotate: -16, ease: 'emphasized' },
            { t: 0.98 },
            { t: 1 },
          ],
          { loop: true },
        ),
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Hourglass: a wooden frame round two glass bulbs. The face sits on the sand of the full upper bulb; a thin
// stream runs into the lower one, and grains fall along it when idle (fast when it spins: turning it over is
// what an hourglass is for).

const wood = HAIR.chestnut;
const sand = FUR.golden;
const glassH = {
  base: mix(OBJECT.white.base, OBJECT.blue.light, 0.4),
  shade: mix(OBJECT.white.shade, OBJECT.blue.light, 0.6),
};
const bulb = { rx: 20.5, ry: 17.75, top: 33.25, bottom: 68.25 } as const;
const sandIn = { rx: 19, ry: 16.25 } as const;
const sandLevel = 22;
const sandTopX = chordX(50, bulb.top, sandIn.rx, sandIn.ry, sandLevel, 1);
const pileY = 75;
const pileX = chordX(50, bulb.bottom, sandIn.rx, sandIn.ry, pileY, 1);
const plate = (y: number) =>
  rect(19.5, y + 0.9, 62, 7.6, wood.shade, 3.4) +
  rect(18.6, y, 61.6, 7.2, wood.base, 3.4) +
  rect(21.5, y + 1.2, 18, 1.8, wood.light, 0.9);
const grain = (i: number): GimmickDef => ({
  id: `grain-${i}`,
  rest: 'hidden',
  markup: circle(50, 55, 1.7, sand.shade),
  anim: [
    {
      ...R.drip({ fall: 12, ms: 420 }),
      delayMs: i * 140,
      trigger: ['spin', 'dizzy'],
      origin: { x: 50, y: 55 },
    },
    {
      ...R.drip({ fall: 12, ms: 1200 }),
      delayMs: i * 400,
      trigger: ['idle', 'laugh'],
      origin: { x: 50, y: 55 },
    },
  ],
});

const hourglass: AvatarDef = {
  id: 'hourglass',
  kind: 'object',
  name: { he: 'שעון חול', en: 'Hourglass' },
  tile: TILE.teal,
  layers: {
    back:
      // the posts
      rect(23, 14, 4.2, 73, wood.shade, 2.1) +
      rect(72.8, 14, 4.2, 73, wood.shade, 2.1) +
      rect(23, 14, 2.6, 73, wood.base, 1.3) +
      rect(72.8, 14, 2.6, 73, wood.base, 1.3) +
      // the glass: two bulbs and a neck, shade then the lit surface up and left
      ellipse(50, bulb.top, bulb.rx, bulb.ry, glassH.shade) +
      ellipse(50, bulb.bottom, bulb.rx, bulb.ry, glassH.shade) +
      rect(46, 46, 8, 10, glassH.shade) +
      ellipse(49.2, bulb.top - 0.8, bulb.rx - 0.6, bulb.ry - 0.6, glassH.base) +
      ellipse(49.2, bulb.bottom - 0.8, bulb.rx - 0.6, bulb.ry - 0.6, glassH.base) +
      // the sand: the full upper bulb (where the face sits), into the neck; the stream; the pile below
      path(
        `M${P([100 - sandTopX, sandLevel])}Q50 23.4 ${P([sandTopX, sandLevel])}` +
          `A${sandIn.rx} ${sandIn.ry} 0 1 1 ${P([100 - sandTopX, sandLevel])}Z`,
        sand.base,
      ) +
      path('M45 46.5L48.7 53.6H51.3L55 46.5Z', sand.base) +
      path(
        `M${P([sandTopX, sandLevel])}A${sandIn.rx} ${sandIn.ry} 0 0 1 55 46.5L56.8 44.6A${sandIn.rx - 1} ${sandIn.ry - 1} 0 0 0 ${P([sandTopX - 0.6, sandLevel + 1.8])}Z`,
        sand.shade,
      ) +
      line('M50 53.6V69', sand.base, 1.1) +
      path(
        `M${P([100 - pileX, pileY])}Q50 62 ${P([pileX, pileY])}A${sandIn.rx} ${sandIn.ry} 0 0 1 ${P([100 - pileX, pileY])}Z`,
        sand.base,
      ) +
      // glints on the glass
      line(
        `M${polar(49.2, bulb.top, 17, 196)}A17 15 0 0 1 ${polar(49.2, bulb.top, 16, 222)}`,
        OBJECT.white.light,
        2.2,
      ) +
      line(
        `M${polar(49.2, bulb.bottom, 17, 160)}A17 15 0 0 0 ${polar(49.2, bulb.bottom, 16.5, 140)}`,
        OBJECT.white.light,
        2.2,
      ) +
      // the plates
      plate(8) +
      plate(85),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 42, y: 33.5 }, right: { x: 58, y: 33.5 }, r: 5, style: 'round' },
    brows: { lift: 1.75, length: 1.7, thickness: 2.1 },
    mouth: { x: 50, y: 45.5, w: 12.5 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 5 },
  },
  pivot: { x: 50, y: 50.5 },
  base: 93,
  squash: true,
  motionBias: ['spin', 'wobble', 'tilt', 'squash'],
  gimmicks: [grain(0), grain(1), grain(2)],
};

// ---------------------------------------------------------------------------------------------------------
// Horseshoe magnet: a chunky red U with steel poles. The face sits on the bend; when it is happy, paper clips
// fly in from the edges and stick to it.

const magnetRed = OBJECT.red;
const pole = OBJECT.steel;
/** The U: down to its feet (`to` undefined), or cut straight across at `to` (the red part over the poles). */
const magnetShape = (to?: number) =>
  `M18 ${to ?? 82}V42A32 32 0 0 1 82 42V${to ?? 82}` +
  (to === undefined ? `Q82 84 80 84H61Q59 84 59 82` : `H59`) +
  `V67A9 9 0 0 0 41 67` +
  (to === undefined ? `V82Q41 84 39 84H20Q18 84 18 82Z` : `V${to}Z`);
/** A paper clip: three straight runs and three bends, its top at (0, 0) pointing down. */
const CLIP = 'M1.4 4.6V10.6A1.5 1.5 0 0 1 -1.6 10.6V2.6A2.2 2.2 0 0 1 2.8 2.6V12A2.9 2.9 0 0 1 -3 12V5.4';
const clip = (
  id: string,
  at: Pt,
  deg: number,
  color: string,
  from: Pt,
  spin: number,
  delay: number,
): GimmickDef => ({
  id,
  rest: 'hidden',
  markup: `<g transform="translate(${P(at)}) rotate(${f(deg)}) scale(1.15)">${line(CLIP, color, 1.3)}</g>`,
  anim: anim(
    ['smile', 'laugh'],
    at,
    1000,
    [
      { t: 0, x: from[0], y: from[1], rotate: spin, opacity: 0, ease: 'linear' },
      { t: 0.1, x: 0.9 * from[0], y: 0.9 * from[1], rotate: 0.9 * spin, opacity: 1, ease: 'exit' },
      { t: 0.62, ease: 'standard' },
      { t: 0.74, rotate: 9 },
      { t: 0.86, rotate: -4 },
      { t: 1 },
    ],
    { delayMs: delay },
  ),
});

const magnet: AvatarDef = {
  id: 'magnet',
  kind: 'object',
  name: { he: 'מגנט פרסה', en: 'Horseshoe magnet' },
  tile: TILE.sky,
  layers: {
    back:
      // the poles, then the red U over their tops
      path(magnetShape(), pole.shade) +
      path(magnetShape(), pole.base, ' transform="translate(-1.3 -1.2)"') +
      rect(19.2, 71, 3, 11, pole.light, 1.5) +
      rect(60.2, 71, 3, 11, pole.light, 1.5) +
      path(magnetShape(72), magnetRed.shade) +
      shaded(magnetShape(71), magnetRed.base, magnetRed.shade, -1.5, -1.3) +
      // a shine along the bend
      line(
        `M${polar(48.5, 40.7, 26.5, 196)}A26.5 26.5 0 0 1 ${polar(48.5, 40.7, 26.5, 236)}`,
        magnetRed.light,
        3.4,
      ),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41, y: 37 }, right: { x: 59, y: 37 }, r: 5.8, style: 'round' },
    brows: { lift: 1.72, length: 1.7, thickness: 2.3 },
    mouth: { x: 50, y: 51, w: 15 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 6 },
  },
  pivot: { x: 50, y: 47 },
  base: 84,
  squash: true,
  motionBias: ['bounce', 'squash', 'wobble', 'tilt'],
  gimmicks: [
    clip('clip-1', [25, 83.6], 32, OBJECT.gold.base, [-24, 12], -200, 0),
    clip('clip-2', [75, 83.6], -32, OBJECT.white.base, [24, 12], 220, 140),
    clip('clip-3', [81.6, 70], -64, OBJECT.pink.base, [16, -26], 160, 280),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Cassette tape: its two reels are the eyes. The hubs turn: slowly when idle, playing when it smiles or
// laughs, fast when dizzy, rewinding when it spins, winding down when it is sleepy.

const shell = CLOTH.charcoal;
const label = OBJECT.cream;
const tape = OBJECT.coffee;
const window_ = mix(OBJECT.steel.light, OBJECT.white.base, 0.35);
const reelL: Pt = [39, 48];
const reelR: Pt = [61, 48];
const hub = (c: Pt) =>
  circle(c[0], c[1], 7, OBJECT.steel.base) +
  [0, 60, 120, 180, 240, 300]
    .map((deg) => line(`M${polar(c[0], c[1], 6.2, deg)}L${polar(c[0], c[1], 7.2, deg)}`, shell.base, 2))
    .join('');
const reel = (id: string, c: Pt): GimmickDef => {
  const o = { x: c[0], y: c[1] };
  return {
    id,
    z: 'back',
    markup: hub(c),
    anim: [
      { ...R.spin({ ms: 520, reverse: true }), trigger: ['spin'], origin: o },
      { ...R.spin({ ms: 600 }), trigger: ['dizzy'], origin: o },
      { ...R.spin({ ms: 1700 }), trigger: ['smile', 'laugh'], origin: o },
      { ...R.spin({ ms: 7000 }), trigger: ['sleepy'], origin: o },
      { ...R.spin({ ms: 3400 }), trigger: ['idle'], origin: o },
    ],
  };
};
const screw = (x: number, y: number) =>
  circle(x, y, 1.8, shell.light) + line(`M${P([x - 1, y - 1])}L${P([x + 1, y + 1])}`, shell.shade, 0.7);

const cassette: AvatarDef = {
  id: 'cassette',
  kind: 'object',
  name: { he: 'קלטת', en: 'Cassette tape' },
  tile: TILE.mustard,
  layers: {
    back:
      // the shell
      rect(12.2, 25.2, 78, 54, shell.shade, 5) +
      rect(10.8, 24, 78, 54, shell.base, 5) +
      // the head opening at the bottom: a raised trapezoid with two holes
      path('M26 78L30.5 69.5H69.5L74 78Z', shell.light) +
      circle(38, 74.2, 1.9, shell.shade) +
      circle(62, 74.2, 1.9, shell.shade) +
      screw(15.6, 28.6) +
      screw(84, 28.6) +
      screw(15.6, 73.2) +
      screw(84, 73.2) +
      // the label: two stripes over the top, the window in the middle
      rect(17, 29.6, 66.6, 39.4, label.shade, 3.4) +
      rect(16.4, 29, 66.2, 38.8, label.base, 3.4) +
      path('M19.8 29H79.2Q82.6 29 82.6 32.4V33.4H16.4V32.4Q16.4 29 19.8 29Z', OBJECT.red.base) +
      rect(16.4, 33.4, 66.2, 2, OBJECT.orange.base) +
      rect(28.6, 39.4, 43.6, 19, label.shade, 9.5) +
      rect(28, 38.8, 43.6, 19, window_, 9.5) +
      // the tape wound on each reel (more on the left: it has just started)
      circle(reelL[0], reelL[1], 9.2, tape.base) +
      circle(reelR[0], reelR[1], 8.4, tape.base) +
      circle(reelL[0] - 0.6, reelL[1] - 0.6, 8.2, tape.light) +
      circle(reelL[0], reelL[1], 8.2, tape.base),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: reelL[0], y: reelL[1] }, right: { x: reelR[0], y: reelR[1] }, r: 4.9, style: 'round' },
    brows: { lift: 2.05, length: 1.75, thickness: 2.1 },
    mouth: { x: 50, y: 61.5, w: 12.5 },
    cheeks: { color: FACE.blush, dx: 0.1, dy: 2.45, size: 0.75 },
    halo: { x: 50, y: 15 },
  },
  pivot: { x: 50, y: 51 },
  base: 78,
  squash: true,
  motionBias: ['spin', 'bounce', 'shake', 'squash'],
  gimmicks: [reel('reel-left', reelL), reel('reel-right', reelR)],
};

// ---------------------------------------------------------------------------------------------------------
// Accordion: two blue end boxes (bass buttons on the left, keys on the right) and cream bellows, where the
// face sits. The bellows stretch and squeeze with squash and when it laughs, breathe when idle, and a note
// or two comes out as it plays.

const ends = OBJECT.blue;
const bellows = OBJECT.cream;
const FOLDS = 8;
const bellowsPath = (() => {
  const top: string[] = [];
  const bottom: string[] = [];
  for (let k = 0; k <= FOLDS; k++) {
    const x = 30 + (40 * k) / FOLDS;
    top.push(`${k ? 'L' : 'M'}${P([x, k % 2 ? 27.6 : 24])}`);
    bottom.unshift(`L${P([x, k % 2 ? 76.4 : 80])}`);
  }
  return top.join('') + bottom.join('') + 'Z';
})();
const bellowsArt =
  path(bellowsPath, bellows.base) +
  Array.from({ length: FOLDS }, (_, k) => {
    const x0 = 30 + (40 * k) / FOLDS;
    const x1 = x0 + 40 / FOLDS;
    const down = k % 2 === 0; // this pleat faces down and right: in shade
    return down
      ? path(`M${P([x0, 24])}L${P([x1, 27.6])}V76.4L${P([x0, 80])}Z`, mix(bellows.base, bellows.shade, 0.55))
      : '';
  }).join('') +
  rect(30, 25.4, 40, 1.6, bellows.shade) +
  rect(30, 77, 40, 1.6, bellows.shade);
const box = (x: number) => rect(x + 1.1, 21.2, 20, 63, ends.shade, 4) + rect(x, 20, 20, 62.6, ends.base, 4);
const leftBox =
  box(11) +
  rect(13.6, 23.4, 2.4, 55, ends.light, 1.2) +
  // the bass buttons: a column of big ones and a staggered column of small ones
  [31, 39, 47, 55, 63, 71]
    .map(
      (y) =>
        circle(21, y, 2.1, OBJECT.white.shade) +
        circle(20.6, y - 0.4, 2.1, OBJECT.white.base) +
        circle(26.4, y + 4, 1.7, OBJECT.white.base),
    )
    .join('');
const rightBox =
  // the keyboard: white keys, and the black ones in twos and threes
  box(69) +
  rect(72.2, 23.6, 13.4, 55.4, OBJECT.white.shade, 2) +
  rect(72.2, 23.6, 12.6, 54.6, OBJECT.white.base, 2) +
  [30, 36.8, 43.6, 50.4, 57.2, 64, 70.8].map((y) => rect(72.2, y, 12.6, 0.8, OBJECT.white.shade)).join('') +
  [27.6, 34.4, 47.6, 54.4, 61.2, 74].map((y) => rect(72.2, y, 6.4, 3.6, CLOTH.charcoal.base, 1)).join('');
/** The bellows' width factor over one anim, and the end boxes kept on its edges (half-width 20). */
const play = (
  trigger: GimmickAnim['trigger'],
  ms: number,
  keys: readonly (readonly [number, number])[],
  loop: boolean,
) => ({
  bellows: anim(
    trigger,
    [50, 52],
    ms,
    keys.map(([t, s]) => ({ t, sx: s })),
    { loop },
  ),
  left: anim(
    trigger,
    [21, 52],
    ms,
    keys.map(([t, s]) => ({ t, x: -20 * (s - 1) })),
    { loop },
  ),
  right: anim(
    trigger,
    [79, 52],
    ms,
    keys.map(([t, s]) => ({ t, x: 20 * (s - 1) })),
    { loop },
  ),
});
const SQUASH_KEYS = [
  [0, 1],
  [0.13, 0.82],
  [0.3, 1.18],
  [0.44, 1.28],
  [0.58, 1],
  [0.66, 0.84],
  [0.78, 1.06],
  [0.88, 1],
  [1, 1],
] as const;
const playSquash = play(['squash'], 1100, SQUASH_KEYS, false);
const playLaugh = play(
  ['laugh'],
  1000,
  [
    [0, 1],
    [0.4, 1.2],
    [0.8, 0.9],
    [1, 1],
  ],
  true,
);
const playIdle = play(
  ['idle'],
  3200,
  [
    [0, 1],
    [0.5, 1.07],
    [1, 1],
  ],
  true,
);
const accordionNote = (i: number, x: number, y: number, pair: boolean): GimmickDef => ({
  id: `note-${i}`,
  rest: 'hidden',
  markup: (pair ? notePair : note)(x, y, OBJECT.white.base),
  anim: [
    anim(['squash'], [x, y], 700, riseKeys(10, 2), { delayMs: 250 + i * 150 }),
    anim(['laugh'], [x, y], 1600, riseKeys(10, 2), { loop: true, delayMs: i * 800 }),
  ],
});

const accordion: AvatarDef = {
  id: 'accordion',
  kind: 'object',
  name: { he: 'אקורדיון', en: 'Accordion' },
  tile: TILE.rose,
  layers: {
    // behind the bellows, so nothing shows through while they move
    back: rect(28, 26, 44, 52, bellows.shade),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 42, y: 48 }, right: { x: 58, y: 48 }, r: 5, style: 'round' },
    brows: { lift: 1.75, length: 1.7, thickness: 2.1 },
    mouth: { x: 50, y: 62, w: 13 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 9 },
  },
  pivot: { x: 50, y: 52 },
  base: 84,
  squash: true,
  motionBias: ['squash', 'bounce', 'shake', 'nod'],
  gimmicks: [
    {
      id: 'bellows',
      z: 'back',
      markup: bellowsArt,
      anim: [playSquash.bellows, playLaugh.bellows, playIdle.bellows],
    },
    { id: 'box-left', z: 'back', markup: leftBox, anim: [playSquash.left, playLaugh.left, playIdle.left] },
    {
      id: 'box-right',
      z: 'back',
      markup: rightBox,
      anim: [playSquash.right, playLaugh.right, playIdle.right],
    },
    accordionNote(0, 37, 20, false),
    accordionNote(1, 58, 19, true),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Balloon: the skin holds the face (`z: 'face'`): it puffs up when surprised, swells and trembles when angry,
// loses air when sad or sleepy, and bobs on its knot when idle.

const skin = OBJECT.pink;
const balloonShape =
  'M50 10C67 10 79 23.5 79 39.5C79 56 64.5 68.5 53 71H47C35.5 68.5 21 56 21 39.5C21 23.5 33 10 50 10Z';
const knot: Pt = [50, 73];

const balloon: AvatarDef = {
  id: 'balloon',
  kind: 'object',
  name: { he: 'בלון', en: 'Balloon' },
  tile: TILE.leaf,
  layers: {
    back: line('M50 76C45.5 80.5 54.5 84 50 88.5S46 93.5 48.5 96', OBJECT.white.base, 1.4),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41, y: 38.5 }, right: { x: 59, y: 38.5 }, r: 5.7, style: 'round' },
    brows: { lift: 1.75, length: 1.7, thickness: 2.3 },
    mouth: { x: 50, y: 53, w: 15 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 6 },
  },
  pivot: { x: 50, y: 42 },
  base: 96,
  squash: true,
  motionBias: ['bounce', 'wobble', 'squash', 'tilt'],
  gimmicks: [
    {
      id: 'skin',
      z: 'face',
      markup:
        path('M46.2 76.8L50 70.6L53.8 76.8Q50 78.2 46.2 76.8Z', skin.shade) +
        shaded(balloonShape, skin.base, skin.shade, -1.6, -1.5) +
        ellipse(33.5, 26.5, 3.3, 7.6, skin.light, 35) +
        circle(39, 17.2, 2, skin.light),
      anim: [
        { ...R.inflate({ scale: 1.12 }), trigger: ['surprised'], origin: { x: knot[0], y: knot[1] } },
        anim(['angry'], knot, 700, [{ t: 0 }, { t: 0.5, sx: 1.09, sy: 1.08 }, { t: 1 }], { loop: true }),
        { ...R.deflate(), trigger: ['sad'], origin: { x: knot[0], y: knot[1] } },
        {
          ...R.deflate({ scale: 0.94, droop: 2, ms: 2400 }),
          trigger: ['sleepy'],
          origin: { x: knot[0], y: knot[1] },
        },
        { ...R.sway({ angle: 4, ms: 3200 }), trigger: ['idle'], origin: { x: knot[0], y: knot[1] } },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Bowling pin: white with two red stripes on its neck; the face sits on the belly. When it is dizzy (and when
// it wobbles) a bowling ball rolls in, knocks it and rolls away.

const pin = OBJECT.white;
const pinShade = mix(OBJECT.white.shade, OBJECT.steel.base, 0.35);
const PIN_TOP: Pt = [50, 10.5];
const PIN: readonly Seg[] = [
  [
    [55.5, 10.5],
    [59.5, 14.6],
    [59.5, 20.2],
  ],
  [
    [59.5, 25.2],
    [56.6, 28.4],
    [56.1, 32.6],
  ],
  [
    [55.6, 37],
    [62.8, 42.6],
    [67.4, 50.4],
  ],
  [
    [71.4, 57.2],
    [72.2, 66.2],
    [70.6, 73.6],
  ],
  [
    [69.2, 80.6],
    [64.8, 86.6],
    [62.6, 93],
  ],
];
const pinOutline = symmetric(PIN_TOP, PIN);
const pinBand = (y0: number, y1: number) => {
  const a = halfWidth(PIN_TOP, PIN, y0);
  const b = halfWidth(PIN_TOP, PIN, y1);
  return path(
    `M${P([50 - a, y0])}Q50 ${f(y0 + 1.8)} ${P([50 + a, y0])}L${P([50 + b, y1])}Q50 ${f(y1 + 1.8)} ${P([50 - b, y1])}Z`,
    OBJECT.red.base,
  );
};
const ball = CLOTH.navy;
const ballAt: Pt = [26.5, 85.4];

const bowlingPin: AvatarDef = {
  id: 'bowling-pin',
  kind: 'object',
  name: { he: 'פין באולינג', en: 'Bowling pin' },
  tile: TILE.cobalt,
  layers: {
    back:
      shaded(pinOutline, pin.base, pinShade, -1.6, -0.8) +
      pinBand(34.4, 37.6) +
      pinBand(40.2, 43.4) +
      ellipse(45.6, 15.6, 1.9, 3.2, OBJECT.white.light, 30),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 42, y: 62.5 }, right: { x: 58, y: 62.5 }, r: 4.6, style: 'dot' },
    brows: { lift: 1.9, length: 2.1, thickness: 2.1 },
    mouth: { x: 50, y: 76, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 6.5 },
  },
  pivot: { x: 50, y: 56 },
  base: 93,
  squash: true,
  motionBias: ['wobble', 'shake', 'squash', 'bounce'],
  gimmicks: [
    {
      id: 'ball',
      rest: 'hidden',
      markup:
        circle(ballAt[0], ballAt[1], 8.6, ball.shade) +
        circle(ballAt[0] - 0.8, ballAt[1] - 0.8, 7.8, ball.base) +
        circle(ballAt[0] - 2.6, ballAt[1] - 3.2, 1.35, ball.shade) +
        circle(ballAt[0] + 1.4, ballAt[1] - 3.6, 1.35, ball.shade) +
        circle(ballAt[0] - 0.4, ballAt[1] + 0.2, 1.35, ball.shade) +
        line(
          `M${polar(ballAt[0] - 0.8, ballAt[1] - 0.8, 5.6, 200)}A5.6 5.6 0 0 1 ${polar(ballAt[0] - 0.8, ballAt[1] - 0.8, 5.6, 245)}`,
          ball.light,
          1.6,
        ),
      anim: anim(['wobble', 'dizzy'], ballAt, 1600, [
        { t: 0, x: -38, rotate: -250, ease: 'linear' },
        { t: 0.14, ease: 'standard' },
        { t: 0.3, x: -7, rotate: -47, ease: 'exit' },
        { t: 1, x: -42, rotate: -280 },
      ]),
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Joystick: a purple base with two fire buttons, the face on its front; the stick (behind the rubber boot)
// leans with a tilt, holds a lean when confused, waggles when it laughs, rattles when angry.

const base = OBJECT.purple;
const knob = OBJECT.red;
const stickPivot: Pt = [50, 50];
const stickAt = { x: stickPivot[0], y: stickPivot[1] };
const button = (x: number, c: Ramp) =>
  ellipse(x, 50.6, 5, 2.5, c.shade) +
  rect(x - 5, 48.1, 10, 2.5, c.shade) +
  ellipse(x, 48.1, 5, 2.5, c.base) +
  ellipse(x - 1.4, 47.6, 1.8, 0.8, c.light);

const joystick: AvatarDef = {
  id: 'joystick',
  kind: 'object',
  name: { he: "ג'ויסטיק", en: 'Joystick' },
  tile: TILE.jade,
  layers: {
    back:
      // the base: its top, then the front
      path(
        roundPoly(
          [
            [23, 43],
            [77, 43],
            [85, 55, 0],
            [15, 55, 0],
          ],
          3,
        ),
        base.light,
      ) +
      path(
        roundPoly(
          [
            [15, 54],
            [85, 54],
            [85, 91.5],
            [15, 91.5],
          ],
          5,
        ),
        base.shade,
      ) +
      path(
        roundPoly(
          [
            [15, 54, 1],
            [83.6, 54, 1],
            [83.6, 90.2],
            [15, 90.2],
          ],
          5,
        ),
        base.base,
      ) +
      button(29, OBJECT.gold) +
      button(71, OBJECT.green) +
      // the rubber boot the stick comes out of
      ellipse(50, 50.2, 8.4, 3.6, CLOTH.charcoal.shade) +
      path('M42.4 50Q44.6 41.5 47.2 40.4H52.8Q55.4 41.5 57.6 50Q50 53.4 42.4 50Z', CLOTH.charcoal.base) +
      path('M44.6 47.8Q45.8 42.6 47.6 41.6H49.2Q47.4 44 46.8 48.6Z', CLOTH.charcoal.light),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 68.5 }, right: { x: 58.5, y: 68.5 }, r: 5.2, style: 'round' },
    brows: { lift: 1.65, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 81.5, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 5.5 },
  },
  pivot: { x: 50, y: 58 },
  base: 91.5,
  squash: true,
  motionBias: ['tilt', 'shake', 'bounce', 'squash'],
  gimmicks: [
    {
      id: 'stick',
      z: 'behind',
      markup:
        line('M50 49V27', OBJECT.steel.shade, 4.8) +
        line('M49.2 49V27', OBJECT.steel.base, 2.2) +
        circle(50, 20, 10.4, knob.shade) +
        circle(49, 19, 9.4, knob.base) +
        ellipse(45.4, 15.4, 2.4, 3.4, knob.light, 40),
      anim: [
        anim(['tilt'], stickPivot, 1400, [
          { t: 0, ease: 'standard' },
          { t: 0.22, rotate: -27 },
          { t: 0.45, rotate: -21 },
          { t: 0.66, rotate: -27 },
          { t: 0.88 },
          { t: 1 },
        ]),
        anim(['shake'], stickPivot, 900, [
          { t: 0 },
          { t: 0.09, rotate: -18 },
          { t: 0.2, rotate: 18 },
          { t: 0.31, rotate: -13 },
          { t: 0.42, rotate: 13 },
          { t: 0.53, rotate: -6 },
          { t: 0.62, rotate: 3 },
          { t: 0.7 },
          { t: 1 },
        ]),
        anim(['confused'], stickPivot, 600, [
          { t: 0, ease: 'emphasized' },
          { t: 1, rotate: -20 },
        ]),
        { ...R.sway({ angle: 15, ms: 700 }), trigger: ['laugh'], origin: stickAt },
        { ...R.sway({ angle: 7, ms: 280 }), trigger: ['angry'], origin: stickAt },
        { ...R.sway({ angle: 18, ms: 1300 }), trigger: ['dizzy'], origin: stickAt },
        { ...R.sway({ angle: 4, ms: 3400 }), trigger: ['idle'], origin: stickAt },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Microphone: a steel ball head (a grille cap on top, a smooth band for the face) on a black handle. It sings
// when it laughs: notes rise beside the head.

const mic = OBJECT.steel;
const handle = HAIR.black;
const head = { cx: 50, cy: 36, rx: 25, ry: 24.5 } as const;
const capY = 22.5;
const mesh = (() => {
  let d = '';
  for (const y of [14.5, 18.5])
    d += `M${P([chordX(head.cx, head.cy, head.rx, head.ry, y, -1) + 1.2, y])}H${f(chordX(head.cx, head.cy, head.rx, head.ry, y, 1) - 1.2)}`;
  for (let x = 31; x <= 69; x += 5.4) {
    const dy = head.ry * Math.sqrt(Math.max(0, 1 - ((x - head.cx) / head.rx) ** 2));
    if (head.cy - dy + 1.2 < capY - 1.6) d += `M${P([x, head.cy - dy + 1.2])}V${f(capY - 1.6)}`;
  }
  return d;
})();
const micNote = (i: number, x: number, y: number, pair: boolean): GimmickDef => ({
  id: `note-${i}`,
  rest: 'hidden',
  markup: (pair ? notePair : note)(x, y, OBJECT.white.base),
  anim: anim(['laugh'], [x, y], 1800, riseKeys(16, i % 2 ? -2.2 : 2.2), { loop: true, delayMs: i * 600 }),
});

const microphone: AvatarDef = {
  id: 'microphone',
  kind: 'object',
  name: { he: 'מיקרופון', en: 'Microphone' },
  tile: TILE.orchid,
  layers: {
    back:
      // the handle, narrowing to the bottom, with a switch
      path('M37.6 60H62.4L58.6 92.6Q58.3 95 55.9 95H44.1Q41.7 95 41.4 92.6Z', handle.base) +
      path('M57.4 60H62.4L58.6 92.6Q58.3 95 55.9 95H54.6Z', handle.shade) +
      rect(41.6, 63, 2.4, 26, handle.light, 1.2) +
      rect(47.6, 71, 4.8, 8.4, OBJECT.green.base, 1.6) +
      rect(47.6, 74.4, 4.8, 5, OBJECT.green.shade, 1.6) +
      // the collar
      ellipse(50, 60.4, 14.2, 4, OBJECT.gold.shade) +
      ellipse(49.6, 59.6, 13.6, 3.4, OBJECT.gold.base) +
      // the head: shade, the lit ball, the grille cap and the seam under it
      ellipse(head.cx, head.cy, head.rx, head.ry, mic.shade) +
      ellipse(head.cx - 1.2, head.cy - 1.2, head.rx - 0.6, head.ry - 0.6, mic.base) +
      line(mesh, mic.shade, 1) +
      line(
        `M${P([chordX(head.cx, head.cy, head.rx, head.ry, capY, -1) + 0.4, capY])}Q50 ${f(capY + 3.2)} ${P([chordX(head.cx, head.cy, head.rx, head.ry, capY, 1) - 0.4, capY])}`,
        mic.shade,
        1.6,
      ) +
      line(`M${polar(48.8, 34.8, 21.5, 200)}A21.5 21.5 0 0 1 ${polar(48.8, 34.8, 21.5, 236)}`, mic.light, 3),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 37.5 }, right: { x: 58.5, y: 37.5 }, r: 5.3, style: 'round' },
    brows: { lift: 1.72, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 50.5, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 6 },
  },
  pivot: { x: 50, y: 50 },
  base: 95,
  squash: true,
  motionBias: ['bounce', 'nod', 'tilt', 'squash'],
  gimmicks: [micNote(0, 15.5, 44, false), micNote(1, 79, 36, true), micNote(2, 82, 56, false)],
};

// ---------------------------------------------------------------------------------------------------------
// Boxing glove: Fight! The fist holds the face (`z: 'face'`) on its wrist: it jabs at you when angry (with a
// flash), pumps when it laughs and bobs like a boxer when idle.

const glove = OBJECT.red;
const cuffBand = OBJECT.white;
const mitt =
  'M28.6 29C28.6 15 41 8.6 55 8.6C70.6 8.6 82 19 82 35C82 50.6 77 61 70.4 67.6H36.4C31.6 61 28.6 52 28.6 44Z';
const thumb =
  'M33.6 33.6C23.4 32 16.6 39.6 17.4 49.4C18.2 58.6 25.4 65.2 34.6 65.6L41.6 60.4C33.4 58.2 29.2 52.8 30 45.2C30.4 41 31.8 37 33.6 33.6Z';
const wrist: Pt = [52.5, 68];
const burst = (cx: number, cy: number, r0: number, r1: number, n: number, rot: number) =>
  'M' +
  Array.from({ length: 2 * n }, (_, i) => polar(cx, cy, i % 2 ? r0 : r1, rot + (180 * i) / n)).join('L') +
  'Z';

const boxingGlove: AvatarDef = {
  id: 'boxing-glove',
  kind: 'object',
  name: { he: 'כפפת אגרוף', en: 'Boxing glove' },
  tile: TILE.slate,
  layers: {
    back:
      // the cuff (it runs up under the fist), its white band, the lacing
      path('M35 60H70V89.6Q70 94 65.6 94H39.4Q35 94 35 89.6Z', glove.shade) +
      path('M35 60H68.4V88.4Q68.4 92.8 64 92.8H39.4Q35 92.8 35 88.4Z', glove.base) +
      rect(35, 68.4, 35, 7.4, cuffBand.shade) +
      rect(35, 68.4, 33.4, 6.6, cuffBand.base) +
      line('M45.6 78.6L59.4 86.6M59.4 78.6L45.6 86.6', glove.light, 1.6),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 47, y: 35 }, right: { x: 64, y: 35 }, r: 5.6, style: 'round' },
    brows: { lift: 1.72, length: 1.7, thickness: 2.3 },
    mouth: { x: 55.5, y: 49, w: 15 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 54, y: 5 },
  },
  pivot: { x: 52, y: 50 },
  base: 94,
  squash: true,
  motionBias: ['bounce', 'squash', 'shake', 'nod'],
  gimmicks: [
    {
      id: 'pow',
      z: 'behind',
      rest: 'hidden',
      markup:
        path(burst(19.5, 17.5, 6, 11, 8, -90), OBJECT.gold.base) +
        path(burst(19.5, 17.5, 3.4, 6.4, 8, -68), OBJECT.orange.base),
      anim: { ...R.sparks({ ms: 720 }), delayMs: 100, trigger: ['angry'], origin: { x: 19.5, y: 17.5 } },
    },
    {
      id: 'fist',
      z: 'face',
      markup:
        shaded(mitt, glove.base, glove.shade, -1.6, -1.2) +
        shaded(thumb, glove.base, glove.shade, -1.2, -1) +
        line('M34.2 35C31.4 40 30.6 47 32.2 52.6', glove.shade, 1.6) +
        ellipse(37.4, 20.6, 2.6, 6, glove.light, 50) +
        ellipse(22.4, 45, 1.6, 4, glove.light, 10),
      anim: [
        anim(
          ['angry'],
          wrist,
          720,
          [
            { t: 0, ease: 'exit' },
            { t: 0.22, sx: 1.15, sy: 1.15, y: -1.5, ease: 'standard' },
            { t: 0.5 },
            { t: 1 },
          ],
          { loop: true },
        ),
        anim(['laugh'], wrist, 800, [{ t: 0 }, { t: 0.35, y: -3.2, rotate: -6 }, { t: 0.7 }, { t: 1 }], {
          loop: true,
        }),
        anim(['idle'], wrist, 1100, [{ t: 0 }, { t: 0.5, y: -1.6 }, { t: 1 }], { loop: true }),
      ],
    },
  ],
};

export const PLAY: readonly AvatarDef[] = [
  puzzleCube,
  hourglass,
  magnet,
  cassette,
  accordion,
  balloon,
  bowlingPin,
  joystick,
  microphone,
  boxingGlove,
];
