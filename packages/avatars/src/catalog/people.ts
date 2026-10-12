/**
 * People: head and shoulders, the shoulders running out of the bottom of the tile. Read docs/avatars/STYLE.md
 * first; `noam` is the style example (proportions, depth shapes, layers, anchors).
 */

import { CLOTH, FACE, HAIR, mix, OBJECT, shade, SKIN, TILE } from '../palette';
import { f } from '../svg';
import type { AvatarDef } from '../types';

type Circle = readonly [x: number, y: number, r: number];

/** Curls: one circle each, in the order given (later ones overlap earlier ones). */
const curls = (list: readonly Circle[], fill: string) =>
  list.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`).join('');

/** A short highlight arc on the upper left of a round shape (a curl, a bun, a cheek). */
const glint = ([x, y, r]: Circle, color: string, width = 1.4) => {
  const k = r * 0.58;
  const a = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return `${(x + k * Math.cos(rad)).toFixed(2)} ${(y + k * Math.sin(rad)).toFixed(2)}`;
  };
  return `<path d="M${a(196)}A${k} ${k} 0 0 1 ${a(256)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
};

// ---------------------------------------------------------------------------------------------------------
// Noam: the style example for people. Curly hair, a mustard sweater, warm skin.

const noamSkin = SKIN.tan;
const noamHair = HAIR.black;
const noamTop = CLOTH.mustard;
const noamFringe: readonly Circle[] = [
  [29, 36.5, 6.5],
  [36, 29, 7.5],
  [45.5, 25.5, 8],
  [55, 25.5, 8],
  [64, 29, 7.5],
  [71, 36.5, 6.5],
];

const noam: AvatarDef = {
  id: 'noam',
  kind: 'person',
  name: { he: 'נועם', en: 'Noam' },
  tile: TILE.teal,
  layers: {
    back:
      // hair behind the head
      curls(
        [
          [25.5, 43, 8.5],
          [26.5, 31, 10],
          [35, 19.5, 11],
          [50, 15, 12],
          [65, 19.5, 11],
          [73.5, 31, 10],
          [74.5, 43, 8.5],
        ],
        noamHair.base,
      ) +
      // sweater: the body runs on to y 150, far below the tile, so a spin never shows where it ends
      `<path d="M3 150V112C3 90 21 80 50 80S97 90 97 112V150Z" fill="${noamTop.base}"/>` +
      `<path d="M30 83.5C36 81 42 80 50 80S64 81 70 83.5C64 92.5 36 92.5 30 83.5Z" fill="${noamTop.shade}"/>` +
      // neck, and the shadow the chin casts on it
      `<path d="M41 64V80a9 7 0 0 0 18 0V64Z" fill="${noamSkin.base}"/>` +
      `<path d="M41 69Q50 78 59 69V64H41Z" fill="${noamSkin.shade}"/>` +
      // ears
      `<circle cx="26" cy="52" r="5.8" fill="${noamSkin.base}"/>` +
      `<circle cx="74" cy="52" r="5.8" fill="${noamSkin.base}"/>` +
      `<circle cx="26.9" cy="52.4" r="2.8" fill="${noamSkin.shade}"/>` +
      `<circle cx="73.1" cy="52.4" r="2.8" fill="${noamSkin.shade}"/>` +
      // head
      `<ellipse cx="50" cy="49" rx="24" ry="25.5" fill="${noamSkin.base}"/>` +
      // nose
      `<ellipse cx="50" cy="59.5" rx="2.6" ry="2" fill="${noamSkin.shade}"/>`,
    front:
      // the fringe sits over the forehead, so raised brows tuck under it
      curls(noamFringe, noamHair.base) + noamFringe.map((c) => glint(c, noamHair.light)).join(''),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41, y: 52 }, right: { x: 59, y: 52 }, r: 4, style: 'dot' },
    brows: { lift: 1.9, length: 2.3, color: noamHair.base },
    mouth: { x: 50, y: 66.5, w: 14 },
    cheeks: { color: FACE.blush },
    halo: { x: 50, y: 8 },
  },
  pivot: { x: 50, y: 54 },
  headBox: { x: 16, y: 8, size: 68 },
  motionBias: ['nod', 'tilt', 'bounce', 'flip'],
};

