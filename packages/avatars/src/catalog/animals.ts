/**
 * Animals: head and shoulders like people, or the whole animal when it is small and round. Read
 * docs/avatars/STYLE.md first, and look at catalog/people.ts (`noam`) and catalog/objects.ts (`eight`).
 *
 * Each animal has one thing that makes it itself at 24 px: the fox's white cheeks and dark ear tips, the cat's
 * collar and bell, the panda's patches, the frog's eye bumps and crown, the rabbit's long (one floppy) ears, the
 * owl's tufts, face discs and beak. The rig draws every face; a muzzle, a beak or a face disc is only the calm
 * surface the mouth and eyes sit on.
 */

import { FACE, FUR, OBJECT, shade, TILE } from '../palette';
import { f } from '../svg';
import type { AvatarDef } from '../types';

// ---------------------------------------------------------------------------------------------------------
// Drawing helpers. Most animals are symmetric: a part is drawn once as a function of the side (−1 = the
// viewer's left, +1 = right) and placed with `mirrored`.

type Pt = readonly [x: number, y: number];
type Side = -1 | 1;

const P = ([x, y]: Pt) => `${f(x)} ${f(y)}`;
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
/** x of a point `dx` from the middle line, on side `s`. */
const sx = (s: Side, dx: number) => 50 + s * dx;
const mirrored = (draw: (s: Side) => string) => draw(-1) + draw(1);

const circle = (x: number, y: number, r: number, fill: string) =>
  `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${fill}"/>`;
const ellipse = (x: number, y: number, rx: number, ry: number, fill: string, rotate = 0) =>
  `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}"` +
  (rotate ? ` transform="rotate(${f(rotate)} ${f(x)} ${f(y)})"` : '') +
  ` fill="${fill}"/>`;
const path = (d: string, fill: string) => `<path d="${d}" fill="${fill}"/>`;
const stroke = (d: string, color: string, width: number) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f(width)}" stroke-linecap="round"/>`;

/** A pointed ear: a triangle from its base corners to a rounded tip. `round` = how much of each side the tip eats. */
function pointedEar(tip: Pt, outer: Pt, inner: Pt, round: number): string {
  return `M${P(outer)}L${P(lerp(tip, outer, round))}Q${P(tip)} ${P(lerp(tip, inner, round))}L${P(inner)}Z`;
}

// ---------------------------------------------------------------------------------------------------------
// Fox: orange with a white lower face, dark ear tips and big cheek ruffs.

const foxFur = FUR.fox;
const foxWhite = FUR.white;
const foxDark = FUR.chocolate;

function foxEar(s: Side): string {
  const tip: Pt = [sx(s, 30), 6];
  const outer: Pt = [sx(s, 25.5), 46];
  const inner: Pt = [sx(s, 4), 27];
  const mid = lerp(outer, inner, 0.5);
  return (
    path(pointedEar(tip, outer, inner, 0.16), foxDark.base) +
    path(`M${P(outer)}L${P(lerp(tip, outer, 0.42))}L${P(lerp(tip, inner, 0.42))}L${P(inner)}Z`, foxFur.base) +
    path(
      `M${P(lerp(outer, inner, 0.22))}L${P(lerp(tip, mid, 0.5))}L${P(lerp(outer, inner, 0.88))}Z`,
      foxWhite.shade,
    )
  );
}

const foxHead =
  'M50 23C64 23 74 30 77 42Q80 54 87 63C78 67 68 79 50 80C32 79 22 67 13 63Q20 54 23 42C26 30 36 23 50 23Z';
const foxMask =
  'M13 63C22 57 32 59 38.5 61.5Q45 63.5 50 56Q55 63.5 61.5 61.5C68 59 78 57 87 63C78 67 68 79 50 80C32 79 22 67 13 63Z';

