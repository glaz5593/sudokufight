/**
 * People, the second set: more head-and-shoulders characters (kind `person`), each with something of
 * their own (a pirate with an eye patch: `eyes.covered`). `noam` in people.ts sets the bar.
 *
 * Read docs/avatars/STYLE.md first. Shared drawing helpers: ./draw.ts; gimmick recipes: ../gimmick.ts. Add each
 * character's AvatarDef here and append it to the list below: catalog/index.ts already includes this list.
 *
 * The set: a chef whose toque jumps off his bald head, an astronaut with a glare that sweeps her visor, a
 * pirate captain with a patch and a parrot feather, a masked wrestler (luchador) with a sudoku grid on his
 * forehead, a professor whose wild hair throws sparks, and a punk whose mohawk springs up.
 */

import { GIMMICK_RECIPES as R } from '../gimmick';
import { CLOTH, FACE, FUR, HAIR, mix, OBJECT, type Ramp, shade, SKIN, TILE } from '../palette';
import { f } from '../svg';
import type { AvatarDef, GimmickDef } from '../types';
import { circle, ellipse, line, mirrored, P, path, polar, rect, shaded, sx, type Side } from './draw';

type Circle = readonly [x: number, y: number, r: number];

// ---------------------------------------------------------------------------------------------------------
// Shared parts

/** Shoulders from y `top`, `half` wide each side of the middle, running off the tile to y 150 (as noam's). */
const bust = (top: number, half: number) =>
  `M${f(50 - half)} 150V${f(top + 32)}C${f(50 - half)} ${f(top + 10)} ${f(68 - half)} ${f(top)} 50 ${f(top)}` +
  `S${f(50 + half)} ${f(top + 10)} ${f(50 + half)} ${f(top + 32)}V150Z`;

/** The shadow the neck casts on the top, `half` wide (noam's collar line). */
const collarShadow = (top: number, half = 20) =>
  `M${f(50 - half)} ${f(top + 3.5)}C${f(56 - half)} ${f(top + 1)} ${f(62 - half)} ${f(top)} 50 ${f(top)}` +
  `S${f(half + 44)} ${f(top + 1)} ${f(50 + half)} ${f(top + 3.5)}` +
  `C${f(half + 44)} ${f(top + 12.5)} ${f(56 - half)} ${f(top + 12.5)} ${f(50 - half)} ${f(top + 3.5)}Z`;

/** A neck from `top` down to `bottom`, and the shadow the chin casts on it. */
const neck = (top: number, bottom: number, half: number, skin: Ramp) =>
  path(
    `M${f(50 - half)} ${f(top)}V${f(bottom)}a${f(half)} ${f(half * 0.78)} 0 0 0 ${f(2 * half)} 0V${f(top)}Z`,
    skin.base,
  ) +
  path(
    `M${f(50 - half)} ${f(top + 5)}Q50 ${f(top + 14)} ${f(50 + half)} ${f(top + 5)}V${f(top)}H${f(50 - half)}Z`,
    skin.shade,
  );

/** Two ears at height `y`, `dx` from the middle, with their inner shade. */
const ears = (y: number, dx: number, r: number, skin: Ramp) =>
  mirrored((s) => circle(sx(s, dx), y, r, skin.base)) +
  mirrored((s) => circle(sx(s, dx - 0.9), y + 0.4, r * 0.48, skin.shade));

/** A short highlight arc on the upper left of a round shape (people.ts's glint). */
const glint = ([x, y, r]: Circle, color: string, width = 1.4) => {
  const k = r * 0.58;
  return line(`M${polar(x, y, k, 196)}A${f(k)} ${f(k)} 0 0 1 ${polar(x, y, k, 256)}`, color, width);
};

/** Puffy shapes made of circles: all of them in `shade`, then all lit, shifted up and left (§5). */
const puffs = (list: readonly Circle[], base: string, shadeColor: string, d = 1.3) =>
  list.map(([x, y, r]) => circle(x, y, r, shadeColor)).join('') +
  list.map(([x, y, r]) => circle(x - d, y - d, r, base)).join('');

/** A ring: a circle drawn as a line (an earring, a piercing). */
const ring = (x: number, y: number, r: number, color: string, width: number) =>
  `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="none" stroke="${color}" stroke-width="${f(width)}"/>`;

/** A point given as "x y" (what `polar` returns) back as numbers. */
const toPoint = (xy: string): [x: number, y: number] => {
  const [x = 0, y = 0] = xy.split(' ').map(Number);
  return [x, y];
};

/** A circle as a path, for even-odd rings. */
const circlePath = (x: number, y: number, r: number) =>
  `M${f(x - r)} ${f(y)}A${f(r)} ${f(r)} 0 1 0 ${f(x + r)} ${f(y)}A${f(r)} ${f(r)} 0 1 0 ${f(x - r)} ${f(y)}Z`;

