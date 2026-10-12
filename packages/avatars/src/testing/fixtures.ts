/**
 * Demo characters for the rig's and the renderer's options, one per capability. They are test fixtures, not
 * part of the catalog (the app never shows them), and working examples to copy from:
 *
 * - demo-cyclops: one eye (`eyes.count: 1`) with a unibrow.
 * - demo-alien: three eyes (`eyes.count: 3`); its antennae sway (`idle`, a `behind` gimmick).
 * - demo-pirate-egg: two eyes, one under a patch (`eyes.covered`).
 * - demo-calculator: no brows, and no rig mouth: the display draws its own (`mouth: false` + `face.art`).
 * - demo-kettle: steam puffs (staggered), a lid that lifts when surprised and rattles when angry.
 * - demo-cloud: rain drops when sad, a lightning zap when angry.
 * - demo-toaster: the toast pops up (`z: 'behind'`).
 * - demo-washer: the drum spins behind a porthole face (`z: 'back'`), slowly when idle; bubbles when laughing.
 * - demo-balloon: inflates when surprised, sags when sad, and the face goes with it (`z: 'face'`).
 *
 * `npm run sheet -w @sudoku-fight/avatars -- --fixtures --shoot` draws their contact sheets and filmstrips.
 */

import { circle, ellipse, line, mirrored, P, path, polar, rect, shaded, sx, type Pt } from '../catalog/draw';
import { GIMMICK_RECIPES as R } from '../gimmick';
import { CLOTH, FACE, FUR, HAIR, mix, OBJECT, shade, TILE } from '../palette';
import { f } from '../svg';
import type { AvatarDef, Expression, GimmickDef } from '../types';

// ---------------------------------------------------------------------------------------------------------
// Cyclops: one big eye and a unibrow.

const cyc = OBJECT.purple;
const horn = OBJECT.cream;

const cyclops: AvatarDef = {
  id: 'demo-cyclops',
  kind: 'creature',
  name: { he: 'קיקלופ (דוגמה)', en: 'Cyclops (demo)' },
  tile: TILE.mustard,
  layers: {
    back:
      // horns, under the body's top edge
      mirrored(
        (s) =>
          path(
            `M${P([sx(s, 14), 34])}Q${P([sx(s, 21), 18])} ${P([sx(s, 26), 12])}Q${P([sx(s, 16), 24])} ${P([sx(s, 4), 30])}Z`,
            horn.shade,
          ) +
          path(
            `M${P([sx(s, 13), 33])}Q${P([sx(s, 20), 19])} ${P([sx(s, 26), 12])}Q${P([sx(s, 17), 25])} ${P([sx(s, 6), 30.5])}Z`,
            horn.base,
          ),
      ) +
      // feet
      ellipse(38, 90.5, 8.5, 4.4, cyc.shade) +
      ellipse(62, 90.5, 8.5, 4.4, cyc.shade) +
      // the body: shade, then the lit surface up and left
      ellipse(50, 58, 33, 32, cyc.shade) +
      ellipse(48.7, 56.7, 31.6, 30.7, cyc.base) +
      ellipse(27.5, 44, 2.8, 6.4, cyc.light, 32),
  },
  face: {
    ink: FACE.ink,
    eyes: { count: 1, middle: { x: 50, y: 52 }, r: 10, style: 'round' },
    brows: { lift: 1.5, length: 2.1, thickness: 2.8, color: shade(cyc.shade, -0.45) },
    mouth: { x: 50, y: 76, w: 17 },
    cheeks: { color: FACE.blush, dx: 0.9, dy: 1.35, size: 0.6 },
    halo: { x: 50, y: 9 },
  },
  pivot: { x: 50, y: 58 },
  base: 94.5,
  squash: true,
  motionBias: ['squash', 'wobble', 'bounce'],
};

// ---------------------------------------------------------------------------------------------------------
// Alien: three eyes, the middle one higher (no brow over it); antennae that sway.