const fox: AvatarDef = {
  id: 'fox',
  kind: 'animal',
  name: { he: 'שועל', en: 'Fox' },
  tile: TILE.sky,
  layers: {
    back:
      mirrored(foxEar) +
      // body and a white bib; the body runs on to y 150
      path('M4 150V108C4 89 25 79 50 79S96 89 96 108V150Z', foxFur.base) +
      path('M29 79Q50 93 71 79Z', foxFur.shade) +
      path('M33 80Q50 86 67 80Q64 99 50 113Q36 99 33 80Z', foxWhite.base) +
      path('M33.5 80Q50 91 66.5 80Z', foxWhite.shade) +
      // head, then the white lower face
      path(foxHead, foxFur.base) +
      path(foxMask, foxWhite.base) +
      // nose
      ellipse(50, 59.5, 3.7, 2.7, FUR.black.base) +
      ellipse(48.8, 58.6, 1.2, 0.7, FUR.black.light),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 39.5, y: 50 }, right: { x: 60.5, y: 50 }, r: 5.2, style: 'oval' },
    brows: { lift: 1.8, length: 2, color: foxDark.base },
    mouth: { x: 50, y: 66.5, w: 14 },
    cheeks: { color: FACE.blush },
    halo: { x: 50, y: 10 },
  },
  pivot: { x: 50, y: 54 },
  headBox: { x: 13, y: 8, size: 74 },
  motionBias: ['tilt', 'flip', 'nod', 'bounce'],
};

// ---------------------------------------------------------------------------------------------------------
// Cat: a grey tabby with a red collar and a gold bell.

const catFur = FUR.grey;
const catStripe = shade(catFur.base, -0.3);
const catMuzzle = FUR.white;
const catPink = FUR.pink;

function catEar(s: Side): string {
  const tip: Pt = [sx(s, 23), 13];
  const outer: Pt = [sx(s, 27), 47];
  const inner: Pt = [sx(s, 7), 34];
  return (
    path(pointedEar(tip, outer, inner, 0.22), catFur.base) +
    path(
      pointedEar(
        lerp(tip, lerp(outer, inner, 0.5), 0.22),
        lerp(outer, inner, 0.15),
        lerp(outer, inner, 0.85),
        0.25,
      ),
      catPink.base,
    )
  );
}

const catStripes =
  // forehead: the tabby "M"
  path('M48.4 32.5Q50 31.5 51.6 32.5L50.8 41Q50 42 49.2 41Z', catStripe) +
  path('M42.2 34Q43.8 33 45 34.2L44.6 39.5Q43.6 40.5 42.8 39.5Z', catStripe) +
  path('M57.8 34Q56.2 33 55 34.2L55.4 39.5Q56.4 40.5 57.2 39.5Z', catStripe) +
  // cheeks
  mirrored((s) =>
    path(
      `M${f(sx(s, 27))} 56Q${f(sx(s, 23))} 57 ${f(sx(s, 21))} 58.5Q${f(sx(s, 23))} 59.6 ${f(sx(s, 27))} 58.6Z`,
      catStripe,
    ),
  ) +
  mirrored((s) =>
    path(
      `M${f(sx(s, 27.5))} 62Q${f(sx(s, 24))} 63.4 ${f(sx(s, 22))} 65Q${f(sx(s, 24.5))} 65.8 ${f(sx(s, 27.5))} 64.4Z`,
      catStripe,
    ),
  );

