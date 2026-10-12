/**
 * Things from the office and the school bag (kind `object`): a paper clip, an eraser, a push pin, a calculator,
 * a tape roll and scissors. This set also brings a few snacks from the school bag (kind `food`: a pickle,
 * cotton candy, a banana) and a chick hatching from its egg (kind `animal`).
 *
 * Read docs/avatars/STYLE.md first. Shared drawing helpers: ./draw.ts; gimmick recipes: ../gimmick.ts. Add each
 * character's AvatarDef here and append it to the list below: catalog/index.ts already includes this list.
 */

import { GIMMICK_RECIPES as R } from '../gimmick';
import { CLOTH, FACE, FUR, HAIR, mix, OBJECT, type Ramp, shade, TILE } from '../palette';
import { f } from '../svg';
import type { AvatarDef, Expression, GimmickDef, GimmickKeyframe } from '../types';
import { circle, ellipse, line, P, path, type Pt, rect, shaded } from './draw';

// ---------------------------------------------------------------------------------------------------------
// Local helpers

/** A point `r` from `c` at `deg` degrees (0 = right, 90 = down). */
const toward = (c: Pt, r: number, deg: number): Pt => {
  const a = (deg * Math.PI) / 180;
  return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
};

/** Quadratic curves through the midpoints of `pts`, from the current point (pts[0]) to the last point. */
function curveThrough(pts: readonly Pt[]): string {
  let d = '';
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    if (p && q) d += `Q${P(p)} ${P([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2])}`;
  }
  const last = pts[pts.length - 1];
  return last ? `${d}L${P(last)}` : d;
}

/** A closed, smooth outline through `pts` (quadratic curves through the midpoints). */
function smoothClosed(pts: readonly Pt[]): string {
  const n = pts.length;
  const p = (i: number): Pt => pts[((i % n) + n) % n] ?? [50, 50];
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let d = `M${P(mid(p(-1), p(0)))}`;
  for (let i = 0; i < n; i++) d += `Q${P(p(i))} ${P(mid(p(i), p(i + 1)))}`;
  return `${d}Z`;
}

/** A spine for a long, soft body (a pickle, a banana): a quadratic Bézier from the top end to the bottom end. */
type Spine = readonly [Pt, Pt, Pt];

const bez = ([a, b, c]: Spine, t: number): Pt => [
  (1 - t) ** 2 * a[0] + 2 * t * (1 - t) * b[0] + t * t * c[0],
  (1 - t) ** 2 * a[1] + 2 * t * (1 - t) * b[1] + t * t * c[1],
];
const bezDir = ([a, b, c]: Spine, t: number): Pt => {
  const x = 2 * (1 - t) * (b[0] - a[0]) + 2 * t * (c[0] - b[0]);
  const y = 2 * (1 - t) * (b[1] - a[1]) + 2 * t * (c[1] - b[1]);
  const len = Math.hypot(x, y) || 1;
  return [x / len, y / len];
};
/** The point at `s` (0 = top end, 1 = bottom end), `offset` to the viewer's left of the spine (− = right). */
const onSpine = (spine: Spine, s: number, offset: number): Pt => {
  const p = bez(spine, s);
  const d = bezDir(spine, s);
  return [p[0] - d[1] * offset, p[1] + d[0] * offset];
};
/** The spine's angle at `s`, in degrees from vertical: for a shine that lies along the body. */
const spineAngle = (spine: Spine, s: number): number => {
  const d = bezDir(spine, s);
  return (Math.atan2(-d[0], d[1]) * 180) / Math.PI;
};
/**
 * The points of one side of a body around `spine`, from s0 to s1: side −1 is the viewer's left, +1 the right;
 * `half(s, side)` is the half-width there.
 */
const bodySide = (
  spine: Spine,
  half: (s: number, side: -1 | 1) => number,
  side: -1 | 1,
  s0: number,
  s1: number,
  n: number,
): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const s = s0 + ((s1 - s0) * i) / n;
    return onSpine(spine, s, -side * half(s, side));
  });
/** A rounded end profile: 0 at s = 0 and 1, 1 in the middle; a smaller `p` tapers that end more. */
const profile = (s: number, pTop: number, pBottom: number): number => {
  const u = Math.abs(2 * s - 1);
  const p = s < 0.5 ? pTop : pBottom;
  return Math.max(0, 1 - u ** p) ** (1 / p);
};

/** A drop, point up: the rig's tear shape, for brine, syrup and the like. */
const dropAt = ([x, y]: Pt, s: number, fill: string): string =>
  path(
    `M${f(x)} ${f(y - 1.6 * s)}C${f(x + 0.35 * s)} ${f(y - s)} ${f(x + s)} ${f(y - 0.45 * s)} ${f(x + s)} ${f(y + 0.1 * s)}` +
      `A${f(s)} ${f(s)} 0 0 1 ${f(x - s)} ${f(y + 0.1 * s)}C${f(x - s)} ${f(y - 0.45 * s)} ${f(x - 0.35 * s)} ${f(y - s)} ${f(x)} ${f(y - 1.6 * s)}Z`,
    fill,
  );

/** A ring (a stroked circle): its hole shows whatever is behind it. */
const ring = (c: Pt, r: number, width: number, color: string): string =>
  `<circle cx="${f(c[0])}" cy="${f(c[1])}" r="${f(r)}" fill="none" stroke="${color}" stroke-width="${f(width)}"/>`;

// =========================================================================================================
// FOOD
// =========================================================================================================

// ---------------------------------------------------------------------------------------------------------
// Pickle: a sour, bumpy pickle, a bit crooked (its spine bends, its eyes sit a little askew, its brows sit
// low). When it is angry or shaken, drops of brine fly off.

const pickleSkin: Ramp = (() => {
  const base = mix(FUR.green.shade, HAIR.honey.shade, 0.3);
  return { base, shade: shade(base, -0.17), light: mix(base, FUR.green.light, 0.55) };
})();
const brine = mix(FACE.tear, pickleSkin.light, 0.45);
const pickleSpine: Spine = [
  [58, 10],
  [43, 50],
  [53, 93],
];
/** Rounded ends, a little fuller at the bottom, and small bumps along both sides. */
const pickleHalf = (s: number, side: -1 | 1) => {
  const h = (19.5 + 3.2 * s) * profile(s, 2.3, 2.6);
  const bumps = 0.75 * Math.sin(2 * Math.PI * 4.5 * s + (side < 0 ? 0 : 1.9));
  return Math.max(0, h + bumps * Math.min(1, h / 8));
};
const pickleOutline = smoothClosed([
  ...bodySide(pickleSpine, pickleHalf, -1, 0, 1, 36),
  ...bodySide(pickleSpine, pickleHalf, 1, 1, 0, 36).slice(1, -1),
]);
/** A wart: a light bump with its shade below it. */
const wart = (s: number, offset: number, r: number) => {
  const [x, y] = onSpine(pickleSpine, s, offset);
  return circle(x + 0.4, y + 0.5, r, pickleSkin.shade) + circle(x, y, r, pickleSkin.light);
};
const brineDrop = (i: number, from: Pt, dx: number): GimmickDef => ({
  id: `brine-${i}`,
  rest: 'hidden',
  markup: dropAt(from, 2, brine),
  anim: {
    trigger: ['angry', 'shake'],
    durationMs: 900,
    delayMs: i * 300,
    loop: true,
    ease: 'linear',
    keyframes: [
      { t: 0, sx: 0.4, sy: 0.4, opacity: 0, ease: 'standard' },
      { t: 0.15, x: dx * 0.35, y: -3, opacity: 1 },
      { t: 0.55, x: dx * 0.8, y: -1, opacity: 1, ease: 'exit' },
      { t: 1, x: dx, y: 9, sx: 0.8, sy: 0.8, opacity: 0 },
    ],
    origin: { x: from[0], y: from[1] },
  },
});

