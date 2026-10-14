// Builds the app's icon set into assets/brand/: design "B · Tile Clash", Moshe's choice of 2026-10-14 from the
// icon canvas (docs/store/ASSETS.md). The iOS icon, the Android adaptive icon's three layers (background,
// foreground, and the monochrome one of themed icons), the splash mark, the Play listing's hi-res icon and
// feature graphic, and tile-clash.svg, the master drawing (background and mark as two groups). Every file is
// written as SVG (what a designer opens) and PNG (what Expo and the stores read), both from the shapes below,
// and docs/brand/icon-preview.html shows them all as phones and stores do (lib/icon-preview.mjs).
//
// The mark: a blue "5" tile tilted left and an orange "9" tile tilted right, clashing, and the spark's bolt
// striking between them, edged in the background colour so it stays apart from both tiles. On a navy ground
// with a faint 3×3 grid. Colours: tokens.json's color.brand (bg, grid, blue, orange, spark, digit). The digits
// are Rubik, the app's font, in its heaviest weight (900 Black, @expo-google-fonts/rubik), read from the font as
// outlines (lib/ttf.mjs): the SVG files hold paths, not text, and need no font.
//
// No installs: pngjs comes with expo-splash-screen (@expo/image-utils → parse-png), and each shape is drawn
// here, anti-aliased from its signed distance (a one-pixel coverage ramp along every edge), curves flattened to
// within 1/50 px. No randomness, no dates: a re-run writes the same bytes.
//   npm run icons -w @sudoku-fight/mobile        (or: node apps/mobile/scripts/gen-icons.mjs [--out <dir>])
// --out writes the brand files to another directory, and no preview page.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { previewHtml } from './lib/icon-preview.mjs';
import { loadFont } from './lib/ttf.mjs';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..');
const TOKENS = join(ROOT, 'docs', 'design', 'tokens.json');
export const OUT = join(here, '..', 'assets', 'brand');
export const PREVIEW = join(ROOT, 'docs', 'brand', 'icon-preview.html');
const FONT = require.resolve('@expo-google-fonts/rubik/900Black/Rubik_900Black.ttf');

const { color } = JSON.parse(readFileSync(TOKENS, 'utf8'));
const { brand } = color;

/** Android's adaptive icon: a 108 dp layer. A mask shows its middle 72 dp, and never cuts the 66 dp circle. */
export const LAYER = 1024;
export const VIEWPORT = (LAYER * 72) / 108;
export const ADAPTIVE_SAFE_RADIUS = (LAYER * 33) / 108;

// ---- shapes: geometry, signed distance (negative inside), bounds, SVG ----

/** A rounded rectangle centred on (cx, cy), turned `angle` degrees clockwise about its centre. */
const rrect = (cx, cy, w, h, r, angle = 0) => ({ kind: 'rrect', cx, cy, w, h, r, angle });
const circle = (cx, cy, r) => ({ kind: 'circle', cx, cy, r });
/** A path: ['M', x, y], ['L', x, y], ['Q', cx, cy, x, y], ['Z']; filled nonzero, grown outward by `grow`. */
const path = (cmds, grow = 0) => ({ kind: 'path', cmds, grow });
const poly = (pts, grow = 0) =>
  path([['M', ...pts[0]], ...pts.slice(1).map((p) => ['L', ...p]), ['Z']], grow);

/** How far a flattened curve may stray from the true one, in pixels. */
const FLATNESS = 0.02;
const flattened = new WeakMap();

/** A path's contours as polygons (each Q split into enough lines to stay within FLATNESS). */
function contours(s) {
  let out = flattened.get(s);
  if (out) return out;
  out = [];
  let current = null;
  let [x, y] = [0, 0];
  for (const c of s.cmds) {
    if (c[0] === 'M') {
      current = [[c[1], c[2]]];
      out.push(current);
      [x, y] = [c[1], c[2]];
    } else if (c[0] === 'L') {
      current.push([c[1], c[2]]);
      [x, y] = [c[1], c[2]];
    } else if (c[0] === 'Q') {
      const [, qx, qy, ex, ey] = c;
      // A quadratic's distance from its chords, n of them, is at most |P0 - 2 P1 + P2| / (4 n²).
      const bend = Math.hypot(x - 2 * qx + ex, y - 2 * qy + ey);
      const steps = Math.max(1, Math.ceil(Math.sqrt(bend / (4 * FLATNESS))));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        current.push([u * u * x + 2 * u * t * qx + t * t * ex, u * u * y + 2 * u * t * qy + t * t * ey]);
      }
      [x, y] = [ex, ey];
    }
  }
  flattened.set(s, out);
  return out;
}

