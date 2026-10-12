/**
 * Objects with faces: digits, letters, things from a player's table. Each one is the whole object, standing in
 * the tile, with room around it for squash and stretch. Read docs/avatars/STYLE.md first.
 */

import { FACE, FUR, OBJECT, TILE } from '../palette';
import { f } from '../svg';
import type { AvatarDef } from '../types';

/** A filled path. */
const fill = (d: string, color: string, extra = '') => `<path d="${d}" fill="${color}"${extra}/>`;

/** A round-capped line: for things that are lines in real life (a handle, steam, a ray, a leg). */
const line = (d: string, color: string, width: number) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A point at `deg` degrees (0 = right, 90 = down) on a circle. */
const polar = (cx: number, cy: number, r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return `${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`;
};

// ---------------------------------------------------------------------------------------------------------
// Eight: the style example for objects. The face sits in the lower bowl; the upper counter stays open, so it
// still reads as an 8 at 24 px.

const eightBody = OBJECT.gold;
const eightTile = TILE.iris;

const eight: AvatarDef = {
  id: 'eight',
  kind: 'object',
  name: { he: 'שמונה', en: 'Eight' },
  tile: eightTile,
  layers: {
    back:
      // feet
      `<ellipse cx="40.5" cy="90.5" rx="7.5" ry="4.2" fill="${eightBody.shade}"/>` +
      `<ellipse cx="59.5" cy="90.5" rx="7.5" ry="4.2" fill="${eightBody.shade}"/>` +
      // the two bowls: the shade first, then the lit surface shifted up and left (depth from shapes, no outlines)
      `<circle cx="50" cy="28.5" r="18" fill="${eightBody.shade}"/>` +
      `<circle cx="50" cy="64.5" r="23.5" fill="${eightBody.shade}"/>` +
      `<circle cx="48.7" cy="27.2" r="16.3" fill="${eightBody.base}"/>` +
      `<circle cx="48.5" cy="63" r="21.5" fill="${eightBody.base}"/>` +
      // the upper counter: the tile shows through, with a shade lip on its top edge
      `<ellipse cx="50" cy="28" rx="6" ry="6.6" fill="${eightTile}"/>` +
      `<path d="M44.5 25.2a6 6.6 0 0 1 11 0a7.2 7.2 0 0 0-11 0z" fill="${eightBody.shade}"/>` +
      // shine
      `<ellipse cx="38.5" cy="20.5" rx="2.8" ry="4.4" transform="rotate(-32 38.5 20.5)" fill="${eightBody.light}"/>` +
      `<ellipse cx="33" cy="55" rx="2.8" ry="5.2" transform="rotate(-24 33 55)" fill="${eightBody.light}"/>`,
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 61 }, right: { x: 58.5, y: 61 }, r: 5.8, style: 'round' },
    brows: { lift: 1.75, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 75.5, w: 15 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 8 },
  },
  pivot: { x: 50, y: 52 },
  base: 94,
  squash: true,
  motionBias: ['squash', 'spin', 'bounce', 'wobble'],
};

// ---------------------------------------------------------------------------------------------------------
// Letter A: a chunky balloon A. The face sits on the wide part under the counter; the counter (a small
// triangle) and the notch between the legs stay open, so it reads as an A at 24 px.

const aBody = OBJECT.red;
const aTile = TILE.teal;
/** The outline: a flat rounded apex, straight sides, two legs with a rounded notch between them. */
const aOutline =
  'M44 11.6H56Q59.8 11.6 61.1 15.2L84.2 86.4Q86 93 79.6 93H67.4Q64.2 93 63 90.1L56 80.4Q50 73.4 44 80.4' +
  'L37 90.1Q35.8 93 32.6 93H20.4Q14 93 15.8 86.4L38.9 15.2Q40.2 11.6 44 11.6Z';
/** The counter: a small rounded triangle. */
const aCounter = 'M48.4 19.4Q50 17.2 51.6 19.4L58.6 29.6Q60.2 32 57.2 32H42.8Q39.8 32 41.4 29.6Z';
const aCounterFloor = 'M48.4 22.2Q50 20 51.6 22.2L58.6 29.6Q60.2 32 57.2 32H42.8Q39.8 32 41.4 29.6Z';