const pickle: AvatarDef = {
  id: 'pickle',
  kind: 'food',
  name: { he: 'מלפפון חמוץ', en: 'Pickle' },
  tile: TILE.orchid,
  layers: {
    back:
      // the blossom end, then the body: shade, then the lit surface up and left
      ellipse(57.6, 10.6, 3.4, 2.4, shade(pickleSkin.shade, -0.25), 20) +
      shaded(pickleOutline, pickleSkin.base, pickleSkin.shade, -1.6, -1.2) +
      // warts along the edges, clear of the face
      wart(0.13, 13, 1.7) +
      wart(0.2, -14, 1.6) +
      wart(0.3, 16.5, 1.5) +
      wart(0.72, -17, 1.7) +
      wart(0.8, 15.5, 1.8) +
      wart(0.9, -9, 1.5) +
      wart(0.86, 3, 1.6) +
      // a long shine down the left side
      (() => {
        const [x, y] = onSpine(pickleSpine, 0.3, 14.5);
        return ellipse(x, y, 2.3, 8.5, pickleSkin.light, spineAngle(pickleSpine, 0.3));
      })(),
  },
  face: {
    ink: FACE.ink,
    // a little askew: the right eye sits higher
    eyes: { left: { x: 41.5, y: 46 }, right: { x: 58.5, y: 44.4 }, r: 5.6, style: 'round' },
    brows: { lift: 1.6, length: 1.8, thickness: 2.4 },
    mouth: { x: 50.5, y: 60, w: 14 },
    // no cheeks: blush on green turns brown
    halo: { x: 54, y: 7 },
  },
  pivot: { x: 50, y: 50 },
  base: 93,
  squash: true,
  motionBias: ['wobble', 'tilt', 'shake', 'squash'],
  gimmicks: [brineDrop(0, [28, 52], -9), brineDrop(1, [73, 44], 9), brineDrop(2, [30, 70], -7)],
};

// ---------------------------------------------------------------------------------------------------------
// Cotton candy: a pink cloud of spun sugar on a striped paper cone. The cloud holds the face (`z: 'face'`):
// it breathes when idle, puffs up when surprised and sags when sad, while sweet drops drip from it.

const candy = FUR.pink;
const wisp = mix(candy.light, OBJECT.white.base, 0.45);
const cone = OBJECT.white;
const coneStripe = OBJECT.blue.light;
const cloudCentre: Pt = [50, 41];
/** The puffs around the cloud's rim, as [angle, distance, radius]: uneven, like spun sugar. */
const puffs: readonly (readonly [number, number, number])[] = [
  [-168, 23, 10],
  [-136, 23.5, 12],
  [-100, 25, 10.5],
  [-68, 23, 12.5],
  [-30, 23.5, 10.5],
  [8, 24, 11.5],
  [44, 22, 10],
  [80, 21, 11],
  [118, 22, 10],
  [150, 23, 11.5],
];
const cloudShapes = (fill: string) =>
  ellipse(cloudCentre[0], cloudCentre[1], 25, 23.5, fill) +
  puffs
    .map(([deg, dist, r]) => {
      const [x, y] = toward(cloudCentre, dist, deg);
      return circle(x, y, r, fill);
    })
    .join('');
const syrupDrop = (i: number, x: number): GimmickDef => ({
  id: `drip-${i}`,
  rest: 'hidden',
  markup: dropAt([x, 65.5], 2.7, candy.shade),
  anim: { ...R.drip({ fall: 20, ms: 1500 }), delayMs: i * 620, trigger: ['sad'], origin: { x, y: 65.5 } },
});

