/**
 * The digits 0-9 (kind `symbol`), each with a character of its own. The 8 already lives in objects.ts.
 *
 * Read docs/avatars/STYLE.md first. Shared drawing helpers: ./draw.ts; gimmick recipes: ../gimmick.ts. Add each
 * character's AvatarDef here and append it to the list below: catalog/index.ts already includes this list.
 *
 * Every digit follows the 8: a chunky "balloon" figure standing in the tile, an offset shade on the lower right,
 * the counter cut open to the tile (with a shade lip on its top edge), one or two shines, and the face on the
 * widest calm surface. The counters sit above the face, so they stay open and the digit reads at 24 px.
 */

import { GIMMICK_RECIPES as R } from '../gimmick';
import { FACE, mix, OBJECT, type Ramp, shade, TILE } from '../palette';
import { f } from '../svg';
import type { AvatarDef } from '../types';
import { circle, ellipse, line, path, shaded } from './draw';

// ---------------------------------------------------------------------------------------------------------
// Shared pieces

/** Two feet, like the 8's. */
const feet = (xl: number, xr: number, y: number, color: string, rx = 7.5, ry = 4.2) =>
  ellipse(xl, y, rx, ry, color) + ellipse(xr, y, rx, ry, color);

/** An oval counter cut to the tile, with the 8's shade lip along its top edge. */
function hole(cx: number, cy: number, rx: number, ry: number, tile: string, lip: string): string {
  const k = 0.42;
  const a = rx * Math.sqrt(1 - k * k);
  const y = cy - k * ry;
  return (
    ellipse(cx, cy, rx, ry, tile) +
    path(
      `M${f(cx - a)} ${f(y)}A${f(rx)} ${f(ry)} 0 0 1 ${f(cx + a)} ${f(y)}` +
        `A${f(1.31 * a)} ${f(1.31 * a)} 0 0 0 ${f(cx - a)} ${f(y)}Z`,
      lip,
    )
  );
}

/** A four-point sparkle (a glint). */
function star(x: number, y: number, s: number, fill: string): string {
  const k = 0.18 * s;
  return path(
    `M${f(x)} ${f(y - s)}Q${f(x + k)} ${f(y - k)} ${f(x + s)} ${f(y)}Q${f(x + k)} ${f(y + k)} ${f(x)} ${f(y + s)}` +
      `Q${f(x - k)} ${f(y + k)} ${f(x - s)} ${f(y)}Q${f(x - k)} ${f(y - k)} ${f(x)} ${f(y - s)}Z`,
    fill,
  );
}

/** The point at `deg` degrees (0 = right, 90 = down) on a circle, as numbers. */
const at = (cx: number, cy: number, r: number, deg: number): [number, number] => [
  cx + r * Math.cos((deg * Math.PI) / 180),
  cy + r * Math.sin((deg * Math.PI) / 180),
];

/** A ring (a halo, a monocle): a stroked ellipse. */
const ring = (x: number, y: number, rx: number, ry: number, color: string, width: number) =>
  `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" fill="none" stroke="${color}" stroke-width="${f(width)}"/>`;

/** The face every digit shares, as on the 8: round eyes, short thick brows, small cheeks. */
const BROWS = { lift: 1.75, length: 1.7, thickness: 2.2 } as const;
const CHEEKS = { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 } as const;

// ---------------------------------------------------------------------------------------------------------
// Zero: round and calm, an angel. A tall oval with its counter high up and the face below; a gold halo floats
// over it (it bobs when idle, hops when surprised, slips when sad).

const mint: Ramp = {
  base: mix(TILE.teal, OBJECT.green.light, 0.55),
  shade: mix(TILE.teal, OBJECT.green.base, 0.3),
  light: mix(TILE.teal, OBJECT.white.base, 0.6),
};
const zeroTile = TILE.orchid;
const halo = OBJECT.gold;