const letterA: AvatarDef = {
  id: 'letter-a',
  kind: 'object',
  name: { he: 'אות A', en: 'Letter A' },
  tile: aTile,
  layers: {
    back:
      // the shade silhouette, then the lit surface shifted up and left: a shade edge shows on the lower right
      fill(aOutline, aBody.shade) +
      fill(aOutline, aBody.base, ' transform="translate(-1.4 -1.3)"') +
      // the counter: the tile shows through, with a shade lip along its top edges
      fill(aCounter, aBody.shade) +
      fill(aCounterFloor, aTile) +
      // shine on the left stroke and the left leg
      `<ellipse cx="38.5" cy="24" rx="2.2" ry="5" transform="rotate(18 38.5 24)" fill="${aBody.light}"/>` +
      `<ellipse cx="22.4" cy="79" rx="2.4" ry="5.4" transform="rotate(18 22.4 79)" fill="${aBody.light}"/>`,
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 52.5 }, right: { x: 58.5, y: 52.5 }, r: 5.7, style: 'round' },
    brows: { lift: 1.72, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 66, w: 15 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 8 },
  },
  pivot: { x: 50, y: 56 },
  base: 93,
  squash: true,
  motionBias: ['tilt', 'squash', 'nod', 'spin'],
};

// ---------------------------------------------------------------------------------------------------------
// Coffee cup: a mug of coffee on a saucer, steam rising. The face sits on the mug's body, under the rim. The
// eyes are `dot`: the white of `round` eyes vanishes on a cream mug, as on light skin.

const cup = OBJECT.cream;
const coffee = OBJECT.coffee;
const steam = OBJECT.white.base;
/** The mug's body, a little narrower at the bottom. */
const cupBody = 'M20.5 36L25.6 76.5Q26.8 85 35.5 85H56.5Q65.2 85 66.4 76.5L71.5 36Z';

const coffeeCup: AvatarDef = {
  id: 'coffee-cup',
  kind: 'object',
  name: { he: 'כוס קפה', en: 'Coffee cup' },
  tile: TILE.coral,
  layers: {
    back:
      // steam: three soft wisps above the cup
      line('M35.5 29C32 25 39.5 21.5 36 16', steam, 3.2) +
      line('M46 28C42.5 23 50 19 46.5 12', steam, 3.2) +
      line('M56.5 29C53 25 60.5 21.5 57 16', steam, 3.2) +
      // saucer: its edge in shade, its top surface, and the shadow the mug casts on it
      `<ellipse cx="49" cy="88.5" rx="31" ry="6" fill="${cup.shade}"/>` +
      `<ellipse cx="48.4" cy="86.9" rx="30.2" ry="4.7" fill="${cup.base}"/>` +
      `<ellipse cx="47.5" cy="86" rx="22" ry="3.2" fill="${cup.shade}"/>` +
      // handle: behind the mug, so its ends tuck under the body
      line('M68.5 47C83 44.5 85.5 70 66 72', cup.shade, 6.8) +
      line('M68 46.6C80.8 44.6 83 67.5 66 70', cup.base, 3.6) +
      // the mug: shade, then the lit surface shifted left
      fill(cupBody, cup.shade) +
      fill(cupBody, cup.base, ' transform="translate(-2.2 -0.8)"') +
      // rim, the inner wall and the coffee
      `<ellipse cx="45" cy="36" rx="26.6" ry="6.2" fill="${cup.light}"/>` +
      `<ellipse cx="45" cy="36.4" rx="23.4" ry="4.6" fill="${cup.shade}"/>` +
      `<ellipse cx="45" cy="37.6" rx="21.6" ry="3.5" fill="${coffee.base}"/>` +
      `<ellipse cx="38.5" cy="37" rx="5.5" ry="1.3" fill="${coffee.light}"/>` +
      // shine on the mug
      `<ellipse cx="25.6" cy="56" rx="2.2" ry="7.5" transform="rotate(-7 25.6 56)" fill="${cup.light}"/>`,
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 37.5, y: 59 }, right: { x: 53.5, y: 59 }, r: 4.5, style: 'dot' },
    brows: { lift: 1.9, length: 2.2, thickness: 2 },
    mouth: { x: 45.5, y: 72.5, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 46, y: 8 },
  },
  pivot: { x: 48, y: 58 },
  base: 94,
  squash: true,
  motionBias: ['wobble', 'squash', 'tilt', 'bounce'],
};