const cottonCandy: AvatarDef = {
  id: 'cotton-candy',
  kind: 'food',
  name: { he: 'שערות סבתא', en: 'Cotton candy' },
  tile: TILE.sky,
  layers: {
    back:
      // the paper cone: shade side, then the lit side, a stripe that winds around it
      path('M41.5 62H58.5L52.6 95Q50 96.6 47.4 95Z', cone.shade) +
      path('M41.5 62H55.5L50.6 95Q49 96 47.4 95Z', cone.base) +
      path('M42.6 68.5L57.2 66L56.4 70.6L43.5 73.4Z', coneStripe) +
      path('M44.4 79L55.3 77L54.6 81.4L45.4 83.4Z', coneStripe) +
      path('M46.2 89.2L53.4 88L52.9 91.6L46.9 92.8Z', coneStripe),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41.5, y: 40 }, right: { x: 58.5, y: 40 }, r: 5.3, style: 'round' },
    brows: { lift: 1.75, length: 1.7, thickness: 2.2 },
    mouth: { x: 50, y: 53.5, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 7 },
  },
  pivot: { x: 50, y: 48 },
  base: 95,
  squash: true,
  motionBias: ['squash', 'wobble', 'bounce', 'spin'],
  gimmicks: [
    {
      id: 'cloud',
      z: 'face',
      markup:
        `<g transform="translate(1.4 1.6)">${cloudShapes(candy.shade)}</g>` +
        cloudShapes(candy.base) +
        // curls of spun sugar, clear of the face
        line('M29 28Q32 21 40.5 21.5', wisp, 2.4) +
        line('M23 43Q22 35 27 30.5', wisp, 2.2) +
        line('M59 18.5Q66.5 17.5 70.5 23Q72 27 68.5 28', wisp, 2.2) +
        line('M68 63Q73.5 61 75.5 55', candy.shade, 2.2) +
        line('M27.5 56Q30.5 62.5 37.5 63', candy.shade, 2.2),
      anim: [
        { ...R.inflate({ scale: 1.1 }), trigger: ['surprised'], origin: { x: 50, y: 46 } },
        { ...R.deflate({ scale: 0.92, droop: 3 }), trigger: ['sad'], origin: { x: 50, y: 64 } },
        {
          trigger: ['idle'],
          durationMs: 2600,
          loop: true,
          keyframes: [{ t: 0 }, { t: 0.5, sx: 1.03, sy: 1.035 }, { t: 1 }],
          origin: { x: 50, y: 64 },
        },
      ],
    },
    syrupDrop(0, 38),
    syrupDrop(1, 62),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Banana: a chubby, curved banana. When it laughs, the top of its peel opens: the closed tip fades as two
// strips of peel swing out from behind the body, and the fruit shows, the stem on the back strip behind it.

const peel = HAIR.blonde;
const fruit = FUR.cream;
const peelTip = FUR.brown;
const bananaSpine: Spine = [
  [63, 13],
  [36, 48],
  [57, 93],
];
const bananaHalf = (s: number) => 21.5 * profile(s, 1.5, 2.4);
/** Where the peel splits. */
const SPLIT = 0.3;
const side = (s: -1 | 1, s0: number, s1: number, n = 16) => bodySide(bananaSpine, bananaHalf, s, s0, s1, n);
/** The peel's torn edge across the split, from the left to the right: it dips a little in the middle. */
const tornEdge = `Q${P(onSpine(bananaSpine, SPLIT + 0.035, 0))} ${P(onSpine(bananaSpine, SPLIT, -bananaHalf(SPLIT)))}`;
const bananaBody = (() => {
  const l = side(-1, SPLIT, 1, 26);
  const r = side(1, 1, SPLIT, 26);
  const first = l[0] ?? [30, 40];
  // round the bottom end through both sides, then back across the split
  return `M${P(first)}${curveThrough([...l, ...r.slice(1)])}Q${P(onSpine(bananaSpine, SPLIT + 0.035, 0))} ${P(first)}Z`;
})();
/** The closed tip of the peel, above the split. */
const bananaCap = (() => {
  const l = side(-1, 0, SPLIT);
  const r = side(1, SPLIT, 0);
  const first = l[0] ?? [60, 14];
  return `M${P(first)}${curveThrough(l)}${tornEdge}${curveThrough(r)}Z`;
})();
/** The fruit inside, narrower than the peel, from just under the tip into the body. */
const bananaFruit = smoothClosed([
  ...bodySide(bananaSpine, (s) => 0.8 * bananaHalf(s), -1, 0.05, SPLIT + 0.08, 10),
  ...bodySide(bananaSpine, (s) => 0.8 * bananaHalf(s), 1, SPLIT + 0.08, 0.05, 10),
]);
/** The back strip of the peel, behind the fruit, with the stem. */
const bananaBackStrip = smoothClosed([
  ...bodySide(bananaSpine, (s) => 0.52 * bananaHalf(s) + 1.2, -1, 0, SPLIT + 0.05, 8),
  ...bodySide(bananaSpine, (s) => 0.52 * bananaHalf(s) + 1.2, 1, SPLIT + 0.05, 0, 8),
]);
/** A strip of peel that swings out from behind the body: one side of the tip, reaching down into the body. */
const peelStrip = (s: -1 | 1): GimmickDef => {
  const pts = [...side(s, 0.02, SPLIT + 0.1, 14), ...bodySide(bananaSpine, () => 0, s, SPLIT + 0.1, 0.02, 6)];
  const hinge = onSpine(bananaSpine, SPLIT + 0.06, -s * 0.62 * bananaHalf(SPLIT + 0.06));
  return {
    id: s < 0 ? 'peel-left' : 'peel-right',
    z: 'behind',
    markup: path(smoothClosed(pts), s < 0 ? peel.base : peel.shade),
    anim: {
      trigger: ['laugh'],
      durationMs: 900,
      keyframes: [
        { t: 0, ease: 'emphasized' },
        { t: 0.38, rotate: s < 0 ? -152 : 128 },
        { t: 1, rotate: s < 0 ? -144 : 120 },
      ],
      origin: { x: hinge[0], y: hinge[1] },
    },
  };
};
const stemBase = onSpine(bananaSpine, 0.01, 0);
const stemTop = toward(stemBase, 6.2, -55);

const banana: AvatarDef = {
  id: 'banana',
  kind: 'food',
  name: { he: 'בננה', en: 'Banana' },
  tile: TILE.violet,
  layers: {
    back:
      // the stem on the back strip, the fruit in front of it (the cap hides both until the peel opens)
      line(`M${P(stemBase)}L${P(stemTop)}`, peelTip.base, 5.2) +
      ellipse(stemTop[0], stemTop[1], 2.6, 1.6, peelTip.shade, -55) +
      path(bananaBackStrip, peel.shade) +
      path(bananaFruit, fruit.shade) +
      path(bananaFruit, fruit.base, ' transform="translate(-1.2 -0.6)"') +
      // the body below the split: shade, then the lit surface up and left
      shaded(bananaBody, peel.base, peel.shade, -1.6, -1.2) +
      // the flower end
      ellipse(56, 92.2, 3.2, 2.2, peelTip.base, 30) +
      // a ridge down the right side and a shine down the left
      line(
        `M${P(onSpine(bananaSpine, 0.42, -15.5))}Q${P(onSpine(bananaSpine, 0.64, -18.5))} ${P(onSpine(bananaSpine, 0.86, -11))}`,
        peel.shade,
        1.6,
      ) +
      line(
        `M${P(onSpine(bananaSpine, 0.38, 16.5))}Q${P(onSpine(bananaSpine, 0.55, 19))} ${P(onSpine(bananaSpine, 0.72, 16.5))}`,
        peel.light,
        2.6,
      ),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 40.5, y: 55 }, right: { x: 56.5, y: 55 }, r: 5.5, style: 'round' },
    brows: { lift: 1.72, length: 1.7, thickness: 2.2 },
    mouth: { x: 49, y: 68.5, w: 15 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 52, y: 7 },
  },
  pivot: { x: 49, y: 54 },
  base: 94,
  squash: true,
  motionBias: ['squash', 'tilt', 'bounce', 'flip'],
  gimmicks: [
    peelStrip(1),
    peelStrip(-1),
    {
      id: 'tip',
      z: 'back',
      markup:
        shaded(bananaCap, peel.base, peel.shade, -1.6, -1.2) +
        line(
          `M${P(onSpine(bananaSpine, SPLIT + 0.02, 0))}L${P(onSpine(bananaSpine, 0.05, 0.4))}`,
          peel.shade,
          1.2,
        ),
      anim: {
        trigger: ['laugh'],
        durationMs: 900,
        ease: 'linear',
        keyframes: [{ t: 0 }, { t: 0.1, opacity: 0 }, { t: 1, opacity: 0 }],
        origin: { x: 50, y: 30 },
      },
    },
  ],
};