const turn = (angle) => {
  const rad = (angle * Math.PI) / 180;
  return [Math.cos(rad), Math.sin(rad)];
};

function distance(s, x, y) {
  if (s.kind === 'circle') return Math.hypot(x - s.cx, y - s.cy) - s.r;
  if (s.kind === 'rrect') {
    const [cos, sin] = turn(s.angle);
    const px = x - s.cx;
    const py = y - s.cy;
    const qx = Math.abs(px * cos + py * sin) - (s.w / 2 - s.r);
    const qy = Math.abs(-px * sin + py * cos) - (s.h / 2 - s.r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - s.r;
  }
  let d = Infinity;
  let winding = 0;
  for (const pts of contours(s)) {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ax, ay] = pts[j];
      const [bx, by] = pts[i];
      const ex = bx - ax;
      const ey = by - ay;
      const wx = x - ax;
      const wy = y - ay;
      const length = ex * ex + ey * ey;
      const t = length ? Math.max(0, Math.min(1, (wx * ex + wy * ey) / length)) : 0;
      d = Math.min(d, Math.hypot(wx - ex * t, wy - ey * t));
      const side = ex * wy - ey * wx;
      if (ay <= y) {
        if (by > y && side > 0) winding++;
      } else if (by <= y && side < 0) winding--;
    }
  }
  return (winding !== 0 ? -d : d) - s.grow;
}

/** The points that bound a shape (with `pad` around each). */
function hull(s) {
  if (s.kind === 'circle') return { pts: [[s.cx, s.cy]], pad: s.r };
  if (s.kind === 'rrect') {
    const [cos, sin] = turn(s.angle);
    const hx = s.w / 2 - s.r;
    const hy = s.h / 2 - s.r;
    const pts = [
      [-hx, -hy],
      [hx, -hy],
      [hx, hy],
      [-hx, hy],
    ].map(([x, y]) => [s.cx + x * cos - y * sin, s.cy + x * sin + y * cos]);
    return { pts, pad: s.r };
  }
  return { pts: contours(s).flat(), pad: s.grow };
}