// ---------------------------------------------------------------------------------------------------------
// Pencil: a short, stout pencil standing on its eraser, point up. The face sits on the painted body; the
// point and the eraser carry the silhouette.

const pencilBody = OBJECT.orange;
const wood = OBJECT.cream;
const graphite = FUR.charcoal;
const ferrule = OBJECT.steel;
const eraser = OBJECT.pink;
/** The painted body: its top edge is the three scallops a sharpener leaves. */
const pencilPaint = 'M26 37Q34 27.5 42 37Q50 27.5 58 37Q66 27.5 74 37V77H26Z';

const pencil: AvatarDef = {
  id: 'pencil',
  kind: 'object',
  name: { he: 'עיפרון', en: 'Pencil' },
  tile: TILE.sky,
  layers: {
    back:
      // the sharpened wood: the right facet in shade
      fill('M47.8 12.6Q50 9.6 52.2 12.6L74 37H26Z', wood.shade) +
      fill('M47.8 12.6Q50 9.6 52.2 12.6L58.5 37H26Z', wood.base) +
      // the graphite point
      fill('M47.8 12.6Q50 9.6 52.2 12.6L58.3 19.4Q50 22 41.7 19.4Z', graphite.shade) +
      fill('M47.8 12.6Q50 9.6 52.2 12.6L54.1 20.7Q48 21.7 41.7 19.4Z', graphite.base) +
      // the painted body, a shade facet on the right and a light facet on the left
      fill(pencilPaint, pencilBody.base) +
      fill('M68.5 32.71Q71.25 33.73 74 37V77H68.5Z', pencilBody.shade) +
      `<rect x="28.4" y="37.5" width="3.2" height="37" rx="1.6" fill="${pencilBody.light}"/>` +
      // eraser, then the metal ferrule over its top
      fill('M27 82H73V88.5Q73 94 67.5 94H32.5Q27 94 27 88.5Z', eraser.shade) +
      fill('M27 82H69.5V88.5Q69.5 94 64 94H32.5Q27 94 27 88.5Z', eraser.base) +
      `<rect x="25" y="76" width="50" height="9.6" rx="2" fill="${ferrule.base}"/>` +
      `<rect x="25" y="79.2" width="50" height="1.3" fill="${ferrule.shade}"/>` +
      `<rect x="25" y="82.4" width="50" height="1.3" fill="${ferrule.shade}"/>` +
      fill('M70.5 76H73Q75 76 75 78V83.6Q75 85.6 73 85.6H70.5Z', ferrule.shade) +
      `<rect x="27.6" y="77" width="3" height="7.6" rx="1.5" fill="${ferrule.light}"/>`,
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41, y: 54 }, right: { x: 59, y: 54 }, r: 5.4, style: 'round' },
    brows: { lift: 1.7, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 67.5, w: 15 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 8 },
  },
  pivot: { x: 50, y: 52 },
  base: 94,
  squash: true,
  motionBias: ['spin', 'bounce', 'tilt', 'squash'],
};

// ---------------------------------------------------------------------------------------------------------
// Light bulb: a lit bulb on a screw base, rays around it: the idea, the hint. The face sits on the glass.

const glass = { base: OBJECT.gold.light, shade: OBJECT.gold.base, light: OBJECT.white.base };
const screw = OBJECT.steel;
/** The glass: a ball that narrows into a neck. */
const bulbGlass = 'M31.6 59.9A26 26 0 1 1 68.4 59.9Q62.5 66 62 74.5H38Q37.5 66 31.6 59.9Z';
const ray = (deg: number) =>
  line(`M${polar(50, 41.5, 31, deg)}L${polar(50, 41.5, 36, deg)}`, glass.base, 3.4);