// =========================================================================================================
// ANIMALS
// =========================================================================================================

// ---------------------------------------------------------------------------------------------------------
// Hatchling: a chick peeking out of its cracked egg, the top of the shell still on its head. The shell cap
// lifts when it is surprised and rattles when it is angry; its little wings flap when it laughs.

const shell = OBJECT.cream;
const chick = OBJECT.gold;
const beak = OBJECT.orange;
/** The zigzag crack of the lower shell, left to right. */
const crack: readonly Pt[] = [
  [21.4, 63],
  [26.5, 57.4],
  [31.5, 63.6],
  [37.5, 58],
  [43.5, 64.2],
  [50, 58.4],
  [56.5, 64.2],
  [62.5, 58],
  [68.5, 63.6],
  [73.5, 57.4],
  [78.6, 63],
];
const lowerShell = `M${crack.map(P).join('L')}A28.8 28 0 0 1 21.4 63Z`;
const capShell =
  'M29.5 26A21 17 0 0 1 70.5 26L66.5 29.4L61.5 25.4L56 29.6L50 25.5L44 29.6L38.5 25.4L33.5 29.4Z';
const wing = (s: -1 | 1): GimmickDef => {
  const root: Pt = [50 + s * 21, 61.5];
  return {
    id: s < 0 ? 'wing-left' : 'wing-right',
    markup:
      ellipse(root[0] + s * 4.5, root[1] - 1.2, 6.8, 4.2, chick.shade, s * -28) +
      ellipse(root[0] + s * 4, root[1] - 1.8, 6.2, 3.6, chick.base, s * -28),
    anim: {
      trigger: ['laugh'],
      durationMs: 360,
      loop: true,
      keyframes: [{ t: 0 }, { t: 0.5, rotate: s * -26 }, { t: 1 }],
      origin: { x: root[0], y: root[1] },
    },
  };
};

const hatchling: AvatarDef = {
  id: 'hatchling',
  kind: 'animal',
  name: { he: 'אפרוח בביצה', en: 'Hatchling' },
  tile: TILE.cobalt,
  layers: {
    back:
      // the chick: shade, then the lit surface up and left
      circle(50.6, 46.8, 22.6, chick.shade) +
      circle(49.4, 45.6, 21.6, chick.base) +
      ellipse(33.5, 42, 2.3, 4.6, chick.light, 20) +
      // the beak the mouth sits on
      path('M42 53.3Q50 46.2 58 53.3Q50 61.6 42 53.3Z', beak.shade) +
      path('M42 52.8Q50 46 57.6 52.6Q50 60.6 42 52.8Z', beak.base) +
      // the lower shell: shade, then the lit surface, a shine
      shaded(lowerShell, shell.base, shell.shade, -1.4, -0.6) +
      ellipse(28.5, 75, 2.2, 5.6, shell.light, 14),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 41, y: 44 }, right: { x: 59, y: 44 }, r: 5, style: 'round' },
    brows: { lift: 1.6, length: 1.7, thickness: 2 },
    mouth: { x: 50, y: 53, w: 10.5 },
    cheeks: { color: FACE.blush, dx: 0.7, dy: 1.25, size: 0.75 },
    halo: { x: 50, y: 7 },
  },
  pivot: { x: 50, y: 54 },
  headBox: { x: 17, y: 8, size: 66 },
  base: 94,
  squash: true,
  motionBias: ['bounce', 'squash', 'tilt', 'wobble'],
  gimmicks: [
    wing(-1),
    wing(1),
    {
      id: 'cap',
      markup:
        `<g transform="rotate(-4 50 24)">` +
        path(capShell, shell.shade) +
        path(capShell, shell.base, ' transform="translate(-1.2 -0.8)"') +
        ellipse(37, 18.5, 2, 3.6, shell.light, 40) +
        `</g>`,
      anim: [
        { ...R.lid({ angle: -26, lift: 4 }), trigger: ['surprised'], origin: { x: 69, y: 27 } },
        {
          ...R.lid({ angle: -9, lift: 1.4, ms: 480 }),
          loop: true,
          trigger: ['angry'],
          origin: { x: 69, y: 27 },
        },
      ],
    },
  ],
};

// =========================================================================================================
// OBJECTS
// =========================================================================================================

// ---------------------------------------------------------------------------------------------------------
// Paper clip: a chunky coated clip, its face inside the inner loop. When it is confused, it fidgets: the free
// end of the wire bends out.

const clipWire = OBJECT.blue;
const WIRE = 6.4;
/** The wire, from the inner tip: up, the small top turn, down, the bottom turn, up, the big top turn, down. */
const clipPath = 'M33 66V38A17 17 0 0 1 67 38V70A22.5 22.5 0 0 1 22 70V36A28 28 0 0 1 78 36V53';
const clipEnd = 'M78 52V71';
const wire = (d: string) =>
  `<g transform="translate(0.9 0.9)">${line(d, clipWire.shade, WIRE)}</g>` +
  line(d, clipWire.base, WIRE - 1.4);