const cat: AvatarDef = {
  id: 'cat',
  kind: 'animal',
  name: { he: 'חתול', en: 'Cat' },
  tile: TILE.mustard,
  layers: {
    back:
      mirrored(catEar) +
      // body, collar and bell
      path('M6 150V110C6 90 26 80 50 80S94 90 94 110V150Z', catFur.base) +
      path('M29 77Q50 90 71 77L72 83Q50 96 28 83Z', OBJECT.red.base) +
      circle(50, 90, 4.8, OBJECT.gold.shade) +
      circle(49.5, 89.4, 4.3, OBJECT.gold.base) +
      stroke('M47.6 91.6H52.4', OBJECT.gold.shade, 1.1) +
      // head: the shade shows as a crescent on the lower right
      ellipse(50, 55, 27, 23.5, catFur.shade) +
      ellipse(49, 54.2, 26, 22.7, catFur.base) +
      catStripes +
      // whiskers, muzzle and nose
      mirrored(
        (s) =>
          stroke(`M${f(sx(s, 10))} 65.5L${f(sx(s, 27))} 62.5`, catMuzzle.base, 1.1) +
          stroke(`M${f(sx(s, 10))} 68L${f(sx(s, 27))} 69.5`, catMuzzle.base, 1.1),
      ) +
      circle(45.3, 66.3, 6.2, catMuzzle.base) +
      circle(54.7, 66.3, 6.2, catMuzzle.base) +
      path('M46.6 60.4Q50 59.2 53.4 60.4Q51.9 63.6 50 63.8Q48.1 63.6 46.6 60.4Z', catPink.shade),
  },
  face: {
    ink: FACE.ink,
    eyes: {
      left: { x: 40, y: 54 },
      right: { x: 60, y: 54 },
      r: 5.4,
      style: 'oval',
      white: shade(FUR.green.light, 0.45),
    },
    brows: { lift: 1.75, length: 2, color: catStripe },
    mouth: { x: 50, y: 67.5, w: 12 },
    cheeks: { color: FACE.blush },
    halo: { x: 50, y: 11 },
  },
  pivot: { x: 50, y: 55 },
  headBox: { x: 15, y: 12, size: 70 },
  motionBias: ['tilt', 'flip', 'nod', 'shake'],
};

// ---------------------------------------------------------------------------------------------------------
// Panda: black ears, eye patches and shoulders on a white head. The eyes are white on the patches (`eyes.ink`),
// so closed and spiral eyes read too.

const pandaWhite = FUR.white;
const pandaBlack = FUR.black;

const panda: AvatarDef = {
  id: 'panda',
  kind: 'animal',
  name: { he: 'פנדה', en: 'Panda' },
  tile: TILE.leaf,
  layers: {
    back:
      // ears
      mirrored(
        (s) => circle(sx(s, 25), 31, 9.5, pandaBlack.base) + circle(sx(s, 24.4), 31.8, 5, pandaBlack.light),
      ) +
      // body: a white chest between black arms
      path('M4 150V112C4 92 26 81 50 81S96 92 96 112V150Z', pandaWhite.base) +
      path('M33 80Q50 91 67 80Z', pandaWhite.shade) +
      mirrored((s) =>
        path(
          `M${f(sx(s, 46))} 150V112C${f(sx(s, 46))} 97 ${f(sx(s, 37))} 88 ${f(sx(s, 23))} 84C${f(sx(s, 18))} 96 ${f(sx(s, 17))} 124 ${f(sx(s, 19))} 150Z`,
          pandaBlack.base,
        ),
      ) +
      // head (the shade shows as a crescent on the lower right) and patches
      ellipse(50, 53, 28, 24.5, pandaWhite.shade) +
      ellipse(49, 52.2, 27, 23.7, pandaWhite.base) +
      mirrored((s) => ellipse(sx(s, 11.5), 54.5, 7.8, 10, pandaBlack.base, s * -30)) +
      // nose
      path('M46 61.4Q50 59.8 54 61.4Q52.6 64.8 50 65Q47.4 64.8 46 61.4Z', pandaBlack.base),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 39.5, y: 52.5 }, right: { x: 60.5, y: 52.5 }, r: 4, style: 'dot', ink: FACE.white },
    brows: { lift: 2.3, length: 2, color: pandaBlack.base },
    mouth: { x: 50, y: 68.5, w: 13 },
    cheeks: { color: FACE.blush, dx: 2.3, dy: 2.2 },
    halo: { x: 50, y: 11 },
  },
  pivot: { x: 50, y: 54 },
  headBox: { x: 14, y: 17, size: 72 },
  motionBias: ['nod', 'bounce', 'wobble', 'tilt'],
};

// ---------------------------------------------------------------------------------------------------------
// Frog: the whole frog, round and soft (it squashes). Eyes on bumps, a wide mouth, and a little gold crown.

const frogSkin = FUR.green;
const frogBelly = FUR.green.light;
const crown = OBJECT.gold;