// ---------------------------------------------------------------------------------------------------------
// Maya: long ginger hair with a side-swept fringe, big blue headphones over it.

const mayaSkin = SKIN.peach;
const mayaHair = HAIR.ginger;
const mayaTop = CLOTH.forest;
const mayaPhones = OBJECT.blue;

/** One headphone cup: the shade, the lit cup shifted up and out, a glint. `out` is −1 (left) or +1 (right). */
const cup = (x: number, out: -1 | 1) =>
  `<rect x="${x - 6.2}" y="43.5" width="12.4" height="20" rx="6.2" fill="${mayaPhones.shade}"/>` +
  `<rect x="${x - 6.2 + (out < 0 ? -1 : 1)}" y="42.5" width="11.6" height="19" rx="5.8" fill="${mayaPhones.base}"/>` +
  `<rect x="${x + (out < 0 ? -4.6 : -2.2)}" y="45.5" width="2.6" height="7" rx="1.3" fill="${mayaPhones.light}"/>`;

const maya: AvatarDef = {
  id: 'maya',
  kind: 'person',
  name: { he: 'מאיה', en: 'Maya' },
  tile: TILE.violet,
  layers: {
    back:
      // top, then the long hair over its shoulders, then the neck and head in front of the hair
      `<path d="M5 150V114C5 93 22 82 50 82S95 93 95 114V150Z" fill="${mayaTop.base}"/>` +
      `<path d="M18 93C15 77 18 60 20 46C20 23 33 12 50 12S80 23 80 46C82 60 85 77 82 93C78 97 68 97 64 93C62 87 60 82 58 78H42C40 82 38 87 36 93C32 97 22 97 18 93Z" fill="${mayaHair.base}"/>` +
      `<path d="M36 93C38 86 40 79 42 72H58C60 79 62 86 64 93C58 89 42 89 36 93Z" fill="${mayaHair.shade}"/>` +
      `<path d="M42.5 64V80a7.5 6 0 0 0 15 0V64Z" fill="${mayaSkin.base}"/>` +
      `<path d="M42.5 69Q50 77 57.5 69V64H42.5Z" fill="${mayaSkin.shade}"/>` +
      `<ellipse cx="50" cy="49" rx="23" ry="25" fill="${mayaSkin.base}"/>` +
      `<ellipse cx="50" cy="59.5" rx="2.3" ry="1.8" fill="${mayaSkin.shade}"/>`,
    front:
      // side-swept fringe
      `<path d="M27 50C24 32 34 19 50 19C64 19 74 27 75 40C71 33 64 30 56 31C46 33 37 39 31 52Z" fill="${mayaHair.base}"/>` +
      glint([40, 24, 9], mayaHair.light, 1.6) +
      // headphones: the band over the hair, a cup over each ear
      `<path d="M18.5 50C18.5 22 32 8.5 50 8.5S81.5 22 81.5 50H77C77 26 65 13 50 13S23 26 23 50Z" fill="${mayaPhones.base}"/>` +
      `<path d="M50 8.5C68 8.5 81.5 22 81.5 50H79C79 25 67 11 50 11Z" fill="${mayaPhones.shade}"/>` +
      cup(22.8, -1) +
      cup(77.2, 1),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 52 }, right: { x: 58.5, y: 52 }, r: 3.8, style: 'dot' },
    brows: { lift: 1.9, length: 2.3, color: mayaHair.shade },
    mouth: { x: 50, y: 66, w: 13 },
    cheeks: { color: FACE.blush },
    halo: { x: 50, y: 5 },
  },
  pivot: { x: 50, y: 52 },
  headBox: { x: 15, y: 6, size: 70 },
  motionBias: ['bounce', 'tilt', 'nod', 'spin'],
};

// ---------------------------------------------------------------------------------------------------------
// Ruthie: a grandmother. Silver hair in a bun, round red glasses, a plum cardigan and pearls.

const ruthSkin = SKIN.porcelain;
const ruthHair = HAIR.silver;
const ruthTop = CLOTH.plum;
const ruthFrames = OBJECT.red.shade;