const paperClip: AvatarDef = {
  id: 'paper-clip',
  kind: 'object',
  name: { he: 'אטב משרדי', en: 'Paper clip' },
  tile: TILE.mustard,
  layers: {
    back:
      wire(clipPath) +
      // shine along the left lanes
      line('M21.4 66V40', clipWire.light, 1.6) +
      line('M32.4 62V40', clipWire.light, 1.4),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 42.5, y: 44 }, right: { x: 57.5, y: 44 }, r: 4.6, style: 'round' },
    brows: { lift: 1.7, length: 1.8, thickness: 2 },
    mouth: { x: 50, y: 56.5, w: 13 },
    cheeks: { color: FACE.blush, dx: 0.5, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 5.5 },
  },
  pivot: { x: 50, y: 50 },
  base: 93,
  squash: true,
  motionBias: ['wobble', 'squash', 'spin', 'tilt'],
  gimmicks: [
    {
      id: 'free-end',
      z: 'back',
      markup: wire(clipEnd),
      anim: {
        trigger: ['confused'],
        durationMs: 900,
        keyframes: [
          { t: 0, ease: 'emphasized' },
          { t: 0.35, rotate: -34 },
          { t: 0.55, rotate: -22, ease: 'standard' },
          { t: 1, rotate: -28 },
        ],
        origin: { x: 78, y: 52 },
      },
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Eraser: a pink rubber block in its paper sleeve, one corner worn round. When it is sad, it rubs out its own
// mouth (a patch of clean rubber over it, with smudges), and the crumbs fall.

const rubber = FUR.pink;
const sleeve = OBJECT.blue;
const crumbColor = mix(OBJECT.steel.shade, rubber.shade, 0.45);
const smudge = shade(rubber.base, -0.07);
/** The front face, its top-left corner worn round. */
const eraserFront = 'M36 25H67Q71 25 71 29V86Q71 90 67 90H28Q24 90 24 86V37Q24 25 36 25Z';
const eraserTop = 'M36 25Q30 25 28.6 21.2L31.4 18.6Q33 16 36.5 16H75.5Q79.6 16 76.6 19L71 25Z';
const eraserSide = 'M71 25L76.6 19Q79.4 16.6 79.4 20.4V80Q79.4 82.4 77.6 84.2L71 90Z';
const crumb = (i: number, x: number, y: number): GimmickDef => ({
  id: `crumb-${i}`,
  rest: 'hidden',
  markup: ellipse(x, y, 2.4, 1.35, crumbColor, 25 * (i - 1)),
  anim: { ...R.drip({ fall: 27, ms: 1300 }), delayMs: 500 + i * 380, trigger: ['sad'], origin: { x, y } },
});

const eraser: AvatarDef = {
  id: 'eraser',
  kind: 'object',
  name: { he: 'מחק', en: 'Eraser' },
  tile: TILE.jade,
  layers: {
    back:
      // the block: side in shade, the top lit, the front
      path(eraserSide, rubber.shade) +
      path(eraserTop, rubber.light) +
      path(eraserFront, rubber.base) +
      // the sleeve: front and side, a white band, its top edge's shadow on the rubber
      rect(24, 62.4, 47, 1.6, rubber.shade) +
      path('M24 64H71V86Q71 90 67 90H28Q24 90 24 86Z', sleeve.base) +
      path('M71 64L79.4 55.4V80Q79.4 82.4 77.6 84.2L71 90Z', sleeve.shade) +
      rect(24, 71.5, 47, 5, OBJECT.white.base) +
      path('M71 71.5L79.4 62.9V67.9L71 76.5Z', OBJECT.white.shade) +
      // shine on the worn corner
      ellipse(29.2, 34, 1.8, 5, shade(rubber.light, 0.3), 30),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 39.5, y: 40 }, right: { x: 55.5, y: 40 }, r: 5.2, style: 'round' },
    brows: { lift: 1.72, length: 1.7, thickness: 2.2 },
    mouth: { x: 47.5, y: 53, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 7 },
  },
  pivot: { x: 51, y: 53 },
  base: 90,
  squash: true,
  motionBias: ['squash', 'wobble', 'shake', 'bounce'],
  gimmicks: [
    {
      id: 'rub-out',
      rest: 'hidden',
      markup:
        ellipse(47.5, 54.2, 6.6, 4.5, rubber.base) +
        line('M42.6 52.6H50.6', smudge, 1.5) +
        line('M45.4 55.4H52.6', smudge, 1.5) +
        line('M43.4 58H48.4', smudge, 1.3),
      anim: {
        trigger: ['sad'],
        durationMs: 1100,
        keyframes: [
          { t: 0, x: -1.6, opacity: 0, ease: 'linear' },
          { t: 0.14, x: 1.6, opacity: 0.55 },
          { t: 0.28, x: -1.6, opacity: 0.8 },
          { t: 0.42, x: 1.6, opacity: 1 },
          { t: 0.56, x: -1.2 },
          { t: 0.7, x: 0.6, ease: 'standard' },
          { t: 1 },
        ],
        origin: { x: 47.5, y: 54 },
      },
    },
    crumb(0, 44, 58.5),
    crumb(1, 48.5, 59.5),
    crumb(2, 52.5, 58.5),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Push pin: a red push pin stuck in a round cork. When it bounces it digs in on landing (the cork stays on the
// ground while the pin hops, and the needle sinks deeper), throwing up cork crumbs; when angry, it digs in.

const pinPlastic = OBJECT.red;
const needle = OBJECT.steel;
const cork = FUR.tawny;
/** The bounce motion's body track (motion.ts), mirrored: it keeps the cork on the ground while the pin hops. */
const corkKeys: readonly GimmickKeyframe[] = [
  { t: 0, ease: 'standard' },
  { t: 0.28, y: 7, ease: 'exit' },
  { t: 0.52, y: -2.6, ease: 'standard' },
  { t: 0.68, y: 2.5, ease: 'exit' },
  { t: 0.82, y: -3.2, ease: 'standard' },
  { t: 0.9, y: -3.2, ease: 'loop' },
  { t: 1 },
];
const corkBit = (i: number, x: number, dx: number): GimmickDef => ({
  id: `cork-bit-${i}`,
  rest: 'hidden',
  markup: rect(x - 1.6, 79.6, 3.2, 2.6, cork.shade, 0.8),
  anim: {
    trigger: ['bounce'],
    durationMs: 1000,
    keyframes: [
      { t: 0, opacity: 0 },
      { t: 0.5, opacity: 0, ease: 'standard' },
      { t: 0.54, x: dx * 0.3, y: -2, opacity: 1, ease: 'standard' },
      { t: 0.72, x: dx, y: -6, rotate: dx * 12, opacity: 1, ease: 'exit' },
      { t: 0.86, x: dx * 1.3, y: -1, rotate: dx * 20, opacity: 0 },
      { t: 1, opacity: 0 },
    ],
    origin: { x, y: 81 },
  },
});

const pushPin: AvatarDef = {
  id: 'push-pin',
  kind: 'object',
  name: { he: 'נעץ', en: 'Push pin' },
  tile: TILE.cobalt,
  layers: {
    back:
      // the needle, down into the cork
      path('M47.6 66H52.4L51 89.5Q50 92 49 89.5Z', needle.shade) +
      path('M47.6 66H50.6L50 90Q49.4 91.6 49 89.5Z', needle.base) +
      // the base flange
      path('M22.5 64A27.5 5.2 0 0 1 77.5 64V67.4A27.5 5.2 0 0 1 22.5 67.4Z', pinPlastic.shade) +
      ellipse(49.4, 63.6, 26.4, 4.5, pinPlastic.base) +
      // the grip: shade, then the lit surface, a shine
      shaded(
        'M32 18Q31 30 33 40Q35 52 30 61Q50 68 70 61Q65 52 67 40Q69 30 68 18Z',
        pinPlastic.base,
        pinPlastic.shade,
        -1.6,
        -0.6,
      ) +
      ellipse(34.6, 32, 1.8, 7.5, pinPlastic.light, -4) +
      // the cap: its rim, its top, a glint
      path('M24.5 13A25.5 5 0 0 1 75.5 13V18.6A25.5 5 0 0 1 24.5 18.6Z', pinPlastic.shade) +
      path('M24.5 13A25.5 5 0 0 1 72.5 13V18.2A25.5 4.6 0 0 1 24.5 18.2Z', pinPlastic.base) +
      ellipse(50, 13, 25.5, 5, pinPlastic.light) +
      ellipse(40, 12, 7, 1.4, shade(pinPlastic.light, 0.5)),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 42.5, y: 38.5 }, right: { x: 57.5, y: 38.5 }, r: 5, style: 'round' },
    brows: { lift: 1.7, length: 1.7, thickness: 2.1 },
    mouth: { x: 50, y: 51.5, w: 13 },
    cheeks: { color: FACE.blush, dx: 0.5, dy: 1.45, size: 0.75 },
    halo: { x: 50, y: 5.5 },
  },
  pivot: { x: 50, y: 52 },
  base: 93.5,
  squash: false,
  motionBias: ['bounce', 'nod', 'tilt', 'shake'],
  gimmicks: [
    {
      id: 'cork',
      z: 'back',
      markup:
        // a round cork: its side, its top, the hole the needle went in, the grain
        path('M19 82A31 6 0 0 1 81 82V88A31 6 0 0 1 19 88Z', cork.shade) +
        ellipse(50, 82, 31, 6, cork.base) +
        ellipse(48, 81.2, 22, 3.4, cork.light) +
        ellipse(50, 82, 3.4, 1.2, shade(cork.shade, -0.25)) +
        [
          [30, 83.4],
          [37, 80.4],
          [62, 80.6],
          [70, 83.2],
          [56, 84.6],
          [28, 90.4],
          [41, 92.2],
          [61, 92],
          [73, 89.6],
        ]
          .map(([x, y]) => circle(x ?? 0, y ?? 0, 0.9, shade(cork.shade, -0.12)))
          .join(''),
      anim: [
        { trigger: ['bounce'], durationMs: 1000, keyframes: corkKeys, origin: { x: 50, y: 82 } },
        {
          trigger: ['angry'],
          durationMs: 700,
          keyframes: [
            { t: 0, ease: 'exit' },
            { t: 0.3, y: -3.4, ease: 'standard' },
            { t: 1, y: -3 },
          ],
          origin: { x: 50, y: 82 },
        },
      ],
    },
    corkBit(0, 46, -6),
    corkBit(1, 54, 6),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Calculator: a desk calculator whose display draws its own mouth in LCD segments (`mouth: false` and
// `face.art`). Its keys tap away when it is idle or confused, and a paper tape prints out of its top when it
// laughs or is surprised.

const calcBody = OBJECT.cream;
const bezel = CLOTH.charcoal;
const lcd = {
  base: mix(OBJECT.green.light, OBJECT.cream.base, 0.55),
  shade: mix(OBJECT.green.base, OBJECT.cream.shade, 0.5),
};
const lcdInk = shade(OBJECT.green.shade, -0.62);
/** A segment: a bar from `a` to `b` with bevelled ends, like one stroke of an LCD digit. */
const SEG = 2.1;
const bar = (a: Pt, b: Pt, t = SEG): string => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const n: Pt = [-u[1], u[0]];
  const k = Math.min(t / 2, len / 2);
  const q = (p: Pt, du: number, dn: number): Pt => [
    p[0] + u[0] * du + n[0] * dn,
    p[1] + u[1] * du + n[1] * dn,
  ];
  const pts = [a, q(a, k, t / 2), q(b, -k, t / 2), b, q(b, -k, -t / 2), q(a, k, -t / 2)];
  return path(`M${pts.map(P).join('L')}Z`, lcdInk);
};
/** The display's digit box: left, right, top, middle, bottom. */
const box = { l: 43.2, r: 56.8, t: 42.6, m: 47.4, b: 52.2 };
const gap = 0.45;
const SEGMENTS: Record<'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g', readonly [Pt, Pt]> = {
  a: [
    [box.l + gap, box.t],
    [box.r - gap, box.t],
  ],
  b: [
    [box.r, box.t + gap],
    [box.r, box.m - gap],
  ],
  c: [
    [box.r, box.m + gap],
    [box.r, box.b - gap],
  ],
  d: [
    [box.l + gap, box.b],
    [box.r - gap, box.b],
  ],
  e: [
    [box.l, box.m + gap],
    [box.l, box.b - gap],
  ],
  f: [
    [box.l, box.t + gap],
    [box.l, box.m - gap],
  ],
  g: [
    [box.l + gap, box.m],
    [box.r - gap, box.m],
  ],
};
const digit = (lit: readonly (keyof typeof SEGMENTS)[]) => lit.map((s) => bar(...SEGMENTS[s])).join('');
const display: Record<Expression, string> = {
  neutral: digit(['g']),
  smile: digit(['e', 'd', 'c']),
  laugh: path(
    `M${P([box.l - 1, box.m - 1.6])}H${f(box.r + 1)}V${f(box.m + 0.6)}L${P([box.r - 2.6, box.b + 1])}` +
      `H${f(box.l + 2.6)}L${P([box.l - 1, box.m + 0.6])}Z`,
    lcdInk,
  ),
  wink: digit(['d', 'c']) + bar([box.l - 1.4, box.b - 1.6], [box.l + gap, box.b]),
  surprised:
    bar([46.6, box.t], [53.4, box.t]) +
    bar([46.6, box.b], [53.4, box.b]) +
    bar([46.1, box.t + gap], [46.1, box.b - gap]) +
    bar([53.9, box.t + gap], [53.9, box.b - gap]),
  sad: digit(['a', 'f', 'b']),
  confused:
    bar([box.l, box.b - 1.4], [49.4, box.b - 1.4]) +
    bar([50.6, box.m - 0.2], [box.r, box.m - 0.2]) +
    bar([50, box.m + 0.5], [50, box.b - 2.1]),
  dizzy:
    bar([box.l - 0.6, 49.4], [46, 46]) +
    bar([46, 46], [49, 49.6]) +
    bar([49, 49.6], [52, 46]) +
    bar([52, 46], [55, 49.6]) +
    bar([55, 49.6], [box.r + 0.6, 47.6]),
  angry: digit(['a', 'b', 'c', 'd', 'e', 'f', 'g']),
  sleepy: rect(48.9, box.b - 1.1, 2.2, 2.2, lcdInk),
};
const KEY_X = [24.5, 37, 49.5, 62] as const;
const KEY_Y = [60.5, 71, 81.5] as const;
const KEY_W = 10.5;
const numKey = OBJECT.white;
const opKey = OBJECT.orange;
/** The keys that tap (gimmicks), as [column, row]: the layers draw only their depth. */
const TAPPING: readonly (readonly [number, number])[] = [
  [1, 1],
  [0, 2],
  [3, 2],
];
const keyDepth = (x: number, y: number, depth: string) => rect(x, y + 1.2, KEY_W, 7.6, depth, 2);
const keyTop = (x: number, y: number, top: string) => rect(x, y, KEY_W, 7.4, top, 2);
/** The symbols on the orange keys (plus, minus, equals), drawn on the key whose top-left is (x, y). */
const opSymbol = (which: '+' | '-' | '=', x: number, y: number) => {
  const x0 = f(x + 3.3);
  const x1 = f(x + KEY_W - 3.3);
  const d =
    which === '+'
      ? `M${x0} ${f(y + 3.7)}H${x1}M${f(x + KEY_W / 2)} ${f(y + 1.75)}V${f(y + 5.65)}`
      : which === '-'
        ? `M${x0} ${f(y + 3.7)}H${x1}`
        : `M${x0} ${f(y + 2.6)}H${x1}M${x0} ${f(y + 4.8)}H${x1}`;
  return line(d, OBJECT.white.base, 1.4);
};
/** A key that taps down and back now and then (its top covers its own depth when pressed). */
const keyTap = (id: string, x: number, y: number, top: string, delayMs: number, symbol = ''): GimmickDef => ({
  id,
  z: 'back',
  markup: keyTop(x, y, top) + symbol,
  anim: {
    trigger: ['idle', 'confused'],
    durationMs: 1800,
    delayMs,
    loop: true,
    keyframes: [{ t: 0 }, { t: 0.06, y: 1.2 }, { t: 0.14, y: 1.2 }, { t: 0.22 }, { t: 1 }],
    origin: { x: x + KEY_W / 2, y },
  },
});
const tapeTear = 'M30.5 34V18.4L32.5 16.7L34.5 18.4L36.5 16.7L38.5 18.4L40.5 16.7L42.5 18.4L44.5 16.7V34Z';

const calculator: AvatarDef = {
  id: 'calculator',
  kind: 'object',
  name: { he: 'מחשבון', en: 'Calculator' },
  tile: TILE.tangerine,
  layers: {
    back:
      // the body: shade, then the lit surface up and left
      rect(20.4, 17.6, 61, 77, calcBody.shade, 9) +
      rect(19, 16.4, 60.6, 76.2, calcBody.base, 9) +
      // the solar cell
      rect(50.5, 20.6, 24, 4.6, bezel.base, 1.4) +
      rect(58.4, 20.6, 0.7, 4.6, bezel.light) +
      rect(66.4, 20.6, 0.7, 4.6, bezel.light) +
      // the display: a sunken bezel, the screen and its shade along the top
      rect(23.5, 28.2, 51, 28.6, bezel.base, 4.5) +
      rect(25.5, 30.2, 47, 24.6, lcd.base, 3) +
      rect(25.5, 30.2, 47, 2, lcd.shade, 1) +
      // the keys: numbers in white, the last column orange, with their symbols (the tapping ones' tops
      // are gimmicks)
      KEY_Y.map((y, row) =>
        KEY_X.map((x, col) => {
          const k = col === 3 ? opKey : numKey;
          const taps = TAPPING.some(([c, r]) => c === col && r === row);
          return keyDepth(x, y, k.shade) + (taps ? '' : keyTop(x, y, k.base));
        }).join(''),
      ).join('') +
      opSymbol('+', KEY_X[3], KEY_Y[0]) +
      opSymbol('-', KEY_X[3], KEY_Y[1]) +
      // shine
      rect(21.6, 30, 1.8, 24, calcBody.light, 0.9),
  },
  face: {
    ink: lcdInk,
    eyes: { left: { x: 42, y: 36.6 }, right: { x: 58, y: 36.6 }, r: 3.8, style: 'dot' },
    brows: false,
    mouth: false,
    art: { default: display.neutral, ...display },
    halo: { x: 50, y: 9 },
  },
  pivot: { x: 50, y: 54 },
  base: 93,
  squash: true,
  motionBias: ['shake', 'bounce', 'squash', 'tilt'],
  gimmicks: [
    {
      id: 'tape',
      z: 'behind',
      markup:
        path(tapeTear, OBJECT.white.shade, ' transform="translate(0.8 0.4)"') +
        path(tapeTear, OBJECT.white.base) +
        rect(33, 20.5, 9, 1.1, OBJECT.steel.base, 0.5) +
        rect(33, 23.3, 6, 1.1, OBJECT.steel.base, 0.5) +
        rect(33, 26.1, 8, 1.1, OBJECT.steel.base, 0.5),
      anim: {
        trigger: ['laugh', 'surprised'],
        durationMs: 1400,
        keyframes: [
          { t: 0, ease: 'standard' },
          { t: 0.12, y: -3.6 },
          { t: 0.3, y: -3.6, ease: 'standard' },
          { t: 0.42, y: -7.2 },
          { t: 0.6, y: -7.2, ease: 'standard' },
          { t: 0.72, y: -10.8 },
          { t: 1, y: -10.8 },
        ],
        origin: { x: 37.5, y: 34 },
      },
    },
    keyTap('key-a', KEY_X[1], KEY_Y[1], numKey.base, 0),
    keyTap('key-b', KEY_X[0], KEY_Y[2], numKey.base, 600),
    keyTap('key-c', KEY_X[3], KEY_Y[2], opKey.base, 1200, opSymbol('=', KEY_X[3], KEY_Y[2])),
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Tape roll: a roll of masking tape lying on its side, the face on its outer wall. Its loose end sways when it
// idles, and unrolls and flutters when it spins.

const tapeWall = {
  base: mix(FUR.cream.base, FUR.golden.base, 0.28),
  shade: mix(FUR.cream.shade, FUR.golden.shade, 0.4),
  light: mix(FUR.cream.light, FUR.golden.light, 0.2),
};
const tapeTop = mix(FUR.cream.base, FUR.golden.base, 0.12);
const tapeLayer = mix(FUR.cream.shade, FUR.golden.base, 0.2);
const core = FUR.tawny;
const wallShape = 'M13 31A37 13 0 0 1 87 31V68A37 13 0 0 1 13 68Z';
const looseEnd =
  'M70.6 72.4Q78.5 70 83.2 66.4L84.6 92L82.4 90.4L80.6 92.6L78.6 90.6L76.6 92.8L74.6 90.6L72.6 92.6Z';

const tapeRoll: AvatarDef = {
  id: 'tape-roll',
  kind: 'object',
  name: { he: 'נייר דבק', en: 'Tape roll' },
  tile: TILE.teal,
  layers: {
    back:
      // the wall: shade, then the lit surface up and left
      path(wallShape, tapeWall.shade) +
      path(wallShape, tapeWall.base, ' transform="translate(-1.8 -0.6)"') +
      // the top: wound layers of tape, the cardboard core and the deep hole
      ellipse(48.6, 30.6, 35.2, 12.4, tapeTop) +
      `<ellipse cx="48.6" cy="30.6" rx="30.5" ry="10.7" fill="none" stroke="${tapeLayer}" stroke-width="0.9"/>` +
      `<ellipse cx="48.6" cy="30.6" rx="25.5" ry="9" fill="none" stroke="${tapeLayer}" stroke-width="0.9"/>` +
      ellipse(48.6, 30.6, 19.5, 7, core.light) +
      ellipse(48.6, 30.7, 16.4, 5.8, shade(core.shade, -0.4)) +
      path('M32.2 30.7A16.4 5.8 0 0 1 65 30.7A16.4 3.6 0 0 0 32.2 30.7Z', core.shade) +
      // a shine on the wall
      ellipse(17.6, 48, 1.8, 7, tapeWall.light, 4),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 40.5, y: 57 }, right: { x: 57.5, y: 57 }, r: 5.3, style: 'round' },
    brows: { lift: 1.7, length: 1.7, thickness: 2.2 },
    mouth: { x: 49, y: 70.5, w: 14 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 49, y: 8 },
  },
  pivot: { x: 49, y: 50 },
  base: 81,
  squash: true,
  motionBias: ['spin', 'squash', 'wobble', 'bounce'],
  gimmicks: [
    {
      id: 'loose-end',
      markup: path(looseEnd, tapeWall.shade, ' transform="translate(0.8 0.4)"') + path(looseEnd, tapeTop),
      anim: [
        {
          trigger: ['spin'],
          durationMs: 1300,
          keyframes: [
            { t: 0, ease: 'exit' },
            { t: 0.3, sy: 1.35, rotate: 14 },
            { t: 0.5, sy: 1.5, rotate: -10 },
            { t: 0.7, sy: 1.4, rotate: 8 },
            { t: 0.85, sy: 1.2, rotate: -3, ease: 'standard' },
            { t: 1 },
          ],
          origin: { x: 77, y: 69 },
        },
        { ...R.sway({ angle: 4, ms: 2600 }), trigger: ['idle', 'dizzy'], origin: { x: 77, y: 69 } },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------------------------------------
// Scissors: lying on the diagonal like ✂, the face on the round plastic hub where the blades cross. The two
// halves snip when it laughs (fast when angry) and now and then when it idles: each half turns on the hub,
// its blade and its finger loop together.

const handle = OBJECT.green;
const blade = OBJECT.steel;
const HUB: Pt = [47, 55];
/** The blades point up and to the right; each half is OPEN degrees off that line. */
const AXIS = -42;
const OPEN = 11;
const BLADE = 48;
/**
 * One half: `s` = −1 has the upper blade and the lower loop, +1 the lower blade and the upper loop. Its blade
 * is drawn along +x and turned into place; its cutting edge faces the other blade.
 */
const scissorHalf = (s: -1 | 1): string => {
  const bladeAngle = AXIS + s * OPEN;
  const edge = -s; // in the blade's own frame, +y faces the other blade for the upper one
  const [hx, hy] = HUB;
  const bladePath =
    `M${P([hx + 4, hy + edge * 1.6])}L${P([hx + BLADE, hy + edge * 0.6])}` +
    `Q${P([hx + BLADE - 9, hy - edge * 4.6])} ${P([hx + 22, hy - edge * 5.4])}L${P([hx + 4, hy - edge * 5.2])}Z`;
  const bevel = `M${P([hx + 14, hy + edge * 1.5])}L${P([hx + BLADE - 3, hy + edge * 0.7])}L${P([hx + BLADE - 6, hy - edge * 0.9])}L${P([hx + 14, hy - edge * 0.6])}Z`;
  const loopAngle = 135 - s * 25;
  const loop = toward(HUB, 30, loopAngle);
  const armEnd = toward(HUB, 23, loopAngle);
  return (
    `<g transform="rotate(${f(bladeAngle)} ${P(HUB)})">` +
    path(bladePath, blade.shade) +
    path(bladePath, blade.base, ` transform="translate(-0.6 ${f(-edge * 0.6)})"`) +
    path(bevel, blade.light) +
    `</g>` +
    line(`M${P(HUB)}L${P([armEnd[0] + 0.5, armEnd[1] + 0.5])}`, handle.shade, 8.6) +
    line(`M${P(HUB)}L${P(armEnd)}`, handle.base, 6.4) +
    ring([loop[0] + 0.7, loop[1] + 0.7], 7.4, 4.8, handle.shade) +
    ring(loop, 7.4, 4, handle.base)
  );
};
const snip = (s: -1 | 1): GimmickDef => ({
  id: s < 0 ? 'half-upper' : 'half-lower',
  z: 'behind',
  markup: scissorHalf(s),
  anim: [
    {
      trigger: ['laugh'],
      durationMs: 640,
      loop: true,
      keyframes: [{ t: 0 }, { t: 0.4, rotate: -s * OPEN }, { t: 0.75 }, { t: 1 }],
      origin: { x: HUB[0], y: HUB[1] },
    },
    {
      trigger: ['angry'],
      durationMs: 380,
      loop: true,
      keyframes: [{ t: 0 }, { t: 0.45, rotate: -s * OPEN * 0.85 }, { t: 0.9 }, { t: 1 }],
      origin: { x: HUB[0], y: HUB[1] },
    },
    {
      trigger: ['idle'],
      durationMs: 3200,
      loop: true,
      keyframes: [{ t: 0 }, { t: 0.78 }, { t: 0.85, rotate: -s * OPEN }, { t: 0.93 }, { t: 1 }],
      origin: { x: HUB[0], y: HUB[1] },
    },
  ],
});

const scissors: AvatarDef = {
  id: 'scissors',
  kind: 'object',
  name: { he: 'מספריים', en: 'Scissors' },
  tile: TILE.coral,
  layers: {
    back:
      // the hub: shade, then the lit surface up and left, a shine
      circle(HUB[0] + 0.9, HUB[1] + 0.9, 19.6, handle.shade) +
      circle(HUB[0] - 0.4, HUB[1] - 0.4, 18.9, handle.base) +
      line(`M${P(toward(HUB, 16.2, 188))}A16.2 16.2 0 0 1 ${P(toward(HUB, 16.2, 232))}`, handle.light, 2.4),
  },
  face: {
    ink: FACE.ink,
    eyes: { left: { x: 39.5, y: 52.5 }, right: { x: 54.5, y: 52.5 }, r: 4.8, style: 'round' },
    brows: { lift: 1.72, length: 1.7, thickness: 2.2 },
    mouth: { x: 47, y: 64.5, w: 13 },
    cheeks: { color: FACE.blush, dx: 0.55, dy: 1.45, size: 0.75 },
    halo: { x: 47, y: 7 },
  },
  pivot: { x: HUB[0], y: HUB[1] },
  base: 92,
  squash: false,
  motionBias: ['spin', 'bounce', 'tilt', 'shake'],
  gimmicks: [snip(1), snip(-1)],
};

export const OFFICE: readonly AvatarDef[] = [
  pickle,
  cottonCandy,
  banana,
  hatchling,
  paperClip,
  eraser,
  pushPin,
  calculator,
  tapeRoll,
  scissors,
];