const frog: AvatarDef = {
  id: 'frog',
  kind: 'animal',
  name: { he: 'צפרדע', en: 'Frog' },
  tile: TILE.rose,
  layers: {
    back:
      // feet
      ellipse(37, 90.5, 9, 4.4, frogSkin.shade) +
      ellipse(63, 90.5, 9, 4.4, frogSkin.shade) +
      // crown, peeking up between the eye bumps
      path('M41 41L39.5 26L45.5 32L50 23L54.5 32L60.5 26L59 41Z', crown.base) +
      path('M41 41L40.6 36.5H59.4L59 41Z', crown.shade) +
      circle(50, 33.5, 1.8, OBJECT.red.base) +
      // body and eye bumps: shades first, then the lit surfaces shifted up and left
      ellipse(50, 66, 32, 24, frogSkin.shade) +
      circle(35, 44, 12, frogSkin.shade) +
      circle(65, 44, 12, frogSkin.shade) +
      ellipse(48.8, 64.6, 30.6, 22.6, frogSkin.base) +
      circle(34, 43, 11, frogSkin.base) +
      circle(64, 43, 11, frogSkin.base) +
      // belly and nostrils
      ellipse(49, 82, 17, 8, frogBelly) +
      circle(46.6, 55.5, 1.1, frogSkin.shade) +
      circle(53.4, 55.5, 1.1, frogSkin.shade) +
      // shine
      ellipse(26.5, 37.5, 2.2, 3.6, frogSkin.light, -35) +
      ellipse(24, 66, 2.4, 5, frogSkin.light, -12),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 34.5, y: 43.5 }, right: { x: 64.5, y: 43.5 }, r: 6.2, style: 'round' },
    brows: { lift: 1.55, length: 1.8, thickness: 2.1 },
    mouth: { x: 50, y: 64, w: 22 },
    // no cheeks: blush on green turns brown
    halo: { x: 50, y: 13 },
  },
  pivot: { x: 50, y: 62 },
  // the whole frog, a little closer: crown to belly, the feet cut
  headBox: { x: 13, y: 19, size: 74 },
  base: 94,
  squash: true,
  motionBias: ['squash', 'bounce', 'wobble', 'spin'],
};

// ---------------------------------------------------------------------------------------------------------
// Rabbit: white, with long ears (the right one flops over) and a bow tie.

const rabbitFur = FUR.white;
const rabbitPink = FUR.pink;

const rabbit: AvatarDef = {
  id: 'rabbit',
  kind: 'animal',
  name: { he: 'ארנב', en: 'Rabbit' },
  tile: TILE.violet,
  layers: {
    back:
      // the upright ear, leaning out
      ellipse(34.5, 23, 7.6, 20, rabbitFur.base, -12) +
      ellipse(34.9, 25, 3.8, 14.5, rabbitPink.base, -12) +
      // the floppy ear: up, then over to the right
      path(
        'M57.5 44C56 32 58 20 66 15C74 10 85 14 87.5 24C89 30 85 34 81.5 30C79 26 75 23 71 25C67.5 27 67 35 68 44Z',
        rabbitFur.base,
      ) +
      path('M61 40C60 32 61 24 65.5 20C67 22 65 30 65 40Z', rabbitPink.base) +
      path('M71 25C75 23 79 26 81.5 30C83 32 85.5 31 86.5 28C84 22 77 19 71 25Z', rabbitFur.shade) +
      // body and bow tie
      path('M6 150V110C6 90 26 80 50 80S94 90 94 110V150Z', rabbitFur.base) +
      path('M34 81Q50 90 66 81Z', rabbitFur.shade) +
      path('M50 86L39 80.5Q37 86 39 91.5Z', OBJECT.blue.base) +
      path('M50 86L61 80.5Q63 86 61 91.5Z', OBJECT.blue.base) +
      circle(50, 86, 3, OBJECT.blue.shade) +
      // head: the shade shows as a crescent on the lower right
      ellipse(50, 58, 25, 22.5, rabbitFur.shade) +
      ellipse(49, 57.2, 24, 21.7, rabbitFur.base) +
      // nose
      path('M47.3 63.4Q50 62.2 52.7 63.4Q51.5 66 50 66.2Q48.5 66 47.3 63.4Z', rabbitPink.shade),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41, y: 56.5 }, right: { x: 59, y: 56.5 }, r: 4.6, style: 'oval' },
    brows: { lift: 1.9, length: 2, color: FUR.charcoal.light },
    mouth: { x: 50, y: 70.5, w: 12.5 },
    cheeks: { color: FACE.blush },
    halo: { x: 52.5, y: 7 },
  },
  pivot: { x: 50, y: 58 },
  headBox: { x: 15, y: 16, size: 70 },
  motionBias: ['bounce', 'nod', 'flip', 'tilt'],
};