const lightbulb: AvatarDef = {
  id: 'lightbulb',
  kind: 'object',
  name: { he: 'נורה', en: 'Light bulb' },
  tile: TILE.berry,
  layers: {
    back:
      // rays
      [-160, -125, -55, -20].map(ray).join('') +
      // the glass: shade, then the lit surface shifted up and left
      fill(bulbGlass, glass.shade) +
      fill(bulbGlass, glass.base, ' transform="translate(-1.4 -1.4)"') +
      // the screw base: three threads and the contact
      fill('M43.5 87H56.5Q56 93.5 50 93.5Q44 93.5 43.5 87Z', graphite.base) +
      [73.5, 78.1, 82.7]
        .map(
          (y) =>
            `<rect x="37" y="${y}" width="26" height="4.6" rx="2.3" fill="${screw.shade}"/>` +
            `<rect x="37" y="${y}" width="23.5" height="3.8" rx="1.9" fill="${screw.base}"/>`,
        )
        .join('') +
      // a glint on the glass
      line(`M${polar(48.6, 40.1, 20, 195)}A20 20 0 0 1 ${polar(48.6, 40.1, 20, 235)}`, glass.light, 3.2),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 43.5 }, right: { x: 58.5, y: 43.5 }, r: 5.6, style: 'round' },
    brows: { lift: 1.75, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 57.5, w: 15 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 8.5 },
  },
  pivot: { x: 50, y: 51.5 },
  base: 93.5,
  squash: true,
  motionBias: ['bounce', 'squash', 'spin', 'tilt'],
};

// ---------------------------------------------------------------------------------------------------------
// Alarm clock: a twin-bell clock on two legs: the game's timer. The face sits on the white dial, between the
// hour marks. The eyes are `dot`: the white of `round` eyes vanishes on the dial.

const clockBody = OBJECT.blue;
const brass = OBJECT.gold;
const dial = OBJECT.white;
/** A bell: a dome with a rim and a knob, tilted outward by `deg`. */
const bell = (cx: number, cy: number, deg: number) =>
  `<g transform="rotate(${deg} ${cx} ${cy})">` +
  `<circle cx="${cx}" cy="${cy - 12.2}" r="2.4" fill="${brass.shade}"/>` +
  fill(`M${cx - 10.5} ${cy}A10.5 10.5 0 0 1 ${cx + 10.5} ${cy}Z`, brass.shade) +
  fill(`M${cx - 10.5} ${cy}A9.6 9.6 0 0 1 ${cx + 8.7} ${cy}Z`, brass.base) +
  `<ellipse cx="${cx}" cy="${cy}" rx="12" ry="2.4" fill="${brass.shade}"/>` +
  `</g>`;

const alarmClock: AvatarDef = {
  id: 'alarm-clock',
  kind: 'object',
  name: { he: 'שעון מעורר', en: 'Alarm clock' },
  tile: TILE.jade,
  layers: {
    back:
      // legs
      line('M36 76L30.5 90.5', brass.shade, 5.6) +
      line('M64 76L69.5 90.5', brass.shade, 5.6) +
      // the hammer between the bells
      line('M50 28V16.5', brass.shade, 3) +
      `<ellipse cx="50" cy="14.2" rx="4.6" ry="3" fill="${brass.base}"/>` +
      // bells
      bell(31.5, 28, -38) +
      bell(68.5, 28, 38) +
      // the body: shade, then the lit surface shifted up and left
      `<circle cx="50" cy="54" r="29" fill="${clockBody.shade}"/>` +
      `<circle cx="48.8" cy="52.8" r="27.4" fill="${clockBody.base}"/>` +
      // the dial, sunk into the body: a thin shade on its upper-left inner edge
      `<circle cx="49.3" cy="53.3" r="22" fill="${dial.shade}"/>` +
      `<circle cx="50" cy="54" r="21.3" fill="${dial.base}"/>` +
      // hour marks at 12, 3, 6 and 9
      [270, 0, 90, 180]
        .map((deg) =>
          line(`M${polar(50, 54, 17.6, deg)}L${polar(50, 54, 19.6, deg)}`, OBJECT.steel.shade, 2.2),
        )
        .join('') +
      // shine on the body
      `<ellipse cx="29.5" cy="40" rx="2.4" ry="5.2" transform="rotate(38 29.5 40)" fill="${clockBody.light}"/>`,
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 42, y: 51.5 }, right: { x: 58, y: 51.5 }, r: 4.5, style: 'dot' },
    brows: { lift: 1.9, length: 2.2, thickness: 2 },
    mouth: { x: 50, y: 63.5, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 7.5 },
  },
  pivot: { x: 50, y: 54 },
  base: 93.5,
  squash: true,
  motionBias: ['shake', 'bounce', 'squash', 'wobble'],
};

export const OBJECTS: readonly AvatarDef[] = [eight, letterA, coffeeCup, pencil, lightbulb, alarmClock];
