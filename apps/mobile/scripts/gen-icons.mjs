// Builds the app's first icon set (work plan stage 14) into assets/brand/: the iOS icon, the Android adaptive
// icon's foreground and its monochrome (themed) layer, the splash mark, and the Play listing's hi-res icon and
// feature graphic. Each one is written twice from the same shapes: as SVG (the source a designer opens) and as
// PNG (what Expo reads). Colours come from docs/design/tokens.json (direction C, "Calm Night").
//
// The mark: a 3×3 board fragment in the board's cell colour, two corner cells owned by P1 and P2 (their ring
// colours), and the gold bolt of the "interfere" icon (Icon.tsx) cutting through it, edged in the background
// colour so it reads on the white cells at 48 px.
//
// No installs: pngjs comes with expo-splash-screen (@expo/image-utils → parse-png), and the shapes are drawn
// here, anti-aliased from their signed distance (a one-pixel coverage ramp along every edge). No randomness,
// so a re-run draws the same pixels. A designer's files can replace these: docs/store/ASSETS.md.
//   npm run icons -w @sudoku-fight/mobile        (or: node apps/mobile/scripts/gen-icons.mjs [--out <dir>])
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');

const here = dirname(fileURLToPath(import.meta.url));
const TOKENS = join(here, '..', '..', '..', 'docs', 'design', 'tokens.json');
export const OUT = join(here, '..', 'assets', 'brand');

const { color } = JSON.parse(readFileSync(TOKENS, 'utf8'));
const [P1, P2, P3, P4] = color.players;

/** Android's adaptive icon: a 108 dp layer, whose 66 dp circle is never masked away (the safe zone). */
export const ADAPTIVE_SAFE_RADIUS = (1024 * 33) / 108;

// ---- shapes: geometry, signed distance (negative inside), bounds, SVG ----

const rrect = (x, y, w, h, r) => ({ kind: 'rrect', x, y, w, h, r });
const circle = (cx, cy, r) => ({ kind: 'circle', cx, cy, r });
/** A polygon, grown outward by `grow` (a round-cornered edge around it). */
const poly = (pts, grow = 0) => ({ kind: 'poly', pts, grow });

function distance(s, x, y) {
  if (s.kind === 'circle') return Math.hypot(x - s.cx, y - s.cy) - s.r;
  if (s.kind === 'rrect') {
    const hx = s.w / 2;
    const hy = s.h / 2;
    const qx = Math.abs(x - s.x - hx) - (hx - s.r);
    const qy = Math.abs(y - s.y - hy) - (hy - s.r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - s.r;
  }
  let d = Infinity;
  let inside = false;
  const { pts } = s;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j];
    const [bx, by] = pts[i];
    const ex = bx - ax;
    const ey = by - ay;
    const wx = x - ax;
    const wy = y - ay;
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    d = Math.min(d, Math.hypot(wx - ex * t, wy - ey * t));
    if (ay > y !== by > y && x < ax + ((y - ay) * ex) / ey) inside = !inside;
  }
  return (inside ? -d : d) - s.grow;
}

/** [left, top, right, bottom]. */
function bounds(s) {
  if (s.kind === 'circle') return [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r];
  if (s.kind === 'rrect') return [s.x, s.y, s.x + s.w, s.y + s.h];
  const xs = s.pts.map((p) => p[0]);
  const ys = s.pts.map((p) => p[1]);
  return [
    Math.min(...xs) - s.grow,
    Math.min(...ys) - s.grow,
    Math.max(...xs) + s.grow,
    Math.max(...ys) + s.grow,
  ];
}

/** The farthest any point of the shape lies from (0, 0). */
function reach(s) {
  if (s.kind === 'circle') return Math.hypot(s.cx, s.cy) + s.r;
  if (s.kind === 'rrect') {
    const corners = [
      [s.x + s.r, s.y + s.r],
      [s.x + s.w - s.r, s.y + s.r],
      [s.x + s.r, s.y + s.h - s.r],
      [s.x + s.w - s.r, s.y + s.h - s.r],
    ];
    return Math.max(...corners.map(([x, y]) => Math.hypot(x, y))) + s.r;
  }
  return Math.max(...s.pts.map(([x, y]) => Math.hypot(x, y))) + s.grow;
}

/** The shape scaled by `k` about (0, 0), then moved by (dx, dy). */
function place(s, k, dx, dy) {
  if (s.kind === 'circle') return circle(s.cx * k + dx, s.cy * k + dy, s.r * k);
  if (s.kind === 'rrect') return rrect(s.x * k + dx, s.y * k + dy, s.w * k, s.h * k, s.r * k);
  return poly(
    s.pts.map(([x, y]) => [x * k + dx, y * k + dy]),
    s.grow * k,
  );
}