// ---------------------------------------------------------------------------------------------------------
// Owl: tawny, with ear tufts, cream face discs, gold eyes and a beak the mouth sits on.

const owlFeather = FUR.tawny;
const owlDisc = FUR.cream;
const owlBeak = OBJECT.orange;

/** Head and body in one: ear tufts leaning out, and a top edge that dips in the middle. */
const owlBody =
  'M19 150V66C19 50 20 38 23 30L17.5 12.5Q16.5 9 19.5 10.5L33.5 23.5Q50 30 66.5 23.5L80.5 10.5Q83.5 9 82.5 12.5' +
  'L77 30C80 38 81 50 81 66V150Z';

/** A row of feather scallops on the belly: small crescents, a texture rather than marks. */
const owlMarks = (y: number, xs: readonly number[]) =>
  xs
    .map((x) =>
      path(
        `M${f(x - 2.8)} ${f(y)}Q${f(x)} ${f(y + 4)} ${f(x + 2.8)} ${f(y)}Q${f(x)} ${f(y + 1.8)} ${f(x - 2.8)} ${f(y)}Z`,
        owlDisc.shade,
      ),
    )
    .join('');

const owl: AvatarDef = {
  id: 'owl',
  kind: 'animal',
  name: { he: 'ינשוף', en: 'Owl' },
  tile: TILE.jade,
  layers: {
    back:
      path(owlBody, owlFeather.base) +
      // wings, bulging out from the shoulders
      mirrored((s) =>
        path(
          `M${f(sx(s, 29))} 58C${f(sx(s, 38))} 72 ${f(sx(s, 38))} 100 ${f(sx(s, 32))} 150H${f(sx(s, 17))}C${f(sx(s, 20))} 118 ${f(sx(s, 19))} 88 ${f(sx(s, 19))} 70C${f(sx(s, 21))} 63 ${f(sx(s, 25))} 59 ${f(sx(s, 29))} 58Z`,
          owlFeather.shade,
        ),
      ) +
      // belly with feather scallops
      ellipse(50, 101, 19, 27, owlDisc.base) +
      owlMarks(81, [43, 50, 57]) +
      owlMarks(87, [39.5, 46.5, 53.5, 60.5]) +
      owlMarks(93, [43, 50, 57]) +
      owlMarks(99, [39.5, 46.5, 53.5, 60.5]) +
      // face discs
      mirrored((s) => ellipse(sx(s, 11), 49, 12, 13.5, owlDisc.base)) +
      // beak
      path(
        'M50 52.5C53 54.5 56.5 57.5 56.5 61.5C56.5 66 53.8 69.5 50 69.5C46.2 69.5 43.5 66 43.5 61.5C43.5 57.5 47 54.5 50 52.5Z',
        owlBeak.base,
      ),
  },
  face: {
    ink: FACE.ink,
    eyes: {
      left: { x: 39.5, y: 49.5 },
      right: { x: 60.5, y: 49.5 },
      r: 5.6,
      style: 'round',
      white: OBJECT.gold.base,
    },
    brows: { lift: 1.75, length: 2.1, color: FUR.brown.shade },
    mouth: { x: 50, y: 62, w: 12 },
    cheeks: { color: FACE.blush, dx: 0.4, dy: 1.6, size: 0.8 },
    halo: { x: 50, y: 7 },
  },
  pivot: { x: 50, y: 52 },
  headBox: { x: 16, y: 8, size: 68 },
  motionBias: ['tilt', 'spin', 'nod', 'flip'],
};

export const ANIMALS: readonly AvatarDef[] = [fox, cat, panda, frog, rabbit, owl];