/** A four-point sparkle (the rig's dizzy star). */
const sparkle = (x: number, y: number, s: number, fill: string) => {
  const k = 0.18 * s;
  return path(
    `M${f(x)} ${f(y - s)}Q${f(x + k)} ${f(y - k)} ${f(x + s)} ${f(y)}Q${f(x + k)} ${f(y + k)} ${f(x)} ${f(y + s)}` +
      `Q${f(x - k)} ${f(y + k)} ${f(x - s)} ${f(y)}Q${f(x - k)} ${f(y - k)} ${f(x)} ${f(y - s)}Z`,
    fill,
  );
};

/** A puff of steam or smoke, three circles around `x`, `y`. */
const puffAt = (x: number, y: number, s: number, fill: string) =>
  circle(x, y, 3.4 * s, fill) +
  circle(x + 2.9 * s, y - 1.3 * s, 2.6 * s, fill) +
  circle(x - 2.3 * s, y - 2 * s, 2.3 * s, fill);

// ---------------------------------------------------------------------------------------------------------
// Chef Avi: a tall pleated toque, a curled handlebar mustache, a white double-breasted jacket and a red
// neckerchief. Bald under the hat: when he is surprised the toque jumps off his head, and when he is angry it
// rattles like a lid on a boiling pot. His mustache twitches when he idles and wiggles when he laughs.

const chefSkin = SKIN.peach;
const chefHair = HAIR.espresso;
const chefWhite = OBJECT.white;
const chefScarf = OBJECT.red;

// The toque stops at y 9, so dizzy stars circle on the tile above it (they don't read on white).
const toquePuffs: readonly Circle[] = [
  [35.5, 25, 9.5],
  [64.5, 25, 9.5],
  [50, 23, 11.5],
  [42.5, 17.5, 8.5],
  [57.5, 17.5, 8.5],
];
const toqueBand = 'M27 30Q50 26 73 30V40Q50 44 27 40Z';

/** One half of the handlebar mustache, on side `s`: out along the lip, the tip curling up and back in. */
const mustacheHalf = (s: Side) => {
  const q = (dx: number, y: number) => P([sx(s, dx), y]);
  return (
    `M${q(0, 62.8)}C${q(4, 61.4)} ${q(10, 61.6)} ${q(14, 64)}C${q(16.5, 65.6)} ${q(19.8, 64.6)} ${q(20.2, 61.4)}` +
    `C${q(20.5, 58.6)} ${q(17.6, 57.6)} ${q(16.4, 59.6)}C${q(17.8, 59.2)} ${q(18.6, 61.6)} ${q(16.6, 62.6)}` +
    `C${q(13.5, 64.4)} ${q(10, 67.6)} ${q(5, 67.8)}C${q(2.5, 68)} ${q(1, 67)} ${q(0, 66.2)}Z`
  );
};