const ruthie: AvatarDef = {
  id: 'ruthie',
  kind: 'person',
  name: { he: 'סבתא רותי', en: 'Grandma Ruthie' },
  tile: TILE.leaf,
  layers: {
    back:
      // bun, then the hair behind the head
      `<circle cx="50.5" cy="15.5" r="10" fill="${ruthHair.shade}"/>` +
      `<circle cx="49.5" cy="14.5" r="9" fill="${ruthHair.base}"/>` +
      `<path d="M22 58C17 46 20 26 34 20C44 15 56 15 66 20C80 26 83 46 78 58C74 56 72 52 72 46H28C28 52 26 56 22 58Z" fill="${ruthHair.base}"/>` +
      // cardigan over a cream blouse, a string of pearls
      `<path d="M5 150V113C5 93 22 82 50 82S95 93 95 113V150Z" fill="${ruthTop.base}"/>` +
      `<path d="M36.5 83.5C42 82.3 46 82 50 82S58 82.3 63.5 83.5L50 104Z" fill="${CLOTH.cream.base}"/>` +
      `<path d="M41.5 64V78a8.5 6.5 0 0 0 17 0V64Z" fill="${ruthSkin.base}"/>` +
      `<path d="M41.5 69Q50 78 58.5 69V64H41.5Z" fill="${ruthSkin.shade}"/>` +
      [40.5, 43.8, 47.1, 50.4, 53.7, 57, 60.3]
        .map(
          (x) =>
            `<circle cx="${x}" cy="${f(88 - 0.035 * (x - 50.4) ** 2)}" r="1.7" fill="${CLOTH.white.base}"/>`,
        )
        .join('') +
      // ears and head
      `<circle cx="26.5" cy="53" r="5.5" fill="${ruthSkin.base}"/>` +
      `<circle cx="73.5" cy="53" r="5.5" fill="${ruthSkin.base}"/>` +
      `<circle cx="27.4" cy="53.4" r="2.6" fill="${ruthSkin.shade}"/>` +
      `<circle cx="72.6" cy="53.4" r="2.6" fill="${ruthSkin.shade}"/>` +
      `<ellipse cx="50" cy="50" rx="23.5" ry="25" fill="${ruthSkin.base}"/>` +
      `<ellipse cx="50" cy="61" rx="2.8" ry="2.2" fill="${ruthSkin.shade}"/>`,
    front:
      // soft waves over the forehead, parted on the left, combed back to the bun
      `<path d="M26.5 50C24 34 34 23 50 23C66 23 76 34 73.5 50C71 42 66 37 59 36C55 38 51 39 47 38C40 36 32 40 26.5 50Z" fill="${ruthHair.base}"/>` +
      `<path d="M31 41C34 33 40 29 46 28M69 41C66 33 60 29 54 28" fill="none" stroke="${ruthHair.shade}" stroke-width="1.5" stroke-linecap="round"/>` +
      glint([38, 30, 10], ruthHair.light, 1.6) +
      glint([49.5, 14.5, 9], ruthHair.light, 1.5) +
      // round glasses
      `<g fill="none" stroke="${ruthFrames}" stroke-width="1.7" stroke-linecap="round">` +
      `<circle cx="41" cy="53" r="7.2"/><circle cx="59" cy="53" r="7.2"/>` +
      `<path d="M48.2 52.5Q50 51 51.8 52.5M33.8 52L28 50.5M66.2 52L72 50.5"/></g>`,
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41, y: 53 }, right: { x: 59, y: 53 }, r: 3.7, style: 'dot' },
    brows: { lift: 2.6, length: 2.3, color: shade(ruthHair.shade, -0.3) },
    mouth: { x: 50, y: 67.5, w: 13.5 },
    cheeks: { color: FACE.blush },
    halo: { x: 50, y: 6 },
  },
  pivot: { x: 50, y: 54 },
  headBox: { x: 16, y: 5, size: 70 },
  motionBias: ['nod', 'tilt', 'shake', 'bounce'],
};

// ---------------------------------------------------------------------------------------------------------
// Omer: a full dark beard and a knitted beanie with a pompom.

const omerSkin = SKIN.caramel;
const omerHair = HAIR.espresso;
const omerHat = CLOTH.brick;
const omerTop = CLOTH.forest;

