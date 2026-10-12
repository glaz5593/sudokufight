/**
 * Signs and sudoku things (kind `symbol`): a question mark, plus and minus, a little sudoku board. This file
 * also holds a few odd ones drawn with them: the mandrake, the dino in its egg, the walking eye (kind
 * `creature`) and the fridge (kind `object`).
 *
 * Read docs/avatars/STYLE.md first. Shared drawing helpers: ./draw.ts; gimmick recipes: ../gimmick.ts. Add each
 * character's AvatarDef here and append it to the list below: catalog/index.ts already includes this list.
 */

import { GIMMICK_RECIPES as R } from '../gimmick';
import { CLOTH, FACE, FUR, HAIR, mix, OBJECT, type Ramp, shade, TILE } from '../palette';
import { f } from '../svg';
import type { AvatarDef, Expression, FaceDef, GimmickAnim, GimmickDef } from '../types';
import { circle, ellipse, line, P, path, polar, rect, shaded, sx, type Pt } from './draw';

/** A stroke drawn twice: the shade where it lies, the lit colour shifted up and left (the offset shade). */
const shadedLine = (
  d: string,
  c: Ramp | { base: string; shade: string },
  width: number,
  dx = -1.2,
  dy = -1.1,
) => line(d, c.shade, width) + `<g transform="translate(${f(dx)} ${f(dy)})">${line(d, c.base, width)}</g>`;
/** A point at `deg` degrees (0 = right, 90 = down) on a circle, as numbers. */
const polarPt = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

// =========================================================================================================
// CREATURES
// =========================================================================================================

// ---------------------------------------------------------------------------------------------------------
// Mandrake: a plump, wrinkled root with a face, a rosette of leaves (and a little purple flower) on its head,
// and two forked root-legs. Its leaves sway when it idles, shake when it is angry and jump when it is
// surprised, and then it screams, as a mandrake does (sound rings flash beside its head).

const root: Ramp = {
  base: mix(OBJECT.cream.shade, FUR.tawny.base, 0.45),
  shade: mix(OBJECT.cream.shade, FUR.tawny.base, 0.85),
  light: mix(OBJECT.cream.light, FUR.tawny.base, 0.12),
};
const leaf = { base: FUR.green.shade, shade: shade(FUR.green.shade, -0.22), light: FUR.green.base };
/** The root: a narrow crown, a plump pear of a body, and two legs where it forks. */
const rootBody =
  'M50 27C57.5 27 62.5 30.5 66 35.5C72 41 75 48 74.6 56.5C74.2 65.5 69 71.5 62.6 75.6L64 87.6Q64.4 92.6 60.4 90.4' +
  'L52.2 81.6Q50 79.6 47.8 81.6L40.4 91Q36.4 93.4 36.4 88.6L37.6 75.8C31 71.6 25.8 65.5 25.4 56.5' +
  'C25 48 28 41 34 35.5C37.5 30.5 42.5 27 50 27Z';
/** One leaf, pointing up from its stalk at (50, 29), turned `deg` degrees: a broad, wavy-edged leaf. */
const mandrakeLeaf = (deg: number, len: number, w: number, c: { base: string; shade: string }) => {
  const y = (t: number) => f(29 - t * len);
  return (
    `<g transform="rotate(${f(deg)} 50 29)">` +
    path(
      `M50 29C${f(50 - 0.7 * w)} ${y(0.2)} ${f(50 - w)} ${y(0.4)} ${f(50 - 0.86 * w)} ${y(0.55)}` +
        `Q${f(50 - 1.02 * w)} ${y(0.7)} ${f(50 - 0.6 * w)} ${y(0.82)}Q${f(50 - 0.4 * w)} ${y(1)} 50 ${y(1)}` +
        `Q${f(50 + 0.4 * w)} ${y(1)} ${f(50 + 0.6 * w)} ${y(0.82)}Q${f(50 + 1.02 * w)} ${y(0.7)} ${f(50 + 0.86 * w)} ${y(0.55)}` +
        `C${f(50 + w)} ${y(0.4)} ${f(50 + 0.7 * w)} ${y(0.2)} 50 29Z`,
      c.base,
    ) +
    line(`M50 ${y(0.1)}V${y(0.8)}`, c.shade, 1.3) +
    `</g>`
  );
};
/** A short wrinkle or ring across the root: an arc from `a` to `b` bulging `k` down. */
const wrinkle = (a: Pt, b: Pt, k: number) =>
  line(`M${P(a)}Q${P([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + k])} ${P(b)}`, root.shade, 1.5);
const ring = (s: -1 | 1, i: number): GimmickDef => ({
  id: `scream-${s < 0 ? 'left' : 'right'}`,
  rest: 'hidden',
  markup:
    line(`M${P([sx(s, 29.5), 40.5])}Q${P([sx(s, 33.5), 46.5])} ${P([sx(s, 29.5), 52.5])}`, FACE.white, 2.2) +
    line(`M${P([sx(s, 35), 37])}Q${P([sx(s, 40.5), 46.5])} ${P([sx(s, 35), 56])}`, FACE.white, 2.2),
  anim: {
    ...R.sparks({ ms: 700 }),
    delayMs: i * 120,
    trigger: ['surprised'],
    origin: { x: sx(s, 29), y: 46.5 },
  },
});