const chef: AvatarDef = {
  id: 'chef',
  kind: 'person',
  name: { he: 'השף אבי', en: 'Chef Avi' },
  tile: TILE.sky,
  layers: {
    back:
      // the jacket: two rows of buttons, a stand-up collar, the red neckerchief
      path(bust(83, 47), chefWhite.base) +
      path(collarShadow(83), chefWhite.shade) +
      mirrored(
        (s) =>
          circle(sx(s, 12), 94, 1.9, OBJECT.steel.base) + circle(sx(s, 13.5), 100.5, 1.9, OBJECT.steel.base),
      ) +
      neck(66, 82, 9, chefSkin) +
      mirrored((s) =>
        path(
          `M${P([sx(s, 12.5), 83.5])}Q${P([sx(s, 6), 80.8])} ${P([50, 81])}V88Q${P([sx(s, 6), 87.6])} ${P([sx(s, 11), 89.6])}Z`,
          chefWhite.base,
        ),
      ) +
      path('M42.5 85Q50 88 57.5 85L50 97Z', chefScarf.base) +
      path('M50 87.6L57.5 85L50 97Z', chefScarf.shade) +
      circle(50.4, 86.4, 3.3, chefScarf.shade) +
      circle(49.9, 85.9, 2.8, chefScarf.base) +
      // sideburns under the hat, ears, the head (bald on top: the hat hides it), the nose
      mirrored((s) =>
        path(
          `M${P([sx(s, 23.5), 40])}H${P([sx(s, 16.5), 40])}C${P([sx(s, 19), 43.5])} ${P([sx(s, 20), 47.5])} ${P([sx(s, 19.5), 53])}C${P([sx(s, 21.8), 50])} ${P([sx(s, 23.2), 45.5])} ${P([sx(s, 23.5), 40])}Z`,
          chefHair.base,
        ),
      ) +
      ears(56, 24, 5.6, chefSkin) +
      ellipse(50, 53.5, 24, 25.5, chefSkin.base) +
      ellipse(40, 33.5, 5.5, 2.4, chefSkin.light, -22) +
      ellipse(50, 60.6, 3.6, 2.8, chefSkin.shade),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41, y: 54.5 }, right: { x: 59, y: 54.5 }, r: 4, style: 'dot' },
    brows: { lift: 1.9, length: 2.4, color: chefHair.base },
    mouth: { x: 50, y: 71.5, w: 13 },
    // high and close in, so the blush stays off the mustache
    cheeks: { color: FACE.blush, dx: 0.75, dy: 1.1 },
    halo: { x: 50, y: 5.5 },
  },
  pivot: { x: 50, y: 54 },
  headBox: { x: 13, y: 8, size: 74 },
  motionBias: ['nod', 'bounce', 'tilt', 'shake'],
  gimmicks: [
    {
      // under the face, so a tear runs over it
      id: 'mustache',
      z: 'back',
      markup:
        mirrored((s) => path(mustacheHalf(s), chefHair.base)) +
        line('M44.5 63.2Q40 62.9 37 64.8', chefHair.light, 1.2),
      anim: [
        { ...R.sway({ angle: 4, ms: 420 }), trigger: ['laugh'], origin: { x: 50, y: 65 } },
        {
          // a double twitch, then still
          trigger: ['idle', 'smile'],
          durationMs: 2600,
          loop: true,
          keyframes: [
            { t: 0 },
            { t: 0.05, y: -1.3, sx: 1.05 },
            { t: 0.1 },
            { t: 0.15, y: -1.3, sx: 1.05 },
            { t: 0.2 },
            { t: 1 },
          ],
          origin: { x: 50, y: 65 },
        },
      ],
    },
    {
      id: 'toque',
      markup:
        puffs(toquePuffs, chefWhite.base, chefWhite.shade) +
        line('M37.5 30.5Q35.8 26.5 37.2 21.5M50 29V19M62.5 30.5Q64.2 26.5 62.8 21.5', chefWhite.shade, 1.3) +
        shaded(toqueBand, chefWhite.base, chefWhite.shade, -1, -1.2) +
        line('M28 31Q50 27.2 72 31', chefWhite.shade, 1.1),
      anim: [
        { ...R.popUp({ height: 10, ms: 1300 }), trigger: ['surprised'], origin: { x: 50, y: 40 } },
        {
          ...R.lid({ angle: -7, lift: 1.4, ms: 480 }),
          loop: true,
          trigger: ['angry'],
          origin: { x: 72, y: 40 },
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Astronaut Noga: a round space helmet over her afro puffs, a white suit with a mission patch. A glare sweeps
// over the visor when she idles, smiles or winks.

const astroSkin = SKIN.umber;
const astroHair = HAIR.black;
const astroSuit = CLOTH.white;
const astroRim = OBJECT.white;
/** The visor glass: light enough for her face, dark enough for white reflections. */
const astroGlass = mix(OBJECT.blue.light, OBJECT.white.base, 0.3);
const helmet = { x: 50, y: 46.5, out: 38.5, in: 33 };
const visorRing = circlePath(helmet.x, helmet.y, helmet.out) + circlePath(helmet.x, helmet.y, helmet.in);

/** A five-point star around `x`, `y`, outer radius `r`. */
const star = (x: number, y: number, r: number, fill: string) =>
  path(
    `M${Array.from({ length: 10 }, (_, i) => polar(x, y, i % 2 ? r * 0.45 : r, -90 + i * 36)).join('L')}Z`,
    fill,
  );

const astronaut: AvatarDef = {
  id: 'astronaut',
  kind: 'person',
  name: { he: 'האסטרונאוטית נוגה', en: 'Astronaut Noga' },
  tile: TILE.coral,
  layers: {
    back:
      // the suit, a mission patch, the steel neck ring the helmet locks onto
      path(bust(80, 48), astroSuit.base) +
      path(collarShadow(80, 24), astroSuit.shade) +
      circle(70, 94, 5.2, OBJECT.blue.shade) +
      circle(69.6, 93.6, 4.6, OBJECT.blue.base) +
      star(69.6, 93.6, 2.8, OBJECT.gold.base) +
      rect(26.6, 76.6, 46, 11, OBJECT.steel.shade, 5.5) +
      rect(26, 75.8, 45.4, 10.2, OBJECT.steel.base, 5.1) +
      // inside the helmet: the glass, her hair puffs, the neck, ears with studs, the head, her hairline
      circle(helmet.x, helmet.y, helmet.in + 0.5, astroGlass) +
      mirrored((s) => circle(sx(s, 16.5), 25, 9.6, astroHair.base)) +
      mirrored((s) => glint([sx(s, 16.5), 25, 9.6], astroHair.light, 1.5)) +
      neck(64, 80, 7, astroSkin) +
      ears(52.5, 21.5, 4.6, astroSkin) +
      mirrored((s) => circle(sx(s, 21.8), 56.6, 1.2, OBJECT.gold.base)) +
      ellipse(50, 50, 21.5, 23.5, astroSkin.base) +
      path(
        'M28.5 47C27 32 37 25.5 50 25.5S73 32 71.5 47C68 39.5 60 35.5 50 35.5S32 39.5 28.5 47Z',
        astroHair.base,
      ) +
      glint([42, 33, 12], astroHair.light, 1.6) +
      ellipse(50, 59, 2.6, 2, astroSkin.shade),
    front:
      // the helmet's rim (shade crescents on the lower right outside, the upper left inside) and reflections
      path(visorRing, astroRim.shade, ' fill-rule="evenodd"') +
      path(visorRing, astroRim.base, ' fill-rule="evenodd" transform="translate(-1.2 -1.2)"') +
      line(
        `M${polar(helmet.x, helmet.y, 28.6, 208)}A28.6 28.6 0 0 1 ${polar(helmet.x, helmet.y, 28.6, 244)}`,
        OBJECT.white.light,
        2.8,
      ) +
      circle(...toPoint(polar(helmet.x, helmet.y, 28.6, 257)), 1.5, OBJECT.white.light) +
      line(
        `M${polar(helmet.x, helmet.y, 29.4, 24)}A29.4 29.4 0 0 1 ${polar(helmet.x, helmet.y, 29.4, 46)}`,
        OBJECT.white.light,
        1.6,
      ),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 52.5 }, right: { x: 58.5, y: 52.5 }, r: 4.1, style: 'round' },
    brows: { lift: 1.9, length: 2.2, color: astroHair.base },
    mouth: { x: 50, y: 65.5, w: 12.5, ink: mix(FACE.tongue, astroSkin.base, 0.25) },
    cheeks: { color: FACE.tongue },
    halo: { x: 50, y: 21 },
  },
  pivot: { x: 50, y: 50 },
  headBox: { x: 13, y: 11, size: 74 },
  motionBias: ['flip', 'spin', 'bounce', 'tilt'],
  gimmicks: [
    {
      id: 'glare',
      rest: 'hidden',
      // two streaks of light along the inside of the rim
      markup:
        line(
          `M${polar(helmet.x, helmet.y, 30.2, 194)}A30.2 30.2 0 0 1 ${polar(helmet.x, helmet.y, 30.2, 226)}`,
          OBJECT.white.light,
          3.4,
        ) +
        line(
          `M${polar(helmet.x, helmet.y, 25.8, 200)}A25.8 25.8 0 0 1 ${polar(helmet.x, helmet.y, 25.8, 220)}`,
          OBJECT.white.light,
          1.8,
        ) +
        sparkle(...toPoint(polar(helmet.x, helmet.y, 30.2, 228)), 3.4, OBJECT.white.light),
      anim: {
        // sweeps over the top of the visor, then nothing for the rest of the beat
        trigger: ['idle', 'smile', 'wink'],
        durationMs: 3200,
        loop: true,
        ease: 'linear',
        keyframes: [
          { t: 0, opacity: 0, ease: 'standard' },
          { t: 0.06, rotate: 14, opacity: 1, ease: 'linear' },
          { t: 0.32, rotate: 124, opacity: 1 },
          { t: 0.38, rotate: 138, opacity: 0 },
          { t: 1, rotate: 138, opacity: 0 },
        ],
        origin: { x: helmet.x, y: helmet.y },
      },
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Captain Roni: a pirate. A black tricorn with gold trim and two parrot feathers, long auburn hair, a patch
// over her left eye (the rig draws the right one only), a gold hoop, a navy coat. The feathers sway when she
// idles, smiles or laughs, and spring back when she is surprised.

const pirSkin = SKIN.caramel;
const pirHair = HAIR.auburn;
const pirHat = CLOTH.charcoal;
const pirCoat = CLOTH.navy;
const pirGold = OBJECT.gold;
const pirPatch = HAIR.black;
const tricornBrim = 'M11 17Q30 23.5 50 19Q70 23.5 89 17Q83 34 50 42.5Q17 34 11 17Z';

const pirate: AvatarDef = {
  id: 'pirate',
  kind: 'person',
  name: { he: 'קפטן רוני', en: 'Captain Roni' },
  tile: TILE.jade,
  layers: {
    back:
      // long wavy hair behind her shoulders
      path(
        'M24 36C17 50 21 62 16 76C13 84 17 92 24 93C31 94 36 89 36 82C36 77 37 73 38 70H62C63 73 64 77 64 82C64 89 69 94 76 93C83 92 87 84 84 76C79 62 83 50 76 36Z',
        pirHair.base,
      ) +
      // the coat over a cream shirt, gold buttons
      path(bust(82, 46), pirCoat.base) +
      path('M37.5 83C42 82 46 81.5 50 81.5S58 82 62.5 83L50 101Z', CLOTH.cream.base) +
      path('M41.5 83.5Q46 90 50 101L44 98Z', CLOTH.cream.shade) +
      mirrored((s) => circle(sx(s, 15), 92, 1.9, pirGold.base) + circle(sx(s, 15), 98.5, 1.9, pirGold.base)) +
      neck(64, 80, 8, pirSkin) +
      // the head, locks of hair at her temples, the gold hoop under the right one
      ellipse(50, 53, 23, 25, pirSkin.base) +
      ellipse(50, 62, 2.6, 2, pirSkin.shade) +
      mirrored((s) =>
        path(
          `M${P([sx(s, 26), 37])}C${P([sx(s, 27.5), 50])} ${P([sx(s, 27), 62])} ${P([sx(s, 24.5), 72])}C${P([sx(s, 22.5), 62])} ${P([sx(s, 22.6), 51])} ${P([sx(s, 19), 40])}Z`,
          pirHair.base,
        ),
      ) +
      ring(73.2, 67.5, 3.4, pirGold.base, 1.7) +
      // the tricorn: the crown behind the turned-up brim, gold trim on the brim
      path('M29 22C29 9.5 39 4.5 50 4.5S71 9.5 71 22Z', pirHat.shade) +
      path('M29 21C29 9.5 38.5 5.5 48.5 5.5S69 9.5 69.5 21Z', pirHat.base) +
      path(tricornBrim, pirHat.shade) +
      path(tricornBrim, pirHat.base, ' transform="translate(-1 -1.2)"') +
      line('M12.6 18.6Q17.6 33 49.2 40.4Q81 33 86.4 18.6', pirGold.base, 1.8),
    front:
      // the patch over her left eye; its strap runs steeply up under the brim, clear of the right brow
      line('M33.6 52L26.8 47.6M46.4 50.8L53.4 40.6', pirPatch.base, 2) +
      ellipse(41, 55, 7.4, 6.4, pirPatch.base, -8) +
      ellipse(38.6, 52.6, 1.9, 1.1, pirPatch.light, -30),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41, y: 55 }, right: { x: 59, y: 55 }, r: 4.1, style: 'dot', covered: 'left' },
    brows: { lift: 1.9, length: 2.3, color: pirHair.shade },
    mouth: { x: 50, y: 69.5, w: 13.5 },
    cheeks: { color: FACE.blush },
    halo: { x: 50, y: 9 },
  },
  pivot: { x: 50, y: 54 },
  headBox: { x: 12, y: 8, size: 76 },
  motionBias: ['tilt', 'shake', 'nod', 'bounce'],
  gimmicks: [
    {
      id: 'feather',
      z: 'behind',
      // a parrot's feathers: a long red one with a blue tip, a short blue one beside it
      markup:
        path('M62 22C66 15 75 11.5 86 12C82 18 73 22 62 22Z', OBJECT.blue.base) +
        line('M63 21.6Q73 15.5 84 12.6', OBJECT.blue.shade, 1) +
        path('M60 22C60 11 68.5 3.5 80 2.5C80 11 72.5 19 60 22Z', OBJECT.red.base) +
        path('M74.5 3.6C76.4 3 78.2 2.7 80 2.5C80 5.6 79.2 8.4 77.8 11Z', OBJECT.blue.base) +
        path('M70.5 5.6L72.4 4.6L75.8 12.6L73.8 14.4Z', OBJECT.gold.base) +
        line('M61 21Q66.5 11.5 78.6 3.8', OBJECT.red.shade, 1.1),
      anim: [
        {
          trigger: ['surprised'],
          durationMs: 1100,
          keyframes: [
            { t: 0, ease: 'emphasized' },
            { t: 0.25, rotate: -16 },
            { t: 0.55, rotate: 6 },
            { t: 0.8, rotate: -2.5 },
            { t: 1 },
          ],
          origin: { x: 61, y: 21.5 },
        },
        { ...R.sway({ angle: 7, ms: 900 }), trigger: ['laugh'], origin: { x: 61, y: 21.5 } },
        { ...R.sway({ angle: 4, ms: 2600 }), trigger: ['idle', 'smile'], origin: { x: 61, y: 21.5 } },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// El Sudoku: a luchador (a masked wrestler). A red mask with white flames around the eyes and a gold sudoku
// grid on the forehead, a red cape with a tall gold collar. The grid glints when he idles, smiles or winks,
// and he steams from both sides when he is angry.

const luchaSkin = SKIN.bronze;
const luchaMask = OBJECT.red;
const luchaGold = OBJECT.gold;
const luchaWhite = OBJECT.white;

/** The white flame around one eye, sweeping up and out to the temple. */
const flame = (s: Side) => {
  const q = (dx: number, y: number) => P([sx(s, dx), y]);
  return (
    `M${q(2.5, 55)}C${q(2.5, 60)} ${q(6.5, 61.5)} ${q(10, 61)}C${q(14.5, 60.2)} ${q(16.5, 56)} ${q(17.5, 51)}` +
    `C${q(18.5, 46.5)} ${q(21, 43)} ${q(24, 40.5)}C${q(19, 41)} ${q(13.5, 43)} ${q(9.5, 45.5)}` +
    `C${q(5.5, 47.5)} ${q(2.5, 50.5)} ${q(2.5, 55)}Z`
  );
};
const luchaMouth = 'M38.5 65C42 62 46 61 50 61S58 62 61.5 65C63 71.5 58 78 50 78S37 71.5 38.5 65Z';

const luchador: AvatarDef = {
  id: 'luchador',
  kind: 'person',
  name: { he: 'אל סודוקו', en: 'El Sudoku' },
  tile: TILE.cobalt,
  layers: {
    back:
      // the cape's tall gold collar behind the head, the cape, his chest in its V
      mirrored((s) =>
        path(
          `M${P([sx(s, 12), 86])}C${P([sx(s, 27), 80])} ${P([sx(s, 36), 66])} ${P([sx(s, 39), 44])}C${P([sx(s, 32), 54])} ${P([sx(s, 22), 62])} ${P([sx(s, 6), 67])}Z`,
          luchaGold.base,
        ),
      ) +
      mirrored((s) =>
        path(
          `M${P([sx(s, 12), 86])}C${P([sx(s, 23), 81])} ${P([sx(s, 30), 72])} ${P([sx(s, 33), 59])}C${P([sx(s, 27), 65])} ${P([sx(s, 18), 70])} ${P([sx(s, 8), 72])}Z`,
          luchaGold.shade,
        ),
      ) +
      path(bust(84, 48), luchaSkin.base) +
      path(collarShadow(84, 13), luchaSkin.shade) +
      path('M2 150V116C2 96 16 87 36 85L50 104L64 85C84 87 98 96 98 116V150Z', luchaMask.base) +
      path('M64 85C84 87 98 96 98 116V150H88V118C88 104 80 93 64 89Z', luchaMask.shade) +
      neck(62, 84, 11, luchaSkin) +
      // the mask: the head, the nose, the mouth opening with its white trim, the flames, the forehead grid
      ellipse(50, 47.5, 26, 30.5, luchaMask.shade) +
      ellipse(48.8, 46.3, 25.2, 29.8, luchaMask.base) +
      ellipse(50, 58.5, 3, 2.3, luchaMask.shade) +
      path(luchaMouth, luchaWhite.base, ' transform="translate(50 70) scale(1.17) translate(-50 -70)"') +
      path(luchaMouth, luchaSkin.base) +
      mirrored((s) =>
        path(
          flame(s),
          luchaGold.base,
          ` transform="translate(${sx(s, 9)} 53) scale(1.14) translate(${-sx(s, 9)} -53)"`,
        ),
      ) +
      mirrored((s) => path(flame(s), luchaWhite.base)) +
      // the sudoku grid on the forehead
      rect(44.8, 21.8, 12, 12, luchaGold.shade, 2.6) +
      rect(44.2, 21.2, 11.6, 11.6, luchaGold.base, 2.6) +
      line('M48.07 21.8V32.2M51.93 21.8V32.2M44.8 25.07H55.2M44.8 28.93H55.2', luchaMask.shade, 0.9),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41, y: 53 }, right: { x: 59, y: 53 }, r: 4, style: 'dot' },
    brows: { lift: 2.1, length: 2.3, thickness: 2.2, color: shade(luchaMask.shade, -0.55) },
    mouth: { x: 50, y: 68.5, w: 13, ink: mix(FACE.tongue, luchaSkin.base, 0.2) },
    halo: { x: 50, y: 9 },
  },
  pivot: { x: 50, y: 50 },
  headBox: { x: 13, y: 12, size: 74 },
  motionBias: ['bounce', 'shake', 'flip', 'nod'],
  gimmicks: [
    {
      id: 'shine',
      rest: 'hidden',
      markup: sparkle(45.6, 22.6, 3.6, FACE.sparkle),
      anim: [
        { ...R.sparks(), trigger: ['smile', 'wink'], origin: { x: 45.6, y: 22.6 } },
        { ...R.sparks({ ms: 2600 }), trigger: ['idle'], origin: { x: 45.6, y: 22.6 } },
      ],
    },
    // two puffs of steam from each side of his head, staggered
    ...([-1, 1] as const).flatMap((s, side) =>
      [0, 1].map((i): GimmickDef => ({
        id: `steam-${side}-${i}`,
        rest: 'hidden',
        markup: puffAt(sx(s, 25), 32, 1.15, luchaWhite.base),
        anim: {
          ...R.steam({ rise: 14, ms: 1500 }),
          delayMs: i * 750 + side * 300,
          trigger: ['angry'],
          origin: { x: sx(s, 25), y: 32 },
        },
      })),
    ),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Professor Gedalya: a mad scientist. Wild white hair, bushy white brows, brass goggles pushed up on his
// forehead, a lab coat and a purple bow tie. Sparks crackle around his hair when he is surprised, angry or
// dizzy (and now and then when he idles).

const profSkin = SKIN.tan;
const profHair = FUR.white;
const profCoat = CLOTH.white;
const profLens = mix(OBJECT.green.light, OBJECT.blue.light, 0.45);
const profBrass = OBJECT.gold;

/** The wild hair on one side: tufts that stick out over the ear. */
const tufts = (s: Side) => {
  const q = (dx: number, y: number) => P([sx(s, dx), y]);
  return (
    `M${q(16, 30)}Q${q(28, 19)} ${q(34, 22)}Q${q(29, 26)} ${q(26, 31)}Q${q(37, 30)} ${q(42, 35)}` +
    `Q${q(33, 38)} ${q(31, 41)}Q${q(40, 45)} ${q(43, 52)}Q${q(34, 51)} ${q(31, 52)}Q${q(37, 58)} ${q(37, 65)}` +
    `Q${q(30, 61)} ${q(25, 58)}Q${q(23, 50)} ${q(22, 44)}Q${q(19, 36)} ${q(16, 30)}Z`
  );
};

/** A small lightning bolt around `x`, `y`. */
const bolt = (x: number, y: number, s: number, fill: string) =>
  path(
    `M${f(x + 0.6 * s)} ${f(y - 1.6 * s)}L${f(x - 0.75 * s)} ${f(y + 0.2 * s)}H${f(x + 0.05 * s)}` +
      `L${f(x - 0.6 * s)} ${f(y + 1.6 * s)}L${f(x + 0.85 * s)} ${f(y - 0.3 * s)}H${f(x)}Z`,
    fill,
  );

/** A spark: a gold bolt on the tile beside the hair (gold doesn't read on white hair). */
const sparkAt = (i: number, x: number, y: number, tilt: number): GimmickDef => ({
  id: `spark-${i}`,
  rest: 'hidden',
  markup: `<g transform="rotate(${f(tilt)} ${f(x)} ${f(y)})">${bolt(x, y, 4.2, OBJECT.gold.base)}</g>`,
  anim: [
    { ...R.sparks(), delayMs: i * 280, trigger: ['surprised', 'angry', 'dizzy'], origin: { x, y } },
    { ...R.sparks({ ms: 2900 }), delayMs: i * 950, trigger: ['idle'], origin: { x, y } },
  ],
});

const professor: AvatarDef = {
  id: 'professor',
  kind: 'person',
  name: { he: 'פרופסור גדליה', en: 'Professor Gedalya' },
  tile: TILE.berry,
  layers: {
    back:
      // lab coat with lapels over a blue shirt, a purple bow tie
      path(bust(82, 47), profCoat.base) +
      path('M37 83C41 82 45.5 81.5 50 81.5S59 82 63 83L50 102Z', OBJECT.blue.light) +
      mirrored((s) =>
        path(
          `M${P([sx(s, 13), 83])}L${P([sx(s, 2), 102])}L${P([sx(s, 9), 98])}L${P([sx(s, 19), 93])}L${P([sx(s, 14), 88])}Z`,
          profCoat.shade,
        ),
      ) +
      neck(64, 80, 8.5, profSkin) +
      path('M50 84.5L43 81V89ZM50 84.5L57 81V89Z', OBJECT.purple.base) +
      circle(50, 84.5, 2, OBJECT.purple.shade) +
      // the hair: tufts on both sides, wisps on the crown; then ears, the head and a big nose
      mirrored((s) => path(tufts(s), profHair.shade)) +
      mirrored((s) => path(tufts(s), profHair.base, ' transform="translate(-0.9 -1)"')) +
      path(
        'M42 30Q37 18 39 12Q42 20 46 27ZM48 28Q49 15 54 9Q52 18 53 28ZM56 29Q60 19 66 16Q62 23 60 31Z',
        profHair.base,
      ) +
      ears(56, 23.5, 6.3, profSkin) +
      ellipse(50, 52, 23, 25, profSkin.base) +
      ellipse(42, 31.5, 5, 2.2, profSkin.light, -18) +
      ellipse(50, 62.2, 3.3, 2.6, profSkin.shade) +
      // the lines of age from the nose to the corners of the mouth
      line('M44.6 63.4Q41.6 65.4 41.8 69.6M55.4 63.4Q58.4 65.4 58.2 69.6', profSkin.shade, 1.2),
    front:
      // goggles pushed up on the forehead: the strap, brass rims, tinted lenses with a glint
      path('M26.5 35Q50 29.5 73.5 35V39.5Q50 34 26.5 39.5Z', CLOTH.charcoal.base) +
      rect(47, 32.5, 6, 3.6, profBrass.shade, 1.4) +
      mirrored(
        (s) =>
          circle(sx(s, 9.5) + 0.6, 34.6, 7.2, profBrass.shade) +
          circle(sx(s, 9.5), 34, 7, profBrass.base) +
          circle(sx(s, 9.5), 34, 5.2, profLens) +
          glint([sx(s, 9.5), 34, 5.2], OBJECT.white.light, 1.3),
      ),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41, y: 55 }, right: { x: 59, y: 55 }, r: 3.9, style: 'dot' },
    brows: { lift: 2, length: 2.6, thickness: 2.6, color: profHair.shade },
    mouth: { x: 50, y: 69.5, w: 13 },
    cheeks: { color: FACE.blush },
    halo: { x: 50, y: 14 },
  },
  pivot: { x: 50, y: 53 },
  headBox: { x: 12, y: 10, size: 76 },
  motionBias: ['shake', 'tilt', 'spin', 'nod'],
  gimmicks: [sparkAt(0, 20, 16, -20), sparkAt(1, 84, 24, 18), sparkAt(2, 66, 8, 10)],
};

// ---------------------------------------------------------------------------------------------------------
// Mika: a punk. A tall pink mohawk over a shaved scalp, rings up her ear and one in her nose, a studded
// choker, a black leather jacket with studs over a red tee. Her mohawk springs up when she is surprised,
// bristles when she is angry and sways when she laughs or headbangs (nod, bounce).

const punkSkin = SKIN.porcelain;
const punkHair = HAIR.pink;
const punkJacket = HAIR.black;
const punkSilver = OBJECT.steel;

/** One spike of the mohawk: from its root on the scalp (`bx` ± `half`, y 34) to its tip. */
const spike = (tx: number, ty: number, bx: number, half: number, fill: string) =>
  path(
    `M${f(bx - half)} 34Q${f((bx - half + tx) / 2 - 1)} ${f((34 + ty) / 2)} ${f(tx)} ${f(ty)}` +
      `Q${f((bx + half + tx) / 2 + 1)} ${f((34 + ty) / 2)} ${f(bx + half)} 34Z`,
    fill,
  );

const punk: AvatarDef = {
  id: 'punk',
  kind: 'person',
  name: { he: 'מיקה', en: 'Mika' },
  tile: TILE.leaf,
  layers: {
    back:
      // the jacket: lapels, studs along the shoulder seams, the red tee
      path(bust(84, 46), punkJacket.base) +
      path('M38 85C42 84 46 83.5 50 83.5S58 84 62 85L58 102H42Z', OBJECT.red.base) +
      mirrored((s) =>
        path(
          `M${P([sx(s, 12), 85])}L${P([sx(s, 5), 102])}L${P([sx(s, 13), 96])}L${P([sx(s, 19), 89])}Z`,
          punkJacket.light,
        ),
      ) +
      mirrored((s) =>
        (
          [
            [32.5, 96.5],
            [26.5, 93],
            [20.5, 90.5],
          ] as const
        )
          .map(([dx, y]) =>
            path(
              `M${P([sx(s, dx), y - 2.2])}L${P([sx(s, dx + 1.8), y + 1.2])}L${P([sx(s, dx - 1.8), y + 1.2])}Z`,
              punkSilver.light,
            ),
          )
          .join(''),
      ) +
      neck(66, 82, 7.5, punkSkin) +
      // a studded choker under the chin
      rect(42.5, 78.4, 15, 3.6, punkJacket.base, 1.2) +
      [45.5, 50, 54.5].map((x) => circle(x, 80.2, 0.95, punkSilver.light)).join('') +
      // ears with rings, the head, the shaved scalp, the nose
      ears(57, 23, 5.6, punkSkin) +
      ring(77.9, 52.8, 1.5, punkSilver.light, 1) +
      ring(78.8, 56.6, 1.5, punkSilver.light, 1) +
      ring(78.2, 60.6, 1.5, punkSilver.light, 1) +
      circle(25.6, 61.3, 1.3, punkSilver.light) +
      ellipse(50, 53.5, 22.5, 24.5, punkSkin.base) +
      path(
        'M28 48C26 36 35 29 50 29S74 36 72 48C68 42 61 39 50 39S32 42 28 48Z',
        mix(punkSkin.shade, HAIR.espresso.base, 0.3),
      ) +
      ellipse(50, 62.4, 2.4, 1.9, punkSkin.shade),
    front: ring(52.4, 64, 1.3, punkSilver.light, 0.9),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 55.5 }, right: { x: 58.5, y: 55.5 }, r: 3.9, style: 'dot' },
    brows: { lift: 1.9, length: 2.3, color: HAIR.espresso.base },
    mouth: { x: 50, y: 69.5, w: 13 },
    cheeks: { color: FACE.blush },
    halo: { x: 50, y: 22 },
  },
  pivot: { x: 50, y: 54 },
  headBox: { x: 15, y: 8, size: 72 },
  motionBias: ['nod', 'bounce', 'shake', 'flip'],
  gimmicks: [
    {
      id: 'mohawk',
      z: 'back',
      markup:
        spike(29, 15, 42, 5.5, punkHair.shade) +
        spike(71, 15, 58, 5.5, punkHair.shade) +
        spike(36.5, 7, 45, 5.5, punkHair.base) +
        spike(63.5, 7, 55, 5.5, punkHair.base) +
        spike(50, 2.5, 50, 7, punkHair.base) +
        path(
          'M38.5 36C40 30.5 44.5 28.5 50 28.5S60 30.5 61.5 36C58 33.5 54 33 50 33S42 33.5 38.5 36Z',
          punkHair.base,
        ) +
        line('M47.4 30Q46.8 17 48.8 8', punkHair.light, 1.5),
      anim: [
        {
          trigger: ['surprised'],
          durationMs: 1100,
          keyframes: [
            { t: 0, ease: 'emphasized' },
            { t: 0.3, sx: 0.96, sy: 1.16 },
            { t: 0.7, sx: 0.96, sy: 1.16, ease: 'standard' },
            { t: 1 },
          ],
          origin: { x: 50, y: 34 },
        },
        {
          trigger: ['angry'],
          durationMs: 320,
          loop: true,
          keyframes: [
            { t: 0 },
            { t: 0.25, rotate: 3, sy: 1.05 },
            { t: 0.75, rotate: -3, sy: 1.05 },
            { t: 1 },
          ],
          origin: { x: 50, y: 34 },
        },
        { ...R.sway({ angle: 6, ms: 700 }), trigger: ['laugh', 'nod', 'bounce'], origin: { x: 50, y: 34 } },
        { ...R.sway({ angle: 2.5, ms: 2600 }), trigger: ['idle'], origin: { x: 50, y: 34 } },
      ],
    },
  ],
};

export const PEOPLE2: readonly AvatarDef[] = [chef, astronaut, pirate, luchador, professor, punk];