const omer: AvatarDef = {
  id: 'omer',
  kind: 'person',
  name: { he: 'עומר', en: 'Omer' },
  tile: TILE.cobalt,
  layers: {
    back:
      // hoodie with the hood bunched around the neck, drawstrings
      `<path d="M3 150V112C3 90 21 80 50 80S97 90 97 112V150Z" fill="${omerTop.base}"/>` +
      `<path d="M26 85C32 78 41 78 50 80S68 78 74 85C68 95 32 95 26 85Z" fill="${omerTop.shade}"/>` +
      `<path d="M44 89L43 100M56 89L57 100" stroke="${CLOTH.cream.base}" stroke-width="1.6" stroke-linecap="round"/>` +
      `<path d="M41 64V80a9 7 0 0 0 18 0V64Z" fill="${omerSkin.base}"/>` +
      `<circle cx="26" cy="54" r="5.6" fill="${omerSkin.base}"/>` +
      `<circle cx="74" cy="54" r="5.6" fill="${omerSkin.base}"/>` +
      `<circle cx="26.9" cy="54.4" r="2.7" fill="${omerSkin.shade}"/>` +
      `<circle cx="73.1" cy="54.4" r="2.7" fill="${omerSkin.shade}"/>` +
      `<ellipse cx="50" cy="50" rx="24" ry="25.5" fill="${omerSkin.base}"/>` +
      `<ellipse cx="50" cy="59.5" rx="2.8" ry="2.1" fill="${omerSkin.shade}"/>` +
      // beard: sideburns, jaw and chin, with the mouth left clear; then the moustache
      `<path d="M26.2 41C25.2 50 25.6 62 29 70C33 80 41 86.5 50 86.5S67 80 71 70C74.4 62 74.8 50 73.8 41H69.6C69.8 50 69 57 66.5 62C64.5 66 61.5 69 60.5 73C58.5 76.5 54.5 78 50 78S41.5 76.5 39.5 73C38.5 69 35.5 66 33.5 62C31 57 30.2 50 30.4 41Z" fill="${omerHair.base}"/>` +
      `<path d="M37.5 70C38 64 43 60.5 50 62.2C57 60.5 62 64 62.5 70C60.5 68 59.5 66 57 65C54.5 64 52 64 50 64.6C48 64 45.5 64 43 65C40.5 66 39.5 68 37.5 70Z" fill="${omerHair.base}"/>` +
      `<path d="M29.5 60C30.5 67 33.5 73 38 77.5" fill="none" stroke="${omerHair.light}" stroke-width="1.5" stroke-linecap="round"/>` +
      // beanie: dome, folded cuff with ribs, pompom. Behind the face, so dizzy stars circle over it.
      `<path d="M24.5 34C24.5 16 36 9 50 9S75.5 16 75.5 34Z" fill="${omerHat.base}"/>` +
      `<path d="M50 9C64 9 75.5 16 75.5 34H66C66 22 60 13 50 9Z" fill="${omerHat.shade}"/>` +
      `<rect x="22.5" y="29" width="55" height="11.5" rx="5.5" fill="${omerHat.shade}"/>` +
      `<rect x="22.5" y="28.5" width="54" height="10.5" rx="5.2" fill="${omerHat.base}"/>` +
      `<path d="M30 30.5V37.5M36 30.5V37.5M42 30.5V37.5M48 30.5V37.5M54 30.5V37.5M60 30.5V37.5M66 30.5V37.5M72 30.5V37.5" stroke="${omerHat.shade}" stroke-width="1.6" stroke-linecap="round"/>` +
      `<circle cx="50.8" cy="8.8" r="6.5" fill="${CLOTH.cream.shade}"/>` +
      `<circle cx="50" cy="8" r="5.8" fill="${CLOTH.cream.base}"/>`,
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41, y: 53 }, right: { x: 59, y: 53 }, r: 4, style: 'dot' },
    brows: { lift: 1.9, length: 2.4, color: omerHair.base },
    mouth: { x: 50, y: 68.5, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.55, size: 0.8 },
    halo: { x: 50, y: 21 },
  },
  pivot: { x: 50, y: 55 },
  headBox: { x: 14, y: 5, size: 72 },
  motionBias: ['nod', 'shake', 'tilt', 'bounce'],
};