/** [left, top, right, bottom]. */
function bounds(s) {
  const { pts, pad } = hull(s);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

/** The farthest any point of the shape lies from (0, 0). */
function reach(s) {
  const { pts, pad } = hull(s);
  return Math.max(...pts.map(([x, y]) => Math.hypot(x, y))) + pad;
}

/** The shape scaled by `k` about (0, 0), then moved by (dx, dy). */
function place(s, k, dx, dy) {
  if (s.kind === 'circle') return circle(s.cx * k + dx, s.cy * k + dy, s.r * k);
  if (s.kind === 'rrect') return rrect(s.cx * k + dx, s.cy * k + dy, s.w * k, s.h * k, s.r * k, s.angle);
  const cmds = s.cmds.map(([op, ...v]) => [op, ...v.map((n, i) => n * k + (i % 2 ? dy : dx))]);
  return path(cmds, s.grow * k);
}

/** Layers scaled and moved the same way (groups too). */
export function placeAll(layers, k, dx, dy) {
  return layers.map((l) =>
    l.group ? { ...l, group: placeAll(l.group, k, dx, dy) } : { ...l, shape: place(l.shape, k, dx, dy) },
  );
}

const n = (v) => String(Math.round(v * 100) / 100);

/** '#rrggbb' or 'rgba(r,g,b,a)' → { rgb: [r, g, b], hex, alpha }. */
function paint(value) {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  const rgb = m
    ? [Number(m[1]), Number(m[2]), Number(m[3])]
    : [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
  const hex = `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  return { rgb, hex, alpha: m ? Number(m[4]) : 1 };
}

function shapeSvg(s, fill) {
  const { hex, alpha } = paint(fill);
  const opacity = alpha < 1 ? ` fill-opacity="${alpha}"` : '';
  if (s.kind === 'circle')
    return `<circle cx="${n(s.cx)}" cy="${n(s.cy)}" r="${n(s.r)}" fill="${hex}"${opacity}/>`;
  if (s.kind === 'rrect') {
    const at = `x="${n(s.cx - s.w / 2)}" y="${n(s.cy - s.h / 2)}" width="${n(s.w)}" height="${n(s.h)}"`;
    const rx = s.r ? ` rx="${n(s.r)}"` : '';
    const rotate = s.angle ? ` transform="rotate(${n(s.angle)} ${n(s.cx)} ${n(s.cy)})"` : '';
    return `<rect ${at}${rx}${rotate} fill="${hex}"${opacity}/>`;
  }
  const d = s.cmds.map(([op, ...v]) => op + v.map(n).join(' ')).join('');
  // A round-joined stroke of twice the growth, under the fill, is the same shape as the distance field's.
  const edge = s.grow > 0 ? ` stroke="${hex}" stroke-width="${n(s.grow * 2)}" stroke-linejoin="round"` : '';
  return `<path d="${d}" fill="${hex}"${opacity}${edge}/>`;
}

// ---- the mark, in the canvas's units: its 512 box spans -256..256 ----

const font = loadFont(FONT);

/**
 * The canvas draws each tile as a 190 square, rx 38, under a 12-wide stroke in the background colour, centred
 * on its edge: the stroke's inner half leaves a 178 tile with corners of 32, and the whole stroke, from 89 to
 * 101 out from the centre, is a 12-wide halo in the ground's colour (outer corners 44) that stops the grid
 * short of the tile. Centres and angles as drawn.
 */
const TILE = { side: 178, radius: 32, halo: 12 };
const TILES = [
  { x: 138 - 256, y: 276 - 256, angle: -14, fill: brand.blue, digit: '5' },
  { x: 374 - 256, y: 240 - 256, angle: 12, fill: brand.orange, digit: '9' },
];
/** The digits' em (the canvas sets them at 130 in Archivo Black; Rubik's figures are a little shorter). */
const DIGIT_SIZE = 136;
/** How far below the tile's centre the digit's centre sits (the canvas's y = 6 on a central baseline). */
const DIGIT_DROP = 2;
/** The canvas's bolt: its points, under translate(81.9 77.1) scale(0.69). */
const BOLT = [
  [268, 40],
  [334, 40],
  [292, 198],
  [342, 198],
  [214, 474],
  [238, 290],
  [184, 290],
].map(([x, y]) => [81.9 + 0.69 * x - 256, 77.1 + 0.69 * y - 256]);
/**
 * The bolt's edge in the background colour, past its fill. The canvas has 5.2 (a 15 stroke under the fill,
 * scaled by 0.69); wider here, so the bolt still stands apart from the orange tile at 48 px. The monochrome
 * icon's gap is wider still: Android draws it in two close tones, small.
 */
const BOLT_EDGE = 8;
const MONO_GAP = 10;

/** The digit's outline: Rubik's glyph, centred on its tile and turned with it. */
function digit(tile) {
  const cmds = font.glyph(tile.digit);
  const k = DIGIT_SIZE / font.unitsPerEm;
  const xs = [];
  const ys = [];
  for (const [, ...v] of cmds) v.forEach((c, i) => (i % 2 ? ys : xs).push(c));
  const mx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const my = (Math.min(...ys) + Math.max(...ys)) / 2;
  const [cos, sin] = turn(tile.angle);
  return path(
    cmds.map(([op, ...v]) => {
      const out = [];
      for (let i = 0; i < v.length; i += 2) {
        // Font units grow up; the picture's y grows down.
        const x = (v[i] - mx) * k;
        const y = -(v[i + 1] - my) * k + DIGIT_DROP;
        out.push(tile.x + x * cos - y * sin, tile.y + x * sin + y * cos);
      }
      return [op, ...out];
    }),
  );
}

/**
 * The mark's layers, bottom first, in canvas units around (0, 0).
 * - 'flat': on the navy ground: the tiles' halos and the bolt's edge painted in its colour, brand.bg. The icon,
 *   the Play icon, the feature graphic, and the adaptive foreground, whose background layer is that ground (so
 *   the launcher's grid stops short of the tiles and the bolt, as on the canvas).
 * - 'layer': on another colour (the splash, on the app's background): the bolt's edge cut out, no halos.
 * - 'mono': one colour (Android 13 themed icons keep only the alpha): solid tiles with the digits cut out, and
 *   the bolt's edge cut out of them.
 */
export function mark(mode = 'flat') {
  const mono = mode === 'mono';
  const ink = color.text;
  const layers = [];
  for (const t of TILES) {
    if (mode === 'flat') {
      const { side, radius, halo } = TILE;
      layers.push({
        shape: rrect(t.x, t.y, side + 2 * halo, side + 2 * halo, radius + halo, t.angle),
        fill: brand.bg,
      });
    }
    layers.push({
      shape: rrect(t.x, t.y, TILE.side, TILE.side, TILE.radius, t.angle),
      fill: mono ? ink : t.fill,
    });
    layers.push(mono ? { shape: digit(t), erase: true } : { shape: digit(t), fill: brand.digit });
  }
  const edge = poly(BOLT, mono ? MONO_GAP : BOLT_EDGE);
  layers.push(mode === 'flat' ? { shape: edge, fill: brand.bg } : { shape: edge, erase: true });
  layers.push({ shape: poly(BOLT), fill: mono ? ink : brand.spark });
  return layers;
}

/** How far the drawn part of a mark reaches from its centre (cut-outs draw nothing). */
const reachOf = (layers) => Math.max(...layers.filter((l) => !l.erase).map((l) => reach(l.shape)));
/** The tiles and the bolt (the splash's mark). */
export const MARK_REACH = reachOf(mark('layer'));
/** With the halos and the bolt's edge too (the adaptive foreground's). */
const FLAT_REACH = reachOf(mark('flat'));

/**
 * The ground: brand.bg over w×h, and the grid's lines dividing a `box` square centred on it in thirds (the
 * canvas draws them 4 wide in its 512 box): the two lines a cell's half from the centre, each way. `across`:
 * the grid goes on, cell by cell, to the ground's edges.
 */
function ground(w, h, box, across = false) {
  const layers = [{ shape: rrect(w / 2, h / 2, w, h, 0), fill: brand.bg }];
  const cell = box / 3;
  const width = (4 * box) / 512;
  // By index, not by distance from the centre: a box's own edges (where a third line would fall) round either
  // way, and kept on one side only they'd make the grid lopsided.
  const [first, last] = across ? [-8, 7] : [-1, 0];
  const lines = (centre, length) => {
    const at = [];
    for (let i = first; i <= last; i++) {
      const v = centre + (i + 0.5) * cell;
      if (v > 0 && v < length) at.push(v);
    }
    return at;
  };
  for (const x of lines(w / 2, w)) layers.push({ shape: rrect(x, h / 2, width, h, 0), fill: brand.grid });
  for (const y of lines(h / 2, h)) layers.push({ shape: rrect(w / 2, y, w, width, 0), fill: brand.grid });
  return layers;
}

/** The four seat shapes (tokens' shapePath, 24×24 box centred on 12, 12), centred on (0, 0). */
function seat(index, fill) {
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
    rrect(0, 0, 14, 14, 0),
    poly(
      c([
        [12, 3],
        [21, 12],
        [12, 21],
        [3, 12],
      ]),
    ),
  ];
  return { shape: shapes[index], fill };
}

// ---- the files ----

/**
 * The mark's scale on the adaptive foreground: 90% of the canvas's (its 512 box on the 72 dp viewport), and never
 * past the safe circle, halos included. At the canvas's own scale the tiles' corners nearly touch a circle mask.
 */
const ADAPTIVE_FIT = 0.9;
const SAFE_MARGIN = 10;
export const ADAPTIVE_SCALE = Math.min(
  (VIEWPORT / 512) * ADAPTIVE_FIT,
  (ADAPTIVE_SAFE_RADIUS - SAFE_MARGIN) / FLAT_REACH,
);

/**
 * The adaptive icon's layers, in 1024 layer pixels around (0, 0). The foreground paints the halos and the bolt's
 * edge in the background layer's own colour, as the square icon does on its ground.
 */
export const adaptive = {
  background: () => placeAll(ground(LAYER, LAYER, VIEWPORT), 1, -LAYER / 2, -LAYER / 2),
  foreground: () => placeAll(mark('flat'), ADAPTIVE_SCALE, 0, 0),
  monochrome: () => placeAll(mark('mono'), ADAPTIVE_SCALE, 0, 0),
};

/** The splash mark: in a `size` square, filling its inscribed circle but for a 1/64 margin. */
const splashLayers = (size) =>
  placeAll(mark('layer'), (size / 2 - size / 64) / MARK_REACH, size / 2, size / 2);

/** The square icon (iOS, Play): ground and mark exactly as the canvas draws them, at `size`. */
const square = (size) => [
  ...ground(size, size, size),
  ...placeAll(mark('flat'), size / 512, size / 2, size / 2),
];

/**
 * The feature graphic: the mark on the ground, two seat shapes on each side. Each shape in its own player's
 * colour (players[i].ring), as the game always pairs them: ● is P1's, never the blue tile's.
 */
function featureGraphic() {
  const [w, h] = [1024, 500];
  const k = 1.05;
  const seats = [
    [0, 112],
    [2, 212],
    [3, 812],
    [1, 912],
  ];
  return [
    ...ground(w, h, 512 * k, true),
    ...placeAll(mark('flat'), k, w / 2, h / 2),
    ...seats.map(([i, x]) => {
      const l = seat(i, color.players[i].ring);
      return { ...l, shape: place(l.shape, 3.4, x, h / 2) };
    }),
  ];
}

/**
 * Every file: its size, whether its PNG has an alpha channel, and its layers in pixels.
 * - icon: iOS (and the default). Opaque, no alpha channel, square corners: Apple rounds them.
 * - adaptive-background / -foreground / -monochrome: Android 8+ and 13+ (themed icons). The foreground and
 *   the monochrome layer stay inside the safe circle; the background's grid divides the 72 dp viewport.
 * - splash-mark: expo-splash-screen's image, inside its inscribed circle (Android 12+ shows the splash icon in a
 *   circle; with imageWidth ≤ 192 dp nothing is cut).
 * - play-icon-512: the Play listing's hi-res icon (32-bit PNG, full square: Play rounds it).
 * - feature-graphic: the Play listing's 1024×500 banner (24-bit PNG).
 * - tile-clash: the master drawing at the canvas's 512, as SVG only.
 */
export function files() {
  const at = (layers) => placeAll(layers, 1, LAYER / 2, LAYER / 2);
  return [
    { name: 'icon', w: 1024, h: 1024, alpha: false, layers: square(1024) },
    { name: 'adaptive-background', w: LAYER, h: LAYER, alpha: false, layers: at(adaptive.background()) },
    { name: 'adaptive-foreground', w: LAYER, h: LAYER, alpha: true, layers: at(adaptive.foreground()) },
    { name: 'adaptive-monochrome', w: LAYER, h: LAYER, alpha: true, layers: at(adaptive.monochrome()) },
    { name: 'splash-mark', w: 1024, h: 1024, alpha: true, layers: splashLayers(1024) },
    { name: 'play-icon-512', w: 512, h: 512, alpha: true, svg: false, layers: square(512) },
    { name: 'feature-graphic', w: 1024, h: 500, alpha: false, layers: featureGraphic() },
    {
      name: 'tile-clash',
      w: 512,
      h: 512,
      alpha: false,
      png: false,
      layers: [
        { id: 'background', group: ground(512, 512, 512) },
        { id: 'mark', group: placeAll(mark('flat'), 1, 256, 256) },
      ],
    },
  ];
}

// ---- drawing ----

/** Composites layers into premultiplied RGBA (0..255 colour, 0..1 alpha). A group draws apart, then over. */
function draw(px, w, h, layers) {
  for (const layer of layers) {
    if (layer.group) {
      const own = new Float64Array(w * h * 4);
      draw(own, w, h, layer.group);
      for (let i = 0; i < px.length; i += 4) {
        const keep = 1 - own[i + 3];
        for (let c = 0; c < 4; c++) px[i + c] = own[i + c] + px[i + c] * keep;
      }
      continue;
    }
    const { rgb, alpha } = layer.erase ? { rgb: [0, 0, 0], alpha: 1 } : paint(layer.fill);
    const [l, t, rt, bt] = bounds(layer.shape);
    const x0 = Math.max(0, Math.floor(l) - 1);
    const y0 = Math.max(0, Math.floor(t) - 1);
    const x1 = Math.min(w, Math.ceil(rt) + 1);
    const y1 = Math.min(h, Math.ceil(bt) + 1);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const a = alpha * Math.max(0, Math.min(1, 0.5 - distance(layer.shape, x + 0.5, y + 0.5)));
        if (a === 0) continue;
        const i = (y * w + x) * 4;
        const keep = 1 - a;
        if (layer.erase) {
          for (let c = 0; c < 4; c++) px[i + c] *= keep;
        } else {
          px[i] = rgb[0] * a + px[i] * keep;
          px[i + 1] = rgb[1] * a + px[i + 1] * keep;
          px[i + 2] = rgb[2] * a + px[i + 2] * keep;
          px[i + 3] = a + px[i + 3] * keep;
        }
      }
    }
  }
}

/** Straight RGBA bytes. */
export function render({ w, h, layers }) {
  const px = new Float64Array(w * h * 4);
  draw(px, w, h, layers);
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

/** SVG markup of layers; a cut-out masks what its group drew before it. */
function svgBody(layers, w, h, ids) {
  let defs = '';
  let body = '';
  for (const layer of layers) {
    if (layer.group) {
      const inner = svgBody(layer.group, w, h, ids);
      defs += inner.defs;
      body += `<g${layer.id ? ` id="${layer.id}"` : ''}>${inner.body}</g>\n`;
    } else if (!layer.erase) {
      body += shapeSvg(layer.shape, layer.fill);
    } else {
      const id = `cut${ids.next++}`;
      defs +=
        `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">` +
        `<rect width="${w}" height="${h}" fill="#fff"/>${shapeSvg(layer.shape, '#000000')}</mask>`;
      body = `<g mask="url(#${id})">${body}</g>`;
    }
  }
  return { defs, body };
}