const zero: AvatarDef = {
  id: 'zero',
  kind: 'symbol',
  name: { he: 'אפס', en: 'Zero' },
  tile: zeroTile,
  layers: {
    back:
      feet(40.5, 59.5, 90.5, mint.shade) +
      ellipse(50, 54.5, 30, 35, mint.shade) +
      ellipse(48.6, 53.1, 28.1, 33.1, mint.base) +
      hole(50, 35.5, 9.5, 11, zeroTile, mint.shade) +
      ellipse(28.5, 37.5, 2.6, 6.4, mint.light, 18) +
      ellipse(26.5, 61.5, 2.4, 5.4, mint.light, 6),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 64.5 }, right: { x: 58.5, y: 64.5 }, r: 5.6, style: 'round' },
    brows: { ...BROWS, lift: 1.65 },
    mouth: { x: 50, y: 78, w: 15 },
    // no cheeks: blush on green turns brown
    halo: { x: 50, y: 15 },
  },
  pivot: { x: 50, y: 55 },
  base: 94.5,
  squash: true,
  motionBias: ['nod', 'wobble', 'squash', 'spin'],
  gimmicks: [
    {
      id: 'halo',
      markup:
        ring(50.4, 12.4, 11, 3, halo.shade, 2.6) +
        ring(50, 12, 11, 3, halo.base, 2.4) +
        line('M41.5 11.2Q44 9.6 48 9.2', halo.light, 1.2),
      anim: [
        { ...R.popUp({ height: 4, ms: 1100 }), trigger: ['surprised'], origin: { x: 50, y: 12 } },
        {
          trigger: ['sad'],
          keyframes: [
            { t: 0, ease: 'standard' },
            { t: 1, y: 2.4, rotate: -12 },
          ],
          durationMs: 900,
          origin: { x: 50, y: 12 },
        },
        { ...R.sway({ angle: 14, ms: 900 }), trigger: ['dizzy'], origin: { x: 50, y: 12 } },
        {
          trigger: ['idle', 'sleepy', 'smile'],
          keyframes: [{ t: 0 }, { t: 0.5, y: -1.6 }, { t: 1 }],
          durationMs: 2600,
          loop: true,
          origin: { x: 50, y: 12 },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// One: tall and proud, number one. The flag up top like a quiff, a base bar to stand on, and a winner's rosette
// on the chest that glints.

const oneBody = OBJECT.red;
const ribbon = OBJECT.blue;
const medal = OBJECT.gold;
const oneOutline =
  'M41 9H59Q67 9 67 17V79H72.5Q79 79 79 85.5Q79 92 72.5 92H27.5Q21 92 21 85.5Q21 79 27.5 79H33V36' +
  'L28.7 40.3A7.6 7.6 0 0 1 18 29.6L36 11.6Q38.4 9 41 9Z';

const one: AvatarDef = {
  id: 'one',
  kind: 'symbol',
  name: { he: 'אחד', en: 'One' },
  tile: TILE.sky,
  layers: {
    back:
      shaded(oneOutline, oneBody.base, oneBody.shade) +
      ellipse(36.6, 62, 2, 5.6, oneBody.light) +
      ellipse(24.5, 31, 2, 4.6, oneBody.light, 45) +
      // the rosette: two ribbon tails, a pleated ring and a gold medal
      path('M47.6 70L41.2 84.6L44.4 83.2L46.6 86.8L52.6 72Z', ribbon.base) +
      path('M52.4 70L58.8 84.6L55.6 83.2L53.4 86.8L47.4 72Z', ribbon.shade) +
      Array.from({ length: 10 }, (_, i) =>
        circle(...at(50, 69, 5.7, i * 36), 2.7, i < 5 ? ribbon.shade : ribbon.base),
      ).join('') +
      circle(50.4, 69.4, 4.9, medal.shade) +
      circle(50, 69, 4.4, medal.base) +
      ellipse(48.6, 67.4, 1.1, 1.7, medal.light, 40),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 40 }, right: { x: 58.5, y: 40 }, r: 5.5, style: 'round' },
    brows: BROWS,
    mouth: { x: 50, y: 53.5, w: 14.5 },
    cheeks: CHEEKS,
    halo: { x: 50, y: 7.5 },
  },
  pivot: { x: 50, y: 50 },
  base: 92,
  squash: true,
  motionBias: ['nod', 'bounce', 'flip', 'tilt'],
  gimmicks: [
    {
      id: 'glint',
      rest: 'hidden',
      markup: star(54, 66, 3.6, OBJECT.white.base),
      anim: {
        ...R.sparks({ ms: 1500 }),
        trigger: ['idle', 'smile', 'laugh', 'wink'],
        origin: { x: 54, y: 66 },
      },
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Two: elegant, a white swan of a digit with a bow. The face sits on the round head; the notch under the
// head and the long base keep it a 2.

const twoBody = OBJECT.white;
const bow = OBJECT.purple;
const twoOutline =
  'M26 33A24 24 0 0 1 74 33C74 45 67 54 59 61L45 74H73Q80 74 80 81V85Q80 92 73 92H27Q20 92 20 85V81.5' +
  'Q20 77 23.5 73.5L42 56Q37 49.5 31 47.5Q26 44.5 26 33Z';
/** One loop of the bow, from the knot to the right. */
const loop = 'M0 0C3 -7.5 11.5 -7 11 -0.5C11.5 6 3 7 0 0Z';

const two: AvatarDef = {
  id: 'two',
  kind: 'symbol',
  name: { he: 'שתיים', en: 'Two' },
  tile: TILE.rose,
  layers: {
    back: shaded(twoOutline, twoBody.base, twoBody.shade),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 31 }, right: { x: 58.5, y: 31 }, r: 4.9, style: 'dot' },
    brows: { lift: 1.85, length: 2.1, thickness: 2.1 },
    mouth: { x: 50, y: 44.5, w: 14.5 },
    cheeks: CHEEKS,
    halo: { x: 50, y: 6.5 },
  },
  pivot: { x: 50, y: 48 },
  base: 92,
  squash: true,
  motionBias: ['spin', 'tilt', 'nod', 'flip'],
  gimmicks: [
    {
      id: 'bow',
      markup:
        `<g transform="translate(33 13.5) rotate(-24)">` +
        path(loop, bow.shade, ' transform="scale(-1 1)"') +
        path(loop, bow.base) +
        path('M-1 1.5L-4.5 9L-1.5 8L0 10.5L1.5 2Z', bow.shade) +
        circle(0, 0, 2.7, bow.shade) +
        circle(-0.4, -0.4, 2.2, bow.base) +
        ellipse(5, -2.4, 2.4, 1.1, bow.light, -20) +
        `</g>`,
      anim: [
        { ...R.sway({ angle: 14, ms: 700 }), trigger: ['laugh', 'spin', 'flip'], origin: { x: 33, y: 13.5 } },
        { ...R.sway({ angle: 7, ms: 2400 }), trigger: ['idle', 'smile', 'wink'], origin: { x: 33, y: 13.5 } },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Three: cheeky, a propeller beanie on its head. The face sits on the bigger lower bowl; the three prongs on
// the left keep it a 3.

const threeBody = OBJECT.orange;
/** Two circles (the bowls), a round-ended slot cut into each from the left, a rounded prong between them. */
const threeOutline =
  'M29.53 28.5A18 18 0 1 1 61.41 44.58Q58.02 47.24 61.98 49.32A23.5 23.5 0 1 1 23.12 64.6H32.2' +
  'A4.8 4.8 0 0 0 32.2 55H26.29Q27.2 46.6 28.95 38.5H43.5A5 5 0 0 0 43.5 28.5Z';
const cap = { a: OBJECT.red, b: OBJECT.gold, band: OBJECT.blue };

const three: AvatarDef = {
  id: 'three',
  kind: 'symbol',
  name: { he: 'שלוש', en: 'Three' },
  tile: TILE.iris,
  layers: {
    back:
      feet(37, 56, 91, threeBody.shade, 7.5, 3.8) +
      shaded(threeOutline, threeBody.base, threeBody.shade) +
      ellipse(34, 22.5, 2, 4.6, threeBody.light, -55) +
      ellipse(27, 74, 2.2, 5, threeBody.light, 30) +
      // the beanie, a little to the right: segments, a band
      path('M42.5 20.5Q43 11.9 52 11.5Q61 11.9 61.5 20.5Z', cap.a.base) +
      path('M48.4 12.1Q52 11.1 55.6 12.1Q56.8 16 56.8 20.5H47.2Q47.2 16 48.4 12.1Z', cap.b.base) +
      path(
        'M42.5 18.4H61.5Q63.4 18.4 63.4 20.2Q63.4 22 61.5 22H42.5Q40.6 22 40.6 20.2Q40.6 18.4 42.5 18.4Z',
        cap.band.base,
      ) +
      line('M52 11.7V8.8', OBJECT.steel.shade, 1.6),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 43.5, y: 71 }, right: { x: 60, y: 71 }, r: 5.5, style: 'round' },
    brows: BROWS,
    mouth: { x: 51.75, y: 83.5, w: 14 },
    cheeks: CHEEKS,
    halo: { x: 48, y: 6.5 },
  },
  pivot: { x: 47, y: 56 },
  base: 94.5,
  squash: true,
  motionBias: ['squash', 'shake', 'bounce', 'flip'],
  gimmicks: [
    {
      id: 'propeller',
      markup:
        ellipse(46.4, 8.8, 5.6, 1.7, cap.a.base) +
        ellipse(57.6, 8.8, 5.6, 1.7, cap.b.base) +
        circle(52, 8.8, 1.5, cap.band.shade),
      anim: [
        {
          trigger: ['laugh', 'dizzy', 'spin', 'squash', 'bounce'],
          keyframes: [{ t: 0 }, { t: 0.5, sx: -1 }, { t: 1 }],
          durationMs: 300,
          loop: true,
          origin: { x: 52, y: 8.8 },
        },
        {
          trigger: ['idle', 'smile', 'wink'],
          keyframes: [{ t: 0 }, { t: 0.5, sx: -1 }, { t: 1 }],
          durationMs: 1400,
          loop: true,
          origin: { x: 52, y: 8.8 },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Four: sporty. A closed 4 with a small counter up in the corner; the face sits where the slope meets the
// crossbar. A basketball rests in the gap under the crossbar and dribbles.

const fourBody = OBJECT.green;
const fourTile = TILE.berry;
const ball = OBJECT.orange;
const fourOutline =
  'M62 9.5H74Q79 9.5 79 15V59H83Q88 59 88 64V70Q88 75 83 75H79V85Q79 90 74 90H62Q57 90 57 85V75H17' +
  'Q12 75 12 70V64.5Q12 61 14.5 58L55 12.5Q57.8 9.5 62 9.5Z';
const fourCounter = 'M63 21.5V30.5Q63 33 60.5 33H54Q50.5 33 52.6 30.6L60.6 21.6Q63 19 63 21.5Z';
const fourLip = 'M52.6 30.6L60.6 21.6Q63 19 63 21.5V23.6Q61.8 22.4 60.6 23.8L53.8 31.5Q52.8 32.6 52.6 30.6Z';
const ballMarkup =
  circle(29, 86.6, 7.2, ball.shade) +
  circle(28.4, 86, 6.5, ball.base) +
  line('M21.9 86.2Q29 84.4 35.6 87.6', shade(ball.shade, -0.35), 1) +
  line('M28.6 79.6Q31.6 86.5 28.2 93.4', shade(ball.shade, -0.35), 1) +
  ellipse(25.6, 83, 1.2, 2.1, ball.light, 40);

const four: AvatarDef = {
  id: 'four',
  kind: 'symbol',
  name: { he: 'ארבע', en: 'Four' },
  tile: fourTile,
  layers: {
    back:
      feet(62, 74, 90.5, fourBody.shade, 6.2, 4) +
      shaded(fourOutline, fourBody.base, fourBody.shade) +
      path(fourCounter, fourTile) +
      path(fourLip, fourBody.shade) +
      ellipse(30, 45, 2, 6, fourBody.light, 41) +
      ellipse(73, 22, 1.8, 4.4, fourBody.light),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 42, y: 52 }, right: { x: 59, y: 52 }, r: 5.5, style: 'round' },
    brows: BROWS,
    mouth: { x: 50.5, y: 65.5, w: 14.5 },
    // no cheeks: blush on green turns brown
    halo: { x: 52, y: 7.5 },
  },
  pivot: { x: 52, y: 52 },
  base: 94.5,
  squash: true,
  motionBias: ['bounce', 'flip', 'squash', 'spin'],
  gimmicks: [
    {
      id: 'ball',
      markup: ballMarkup,
      anim: [
        {
          trigger: ['laugh', 'bounce', 'squash', 'surprised'],
          keyframes: [
            { t: 0, ease: 'standard' },
            { t: 0.42, y: -15 },
            { t: 0.5, y: -15, ease: 'exit' },
            { t: 0.88, y: 0 },
            { t: 0.94, sx: 1.12, sy: 0.86 },
            { t: 1 },
          ],
          durationMs: 760,
          loop: true,
          origin: { x: 29, y: 93.8 },
        },
        {
          trigger: ['idle', 'smile'],
          keyframes: [
            { t: 0, ease: 'standard' },
            { t: 0.45, y: -7 },
            { t: 0.9, y: 0, ease: 'exit' },
            { t: 0.95, sx: 1.08, sy: 0.9 },
            { t: 1 },
          ],
          durationMs: 900,
          loop: true,
          origin: { x: 29, y: 93.8 },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Five: sleepy, in a nightcap. The face sits on the bowl; the flag and the notch on the left keep it a 5. The
// cap's floppy tail swings when idle, and a sleep bubble swells and shrinks when it dozes off.

const fiveBody = OBJECT.blue;
const nightcap = OBJECT.pink;
const fluff = OBJECT.white;
const fiveOutline =
  'M33 14H70Q75 14 75 19V24Q75 29 70 29H44V38.4A25.5 25.5 0 1 1 25.6 76.5Q21.8 72 24.6 68.2' +
  'Q37.5 61.5 28.5 53V19Q28.5 14 33 14Z';

const five: AvatarDef = {
  id: 'five',
  kind: 'symbol',
  name: { he: 'חמש', en: 'Five' },
  tile: TILE.mustard,
  layers: {
    back:
      feet(39, 58, 90.5, fiveBody.shade) +
      shaded(fiveOutline, fiveBody.base, fiveBody.shade) +
      ellipse(64, 18.5, 4.4, 1.6, fiveBody.light) +
      ellipse(29, 72, 2, 4.4, fiveBody.light, 35) +
      // the nightcap's crown over the corner (its floppy tail is a gimmick, behind)
      path('M47 15.5C46 6.5 33 4.5 26 10.5Q27 14.5 30 17.5Z', nightcap.shade) +
      path('M45.6 14.6C44.4 7 33 5.6 26.8 11Q27.8 13.8 31 15.8Z', nightcap.base) +
      `<rect x="26" y="12.5" width="23" height="6" rx="3" transform="rotate(-9 37.5 15.5)" fill="${fluff.shade}"/>` +
      `<rect x="26" y="12" width="22" height="5" rx="2.5" transform="rotate(-9 37 14.5)" fill="${fluff.base}"/>`,
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 44.5, y: 63 }, right: { x: 61.5, y: 63 }, r: 5.5, style: 'round' },
    brows: BROWS,
    mouth: { x: 53, y: 76.5, w: 14.5 },
    cheeks: CHEEKS,
    halo: { x: 55, y: 7.5 },
  },
  pivot: { x: 49, y: 56 },
  base: 94.5,
  squash: true,
  motionBias: ['nod', 'wobble', 'tilt', 'squash'],
  gimmicks: [
    {
      id: 'cap-tail',
      z: 'behind',
      markup:
        path('M29 8.6C21.5 13.5 17 21 16 30L20.6 30.4C22 24.5 25.5 19.5 31 16.5Z', nightcap.shade) +
        path('M29 9.8C22.3 14.6 18.8 21.4 17.8 28.6L20.4 28.8C21.8 23 25.8 18.4 30.8 15.6Z', nightcap.base) +
        circle(18.4, 31.2, 4.4, fluff.shade) +
        circle(17.9, 30.6, 3.8, fluff.base),
      anim: [
        { ...R.sway({ angle: 9, ms: 2800 }), trigger: ['idle', 'sleepy', 'smile'], origin: { x: 28, y: 13 } },
        { ...R.sway({ angle: 16, ms: 700 }), trigger: ['laugh', 'shake', 'dizzy'], origin: { x: 28, y: 13 } },
      ],
    },
    {
      id: 'sleep-bubble',
      rest: 'hidden',
      markup:
        circle(64.5, 73.5, 5.6, mix(FACE.tear, OBJECT.white.base, 0.45)) +
        line('M61 71.4Q62 69.6 64 69.2', OBJECT.white.base, 1.3),
      anim: {
        trigger: ['sleepy'],
        keyframes: [{ t: 0, sx: 0.3, sy: 0.3 }, { t: 0.5 }, { t: 1, sx: 0.3, sy: 0.3 }],
        durationMs: 2600,
        loop: true,
        origin: { x: 59.5, y: 77 },
      },
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Six and nine: a mischievous pair of little imps, the one the other turned upside down. Each has horns and a
// devil's tail that wags. The counter sits above the face, in the bowl.

const imp = { horn: OBJECT.cream, six: OBJECT.purple, nine: OBJECT.pink };
const sixTile = TILE.jade;
const nineTile = TILE.cobalt;
const sixOutline =
  'M24 61.5C24 36.5 36 13.5 58 9Q64.5 8 66 13Q67 18 61.5 20C51 23.5 42 29.5 38 37.1A26 27.5 0 1 1 24 61.5Z';
const nineOutline =
  'M76 38.5C76 63.5 64 86.5 42 91Q35.5 92 34 87Q33 82 38.5 80C49 76.5 58 70.5 62 62.9A26 27.5 0 1 1 76 38.5Z';
/** A small horn standing at (x, y), leaning `deg` degrees. */
const horn = (x: number, y: number, deg: number, color: Ramp, s = 1.3) =>
  `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(deg)}) scale(${f(s)})">` +
  path('M-3.6 2Q-3.4 -4.5 1.2 -8.6Q0 -3 3.6 2Z', color.shade) +
  path('M-3.6 2Q-3.4 -4.5 1.2 -8.6Q-0.6 -3 2 2Z', color.base) +
  `</g>`;
/** The devil's tail, from its root to a spade tip. */
const tail = (d: string, tipX: number, tipY: number, color: Ramp) =>
  line(d, color.shade, 2.4) +
  path(
    `M${f(tipX)} ${f(tipY - 5.4)}Q${f(tipX + 4.4)} ${f(tipY - 1.4)} ${f(tipX + 3)} ${f(tipY + 0.6)}` +
      `Q${f(tipX + 1.4)} ${f(tipY + 2)} ${f(tipX)} ${f(tipY + 0.4)}Q${f(tipX - 1.4)} ${f(tipY + 2)} ${f(tipX - 3)} ${f(tipY + 0.6)}` +
      `Q${f(tipX - 4.4)} ${f(tipY - 1.4)} ${f(tipX)} ${f(tipY - 5.4)}Z`,
    color.shade,
  );

const six: AvatarDef = {
  id: 'six',
  kind: 'symbol',
  name: { he: 'שש', en: 'Six' },
  tile: sixTile,
  layers: {
    back:
      horn(49.5, 37, -16, imp.horn) +
      horn(63.5, 40.5, 26, imp.horn) +
      feet(40.5, 59.5, 90.5, imp.six.shade) +
      shaded(sixOutline, imp.six.base, imp.six.shade) +
      hole(50, 44.5, 5, 5.2, sixTile, imp.six.shade) +
      ellipse(30.5, 47, 2.4, 6.6, imp.six.light, 20) +
      ellipse(29, 70, 2.2, 5, imp.six.light, 10),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 66 }, right: { x: 58.5, y: 66 }, r: 5.6, style: 'round' },
    brows: BROWS,
    mouth: { x: 50, y: 79, w: 14.5 },
    cheeks: CHEEKS,
    halo: { x: 54, y: 6.5 },
  },
  pivot: { x: 50, y: 56 },
  base: 94.5,
  squash: true,
  motionBias: ['flip', 'shake', 'squash', 'wobble'],
  gimmicks: [
    {
      id: 'tail',
      z: 'behind',
      markup: tail('M72 74C82 78 89 71 86 62', 86, 60, imp.six),
      anim: [
        { ...R.sway({ angle: 16, ms: 520 }), trigger: ['laugh', 'angry', 'flip'], origin: { x: 73, y: 74 } },
        { ...R.sway({ angle: 9, ms: 1700 }), trigger: ['idle', 'smile', 'wink'], origin: { x: 73, y: 74 } },
      ],
    },
  ],
};

const nine: AvatarDef = {
  id: 'nine',
  kind: 'symbol',
  name: { he: 'תשע', en: 'Nine' },
  tile: nineTile,
  layers: {
    back:
      horn(36, 18.5, -34, imp.horn) +
      horn(64, 18.5, 34, imp.horn) +
      shaded(nineOutline, imp.nine.base, imp.nine.shade) +
      hole(50, 20.5, 5, 5.2, nineTile, imp.nine.shade) +
      ellipse(30, 30, 2.4, 6.4, imp.nine.light, 24) +
      ellipse(53, 85, 1.8, 4.6, imp.nine.light, 64),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 42.5 }, right: { x: 58.5, y: 42.5 }, r: 5.6, style: 'round' },
    brows: BROWS,
    mouth: { x: 50, y: 55.5, w: 14.5 },
    cheeks: CHEEKS,
    halo: { x: 50, y: 6.5 },
  },
  pivot: { x: 50, y: 48 },
  base: 92,
  squash: true,
  motionBias: ['flip', 'shake', 'bounce', 'tilt'],
  gimmicks: [
    {
      id: 'tail',
      z: 'behind',
      markup: tail('M28 50C18 46 11 38 14 30', 14, 28, imp.nine),
      anim: [
        { ...R.sway({ angle: 16, ms: 520 }), trigger: ['laugh', 'angry', 'flip'], origin: { x: 27, y: 50 } },
        { ...R.sway({ angle: 9, ms: 1700 }), trigger: ['idle', 'smile', 'wink'], origin: { x: 27, y: 50 } },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Seven: arrogant, a silver aristocrat with a monocle. The face sits on the thick top bar; the slanted stem
// carries the 7. When surprised, the monocle pops out and dangles.

const sevenBody = OBJECT.steel;
const monocle = OBJECT.gold;
const sevenOutline =
  'M23 9.5H77Q85 9.5 85 17.5V41Q85 46.5 82 51L57 89Q55 92 51.5 92H39.5Q34 92 36 87.5L57.2 50.5' +
  'Q59 47.5 55.5 47.5H23Q15 47.5 15 39.5V17.5Q15 9.5 23 9.5Z';

const seven: AvatarDef = {
  id: 'seven',
  kind: 'symbol',
  name: { he: 'שבע', en: 'Seven' },
  tile: TILE.coral,
  layers: {
    back:
      shaded(sevenOutline, sevenBody.base, sevenBody.shade) +
      ellipse(20.5, 23, 2, 5.6, sevenBody.light) +
      ellipse(47, 71, 1.8, 6, sevenBody.light, 30),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 26.5 }, right: { x: 58.5, y: 26.5 }, r: 5.2, style: 'round' },
    brows: { lift: 2, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 38.5, w: 14 },
    cheeks: CHEEKS,
    halo: { x: 50, y: 6.5 },
  },
  pivot: { x: 50, y: 41 },
  base: 92,
  squash: true,
  motionBias: ['tilt', 'nod', 'shake', 'wobble'],
  gimmicks: [
    {
      id: 'monocle',
      markup:
        line('M64.2 31.4Q70 36 67 44', monocle.shade, 1.1) +
        ring(58.8, 26.8, 7.3, 7.3, monocle.shade, 1.9) +
        ring(58.5, 26.5, 7.3, 7.3, monocle.base, 1.6),
      anim: {
        trigger: ['surprised'],
        keyframes: [
          { t: 0, ease: 'emphasized' },
          { t: 0.16, y: -3, rotate: -8, ease: 'exit' },
          { t: 0.5, x: 7, y: 21, rotate: 26, ease: 'standard' },
          { t: 0.72, x: 7, y: 18.5, rotate: 14 },
          { t: 1, x: 7, y: 20, rotate: 20 },
        ],
        durationMs: 1300,
        origin: { x: 58.5, y: 26.5 },
      },
    },
  ],
};

export const DIGITS: readonly AvatarDef[] = [zero, one, two, three, four, five, six, seven, nine];