// ---------------------------------------------------------------------------------------------------------
// Dana: an orange head wrap with gold stripes, knotted on top, and gold hoops. Dark skin: round eyes, and a
// light mouth line that reads on it.

const danaSkin = SKIN.umber;
const danaWrap = OBJECT.orange;
const danaGold = OBJECT.gold;
const danaTop = CLOTH.denim;

const dana: AvatarDef = {
  id: 'dana',
  kind: 'person',
  name: { he: 'דנה', en: 'Dana' },
  tile: TILE.orchid,
  layers: {
    back:
      `<path d="M5 150V113C5 93 22 82 50 82S95 93 95 113V150Z" fill="${danaTop.base}"/>` +
      `<path d="M37 83.2C42 82.3 46 82 50 82S58 82.3 63 83.2C60 92 40 92 37 83.2Z" fill="${danaTop.shade}"/>` +
      `<path d="M42 64V80a8 6 0 0 0 16 0V64Z" fill="${danaSkin.base}"/>` +
      `<path d="M42 69Q50 77 58 69V64H42Z" fill="${danaSkin.shade}"/>` +
      `<circle cx="26" cy="53" r="5.4" fill="${danaSkin.base}"/>` +
      `<circle cx="74" cy="53" r="5.4" fill="${danaSkin.base}"/>` +
      `<circle cx="26.9" cy="53.4" r="2.5" fill="${danaSkin.shade}"/>` +
      `<circle cx="73.1" cy="53.4" r="2.5" fill="${danaSkin.shade}"/>` +
      `<g fill="none" stroke="${danaGold.base}" stroke-width="1.9"><circle cx="25" cy="63.5" r="4.6"/><circle cx="75" cy="63.5" r="4.6"/></g>` +
      `<ellipse cx="50" cy="50" rx="23.5" ry="25.5" fill="${danaSkin.base}"/>` +
      `<ellipse cx="50" cy="60" rx="3" ry="2.2" fill="${danaSkin.shade}"/>` +
      // the wrap: a tall dome, shaded on the right, folds rising to the knot, gold stripes
      `<path d="M23 48C17 30 24 9 50 8C76 9 83 30 77 48C73 41 63 36.5 50 36.5S27 41 23 48Z" fill="${danaWrap.base}"/>` +
      `<path d="M50 8C76 9 83 30 77 48C75 43 72 40 69 38.5C70 24 63 12 50 8Z" fill="${danaWrap.shade}"/>` +
      `<path d="M23.5 45C27 35 37 29 49 28C57 22 61 16 62 10.5C66 14 66 20 62 25C58 30 53 33 49 33.5C38 34.5 29 38.5 23.5 45Z" fill="${danaWrap.shade}"/>` +
      `<path d="M27 30C33 21 43 16 55 14M34 23C40 18 46 15.5 52 14.5M64 36C68 30 70 24 69 18" fill="none" stroke="${danaGold.base}" stroke-width="1.8" stroke-linecap="round"/>` +
      // the knot: two loops and the twist between them
      `<ellipse cx="40" cy="10.5" rx="9.5" ry="5.5" transform="rotate(-18 40 10.5)" fill="${danaWrap.shade}"/>` +
      `<ellipse cx="39.3" cy="9.8" rx="8.6" ry="4.7" transform="rotate(-18 39.3 9.8)" fill="${danaWrap.base}"/>` +
      `<ellipse cx="60.5" cy="9.5" rx="9.5" ry="5.8" transform="rotate(22 60.5 9.5)" fill="${danaWrap.shade}"/>` +
      `<circle cx="50.5" cy="13" r="5.2" fill="${danaWrap.shade}"/>` +
      `<circle cx="49.8" cy="12.3" r="4.3" fill="${danaWrap.base}"/>` +
      glint([36, 26, 11], danaWrap.light, 1.8),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41, y: 53 }, right: { x: 59, y: 53 }, r: 4.2, style: 'round' },
    brows: { lift: 1.9, length: 2.2, color: HAIR.black.base },
    mouth: { x: 50, y: 67.5, w: 13.5, ink: mix(FACE.tongue, danaSkin.base, 0.25) },
    cheeks: { color: FACE.tongue },
    halo: { x: 50, y: 22 },
  },
  pivot: { x: 50, y: 52 },
  headBox: { x: 15, y: 4, size: 72 },
  motionBias: ['tilt', 'bounce', 'nod', 'flip'],
};