const n = (v) => String(Math.round(v * 100) / 100);

function shapeSvg(s, fill) {
  if (s.kind === 'circle') return `<circle cx="${n(s.cx)}" cy="${n(s.cy)}" r="${n(s.r)}" fill="${fill}"/>`;
  if (s.kind === 'rrect')
    return `<rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" rx="${n(s.r)}" fill="${fill}"/>`;
  const d = `M${s.pts.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}Z`;
  // A round-joined stroke of twice the growth, under the fill, is the same shape as the distance field's.
  const edge = s.grow > 0 ? ` stroke="${fill}" stroke-width="${n(s.grow * 2)}" stroke-linejoin="round"` : '';
  return `<path d="${d}" fill="${fill}"${edge}/>`;
}

// ---- the mark, in units: the board fragment spans -50..50 ----

const GAP = 4;
const CELL = (100 - 2 * GAP) / 3;
const CELL_RADIUS = 4;
/** The background-coloured edge that keeps the bolt off the white cells. */
const BOLT_EDGE = 5;
/** Icon.tsx's "bolt" (24×24 box, centred on 11.5, 12) and its scale over the board. */
const BOLT = [
  [13, 2],
  [4, 14],
  [11, 14],
  [10, 22],
  [19, 10],
  [12, 10],
];
const BOLT_SCALE = 5.5;

/**
 * The mark's layers, bottom first. `mono`: one colour, for Android's themed icons, which keep only the alpha:
 * the bolt's edge is cut out of the board instead of painted.
 */
export function mark({ mono = false } = {}) {
  const ink = color.text;
  const layers = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const owner = row === 0 && col === 0 ? P1.ring : row === 2 && col === 2 ? P2.ring : color.board.cell;
      const at = (i) => -50 + i * (CELL + GAP);
      layers.push({ shape: rrect(at(col), at(row), CELL, CELL, CELL_RADIUS), fill: mono ? ink : owner });
    }
  }
  const bolt = BOLT.map(([x, y]) => [(x - 11.5) * BOLT_SCALE, (y - 12) * BOLT_SCALE]);
  const edge = poly(bolt, BOLT_EDGE);
  layers.push(mono ? { shape: edge, erase: true } : { shape: edge, fill: color.bg });
  layers.push({ shape: poly(bolt), fill: mono ? ink : color.accent });
  return layers;
}

/** How far the mark reaches from its centre, in units. */
export const MARK_REACH = Math.max(...mark().map((l) => reach(l.shape)));

/** Four seat shapes (tokens' shapePath, 24×24 box centred on 12, 12) in their ring colours. */
function seat(index) {
  const c = (pts) => pts.map(([x, y]) => [x - 12, y - 12]);
  const shapes = [
    circle(0, 0, 8),
    poly(
      c([
        [12, 4],
        [20, 19],
        [4, 19],
      ]),
    ),
    rrect(-7, -7, 14, 14, 0),
    poly(
      c([
        [12, 3],
        [21, 12],
        [12, 21],
        [3, 12],
      ]),
    ),
  ];
  return { shape: shapes[index], fill: [P1, P2, P3, P4][index].ring };
}

const placeAll = (layers, k, dx, dy) => layers.map((l) => ({ ...l, shape: place(l.shape, k, dx, dy) }));

// ---- the files ----

/**
 * Every file: its size, background (null: transparent), alpha channel, and layers in pixels.
 * - icon: iOS (and the default). Opaque, no alpha channel, square corners: Apple rounds them.
 * - adaptive-foreground / adaptive-monochrome: Android 8+ and 13+ (themed icons); the mark stays inside the
 *   safe zone, the background colour is app.json's adaptiveIcon.backgroundColor.
 * - splash-mark: expo-splash-screen's image, inside its inscribed circle (Android 12+ shows the splash icon in
 *   a circle; with imageWidth ≤ 192 dp nothing is cut).
 * - play-icon-512: the Play listing's hi-res icon (32-bit PNG, full square: Play rounds it).
 * - feature-graphic: the Play listing's 1024×500 banner (24-bit PNG), the mark between the four seat shapes.
 */