const mandrake: AvatarDef = {
  id: 'mandrake',
  kind: 'creature',
  name: { he: 'מנדרגורה', en: 'Mandrake' },
  tile: TILE.iris,
  layers: {
    back:
      // root-arms: thin roots from the sides, curling down, a hair-root on each
      shadedLine('M28 58Q17.5 60.5 16.6 70.5Q16.4 74 18.8 75.6', root, 3.2) +
      shadedLine('M72 58Q82.5 60.5 83.4 70.5Q83.6 74 81.2 75.6', root, 3.2) +
      line('M17.8 66L13.6 65', root.shade, 1.1) +
      line('M82.6 64.5L86.6 62.6', root.shade, 1.1) +
      // hair-roots on the legs
      line('M38.6 84L34 84.4', root.shade, 1.1) +
      line('M62.8 81.5L67.2 80.6', root.shade, 1.1) +
      // the root: shade, then the lit surface up and left
      shaded(rootBody, root.base, root.shade) +
      // the rings of a root: across the crown, and short wrinkles down both sides
      wrinkle([43.6, 31.6], [56.4, 31.6], 1.8) +
      wrinkle([25.6, 49], [30.6, 50.4], 0.6) +
      wrinkle([26.8, 64.6], [32.8, 67.6], 0.8) +
      wrinkle([68.8, 46.4], [73.8, 44.6], 0.6) +
      wrinkle([66.6, 68.2], [72.6, 64.6], 0.8) +
      wrinkle([38, 76.8], [44, 77.6], 0.6) +
      wrinkle([56.2, 77.6], [62, 76.6], 0.6) +
      // shine
      ellipse(32.6, 45, 2.2, 5.4, root.light, 26),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 49 }, right: { x: 58.5, y: 49 }, r: 5.2, style: 'round' },
    brows: { lift: 1.7, length: 1.7, thickness: 2.2, color: shade(root.shade, -0.5) },
    mouth: { x: 50, y: 63, w: 15 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 7 },
  },
  pivot: { x: 50, y: 55 },
  // tiny sizes: the leaves, the face and the arms; the legs are cut
  headBox: { x: 14, y: 5, size: 72 },
  base: 93,
  squash: true,
  motionBias: ['wobble', 'shake', 'squash', 'bounce'],
  gimmicks: [
    {
      id: 'leaves',
      z: 'behind',
      markup:
        mandrakeLeaf(-68, 21, 7.5, leaf) +
        mandrakeLeaf(68, 21, 7.5, leaf) +
        mandrakeLeaf(-34, 22, 8, { base: leaf.light, shade: leaf.shade }) +
        mandrakeLeaf(34, 22, 8, { base: leaf.light, shade: leaf.shade }) +
        mandrakeLeaf(0, 21, 8, leaf) +
        // a small purple flower in the middle of the rosette
        line('M50 27V16', leaf.shade, 1.4) +
        [-60, 0, 60]
          .map((deg) => ellipse(...polarPt(50, 14.6, 2.6, deg - 90), 2.2, 3.2, OBJECT.purple.base, deg))
          .join('') +
        circle(50, 14.6, 1.6, OBJECT.gold.base),
      anim: [
        { ...R.popUp({ height: 5, ms: 900 }), trigger: ['surprised'], origin: { x: 50, y: 29 } },
        { ...R.sway({ angle: 7, ms: 300 }), trigger: ['angry'], origin: { x: 50, y: 29 } },
        { ...R.sway({ angle: 5, ms: 2600 }), trigger: ['idle', 'confused'], origin: { x: 50, y: 29 } },
      ],
    },
    ring(-1, 0),
    ring(1, 1),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Dino egg: a baby dinosaur still in its spotted egg, only its head out of the top and its feet out of the
// bottom. Its tail wags out of a hole in the side, and it stamps its feet when it laughs or throws a tantrum.

const dino = FUR.green;
const plate = OBJECT.orange;
const egg = OBJECT.cream;
/** The lower shell: a zigzag crack across the top, the egg's round bottom. */
const eggCrack: readonly Pt[] = [
  [21.6, 61],
  [27, 55.6],
  [32.4, 61.2],
  [38.2, 55.8],
  [44, 61.4],
  [50, 56],
  [56, 61.4],
  [61.8, 55.8],
  [67.6, 61.2],
  [73, 55.6],
  [78.4, 61],
];
const lowerEgg = `M${eggCrack.map(P).join('L')}C80 73 72 89 50 89C28 89 20 73 21.6 61Z`;
const tailD = 'M71.4 69.4Q80.4 68.6 85.6 61.2Q87.6 58.4 89.8 57Q89.6 61.4 87.8 65.4Q82.8 76.2 71.8 76.2Z';
const dinoHead =
  'M50 13C65 13 73.6 22.5 73.6 36C73.6 51 70 61 50 61C30 61 26.4 51 26.4 36C26.4 22.5 35 13 50 13Z';
/** A back plate: a rounded triangle standing on (x, y), `h` tall, turned `deg`. */
const dinoPlate = (x: number, y: number, h: number, deg: number) =>
  `<g transform="rotate(${f(deg)} ${f(x)} ${f(y)})">` +
  path(
    `M${f(x - 0.42 * h)} ${f(y)}Q${f(x - 0.1 * h)} ${f(y - h)} ${f(x)} ${f(y - h)}Q${f(x + 0.1 * h)} ${f(y - h)} ${f(x + 0.42 * h)} ${f(y)}Z`,
    plate.shade,
  ) +
  path(
    `M${f(x - 0.42 * h)} ${f(y)}Q${f(x - 0.16 * h)} ${f(y - h)} ${f(x - 0.04 * h)} ${f(y - h)}Q${f(x + 0.04 * h)} ${f(y - h)} ${f(x + 0.22 * h)} ${f(y)}Z`,
    plate.base,
  ) +
  `</g>`;
/** A foot out of the bottom of the shell; it kicks out sideways from a hip inside the egg. */
const foot = (s: -1 | 1): GimmickDef => {
  const hip: Pt = [sx(s, 11), 80];
  return {
    id: s < 0 ? 'foot-left' : 'foot-right',
    z: 'behind',
    markup:
      ellipse(sx(s, 15), 90.5, 7.6, 4.2, dino.shade) +
      ellipse(sx(s, 15.4), 89.6, 6.6, 3.4, dino.base) +
      [-4.6, 0, 4.6].map((dx) => circle(sx(s, 15) + dx, 93.2, 1.5, egg.base)).join(''),
    anim: [
      {
        trigger: ['angry', 'laugh'],
        durationMs: 440,
        loop: true,
        delayMs: s < 0 ? 0 : 220,
        keyframes: [{ t: 0 }, { t: 0.32, rotate: s * -24 }, { t: 0.62 }, { t: 1 }],
        origin: { x: hip[0], y: hip[1] },
      },
    ],
  };
};

const dinoEgg: AvatarDef = {
  id: 'dino-egg',
  kind: 'creature',
  name: { he: 'דינוזאור בביצה', en: 'Dino egg' },
  tile: TILE.berry,
  layers: {
    back:
      // plates along the top of the head, their feet tucked under it
      dinoPlate(37.6, 20.5, 11, -36) +
      dinoPlate(62.4, 20.5, 11, 36) +
      dinoPlate(50, 17, 13, 0) +
      // the head: shade, then the lit surface up and left, a shine, spots, nostrils
      shaded(dinoHead, dino.base, dino.shade) +
      ellipse(32.6, 29, 2.2, 5.2, dino.light, 26) +
      circle(66.4, 23.6, 2.3, dino.shade) +
      circle(70, 30, 1.5, dino.shade) +
      circle(30.4, 44.6, 1.6, dino.shade) +
      ellipse(46.6, 41.8, 1.2, 0.9, dino.shade) +
      ellipse(53.4, 41.8, 1.2, 0.9, dino.shade) +
      // the lower shell over the head: shade, then the lit surface, spots, a shine
      shaded(lowerEgg, egg.base, egg.shade, -1.4, -0.6) +
      ellipse(36, 73, 3.2, 2.4, egg.shade, -20) +
      ellipse(55, 80.5, 4, 2.8, egg.shade, 15) +
      ellipse(48, 67.5, 2.2, 1.7, egg.shade) +
      ellipse(28.5, 70, 2, 5, egg.light, 12) +
      // the hole the tail comes out of
      ellipse(73.2, 72.6, 4.4, 5.6, shade(egg.shade, -0.3), 20),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 33.5 }, right: { x: 58.5, y: 33.5 }, r: 5.4, style: 'round' },
    brows: { lift: 1.65, length: 1.7, thickness: 2.2, color: shade(dino.shade, -0.45) },
    mouth: { x: 50, y: 48, w: 15 },
    // no cheeks: blush on green turns brown
    halo: { x: 50, y: 6 },
  },
  pivot: { x: 50, y: 52 },
  // tiny sizes: the head and the top of the egg
  headBox: { x: 17, y: 4, size: 66 },
  base: 94,
  squash: true,
  motionBias: ['wobble', 'bounce', 'squash', 'tilt'],
  gimmicks: [
    foot(-1),
    foot(1),
    {
      id: 'tail',
      z: 'back',
      markup:
        dinoPlate(78.2, 68.6, 6, -28) +
        dinoPlate(84.2, 63.6, 5.2, -42) +
        path(tailD, dino.shade) +
        path(tailD, dino.base, ' transform="translate(-0.8 -1)"'),
      anim: [
        { ...R.sway({ angle: 14, ms: 700 }), trigger: ['laugh', 'smile'], origin: { x: 72.6, y: 73 } },
        { ...R.sway({ angle: 8, ms: 1800 }), trigger: ['idle'], origin: { x: 72.6, y: 73 } },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Walking eye: one big eye on two thin legs in red sneakers, no body at all. The eye is the rig's (count 1);
// its lids are the lilac ball around it, so a blink or a squint shows real lids. No rig brows or mouth: the
// one eyebrow floating above it is drawn per expression (`face.art`), and it carries most of the feeling. It
// runs on the spot when it laughs or is angry, and taps a foot when it idles.

const lid = {
  base: OBJECT.purple.light,
  shade: OBJECT.purple.base,
  light: mix(OBJECT.purple.light, '#ffffff', 0.45),
};
const eyeC: Pt = [50, 44];
const brow = HAIR.black.base;
const browLine = (d: string) =>
  `<path d="${d}" fill="none" stroke="${brow}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>`;
/**
 * Laughing: the rig closes a lone eye with a round arc, which on an eye this big reads as a frown. The art
 * covers it with the lid and draws a happy, pointed squint instead.
 */
const laughingEye =
  circle(eyeC[0] - 1.2, eyeC[1] - 1.2, 22.4, lid.base) +
  ellipse(31, 32, 2.2, 4.6, lid.light, 38) +
  `<path d="M35.5 50.5L50 38.5L64.5 50.5" fill="none" stroke="${FACE.ink}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`;
const eyeArt: Record<Expression, string> = {
  neutral: browLine('M38 14.5Q50 11 62 14.5'),
  smile: browLine('M37.5 13Q50 8.6 62.5 13'),
  laugh: laughingEye + browLine('M37.5 12Q50 6.6 62.5 12'),
  wink: browLine('M38 16.5Q50 11 62 11'),
  surprised: browLine('M37 10.5Q50 4.5 63 10.5'),
  sad: browLine('M37.5 17.5Q44 11.5 50 11.2Q56 11.5 62.5 17.5'),
  confused: browLine('M37.5 11Q44 8 50 11.5T62.5 15'),
  dizzy: browLine('M37 14Q40.25 11.5 43.5 14T50 14T56.5 14T63 14'),
  angry: browLine('M37.5 11.5L50 18.5L62.5 11.5'),
  sleepy: browLine('M38 17Q50 15 62 17'),
};
const leg = (s: -1 | 1): GimmickDef => {
  const hip: Pt = [sx(s, 8), 64];
  const origin = { x: hip[0], y: hip[1] };
  const run: GimmickAnim = {
    trigger: ['laugh', 'angry'],
    durationMs: 520,
    loop: true,
    delayMs: s < 0 ? 0 : 260,
    keyframes: [{ t: 0 }, { t: 0.3, y: -3.2, rotate: s * 10 }, { t: 0.55, y: 0.3 }, { t: 1 }],
    origin,
  };
  // idle: the right foot taps twice, then rests
  const tap: GimmickAnim = {
    trigger: ['idle'],
    durationMs: 1800,
    loop: true,
    keyframes: [{ t: 0 }, { t: 0.1, rotate: -9 }, { t: 0.2 }, { t: 0.3, rotate: -9 }, { t: 0.4 }, { t: 1 }],
    origin,
  };
  return {
    id: s < 0 ? 'leg-left' : 'leg-right',
    z: 'behind',
    markup:
      line(`M${P(hip)}Q${P([sx(s, 13), 77])} ${P([sx(s, 10), 87])}`, CLOTH.charcoal.base, 3.4) +
      // a red sneaker on a white sole
      path(
        `M${P([sx(s, 6), 86.5])}Q${P([sx(s, 9), 83.2])} ${P([sx(s, 14), 84.6])}Q${P([sx(s, 20.5), 86.4])} ${P([sx(s, 20.5), 89.6])}` +
          `L${P([sx(s, 20.5), 91.4])}H${f(sx(s, 6))}Z`,
        OBJECT.red.base,
      ) +
      rect(Math.min(sx(s, 6), sx(s, 20.5)), 89.6, 14.5, 2.6, OBJECT.white.base, 1.3),
    anim: s > 0 ? [run, tap] : run,
  };
};

const walkingEye: AvatarDef = {
  id: 'walking-eye',
  kind: 'creature',
  name: { he: 'עין מהלכת', en: 'Walking eye' },
  tile: TILE.mustard,
  layers: {
    back:
      // lashes along the top
      [-62, -76, -90, -104, -118]
        .map((deg) =>
          line(`M${polar(eyeC[0], eyeC[1], 23.6, deg)}L${polar(eyeC[0], eyeC[1], 28.6, deg)}`, brow, 2.2),
        )
        .join('') +
      // the lid ball: shade, then the lit surface up and left, a shine
      circle(eyeC[0], eyeC[1], 24, lid.shade) +
      circle(eyeC[0] - 1.2, eyeC[1] - 1.2, 22.8, lid.base) +
      ellipse(31, 32, 2.2, 4.6, lid.light, 38),
  },
  face: {
    ink: FACE.ink,
    eyes: { count: 1, middle: { x: eyeC[0], y: eyeC[1] }, r: 18.5, style: 'round' },
    brows: false,
    mouth: false,
    art: { default: eyeArt.neutral, ...eyeArt },
    halo: { x: 50, y: 6 },
  },
  pivot: { x: 50, y: 50 },
  base: 91.5,
  squash: true,
  motionBias: ['bounce', 'tilt', 'squash', 'spin'],
  gimmicks: [leg(-1), leg(1)],
};

// =========================================================================================================
// OBJECTS
// =========================================================================================================

// ---------------------------------------------------------------------------------------------------------
// Fridge: a retro mint fridge. Its face is on the freezer door; the big door below is its jaw: it swings open
// when it laughs (the shelves and the snacks show) and pops ajar when it is surprised.

const fridgeBody: Ramp = {
  base: mix(OBJECT.green.light, OBJECT.white.base, 0.52),
  shade: mix(OBJECT.green.base, OBJECT.white.base, 0.3),
  light: mix(OBJECT.green.light, OBJECT.white.base, 0.85),
};
const chrome = OBJECT.steel;
const inside = {
  base: mix(OBJECT.gold.light, OBJECT.white.base, 0.6),
  shade: mix(OBJECT.steel.light, OBJECT.white.base, 0.2),
};
const HINGE = 25.4;

const fridge: AvatarDef = {
  id: 'fridge',
  kind: 'object',
  name: { he: 'מקרר', en: 'Fridge' },
  tile: TILE.coral,
  layers: {
    back:
      // feet
      rect(30, 86, 7, 7, CLOTH.charcoal.base, 2) +
      rect(63, 86, 7, 7, CLOTH.charcoal.base, 2) +
      // the cabinet: shade, then the lit surface up and left
      path('M37 9H63Q76 9 76 22V83Q76 89 70 89H30Q24 89 24 83V22Q24 9 37 9Z', fridgeBody.shade) +
      path(
        'M37 9H63Q76 9 76 22V83Q76 89 70 89H30Q24 89 24 83V22Q24 9 37 9Z',
        fridgeBody.base,
        ' transform="translate(-1.4 -1.2)"',
      ) +
      // the open cabinet behind the big door: the lit inside, two shelves, snacks
      rect(26.5, 52, 45.5, 33.5, inside.shade, 3) +
      rect(27.5, 53, 43.5, 31.5, inside.base, 2.5) +
      rect(27.5, 63.5, 43.5, 1.8, chrome.base) +
      rect(27.5, 75.5, 43.5, 1.8, chrome.base) +
      // a milk bottle, an apple, a cheese wedge, a jar
      path('M33 63.5V58Q33 56.5 34.5 55.5V54H38.5V55.5Q40 56.5 40 58V63.5Z', OBJECT.white.base) +
      rect(34.2, 53.2, 4.6, 1.6, OBJECT.blue.base, 0.6) +
      circle(47, 60.6, 2.9, OBJECT.red.base) +
      line('M47 57.6L47.6 56.2', FUR.brown.base, 0.9) +
      path('M55 63.5L66 63.5L66 59Z', OBJECT.gold.base) +
      circle(61.5, 61.5, 0.8, OBJECT.gold.shade) +
      rect(36, 69, 8, 6.5, OBJECT.orange.base, 1.6) +
      rect(35.6, 68, 8.8, 2, OBJECT.red.shade, 0.8) +
      rect(52, 66.8, 4.5, 8.7, OBJECT.green.shade, 1.6) +
      // the freezer door's seam, its handle, a shine
      rect(24, 48.6, 50.6, 1.6, fridgeBody.shade) +
      rect(68.6, 33, 3.2, 11, chrome.shade, 1.6) +
      rect(68.2, 32.4, 2.8, 10.4, chrome.base, 1.4) +
      ellipse(28.8, 22, 1.8, 6.5, fridgeBody.light),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 26 }, right: { x: 58.5, y: 26 }, r: 4.8, style: 'dot' },
    brows: { lift: 1.85, length: 2.1, thickness: 2 },
    mouth: { x: 50, y: 38.8, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 6 },
  },
  pivot: { x: 50, y: 50 },
  base: 93,
  squash: true,
  motionBias: ['shake', 'wobble', 'squash', 'bounce'],
  gimmicks: [
    {
      id: 'door',
      z: 'back',
      markup:
        // the big door, its handle and three magnets: a heart, a star, a note
        path(
          `M${HINGE - 1.4} 50.2H74.6V82.4Q74.6 87.8 68.6 87.8H${f(HINGE + 4.6)}Q${f(HINGE - 1.4)} 87.8 ${f(HINGE - 1.4)} 82.4Z`,
          fridgeBody.base,
        ) +
        rect(HINGE - 1.4, 85.6, 51.2, 2.2, fridgeBody.shade, 1.1) +
        rect(68.6, 54, 3.2, 13, chrome.shade, 1.6) +
        rect(68.2, 53.4, 2.8, 12.4, chrome.base, 1.4) +
        path(
          'M38 63.6Q34 60.6 34 58.2Q34 55.8 36.2 55.8Q37.4 55.8 38 57Q38.6 55.8 39.8 55.8Q42 55.8 42 58.2Q42 60.6 38 63.6Z',
          OBJECT.red.base,
        ) +
        rect(46, 66.5, 10, 11, OBJECT.white.base, 1) +
        line('M48 70H54M48 73H52.5', OBJECT.steel.base, 1) +
        circle(51, 66.6, 1.3, OBJECT.blue.base) +
        path(
          `M${polar(40, 74, 3.6, -90)}L${polar(40, 74, 1.5, -54)}L${polar(40, 74, 3.6, -18)}L${polar(40, 74, 1.5, 18)}` +
            `L${polar(40, 74, 3.6, 54)}L${polar(40, 74, 1.5, 90)}L${polar(40, 74, 3.6, 126)}L${polar(40, 74, 1.5, 162)}` +
            `L${polar(40, 74, 3.6, 198)}L${polar(40, 74, 1.5, 234)}Z`,
          OBJECT.gold.base,
        ),
      anim: [
        {
          trigger: ['laugh'],
          durationMs: 900,
          keyframes: [
            { t: 0, ease: 'emphasized' },
            { t: 0.45, sx: 0.12 },
            { t: 0.7, sx: 0.16, ease: 'standard' },
            { t: 1, sx: 0.12 },
          ],
          origin: { x: HINGE - 1.4, y: 69 },
        },
        {
          trigger: ['surprised'],
          durationMs: 1400,
          keyframes: [
            { t: 0, ease: 'emphasized' },
            { t: 0.25, sx: 0.55 },
            { t: 0.65, sx: 0.6, ease: 'exit' },
            { t: 0.85, sx: 1.02 },
            { t: 1 },
          ],
          origin: { x: HINGE - 1.4, y: 69 },
        },
        {
          trigger: ['angry'],
          durationMs: 380,
          loop: true,
          keyframes: [{ t: 0 }, { t: 0.5, sx: 0.9 }, { t: 1 }],
          origin: { x: HINGE - 1.4, y: 69 },
        },
      ],
    },
  ],
};

// =========================================================================================================
// SYMBOLS
// =========================================================================================================

// ---------------------------------------------------------------------------------------------------------
// Sudoku board: a little 4 x 4 board in the app's colours, its face made of its four middle cells (the
// highlighted ones). When it smiles it fills in the missing 4; when it is angry a wrong 2 flashes red.

const frame = CLOTH.charcoal;
const cell = OBJECT.white;
const gridLine = OBJECT.steel.light;
/** The givens: softer than the app's near-black, so at 24 px the face, not the digits, carries the tile. */
const given = mix(CLOTH.charcoal.base, OBJECT.steel.shade, 0.45);
const faceCells = {
  base: mix(TILE.sky, OBJECT.white.base, 0.6),
  shade: mix(TILE.sky, OBJECT.white.base, 0.3),
};
/** Cell centres: columns and rows 1-4. */
const COL = [25.3, 40.9, 59.1, 74.7] as const;
const ROW = [21.3, 36.9, 55.1, 70.7] as const;
const at = (r: number, c: number): Pt => [COL[c - 1] ?? 50, ROW[r - 1] ?? 50];
/** A digit 1-4 as a stroke, `h` tall, centred on `c`. */
const digit = (n: 1 | 2 | 3 | 4, [x, y]: Pt, color: string, h = 8.6): string => {
  const p = (dx: number, dy: number) => `${f(x + dx * h)} ${f(y + dy * h)}`;
  const d = {
    1: `M${p(-0.2, -0.28)}L${p(0.06, -0.5)}V${f(y + 0.5 * h)}`,
    2: `M${p(-0.27, -0.24)}C${p(-0.25, -0.58)} ${p(0.3, -0.58)} ${p(0.29, -0.22)}C${p(0.28, 0)} ${p(-0.05, 0.18)} ${p(-0.3, 0.5)}H${f(x + 0.32 * h)}`,
    3: `M${p(-0.27, -0.38)}Q${p(0.02, -0.62)} ${p(0.24, -0.38)}Q${p(0.36, -0.1)} ${p(-0.02, -0.04)}Q${p(0.42, 0.04)} ${p(0.26, 0.36)}Q${p(0.02, 0.64)} ${p(-0.3, 0.38)}`,
    4: `M${p(0.12, 0.5)}V${f(y - 0.5 * h)}L${p(-0.32, 0.18)}H${f(x + 0.34 * h)}`,
  }[n];
  return line(d, color, 0.22 * h);
};

const sudokuBoard: AvatarDef = {
  id: 'sudoku-board',
  kind: 'symbol',
  name: { he: 'לוח סודוקו', en: 'Sudoku board' },
  tile: TILE.tangerine,
  layers: {
    back:
      // feet
      ellipse(36, 88.5, 7.5, 4, frame.shade) +
      ellipse(64, 88.5, 7.5, 4, frame.shade) +
      // the frame: shade, then the lit surface up and left
      rect(14, 10, 72, 75, frame.shade, 9) +
      rect(12.8, 8.8, 72, 75, frame.base, 9) +
      // four boxes of four cells: dark gaps between the boxes, thin lines between the cells
      [
        [17.5, 13.5],
        [51.3, 13.5],
        [17.5, 47.3],
        [51.3, 47.3],
      ]
        .map(
          ([x = 0, y = 0]) =>
            rect(x, y, 31.2, 31.2, cell.base, 2.6) +
            line(
              `M${f(x + 15.6)} ${f(y)}V${f(y + 31.2)}M${f(x)} ${f(y + 15.6)}H${f(x + 31.2)}`,
              gridLine,
              1.1,
            ),
        )
        .join('') +
      // the face: the four middle cells, highlighted
      rect(33.1, 29.1, 33.8, 33.8, faceCells.shade, 3.4) +
      rect(33.6, 29.6, 32.8, 32.8, faceCells.base, 3) +
      line('M50 30V62M34 46H66', mix(faceCells.base, faceCells.shade, 0.5), 1) +
      // the givens
      digit(1, at(1, 1), given) +
      digit(3, at(2, 1), given) +
      digit(2, at(2, 4), given) +
      digit(2, at(3, 1), given) +
      digit(4, at(4, 1), given) +
      digit(3, at(4, 2), given) +
      digit(1, at(4, 4), given),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: COL[1], y: ROW[1] }, right: { x: COL[2], y: ROW[1] }, r: 5, style: 'dot' },
    brows: { lift: 1.8, length: 2, thickness: 2 },
    mouth: { x: 50, y: 52, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 6 },
  },
  pivot: { x: 50, y: 48 },
  base: 92.5,
  squash: true,
  motionBias: ['bounce', 'flip', 'tilt', 'squash'],
  gimmicks: [
    {
      id: 'fill-in',
      rest: 'hidden',
      markup: digit(4, at(1, 4), OBJECT.blue.shade),
      anim: {
        trigger: ['smile', 'laugh'],
        durationMs: 800,
        keyframes: [
          { t: 0, sx: 0.3, sy: 0.3, opacity: 0, ease: 'emphasized' },
          { t: 0.4, sx: 1, sy: 1, opacity: 1 },
          { t: 1, opacity: 1 },
        ],
        origin: { x: COL[3], y: ROW[0] },
      },
    },
    {
      id: 'mistake',
      rest: 'hidden',
      markup:
        rect(COL[3] - 7.4, ROW[2] - 7.4, 14.8, 14.8, mix(OBJECT.red.light, OBJECT.white.base, 0.55), 2) +
        digit(2, at(3, 4), shade(OBJECT.red.shade, -0.12)),
      anim: {
        trigger: ['angry'],
        durationMs: 900,
        loop: true,
        ease: 'linear',
        keyframes: [
          { t: 0, opacity: 0 },
          { t: 0.08, opacity: 1 },
          { t: 0.5, opacity: 1 },
          { t: 0.58, opacity: 0 },
          { t: 1, opacity: 0 },
        ],
        origin: { x: COL[3], y: ROW[2] },
      },
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Question mark: always a little lost. The dot is its head; the hook floats above it like the question it
// can't stop asking. Confused, the hook turns this way and that; surprised, it snaps straight into a "!".

const qm = OBJECT.purple;
const hookD = 'M37.6 30.4A13 13 0 1 1 57 38.4Q50.2 42 50.2 47.6';

const questionMark: AvatarDef = {
  id: 'question-mark',
  kind: 'symbol',
  name: { he: 'סימן שאלה', en: 'Question mark' },
  tile: TILE.leaf,
  layers: {
    back:
      // the dot, its head: shade, then the lit surface up and left, a shine
      circle(50, 73, 20, qm.shade) +
      circle(48.7, 71.7, 18.8, qm.base) +
      ellipse(35, 64, 2.2, 4.8, qm.light, 36),
  },
  face: {
    ink: FACE.ink,
    // low on the head, so even surprised brows stay on it
    eyes: { left: { x: 42, y: 72 }, right: { x: 58, y: 72 }, r: 5.4, style: 'round' },
    brows: { lift: 1.6, length: 1.6, thickness: 2.1 },
    mouth: { x: 50, y: 84.2, w: 13 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 7 },
  },
  // the middle of the whole sign, so a spin keeps the hook in the tile
  pivot: { x: 50, y: 52 },
  base: 93,
  squash: true,
  motionBias: ['tilt', 'shake', 'spin', 'squash'],
  gimmicks: [
    {
      id: 'hook',
      z: 'behind',
      markup: shadedLine(hookD, qm, 11.5) + ellipse(41.5, 21, 1.4, 3.2, qm.light, 50),
      anim: [
        {
          trigger: ['surprised'],
          durationMs: 500,
          keyframes: [
            { t: 0, ease: 'exit' },
            { t: 0.5, sx: 0.4, sy: 0.6, opacity: 0 },
            { t: 1, sx: 0.4, sy: 0.6, opacity: 0 },
          ],
          origin: { x: 50, y: 48 },
        },
        {
          trigger: ['confused'],
          durationMs: 2200,
          loop: true,
          keyframes: [{ t: 0 }, { t: 0.25, sx: -1 }, { t: 0.5, sx: -1 }, { t: 0.75 }, { t: 1 }],
          origin: { x: 50, y: 48 },
        },
        { ...R.sway({ angle: 6, ms: 2800 }), trigger: ['idle', 'sad'], origin: { x: 50, y: 48 } },
      ],
    },
    {
      id: 'bang',
      rest: 'hidden',
      markup:
        path('M43.6 13.5Q43.6 8 50 8Q56.4 8 56.4 13.5L53.4 44Q53 47.6 50 47.6Q47 47.6 46.6 44Z', qm.shade) +
        path(
          'M42.4 12.4Q42.4 6.9 48.8 6.9Q55.2 6.9 55.2 12.4L52.2 42.9Q51.8 46.5 48.8 46.5Q45.8 46.5 45.4 42.9Z',
          qm.base,
        ),
      anim: {
        trigger: ['surprised'],
        durationMs: 700,
        keyframes: [
          { t: 0, sy: 0.3, opacity: 0, ease: 'emphasized' },
          { t: 0.15, sy: 0.4, opacity: 1, ease: 'emphasized' },
          { t: 0.6, sy: 1 },
          { t: 1, sy: 1 },
        ],
        origin: { x: 50, y: 47 },
      },
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Plus and minus: a matching pair, the same chunky bar. Plus is cheerful (little pluses twinkle round it);
// when it is sad its upright bar sinks and it turns into a minus. Minus is gloomy and sighs; when it laughs,
// at last, an upright bar shoots up behind it and for a moment it is a plus.

const BAR = { x: 11, y: 33, w: 78, h: 34, r: 8 } as const;
const POST = { x: 33, y: 11, w: 34, h: 78, r: 8 } as const;
const bar = (b: { x: number; y: number; w: number; h: number; r: number }, c: Ramp) =>
  rect(b.x, b.y, b.w, b.h, c.shade, b.r) + rect(b.x - 1.4, b.y - 1.3, b.w, b.h, c.base, b.r);
const plusC = OBJECT.green;
const minusC = OBJECT.red;
/** The pair's shared face. No cheeks: blush turns brown on the green and vanishes on the red. */
const barFace: FaceDef = {
  ink: FACE.ink,
  eyes: { left: { x: 41.5, y: 46.5 }, right: { x: 58.5, y: 46.5 }, r: 5.4, style: 'round' },
  brows: { lift: 1.62, length: 1.7, thickness: 2.2 },
  mouth: { x: 50, y: 59.3, w: 14 },
  halo: { x: 50, y: 8 },
};
/** A tiny plus that twinkles beside the big one. */
const twinkle = (i: number, [x, y]: Pt, s: number): GimmickDef => ({
  id: `twinkle-${i}`,
  rest: 'hidden',
  markup: line(`M${f(x - s)} ${f(y)}H${f(x + s)}M${f(x)} ${f(y - s)}V${f(y + s)}`, FACE.sparkle, 0.8 * s),
  anim: [
    { ...R.sparks({ ms: 1500 }), delayMs: i * 500, trigger: ['smile', 'laugh'], origin: { x, y } },
    // idle: now and then, one at a time
    { ...R.sparks({ ms: 4200 }), delayMs: i * 1400, trigger: ['idle'], origin: { x, y } },
  ],
});

const plus: AvatarDef = {
  id: 'plus',
  kind: 'symbol',
  name: { he: 'פלוס', en: 'Plus' },
  tile: TILE.rose,
  layers: {
    back: bar(BAR, plusC) + ellipse(17, 42, 1.8, 4.4, plusC.light),
  },
  face: barFace,
  pivot: { x: 50, y: 50 },
  base: 89,
  squash: true,
  motionBias: ['bounce', 'spin', 'squash', 'tilt'],
  gimmicks: [
    {
      id: 'post',
      z: 'behind',
      markup: bar(POST, plusC) + ellipse(38.5, 18.5, 1.8, 4.4, plusC.light),
      anim: {
        trigger: ['sad'],
        durationMs: 900,
        keyframes: [
          { t: 0, ease: 'exit' },
          { t: 0.6, sy: 0.12 },
          { t: 1, sy: 0.12 },
        ],
        origin: { x: 50, y: 50 },
      },
    },
    twinkle(0, [21, 20], 3.2),
    twinkle(1, [80, 79], 3.2),
    twinkle(2, [79, 21], 2.4),
  ],
};

const minus: AvatarDef = {
  id: 'minus',
  kind: 'symbol',
  name: { he: 'מינוס', en: 'Minus' },
  tile: TILE.sky,
  layers: { back: '' },
  face: barFace,
  pivot: { x: 50, y: 50 },
  base: 67,
  squash: true,
  motionBias: ['nod', 'wobble', 'tilt', 'shake'],
  gimmicks: [
    {
      id: 'post',
      z: 'behind',
      rest: 'hidden',
      markup: bar(POST, minusC) + ellipse(38.5, 18.5, 1.8, 4.4, minusC.light),
      anim: {
        trigger: ['laugh'],
        durationMs: 900,
        keyframes: [
          { t: 0, sy: 0.12, opacity: 0 },
          { t: 0.05, sy: 0.12, ease: 'emphasized' },
          { t: 0.5, sy: 1 },
          { t: 1, sy: 1 },
        ],
        origin: { x: 50, y: 50 },
      },
    },
    {
      id: 'bar',
      z: 'face',
      markup: bar(BAR, minusC) + ellipse(17, 42, 1.8, 4.4, minusC.light),
      anim: [
        { ...R.deflate({ scale: 0.94, droop: 3, ms: 1200 }), trigger: ['sad'], origin: { x: 50, y: 67 } },
        {
          trigger: ['idle'],
          durationMs: 4200,
          loop: true,
          keyframes: [{ t: 0 }, { t: 0.4, sx: 1.02, sy: 1.05 }, { t: 0.55, sx: 1.02, sy: 1.05 }, { t: 1 }],
          origin: { x: 50, y: 67 },
        },
      ],
    },
  ],
};

export const SYMBOLS: readonly AvatarDef[] = [
  mandrake,
  dinoEgg,
  walkingEye,
  fridge,
  sudokuBoard,
  questionMark,
  plus,
  minus,
];