// ---------------------------------------------------------------------------------------------------------
// Ido: a boy with a blue cap, its peak turned a little to the side. A child: a rounder head, big ears and
// eyes, a short neck and narrow shoulders.

const idoSkin = SKIN.bronze;
const idoHair = HAIR.black;
const idoCap = OBJECT.blue;
const idoTop = CLOTH.navy;

const ido: AvatarDef = {
  id: 'ido',
  kind: 'person',
  name: { he: 'עידו', en: 'Ido' },
  tile: TILE.tangerine,
  layers: {
    back:
      `<path d="M11 150V114C11 96 27 86 50 86S89 96 89 114V150Z" fill="${idoTop.base}"/>` +
      `<path d="M39.5 86.6C44 86 56 86 60.5 86.6C58 94 42 94 39.5 86.6Z" fill="${idoTop.shade}"/>` +
      `<path d="M43.5 70V86a6.5 5 0 0 0 13 0V70Z" fill="${idoSkin.base}"/>` +
      `<path d="M43.5 74Q50 81 56.5 74V70H43.5Z" fill="${idoSkin.shade}"/>` +
      `<circle cx="25.5" cy="57" r="6.6" fill="${idoSkin.base}"/>` +
      `<circle cx="74.5" cy="57" r="6.6" fill="${idoSkin.base}"/>` +
      `<circle cx="26.5" cy="57.5" r="3.2" fill="${idoSkin.shade}"/>` +
      `<circle cx="73.5" cy="57.5" r="3.2" fill="${idoSkin.shade}"/>` +
      `<ellipse cx="50" cy="55" rx="24.5" ry="24" fill="${idoSkin.base}"/>` +
      // hair below the cap, and the shadow the cap casts on the forehead
      `<path d="M26 40H34C31.5 43 30 47 30.5 52C28 49.5 26.5 45 26 40Z" fill="${idoHair.base}"/>` +
      `<path d="M74 40H66C68.5 43 70 47 69.5 52C72 49.5 73.5 45 74 40Z" fill="${idoHair.base}"/>` +
      `<path d="M30 42H70C68 45.5 60 47.5 50 47.5S32 45.5 30 42Z" fill="${idoSkin.shade}"/>` +
      `<ellipse cx="50" cy="64" rx="2.4" ry="1.8" fill="${idoSkin.shade}"/>`,
    front:
      // cap: the crown (shaded on the right), seams, the button, the peak turned to the viewer's right
      `<path d="M25.5 44C24.5 22 36.5 12.5 50 12.5S75.5 22 74.5 44Z" fill="${idoCap.base}"/>` +
      `<path d="M50 12.5C64 12.5 75.5 22 74.5 44H65C65 28 59 17 50 12.5Z" fill="${idoCap.shade}"/>` +
      `<path d="M50 14C42 19 39 30 39.5 43" fill="none" stroke="${idoCap.shade}" stroke-width="1.3" stroke-linecap="round"/>` +
      `<circle cx="50" cy="13" r="2.6" fill="${idoCap.shade}"/>` +
      glint([39, 26, 12], idoCap.light, 1.8) +
      `<path d="M38 42.5C52 37 74 35 89 39C91 39.6 91 41.8 89.3 42.6C77 46.5 58 47.5 40 46.5Z" fill="${idoCap.shade}"/>` +
      `<path d="M38 42.5C52 37 74 35 89 39C88.5 40.6 86 41.4 83 41.8C70 41 54 42.5 40 44.8Z" fill="${idoCap.base}"/>`,
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 40.5, y: 58 }, right: { x: 59.5, y: 58 }, r: 4.5, style: 'round' },
    brows: { lift: 1.75, length: 2, color: idoHair.base },
    mouth: { x: 50, y: 71, w: 13 },
    cheeks: { color: FACE.blush },
    halo: { x: 50, y: 7 },
  },
  pivot: { x: 50, y: 56 },
  headBox: { x: 14, y: 9, size: 72 },
  motionBias: ['bounce', 'spin', 'shake', 'flip'],
};

export const PEOPLE: readonly AvatarDef[] = [noam, maya, ruthie, omer, dana, ido];