export function files() {
  const iconScale = 6.2;
  const adaptive = (ADAPTIVE_SAFE_RADIUS - 12) / MARK_REACH;
  return [
    {
      name: 'icon',
      w: 1024,
      h: 1024,
      bg: color.bg,
      alpha: false,
      layers: placeAll(mark(), iconScale, 512, 512),
    },
    {
      name: 'adaptive-foreground',
      w: 1024,
      h: 1024,
      bg: null,
      alpha: true,
      layers: placeAll(mark(), adaptive, 512, 512),
    },
    {
      name: 'adaptive-monochrome',
      w: 1024,
      h: 1024,
      bg: null,
      alpha: true,
      layers: placeAll(mark({ mono: true }), adaptive, 512, 512),
    },
    {
      name: 'splash-mark',
      w: 1024,
      h: 1024,
      bg: null,
      alpha: true,
      layers: placeAll(mark(), (512 - 16) / MARK_REACH, 512, 512),
    },
    {
      name: 'play-icon-512',
      w: 512,
      h: 512,
      bg: color.bg,
      alpha: true,
      svg: false,
      layers: placeAll(mark(), iconScale / 2, 256, 256),
    },
    {
      name: 'feature-graphic',
      w: 1024,
      h: 500,
      bg: color.bg,
      alpha: false,
      layers: [
        ...placeAll(mark(), 2.9, 512, 250),
        ...[0, 1, 2, 3].map((i) => {
          const x = [172, 304, 720, 852][i];
          const l = seat(i);
          return { ...l, shape: place(l.shape, 3.2, x, 250) };
        }),
      ],
    },
  ];
}

/** Straight RGBA bytes. Layers composite over the background with their edge coverage; `erase` cuts out. */
export function render({ w, h, bg, layers }) {
  const px = new Float64Array(w * h * 4); // premultiplied, 0..255
  if (bg) {
    const [r, g, b] = rgb(bg);
    for (let i = 0; i < px.length; i += 4) px.set([r, g, b, 1], i);
  }
  for (const layer of layers) {
    const [r, g, b] = layer.erase ? [0, 0, 0] : rgb(layer.fill);
    const [l, t, rt, bt] = bounds(layer.shape);
    const x0 = Math.max(0, Math.floor(l) - 1);
    const y0 = Math.max(0, Math.floor(t) - 1);
    const x1 = Math.min(w, Math.ceil(rt) + 1);
    const y1 = Math.min(h, Math.ceil(bt) + 1);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const a = Math.max(0, Math.min(1, 0.5 - distance(layer.shape, x + 0.5, y + 0.5)));
        if (a === 0) continue;
        const i = (y * w + x) * 4;
        const keep = 1 - a;
        if (layer.erase) {
          for (let c = 0; c < 4; c++) px[i + c] *= keep;
        } else {
          px[i] = r * a + px[i] * keep;
          px[i + 1] = g * a + px[i + 1] * keep;
          px[i + 2] = b * a + px[i + 2] * keep;
          px[i + 3] = a + px[i + 3] * keep;
        }
      }
    }
  }
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    out[i + 3] = Math.round(a * 255);
    if (out[i + 3] === 0) continue;
    for (let c = 0; c < 3; c++) out[i + c] = Math.round(Math.min(255, px[i + c] / a));
  }
  return out;
}

export function png(file) {
  const image = new PNG({ width: file.w, height: file.h });
  image.data = render(file);
  // Colour type 6 is RGBA; 2 is RGB, with no alpha channel at all (the App Store refuses one in the icon).
  return PNG.sync.write(image, { colorType: file.alpha ? 6 : 2, inputHasAlpha: true, deflateLevel: 9 });
}

export function svg({ name, w, h, bg, layers }) {
  let body = bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : '';
  let defs = '';
  layers.forEach((layer, i) => {
    if (!layer.erase) {
      body += shapeSvg(layer.shape, layer.fill);
      return;
    }
    // A cut-out: everything drawn so far goes under a mask that is opaque except for the shape.
    const id = `cut${i}`;
    defs +=
      `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">` +
      `<rect width="${w}" height="${h}" fill="#fff"/>${shapeSvg(layer.shape, '#000')}</mask>`;
    body = `<g mask="url(#${id})">${body}</g>`;
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n` +
    `<!-- Sudoku Fight: ${name}. Generated by apps/mobile/scripts/gen-icons.mjs (docs/store/ASSETS.md). -->\n` +
    (defs ? `<defs>${defs}</defs>\n` : '') +
    `${body}\n</svg>\n`
  );
}

function rgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf('--out');
  const out = at > 0 && process.argv[at + 1] ? resolve(process.argv[at + 1]) : OUT;
  mkdirSync(out, { recursive: true });
  for (const file of files()) {
    const bytes = png(file);
    writeFileSync(join(out, `${file.name}.png`), bytes);
    if (file.svg !== false) writeFileSync(join(out, `${file.name}.svg`), svg(file));
    console.log(`${file.name}.png  ${file.w}×${file.h}  ${(bytes.length / 1024).toFixed(1)} KB`);
  }
  console.log(`Written to ${out}`);
}