const skin = FUR.green;
const suit = OBJECT.steel;
const alienHead = 'M50 15C70 15 84 27 84 43C84 62 65 80 50 80C35 80 16 62 16 43C16 27 30 15 50 15Z';

const alien: AvatarDef = {
  id: 'demo-alien',
  kind: 'creature',
  name: { he: 'חייזר (דוגמה)', en: 'Alien (demo)' },
  tile: TILE.violet,
  layers: {
    back:
      // a silver suit off the bottom (to y 150: a spin must not show its edge), the neck
      path('M6 150V102Q6 88 28 86H72Q94 88 94 102V150Z', suit.shade) +
      path('M6 150V103Q6 89.5 27.5 87.5H70Q91 89.5 91 103V150Z', suit.base) +
      rect(43, 70, 14, 19, skin.shade) +
      // the head
      shaded(alienHead, skin.base, skin.shade) +
      ellipse(26, 34, 2.6, 6.4, skin.light, 38),
  },
  face: {
    ink: FACE.ink,
    eyes: {
      count: 3,
      left: { x: 36, y: 50 },
      right: { x: 64, y: 50 },
      middle: { x: 50, y: 33.5 },
      r: 6.2,
      style: 'oval',
    },
    brows: { lift: 1.6, length: 1.7, thickness: 2.2, color: shade(skin.shade, -0.5) },
    mouth: { x: 50, y: 65, w: 13 },
    cheeks: { color: FACE.blush, dx: 0.6, dy: 1.45, size: 0.8 },
    halo: { x: 50, y: 9 },
  },
  pivot: { x: 50, y: 48 },
  headBox: { x: 12, y: 5, size: 78 },
  motionBias: ['tilt', 'spin', 'nod'],
  gimmicks: [
    {
      id: 'antennae',
      z: 'behind',
      markup:
        line('M43 20L40 9', skin.shade, 2.6) +
        line('M57 20L60 9', skin.shade, 2.6) +
        circle(40, 9, 3.4, OBJECT.gold.base) +
        circle(60, 9, 3.4, OBJECT.gold.base),
      anim: { ...R.sway({ angle: 7 }), trigger: ['idle', 'confused'], origin: { x: 50, y: 22 } },
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Pirate egg: the left eye is under a patch. The rig draws the right eye only, and it carries every
// expression (its wink is a sly squint); the brows still frame both places.

const shell = OBJECT.cream;
const eggOutline = 'M50 10C67 10 79 38 79 60C79 80 66 92 50 92C34 92 21 80 21 60C21 38 33 10 50 10Z';
const patch = HAIR.black;

const pirateEgg: AvatarDef = {
  id: 'demo-pirate-egg',
  kind: 'food',
  name: { he: 'ביצה פיראטית (דוגמה)', en: 'Pirate egg (demo)' },
  tile: TILE.cobalt,
  layers: {
    back: shaded(eggOutline, shell.base, shell.shade) + ellipse(31, 40, 2.6, 7, shell.light, 24),
    front:
      // the strap, then the patch over the left eye
      line('M21.6 64L40 56L70.5 26', patch.base, 2.2) +
      ellipse(40, 56, 7.2, 6.4, patch.base, -10) +
      ellipse(37.5, 53.5, 1.8, 1.2, patch.light, -30),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 40, y: 56 }, right: { x: 60, y: 56 }, r: 4.6, style: 'dot', covered: 'left' },
    brows: { lift: 1.95, length: 2.1, thickness: 2 },
    mouth: { x: 50, y: 70, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.6, dy: 1.45, size: 0.8 },
    halo: { x: 50, y: 7.5 },
  },
  pivot: { x: 50, y: 56 },
  base: 92,
  squash: true,
  motionBias: ['wobble', 'tilt', 'squash'],
};

// ---------------------------------------------------------------------------------------------------------
// Calculator: no brows, and the mouth is a segment drawing on its display, one per expression.

const calc = CLOTH.charcoal;
const lcd = {
  base: mix(OBJECT.green.light, OBJECT.cream.base, 0.55),
  shade: mix(OBJECT.green.base, OBJECT.cream.shade, 0.5),
};
const lcdInk = shade(OBJECT.green.shade, -0.62);
const seg = (d: string) =>
  `<path d="${d}" fill="none" stroke="${lcdInk}" stroke-width="2.3" stroke-linecap="square" stroke-linejoin="miter"/>`;
const display: Record<Expression, string> = {
  neutral: seg('M44 40.5H56'),
  smile: seg('M42.5 37.8L45 41.6H55L57.5 37.8'),
  laugh: path('M42 37.2H58V39.6L55 44H45L42 39.6Z', lcdInk),
  wink: seg('M43 41H53.5L57.5 37.6'),
  surprised: seg('M46.5 36.8H53.5V44.2H46.5Z'),
  sad: seg('M42.5 43.6L45 39.8H55L57.5 43.6'),
  confused: seg('M43 42H49.5V39H57'),
  dizzy: seg('M42 40.5L44.7 38.2L47.3 42.6L50 38.2L52.7 42.6L55.3 38.2L58 40.5'),
  angry: seg('M42.8 37.6H57.2V43.6H42.8ZM42.8 40.6H57.2M47.6 37.6V43.6M52.4 37.6V43.6'),
  sleepy: seg('M47.5 40.8H52.5'),
};
const key = (x: number, y: number, color: string, depth: string) =>
  rect(x, y + 1, 9, 7.6, depth, 2) + rect(x, y, 9, 7.2, color, 2);

const calculator: AvatarDef = {
  id: 'demo-calculator',
  kind: 'object',
  name: { he: 'מחשבון (דוגמה)', en: 'Calculator (demo)' },
  tile: TILE.coral,
  layers: {
    back:
      rect(21.4, 11.3, 60, 83, calc.shade, 9) +
      rect(20, 10, 59, 82, calc.base, 9) +
      // the display: a sunken bezel, the screen
      rect(25.5, 16.5, 49, 33, calc.shade, 4.5) +
      rect(27.5, 18.5, 45, 29, lcd.base, 3) +
      rect(27.5, 18.5, 45, 2.2, lcd.shade, 1.1) +
      // keys: three rows of four, the last column orange
      [55.5, 67.5, 79.5]
        .map((y) =>
          [26, 39, 52, 65]
            .map((x, i) =>
              i === 3
                ? key(x, y, OBJECT.orange.base, OBJECT.orange.shade)
                : key(x, y, calc.light, calc.shade),
            )
            .join(''),
        )
        .join(''),
  },
  face: {
    ink: lcdInk,
    eyes: { left: { x: 41, y: 29.5 }, right: { x: 59, y: 29.5 }, r: 3.9, style: 'dot' },
    brows: false,
    mouth: false,
    art: { default: display.neutral, ...display },
    halo: { x: 50, y: 7 },
  },
  pivot: { x: 50, y: 52 },
  base: 93,
  squash: true,
  motionBias: ['bounce', 'shake', 'squash'],
};

// ---------------------------------------------------------------------------------------------------------
// Kettle: steam from the spout (three staggered puffs: idle, laugh, angry); the lid lifts when surprised and
// rattles when angry (one gimmick, two anims).

const kettle = OBJECT.red;
const kettleBody = 'M25 86Q16.5 86 17.5 76Q19.5 49 37 41H63Q80.5 49 82.5 76Q83.5 86 75 86Z';
const puff = (i: number, at: Pt): GimmickDef => ({
  id: `steam-${i}`,
  rest: 'hidden',
  markup:
    circle(at[0], at[1], 4.2, OBJECT.white.base) +
    circle(at[0] + 3.6, at[1] - 1.6, 3.2, OBJECT.white.base) +
    circle(at[0] - 2.8, at[1] - 2.4, 2.8, OBJECT.white.base),
  anim: {
    ...R.steam({ rise: 20, ms: 2000 }),
    delayMs: i * 667,
    trigger: ['idle', 'laugh', 'angry'],
    origin: { x: at[0], y: at[1] },
  },
});

const kettleChar: AvatarDef = {
  id: 'demo-kettle',
  kind: 'object',
  name: { he: 'קומקום (דוגמה)', en: 'Kettle (demo)' },
  tile: TILE.teal,
  layers: {
    back:
      // the handle over the top, the spout on the left
      line('M34 42Q33 17 50 17Q67 17 66 42', CLOTH.charcoal.base, 4.6) +
      path('M27 72L13.5 47.5Q11.5 43.5 15.5 43L19.5 44L33 60Z', kettle.shade) +
      path('M26.5 71L13.5 47.5Q11.5 43.5 15.5 43L18.5 43.8L31.5 59.5Z', kettle.base) +
      // the base, the body
      rect(22, 83, 56, 7, CLOTH.charcoal.base, 3) +
      shaded(kettleBody, kettle.base, kettle.shade) +
      ellipse(26.5, 62, 2.4, 8, kettle.light, 10),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41, y: 62 }, right: { x: 59, y: 62 }, r: 5.2, style: 'round' },
    brows: { lift: 1.75, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 75.5, w: 15 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 8 },
  },
  pivot: { x: 50, y: 63 },
  base: 90,
  squash: true,
  motionBias: ['shake', 'squash', 'bounce'],
  gimmicks: [
    {
      id: 'lid',
      z: 'back',
      markup:
        ellipse(50, 41.5, 15.5, 4.2, kettle.shade) +
        ellipse(49.4, 40.6, 14.6, 3.6, kettle.light) +
        circle(50, 36.4, 3.2, CLOTH.charcoal.base),
      anim: [
        { ...R.lid(), trigger: ['surprised'], origin: { x: 65, y: 41.5 } },
        {
          ...R.lid({ angle: -10, lift: 1.6, ms: 520 }),
          loop: true,
          trigger: ['angry'],
          origin: { x: 65, y: 41.5 },
        },
      ],
    },
    puff(0, [13, 39]),
    puff(1, [13, 39]),
    puff(2, [13, 39]),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Rain cloud: drops fall when it is sad, a zap flashes when it is angry.

const cloud = OBJECT.white;
const cloudShape = 'M27 70Q14 70 14 57Q14 44 28 43Q30 26 47 23.5Q63 21.5 69 36Q86 37 86 53.5Q86 70 71 70Z';
/** A drop: the rig's tear shape. */
const dropAt = ([x, y]: Pt, s: number, fill: string) =>
  path(
    `M${f(x)} ${f(y - 1.6 * s)}C${f(x + 0.35 * s)} ${f(y - s)} ${f(x + s)} ${f(y - 0.45 * s)} ${f(x + s)} ${f(y + 0.1 * s)}` +
      `A${f(s)} ${f(s)} 0 0 1 ${f(x - s)} ${f(y + 0.1 * s)}C${f(x - s)} ${f(y - 0.45 * s)} ${f(x - 0.35 * s)} ${f(y - s)} ${f(x)} ${f(y - 1.6 * s)}Z`,
    fill,
  );
const rainDrop = (i: number, x: number): GimmickDef => ({
  id: `drop-${i}`,
  rest: 'hidden',
  markup: dropAt([x, 75], 2.4, FACE.tear),
  anim: { ...R.drip({ fall: 15 }), delayMs: i * 420, trigger: ['sad'], origin: { x, y: 75 } },
});

const rainCloud: AvatarDef = {
  id: 'demo-cloud',
  kind: 'nature',
  name: { he: 'ענן (דוגמה)', en: 'Cloud (demo)' },
  tile: TILE.iris,
  layers: {
    back:
      shaded(cloudShape, cloud.base, cloud.shade, -1.6, -1.6) + ellipse(30, 47, 2.4, 4.6, cloud.light, 40),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41, y: 48 }, right: { x: 59, y: 48 }, r: 4.4, style: 'dot' },
    brows: { lift: 1.9, length: 2.1, thickness: 2 },
    mouth: { x: 50, y: 60, w: 13 },
    cheeks: { color: FACE.blush, dx: 0.6, dy: 1.45, size: 0.8 },
    halo: { x: 50, y: 10 },
  },
  pivot: { x: 50, y: 47 },
  base: 70,
  squash: true,
  motionBias: ['wobble', 'bounce', 'squash'],
  gimmicks: [
    rainDrop(0, 35),
    rainDrop(1, 50),
    rainDrop(2, 65),
    {
      id: 'zap',
      rest: 'hidden',
      markup: path('M57 69L46 82.5H52.5L44.5 95L62 78.5H55L61.5 69Z', OBJECT.gold.base),
      anim: { ...R.sparks(), trigger: ['angry'], origin: { x: 53, y: 80 } },
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Toaster: the toast pops up behind it when it is surprised or laughs.

const steel = OBJECT.steel;

const toaster: AvatarDef = {
  id: 'demo-toaster',
  kind: 'object',
  name: { he: 'טוסטר (דוגמה)', en: 'Toaster (demo)' },
  tile: TILE.orchid,
  layers: {
    back:
      rect(24, 86, 8, 6, CLOTH.charcoal.base, 2) +
      rect(68, 86, 8, 6, CLOTH.charcoal.base, 2) +
      rect(17.4, 42.4, 67, 47, steel.shade, 12) +
      rect(16, 41, 66, 46, steel.base, 12) +
      rect(20.5, 44, 3, 36, steel.light, 1.5) +
      // the lever
      rect(80, 55, 6, 5, CLOTH.charcoal.base, 1.5),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 40, y: 60 }, right: { x: 60, y: 60 }, r: 5.4, style: 'round' },
    brows: { lift: 1.7, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 74, w: 15 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 8 },
  },
  pivot: { x: 49, y: 64 },
  base: 92,
  squash: true,
  motionBias: ['bounce', 'squash', 'shake'],
  gimmicks: [
    {
      id: 'toast',
      z: 'behind',
      markup:
        path('M33 62V43Q30.5 35.5 38.5 34.5Q49 31.5 59.5 34.5Q67.5 35.5 65 43V62Z', FUR.tawny.base) +
        path('M36 62V44Q34.5 38.5 40 37.8Q49 35.5 58 37.8Q63.5 38.5 62 44V62Z', FUR.golden.light),
      anim: { ...R.popUp({ height: 18 }), trigger: ['surprised', 'laugh'], origin: { x: 49, y: 62 } },
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Washing machine: the face sits on the porthole glass; the drum (with laundry) turns behind it, slowly when
// idle and fast when dizzy, spinning or laughing; bubbles rise when it laughs.

const washer = OBJECT.white;
const glass = OBJECT.blue.light;
const hub: Pt = [50, 60];
const sock = (deg: number, color: string) => {
  const [x, y] = polar(hub[0], hub[1], 16.6, deg).split(' ').map(Number);
  return ellipse(x ?? 0, y ?? 0, 4.4, 2, color, deg + 90);
};
const bubble = (i: number, at: Pt): GimmickDef => ({
  id: `bubble-${i}`,
  rest: 'hidden',
  markup: circle(at[0], at[1], 2.8, glass) + circle(at[0] - 0.9, at[1] - 0.9, 0.9, OBJECT.white.light),
  anim: { ...R.bubble({ rise: 20 }), delayMs: i * 500, trigger: ['laugh'], origin: { x: at[0], y: at[1] } },
});

const washingMachine: AvatarDef = {
  id: 'demo-washer',
  kind: 'object',
  name: { he: 'מכונת כביסה (דוגמה)', en: 'Washing machine (demo)' },
  tile: TILE.berry,
  layers: {
    back:
      rect(19.4, 11.4, 64, 82, washer.shade, 8) +
      rect(18, 10, 63, 81, washer.base, 8) +
      rect(18, 24.5, 63, 1.6, washer.shade) +
      circle(30, 17.5, 2.2, OBJECT.blue.base) +
      circle(37.5, 17.5, 2.2, OBJECT.green.base) +
      circle(70.5, 17.5, 4.4, steel.shade) +
      circle(70, 17, 3.8, steel.base) +
      // the porthole: a steel ring, its inner shade, the glass
      circle(hub[0] + 0.8, hub[1] + 0.8, 25, steel.shade) +
      circle(hub[0], hub[1], 24.4, steel.base) +
      circle(hub[0], hub[1], 20.6, steel.shade) +
      circle(hub[0], hub[1], 19.6, glass),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 44, y: 58 }, right: { x: 56, y: 58 }, r: 4, style: 'dot' },
    brows: { lift: 1.8, length: 2, thickness: 1.8 },
    mouth: { x: 50, y: 67.5, w: 11 },
    halo: { x: 50, y: 6.5 },
  },
  pivot: { x: 50, y: 52 },
  base: 91,
  squash: true,
  motionBias: ['shake', 'spin', 'squash'],
  gimmicks: [
    {
      id: 'drum',
      z: 'back',
      markup: sock(200, OBJECT.red.base) + sock(320, OBJECT.gold.base) + sock(80, CLOTH.forest.base),
      anim: [
        { ...R.spin({ ms: 1100 }), trigger: ['dizzy', 'spin', 'laugh'], origin: { x: hub[0], y: hub[1] } },
        { ...R.spin({ ms: 9000 }), trigger: ['idle'], origin: { x: hub[0], y: hub[1] } },
      ],
    },
    bubble(0, [39, 37]),
    bubble(1, [51, 35]),
    bubble(2, [62, 37.5]),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Balloon: the skin holds the face (`z: 'face'`), so the face grows when it inflates and sinks when it sags.

const skinB = OBJECT.pink;

const balloon: AvatarDef = {
  id: 'demo-balloon',
  kind: 'object',
  name: { he: 'בלון (דוגמה)', en: 'Balloon (demo)' },
  tile: TILE.jade,
  layers: {
    back: line('M50 78C46 84 54 89 50 95.5', OBJECT.white.shade, 1.6),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 42 }, right: { x: 58.5, y: 42 }, r: 5, style: 'round' },
    brows: { lift: 1.75, length: 1.7, thickness: 2.1 },
    mouth: { x: 50, y: 56, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 8 },
  },
  pivot: { x: 50, y: 45 },
  base: 96,
  squash: true,
  motionBias: ['bounce', 'wobble', 'squash'],
  gimmicks: [
    {
      id: 'skin',
      z: 'face',
      markup:
        path('M46 78.5L50 72L54 78.5Q50 80 46 78.5Z', skinB.shade) +
        ellipse(50, 44, 25.5, 29.5, skinB.shade) +
        ellipse(48.8, 42.8, 24.2, 28.4, skinB.base) +
        ellipse(36, 30, 3, 6.6, skinB.light, 30),
      anim: [
        { ...R.inflate({ scale: 1.16 }), trigger: ['surprised'], origin: { x: 50, y: 77 } },
        { ...R.deflate(), trigger: ['sad'], origin: { x: 50, y: 77 } },
      ],
    },
  ],
};

/** Every demo, in the order of the list above. */
export const FIXTURES: readonly AvatarDef[] = [
  cyclops,
  alien,
  pirateEgg,
  calculator,
  kettleChar,
  rainCloud,
  toaster,
  washingMachine,
  balloon,
];