export function svg({ name, w, h, layers }) {
  const { defs, body } = svgBody(layers, w, h, { next: 0 });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n` +
    `<!-- Sudoku Fight: ${name}, design "B · Tile Clash". Generated by apps/mobile/scripts/gen-icons.mjs ` +
    `(docs/store/ASSETS.md). Digits: Rubik Black outlines (SIL Open Font License 1.1). -->\n` +
    (defs ? `<defs>${defs}</defs>\n` : '') +
    `${body}\n</svg>\n`
  );
}

// ---- small sizes, for the preview page ----

/** The launcher icon as a phone draws it at `size` px: both adaptive layers, cropped to the 72 dp viewport. */
export function launcher(size) {
  const k = (size * 108) / 72 / LAYER;
  const layers = [
    ...placeAll(adaptive.background(), k, size / 2, size / 2),
    { group: placeAll(adaptive.foreground(), k, size / 2, size / 2) },
  ];
  return png({ w: size, h: size, alpha: false, layers });
}

/** The monochrome layer at `size` px, cropped the same way (the page tints it as Android 13 does). */
export function themed(size) {
  const k = (size * 108) / 72 / LAYER;
  return png({
    w: size,
    h: size,
    alpha: true,
    layers: placeAll(adaptive.monochrome(), k, size / 2, size / 2),
  });
}

/** The square icon at `size` px (iOS draws it under its own rounded mask). */
export const squareIcon = (size) => png({ w: size, h: size, alpha: false, layers: square(size) });

/** The splash mark at `size` px. */
export const splashMark = (size) => png({ w: size, h: size, alpha: true, layers: splashLayers(size) });

/** What the preview page shows, rendered at the sizes it shows them. */
export function previewRenders() {
  const at = (sizes, draw) => Object.fromEntries(sizes.map((s) => [s, draw(s)]));
  return {
    launcher: at([192, 96, 48], launcher),
    themed: at([192, 96, 48], themed),
    ios: at([120, 80, 58], squareIcon),
    splash: splashMark(256),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf('--out');
  const out = at > 0 && process.argv[at + 1] ? resolve(process.argv[at + 1]) : OUT;
  mkdirSync(out, { recursive: true });
  const written = {};
  for (const file of files()) {
    if (file.svg !== false) writeFileSync(join(out, `${file.name}.svg`), svg(file));
    if (file.png === false) continue;
    const bytes = png(file);
    written[file.name] = bytes;
    writeFileSync(join(out, `${file.name}.png`), bytes);
    console.log(`${file.name}.png  ${file.w}×${file.h}  ${(bytes.length / 1024).toFixed(1)} KB`);
  }
  console.log(`Written to ${out}`);
  if (out === OUT) {
    mkdirSync(dirname(PREVIEW), { recursive: true });
    writeFileSync(
      PREVIEW,
      previewHtml({ files: written, renders: previewRenders(), brand, appBg: color.bg }),
    );
    console.log(`Preview: ${PREVIEW}`);
  }
}
