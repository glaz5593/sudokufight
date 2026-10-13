/**
 * The avatars in the app: react-native-svg's SvgXml draws them and Reanimated 4 moves them, from the same data
 * as the preview page.
 *
 * renderAvatar (render.ts) is made for a browser: CSS classes, custom properties and @keyframes play its
 * motions and gimmicks. SvgXml has no CSS: it turns a `style` attribute into a React style object (so the
 * `--sfa-*` variables come out garbled) and a `class` into a className that means nothing. So the app gets
 * its own output from here:
 *
 * - renderStatic(): one plain <svg> for an avatar that stands still (lists, history, the leaderboard, the
 *   22 px avatar in a locked cell). No class, style, role, aria or data attributes, and no id but its clip
 *   path's (from `idPrefix`). Gimmicks show their rest pose; a gimmick hidden at rest is not drawn.
 *   `def` null draws the "no avatar" placeholder (a deleted or missing account).
 *
 * - nativeLayers(): the same picture as a tree of layers, for an avatar that moves. Each node is a complete
 *   <svg> over its own rectangle (NativeNode.rect: all it draws, its children's rects included, measured by
 *   bounds.ts and put on whole device pixels; it may reach past the tile, where a turning body brings parts
 *   into view), stacked absolutely. Each layer is a bitmap on the phone (react-native-svg draws an SvgXml into
 *   one as big as its view), so an eye's is an eye's size, not the tile's. A node's children are nested in it,
 *   so its transform carries them, as an SVG group does. The tree mirrors render.ts:
 *
 *     tile                              static (or draw it as a View: NativeLayers.tile)
 *     body                              motion target 'body'; draws nothing itself
 *     ├─ gimmick:{id}…                  z 'behind'
 *     ├─ back                           layers.back
 *     ├─ gimmick:{id}…                  z 'back'
 *     ├─ [gimmick:{id}                  z 'face': its markup, then the face inside it]
 *     │   face                          motion target 'face'; draws nothing itself
 *     │   ├─ cheeks
 *     │   ├─ eye-0, eye-1…              motion target 'eyes': one node per drawn eye, around its own centre
 *     │   └─ features                   brows, mouth, face art and extras (no motion moves them apart)
 *     ├─ front                          layers.front, if any
 *     └─ gimmick:{id}…                  z 'front'
 *
 *   No layer is clipped (a clip inside a moving layer would move with it): clip the whole stack with a View
 *   of the avatar's size, `overflow: 'hidden'` and `borderRadius: tile.radiusPx`.
 *
 * - motionPlan() and gimmickPlans(): animation plans that map one to one onto Reanimated. Per node and per
 *   property, a start value and segments: `withDelay(delayMs, withRepeat(withSequence(...segments.map(s =>
 *   withTiming(s.to, { duration: s.durationMs, easing: Easing.bezier(...s.bezier) }))), loop ? -1 : 1))`,
 *   after setting the shared value to `from` (during the delay the first keyframe shows, as CSS's `both` fill
 *   does). The segments follow the keyframes exactly as sampleTrack / sampleGimmick and the CSS do: segment i
 *   runs from keyframe i to keyframe i + 1 with keyframe i's curve (else the motion's or the anim's, else
 *   GIMMICK_EASE), a field a keyframe leaves out is the identity (0; 1 for scales and opacity), and every loop
 *   lasts exactly `durationMs`.
 *
 * Units: translate is in canvas units (the 100 x 100 viewBox: multiply by NativeFrame.scale for px), rotate
 * in degrees, scale and opacity plain numbers. Every origin is a point in canvas units; nativeTransform()
 * builds React Native's transform array around one (the same matrix as motion.ts poseMatrix()), given in px
 * from the centre of the node's rect (originFromCentrePx).
 *
 * Suggested wiring, per node (its shared values start at `nodeRest(node)`; `plan` is the one playing on it):
 *
 *   const o = originFromCentrePx(frame, node.rect, plan?.origin ?? node.origin);
 *   const at = placePx(frame, node.rect, parent?.rect ?? frame.rect);
 *   const style = useAnimatedStyle(() => ({
 *     opacity: opacity.value,
 *     transform: nativeTransform(
 *       { x: tx.value, y: ty.value, rotate: rot.value, sx: sx.value, sy: sy.value }, o, frame.scale),
 *   }));
 *   <Animated.View style={[{ position: 'absolute', ...at }, style]}>
 *     {node.svg && <SvgXml xml={node.svg} width={at.width} height={at.height} />}
 *     {children}
 *   </Animated.View>
 *
 * Lay the clipping View out left to right (`direction: 'ltr'`), so a `left` stays the left in an RTL app.
 * Layers that stand still side by side can share one bitmap: join their `markup` and draw it with layerSvg()
 * over the union of their rects. Reduced motion: play no plan at all, only the face changes (motionPlan with
 * `reducedMotion` keeps them and drops the nodes; gimmickPlans returns none).
 *
 * Grayscale (an inactive player): colour math on every fill and stroke (grayOf), not an SVG filter. Filters
 * are not reliable across react-native-svg's platforms, and colour math is exact, free and the same
 * everywhere: each colour becomes the grey of the same luminance, so every contrast stays as it was.
 */

import { type Extents, markupBounds } from './bounds';
import { EASINGS, faceChanges, motionOrigin, resolveMotion } from './motion';
import { GIMMICK_EASE, gimmickAnims, type GimmickState, playingGimmicks } from './gimmick';
import { luminance, mix, TILE } from './palette';
import { CANVAS, defaultIdPrefix, type RenderOptions, TILE_RADIUS, viewBoxOf } from './render';
import { drawBrows, drawCheeks, drawExtras, drawMouth, type EyePart, eyeCentres, eyeParts } from './rig';
import { clamp, f } from './svg';
import type {
  AvatarDef,
  Box,
  EasingName,
  Expression,
  GimmickAnim,
  GimmickDef,
  GimmickPose,
  MotionId,
  MotionTrack,
  Point,
  Pose,
} from './types';

export type Crop = NonNullable<RenderOptions['crop']>;

const FULL: Box = { x: 0, y: 0, size: CANVAS };
const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------------------------------------------------
// Grayscale: colour math, for an inactive player

/** A #rrggbb (or #rgb) colour as the grey of the same WCAG luminance (palette.ts), as #rrggbb. */
export function grayOf(hex: string): string {
  const six = /^#[0-9a-f]{3}$/i.test(hex) ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;
  const l = luminance(six);
  // The inverse of luminance()'s sRGB curve: for a grey (r = g = b) the luminance is the channel's.
  const c = l <= 0.03928 / 12.92 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  const v = Math.round(clamp(c, 0, 1) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${v}${v}${v}`;
}

/** SVG markup with every hex `fill` and `stroke` turned to its grey (grayOf). Other values stay. */
export function grayscaleSvg(markup: string): string {
  return markup.replace(
    /(\s(?:fill|stroke))="(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})"/g,
    (_, attr: string, hex: string) => `${attr}="${grayOf(hex)}"`,
  );
}

// ---------------------------------------------------------------------------------------------------------
// The "no avatar" placeholder: a deleted or missing account

const NA_TILE = mix(TILE.slate, grayOf(TILE.slate), 0.55);
const NA_BASE = mix(NA_TILE, '#ffffff', 0.42);
const NA_SHADE = mix(NA_TILE, '#ffffff', 0.26);
const NA_SHOULDERS = 'M8 150V100C8 83.5 25.5 74 50 74C74.5 74 92 83.5 92 100V150Z';

/**
 * The placeholder, in the style of the set (docs/avatars/STYLE.md): a muted slate tile and a soft, faceless
 * head and shoulders in two light greys (the offset shade, a cast shadow under the head), with no face and no
 * question mark. Its tile keeps the set's contrast on the dark app and on white.
 */
export const NO_AVATAR = {
  tile: NA_TILE,
  /** The head, for `crop: 'head'` (the 22 px avatar in a locked cell). */
  headBox: { x: 18, y: 13, size: 64 } satisfies Box,
  pivot: { x: 50, y: 50 } satisfies Point,
  markup:
    `<path d="${NA_SHOULDERS}" fill="${NA_SHADE}"/>` +
    `<path d="${NA_SHOULDERS}" fill="${NA_BASE}" transform="translate(-1.4 -1.3)"/>` +
    `<rect x="42" y="56" width="16" height="20" rx="6" fill="${NA_SHADE}"/>` +
    `<ellipse cx="51" cy="74.6" rx="13.5" ry="3.8" fill="${NA_SHADE}"/>` +
    `<circle cx="50" cy="43" r="20" fill="${NA_SHADE}"/>` +
    `<circle cx="48.7" cy="41.7" r="18" fill="${NA_BASE}"/>`,
} as const;

/** The id prefix of the placeholder's clip path, unless the caller gives one. */
export const NO_AVATAR_PREFIX = 'sfa-none';

// ---------------------------------------------------------------------------------------------------------
// Geometry: the visible square, each layer's rectangle, and px

/** A rectangle in canvas units. */
export interface NativeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a rectangle sits inside another one, in px (a `left`, `top`, `width` and `height` style). */
export interface PlacePx {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface NativeFrame {
  /** The visible square in canvas units: the tile, or the head box for `crop: 'head'`. */
  box: Box;
  /** `box` as a rectangle: what a top-level layer is placed in (placePx). */
  rect: NativeRect;
  /** On-screen side of the visible square, px. */
  size: number;
  /** px per canvas unit: multiply a plan's translate by it. */
  scale: number;
  /** Device pixels per px (React Native's PixelRatio.get()): every layer's edges sit on whole device pixels. */
  pixelRatio: number;
}

/**
 * How far a layer reaches past the visible square on each side, as a share of the square's side, when its
 * markup holds something bounds.ts can't measure (none of ours does: a test checks it).
 */
export const LAYER_FALLBACK_OVERSCAN = 0.5;

function boxOf(def: AvatarDef | null, crop: Crop): Box {
  if (!def) return crop === 'head' ? NO_AVATAR.headBox : FULL;
  return viewBoxOf(def, crop);
}

const rectOf = (b: Box): NativeRect => ({ x: b.x, y: b.y, width: b.size, height: b.size });

/** Where an avatar of `size` px draws, and how canvas units map to px. */
export function nativeFrame(
  def: AvatarDef | null,
  size: number = CANVAS,
  crop: Crop = 'tile',
  pixelRatio = 1,
): NativeFrame {
  const box = boxOf(def, crop);
  return { box, rect: rectOf(box), size, scale: size / box.size, pixelRatio };
}

/** `rect` inside `outer` (a parent layer's rect, or the visible square: frame.rect), in px. */
export function placePx(frame: NativeFrame, rect: NativeRect, outer: NativeRect = frame.rect): PlacePx {
  const s = frame.scale;
  return {
    left: (rect.x - outer.x) * s,
    top: (rect.y - outer.y) * s,
    width: rect.width * s,
    height: rect.height * s,
  };
}

/** A canvas point in px from a layer's top-left corner (for a `transformOrigin` style). */
export function originPx(frame: NativeFrame, rect: NativeRect, p: Point): Point {
  return { x: (p.x - rect.x) * frame.scale, y: (p.y - rect.y) * frame.scale };
}

/** A canvas point in px from a layer's centre, where React Native turns and scales by default. */
export function originFromCentrePx(frame: NativeFrame, rect: NativeRect, p: Point): Point {
  const o = originPx(frame, rect, p);
  return { x: o.x - (rect.width * frame.scale) / 2, y: o.y - (rect.height * frame.scale) / 2 };
}

/**
 * A rectangle on whole device pixels (counted from the visible square's corner) that holds `e` with one device
 * pixel to spare on each side (for anti-aliasing): layers placed inside each other stay on one pixel grid, and
 * each bitmap maps its viewBox exactly.
 */
function snapRect(frame: NativeFrame, e: Extents): NativeRect {
  const unit = 1 / (frame.scale * frame.pixelRatio);
  const { x, y } = frame.box;
  const x0 = x + (Math.floor((e.x0 - x) / unit) - 1) * unit;
  const y0 = y + (Math.floor((e.y0 - y) / unit) - 1) * unit;
  const x1 = x + (Math.ceil((e.x1 - x) / unit) + 1) * unit;
  const y1 = y + (Math.ceil((e.y1 - y) / unit) + 1) * unit;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** A number for a viewBox: finer than f() (a device pixel is a fraction of a canvas unit). */
function fine(n: number): string {
  const r = Math.round(n * 1e4) / 1e4;
  return Object.is(r, -0) ? '0' : String(r);
}

/** Markup as one layer: a whole <svg> over `rect` (its viewBox), as many px as `rect` covers on screen. */
export function layerSvg(frame: NativeFrame, rect: NativeRect, markup: string): string {
  const p = placePx(frame, rect);
  return (
    `<svg xmlns="${SVG_NS}" viewBox="${fine(rect.x)} ${fine(rect.y)} ${fine(rect.width)} ${fine(rect.height)}" ` +
    `width="${fine(p.width)}" height="${fine(p.height)}">${markup}</svg>`
  );
}

/** React Native's transform array (the parts it takes here). */
export type NativeTransform = (
  | { translateX: number }
  | { translateY: number }
  | { rotate: string }
  | { scaleX: number }
  | { scaleY: number }
)[];

/**
 * A pose as React Native's `transform`, for a view whose transform origin is its centre (the default):
 * translate(origin + offset) · rotate · scale · translate(−origin), the matrix of motion.ts poseMatrix().
 * `origin` in px from the layer's centre (originFromCentrePx), the pose's translate in canvas units, `scale`
 * px per canvas unit (NativeFrame.scale). A worklet: call it inside useAnimatedStyle.
 */
export function nativeTransform(pose: Pose, origin: Point, scale: number): NativeTransform {
  'worklet';
  return [
    { translateX: origin.x + pose.x * scale },
    { translateY: origin.y + pose.y * scale },
    { rotate: `${pose.rotate}deg` },
    { scaleX: pose.sx },
    { scaleY: pose.sy },
    { translateX: -origin.x },
    { translateY: -origin.y },
  ];
}

// ---------------------------------------------------------------------------------------------------------
// Shared parts

interface FaceParts {
  cheeks: string;
  eyes: EyePart[];
  /** Brows, mouth, face art and extras, in render.ts's order. */
  features: string;
}

function faceParts(def: AvatarDef, expression: Expression, faceSize: number): FaceParts {
  const face = def.face;
  const rig = { size: faceSize };
  const art = face.art ? (face.art[expression] ?? face.art.default) : '';
  return {
    cheeks: drawCheeks(face, expression, rig),
    eyes: eyeParts(face, expression, rig),
    features:
      drawBrows(face, expression, rig) +
      drawMouth(face, expression, rig) +
      art +
      drawExtras(face, expression, rig),
  };
}

/** `<rect …` of the tile over `box`, without its closing `/>`. */
function tileRect(box: Box): string {
  return (
    `<rect x="${f(box.x)}" y="${f(box.y)}" width="${f(box.size)}" height="${f(box.size)}" ` +
    `rx="${f((TILE_RADIUS * box.size) / CANVAS)}"`
  );
}

const gimmicksAt = (def: AvatarDef, z: 'behind' | 'back' | 'front'): GimmickDef[] =>
  (def.gimmicks ?? []).filter((g) => (g.z ?? 'front') === z);

const faceHolder = (def: AvatarDef): GimmickDef | undefined => def.gimmicks?.find((g) => g.z === 'face');

// ---------------------------------------------------------------------------------------------------------
// renderStatic: one plain <svg>

export interface StaticOptions {
  expression?: Expression;
  /** Width and height in px. Default 100. */
  size?: number;
  /** `head`: zoom to the head box (tiny sizes). Avatars without one show the whole tile. */
  crop?: Crop;
  /** Prefix of the clip path's id: give each copy on one screen its own. Default `sfa-{id}` (`sfa-none`). */
  idPrefix?: string;
  /** Grey, for an inactive player (grayscaleSvg). */
  grayscale?: boolean;
}

/** An avatar that stands still, as one <svg> SvgXml draws as the browser draws renderAvatar. */
export function renderStatic(def: AvatarDef | null, opts: StaticOptions = {}): string {
  const size = opts.size ?? CANVAS;
  const box = boxOf(def, opts.crop ?? 'tile');
  const p = opts.idPrefix ?? (def ? defaultIdPrefix(def) : NO_AVATAR_PREFIX);
  const tile = tileRect(box);
  let body: string = NO_AVATAR.markup;
  if (def) {
    const parts = faceParts(def, opts.expression ?? 'neutral', (size * CANVAS) / box.size);
    const face = parts.cheeks + parts.eyes.map((e) => e.markup).join('') + parts.features;
    const shown = (gs: GimmickDef[]) =>
      gs
        .filter((g) => g.rest !== 'hidden')
        .map((g) => g.markup)
        .join('');
    const holder = faceHolder(def);
    // A face held by a gimmick hidden at rest is hidden with it, as in renderAvatar.
    const held = !holder
      ? face
      : holder.rest === 'hidden'
        ? `<g opacity="0">${holder.markup}${face}</g>`
        : holder.markup + face;
    body =
      shown(gimmicksAt(def, 'behind')) +
      def.layers.back +
      shown(gimmicksAt(def, 'back')) +
      held +
      (def.layers.front ?? '') +
      shown(gimmicksAt(def, 'front'));
  }
  const svg =
    `<svg xmlns="${SVG_NS}" viewBox="${f(box.x)} ${f(box.y)} ${f(box.size)} ${f(box.size)}" ` +
    `width="${f(size)}" height="${f(size)}">` +
    `<defs><clipPath id="${p}-clip">${tile}/></clipPath></defs>` +
    `${tile} fill="${def ? def.tile : NO_AVATAR.tile}"/>` +
    `<g clip-path="url(#${p}-clip)">${body}</g></svg>`;
  return opts.grayscale ? grayscaleSvg(svg) : svg;
}

// ---------------------------------------------------------------------------------------------------------
// nativeLayers: the tree of layers an avatar moves in

export type NativeNodeKind = 'tile' | 'body' | 'art' | 'gimmick' | 'face' | 'cheeks' | 'eye' | 'features';

/** The fixed node keys (eyes and gimmicks: eyeNodeKey, gimmickNodeKey). */
export const NODE = {
  tile: 'tile',
  body: 'body',
  back: 'back',
  front: 'front',
  face: 'face',
  cheeks: 'cheeks',
  features: 'features',
} as const;

/** The key of the drawn eye `index` (eyeCentres() order: the viewer's left first). */
export const eyeNodeKey = (index: number): string => `eye-${index}`;
export const gimmickNodeKey = (id: string): string => `gimmick:${id}`;

export interface NativeNode {
  /** Unique in the tree, and the same for every expression, size and crop of one avatar. */
  key: string;
  kind: NativeNodeKind;
  /** The node this one is nested in (its transform carries this one); null at the top. */
  parent: string | null;
  /**
   * The rectangle this node's view covers, in canvas units: what it draws itself and its children's rects
   * (bounds.ts), on whole device pixels. Place it inside its parent's rect (the top: frame.rect) with placePx.
   */
  rect: NativeRect;
  /** What this node draws itself (its elements, without an <svg> around them); '' if nothing. */
  markup: string;
  /** Where its own drawing lies (the viewBox of `svg`), inside `rect`; null if it draws nothing. */
  drawRect: NativeRect | null;
  /**
   * The same as a complete <svg> over `drawRect` (layerSvg), drawn under its children. Null if it draws nothing
   * (a group, or a part this face leaves out at this size).
   */
  svg: string | null;
  /** Where it turns and scales by default, in canvas units (an eye: its own centre). A plan has its own. */
  origin: Point;
  /** Opacity at rest: 0 for a gimmick hidden until it plays, else 1. */
  restOpacity: number;
  /** The gimmick's id (kind 'gimmick'). */
  gimmick?: string;
}

export interface NativeLayers {
  frame: NativeFrame;
  /** The tile, to draw as a View instead of the tile node: its colour and corner radius. */
  tile: { color: string; radius: number; radiusPx: number };
  /** In drawing order, every parent before its children (a pre-order walk of the tree). */
  nodes: NativeNode[];
}

export interface LayerOptions {
  expression?: Expression;
  /** Width and height of the visible square, px. Default 100. */
  size?: number;
  crop?: Crop;
  grayscale?: boolean;
  /** Device pixels per px (PixelRatio.get()), for the layers' pixel grid. Default 1. */
  pixelRatio?: number;
}

/**
 * An avatar as layers to stack and move (see the top of this file). Only the face nodes (cheeks, eyes,
 * features) change with the expression: render again for a new face, and the other layers' strings stay equal.
 * `def` null gives the placeholder: tile, body and its art.
 */
export function nativeLayers(def: AvatarDef | null, opts: LayerOptions = {}): NativeLayers {
  const size = opts.size ?? CANVAS;
  const frame = nativeFrame(def, size, opts.crop ?? 'tile', opts.pixelRatio ?? 1);
  const { box } = frame;
  const color = def ? def.tile : NO_AVATAR.tile;
  const pivot = def ? def.pivot : NO_AVATAR.pivot;
  // Rects come once the tree is whole (a node's holds its children's).
  const nodes: Omit<NativeNode, 'rect' | 'drawRect' | 'svg'>[] = [];
  const add = (
    key: string,
    kind: NativeNodeKind,
    parent: string | null,
    markup: string,
    origin: Point = pivot,
    extra: Pick<NativeNode, 'gimmick'> & { restOpacity?: number } = {},
  ) =>
    nodes.push({
      key,
      kind,
      parent,
      markup: opts.grayscale ? grayscaleSvg(markup) : markup,
      origin,
      restOpacity: 1,
      ...extra,
    });
  const gimmick = (g: GimmickDef) =>
    add(gimmickNodeKey(g.id), 'gimmick', NODE.body, g.markup, gimmickAnims(g)[0]?.origin ?? pivot, {
      gimmick: g.id,
      restOpacity: g.rest === 'hidden' ? 0 : 1,
    });

  add(NODE.tile, 'tile', null, `${tileRect(box)} fill="${color}"/>`);
  add(NODE.body, 'body', null, '');
  if (!def) add(NODE.back, 'art', NODE.body, NO_AVATAR.markup);
  else {
    gimmicksAt(def, 'behind').forEach(gimmick);
    add(NODE.back, 'art', NODE.body, def.layers.back);
    gimmicksAt(def, 'back').forEach(gimmick);
    const holder = faceHolder(def);
    if (holder) gimmick(holder);
    const parts = faceParts(def, opts.expression ?? 'neutral', (size * CANVAS) / box.size);
    add(NODE.face, 'face', holder ? gimmickNodeKey(holder.id) : NODE.body, '');
    add(NODE.cheeks, 'cheeks', NODE.face, parts.cheeks);
    parts.eyes.forEach((e, i) => add(eyeNodeKey(i), 'eye', NODE.face, e.markup, e.c));
    add(NODE.features, 'features', NODE.face, parts.features);
    if (def.layers.front) add(NODE.front, 'art', NODE.body, def.layers.front);
    gimmicksAt(def, 'front').forEach(gimmick);
  }
  // Each node's extents, its children's included: children come after their parent, so walk back.
  const fallback: Extents = {
    x0: box.x - box.size * LAYER_FALLBACK_OVERSCAN,
    y0: box.y - box.size * LAYER_FALLBACK_OVERSCAN,
    x1: box.x + box.size * (1 + LAYER_FALLBACK_OVERSCAN),
    y1: box.y + box.size * (1 + LAYER_FALLBACK_OVERSCAN),
  };
  const own = new Map<string, Extents>();
  const all = new Map<string, Extents>();
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!;
    const b = n.markup ? markupBounds(n.markup) : null;
    const mine = b && !b.known ? fallback : (b?.extents ?? null);
    if (mine) own.set(n.key, mine);
    const e = union(mine, all.get(n.key) ?? null);
    if (!e) continue;
    all.set(n.key, e);
    if (n.parent !== null) all.set(n.parent, union(all.get(n.parent) ?? null, e)!);
  }
  // Parents come first: a node with nothing to show (an eye this face leaves out) takes its parent's rect.
  const rects = new Map<string | null, NativeRect>([[null, frame.rect]]);
  return {
    frame,
    tile: {
      color: opts.grayscale ? grayOf(color) : color,
      radius: (TILE_RADIUS * box.size) / CANVAS,
      radiusPx: (TILE_RADIUS * size) / CANVAS,
    },
    nodes: nodes.map((n) => {
      const e = all.get(n.key);
      const rect = e ? snapRect(frame, e) : (rects.get(n.parent) ?? frame.rect);
      rects.set(n.key, rect);
      const mine = own.get(n.key);
      const drawRect = n.markup && mine ? snapRect(frame, mine) : null;
      return { ...n, rect, drawRect, svg: drawRect ? layerSvg(frame, drawRect, n.markup) : null };
    }),
  };
}

function union(a: Extents | null, b: Extents | null): Extents | null {
  if (!a) return b;
  if (!b) return a;
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Plans: what Reanimated plays

export const NATIVE_PROPERTIES = [
  'translateX',
  'translateY',
  'rotate',
  'scaleX',
  'scaleY',
  'opacity',
] as const;
export type NativeProperty = (typeof NATIVE_PROPERTIES)[number];
export type NativeValues = Record<NativeProperty, number>;

/** Every property's identity: no move, no turn, full size, opaque. */
export const NATIVE_IDENTITY: Readonly<NativeValues> = {
  translateX: 0,
  translateY: 0,
  rotate: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
};

/** A node's values at rest: the identity, with the node's rest opacity. */
export function nodeRest(node: Pick<NativeNode, 'restOpacity'>): NativeValues {
  return { ...NATIVE_IDENTITY, opacity: node.restOpacity };
}

const TRANSFORMS = ['translateX', 'translateY', 'rotate', 'scaleX', 'scaleY'] as const;
const FIELD: Record<NativeProperty, keyof GimmickPose> = {
  translateX: 'x',
  translateY: 'y',
  rotate: 'rotate',
  scaleX: 'sx',
  scaleY: 'sy',
  opacity: 'opacity',
};

/** One withTiming: to `to` over `durationMs`, on the curve `bezier` (Easing.bezier(...bezier)). */
export interface PlanSegment {
  to: number;
  durationMs: number;
  /** The curve's name (EASINGS), for an app that builds each Easing once. */
  ease: EasingName;
  bezier: readonly [number, number, number, number];
}

/**
 * One property of one node: set it to `from`, then withDelay(delayMs, withRepeat(withSequence(segments),
 * loop ? -1 : 1)). Translate in canvas units, rotate in degrees. A loop's segments add up to its duration.
 */
export interface PropertyPlan {
  property: NativeProperty;
  from: number;
  segments: PlanSegment[];
  delayMs: number;
  loop: boolean;
}

export interface NodePlan {
  /** The node it moves (NativeNode.key). */
  node: string;
  /** The fixed point of rotate and scale, in canvas units. */
  origin: Point;
  /** A property the plan leaves out stays at this value while the plan plays; and when it ends, all return here. */
  rest: NativeValues;
  properties: PropertyPlan[];
}

interface Timing {
  durationMs: number;
  /** The curve of a keyframe without its own. */
  ease: EasingName;
  delayMs: number;
  loop: boolean;
}

type Keyframe = Partial<GimmickPose> & { t: number; ease?: EasingName };

/** Every property in `props` whose keyframes leave its rest value, as a plan (see the top of this file). */
function propertyPlans(
  ks: readonly Keyframe[],
  timing: Timing,
  props: readonly NativeProperty[],
  rest: NativeValues,
): PropertyPlan[] {
  const first = ks[0];
  const last = ks[ks.length - 1];
  if (!first || !last) return [];
  const out: PropertyPlan[] = [];
  for (const property of props) {
    const values = ks.map((k) => k[FIELD[property]] ?? NATIVE_IDENTITY[property]);
    if (values.every((v) => v === rest[property])) continue;
    const from = values[0] ?? NATIVE_IDENTITY[property];
    const segments: PlanSegment[] = [];
    // Before the first keyframe and after the last, the pose holds (sampleTrack, CSS fill).
    const hold = (to: number, span: number) => {
      if (span > 0)
        segments.push({ to, durationMs: span * timing.durationMs, ease: 'linear', bezier: EASINGS.linear });
    };
    hold(from, first.t);
    for (let i = 0; i < ks.length - 1; i++) {
      const a = ks[i];
      const b = ks[i + 1];
      if (!a || !b) continue;
      const ease = a.ease ?? timing.ease;
      segments.push({
        to: values[i + 1] ?? NATIVE_IDENTITY[property],
        durationMs: (b.t - a.t) * timing.durationMs,
        ease,
        bezier: EASINGS[ease],
      });
    }
    hold(values[values.length - 1] ?? from, 1 - last.t);
    out.push({ property, from, segments, delayMs: timing.delayMs, loop: timing.loop });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Motions

/** A face change of a motion: at `atMs` from its start, show this face (`base`: the face before the motion). */
export interface FaceChange {
  atMs: number;
  expression: Expression | 'base';
}

export interface MotionPlan {
  /** The motion asked for. */
  requested: MotionId;
  /** The motion played: `squash` falls back to `bounce` for an avatar that may not squash (resolveMotion). */
  id: MotionId;
  durationMs: number;
  /** The face this motion shows: with reduced motion, all that shows. */
  expression?: Expression;
  /** One per node its tracks move (an `eyes` track: one per eye); none with reduced motion. Played once. */
  nodes: NodePlan[];
  /** The face swaps, in time order, kept with reduced motion: render the face nodes again at each. */
  faceChanges: FaceChange[];
}

/** The nodes a track moves, each with its origin: an `eyes` track moves every eye around its own centre. */
function trackNodes(def: AvatarDef, tr: MotionTrack): { node: string; origin: Point }[] {
  if (tr.target === 'eyes')
    return eyeCentres(def.face).map((c, i) => ({
      node: eyeNodeKey(i),
      origin: tr.origin === 'eyes' ? c : motionOrigin(def, tr.origin),
    }));
  return [{ node: tr.target === 'body' ? NODE.body : NODE.face, origin: motionOrigin(def, tr.origin) }];
}

/**
 * What a motion does to an avatar's layers (nativeLayers), as Reanimated plans. When it ends, every node it
 * moved goes back to rest (its last keyframe already is: a spin ends at 360°, the same picture as 0°).
 */
export function motionPlan(def: AvatarDef, id: MotionId, opts: { reducedMotion?: boolean } = {}): MotionPlan {
  const m = resolveMotion(def, id);
  const plans = new Map<string, NodePlan>();
  if (!opts.reducedMotion) {
    const timing: Timing = { durationMs: m.durationMs, ease: m.ease, delayMs: 0, loop: false };
    // Two tracks on one target: the later one wins, as in CSS.
    for (const tr of m.tracks)
      for (const { node, origin } of trackNodes(def, tr))
        plans.set(node, {
          node,
          origin,
          rest: { ...NATIVE_IDENTITY },
          properties: propertyPlans(tr.keyframes, timing, TRANSFORMS, NATIVE_IDENTITY),
        });
  }
  return {
    requested: id,
    id: m.id,
    durationMs: m.durationMs,
    ...(m.expression ? { expression: m.expression } : {}),
    nodes: [...plans.values()],
    faceChanges: faceChanges(m),
  };
}

/** The gap between two idle blinks, ms: the preview's rhythm. */
export const IDLE_BLINK_MS = { min: 2400, max: 5200 } as const;

/**
 * The idle blink: motion `blink` (every eye's scaleY, around its own centre). Play it after
 * idleBlinkDelayMs(), again and again, while no other motion plays and motion is not reduced.
 */
export function blinkPlan(def: AvatarDef): MotionPlan {
  return motionPlan(def, 'blink');
}

/** The wait before the next idle blink, from a random number 0-1 (the caller's own source). */
export function idleBlinkDelayMs(random01: number): number {
  return IDLE_BLINK_MS.min + clamp(random01, 0, 1) * (IDLE_BLINK_MS.max - IDLE_BLINK_MS.min);
}

// ---------------------------------------------------------------------------------------------------------
// Gimmicks

export interface GimmickPlan extends NodePlan {
  /** The gimmick's id, and the index of the anim in its list. */
  gimmick: string;
  index: number;
}

function animPlan(g: GimmickDef, anim: GimmickAnim, index: number): GimmickPlan {
  const rest = nodeRest({ restOpacity: g.rest === 'hidden' ? 0 : 1 });
  const timing: Timing = {
    durationMs: anim.durationMs,
    ease: anim.ease ?? GIMMICK_EASE,
    delayMs: anim.delayMs ?? 0,
    loop: anim.loop ?? false,
  };
  return {
    node: gimmickNodeKey(g.id),
    gimmick: g.id,
    index,
    origin: anim.origin,
    rest,
    properties: propertyPlans(anim.keyframes, timing, NATIVE_PROPERTIES, rest),
  };
}

/** The plan of one anim of a gimmick (its index in gimmickAnims()), if it has one. */
export function gimmickAnimPlan(g: GimmickDef, index: number): GimmickPlan | undefined {
  const anim = gimmickAnims(g)[index];
  return anim ? animPlan(g, anim, index) : undefined;
}

/** The motion of a state as this avatar plays it (squash falls back), as playingGimmicks expects. */
const resolved = (def: AvatarDef, st: GimmickState): GimmickState => ({
  ...st,
  motion: st.motion ? resolveMotion(def, st.motion).id : null,
});

/**
 * The gimmick anims that play in this state, as plans (playingGimmicks: none under 48 px or with reduced
 * motion; the motion's anim, else the expression's, else `idle` where idling is allowed). `st.motion` may be
 * the motion asked for: it is resolved here. A once-anim holds its last pose until its trigger ends.
 */
export function gimmickPlans(def: AvatarDef, st: GimmickState): GimmickPlan[] {
  return playingGimmicks(def, resolved(def, st)).map((p) => animPlan(p.gimmick, p.anim, p.index));
}

export interface GimmickUpdate {
  node: string;
  gimmick: string;
  /** Start this plan (from its `from` values), or null: back to `rest` at once. */
  plan: GimmickPlan | null;
  rest: NativeValues;
}

/**
 * What changes between two states (an expression shows, a motion starts or ends, idling is allowed): the
 * gimmicks to start and the ones to put back to rest. A gimmick that keeps playing the same anim keeps going,
 * as in CSS. To replay a motion's anims, pass a state without the motion in between. `prev` null: from rest.
 */
export function gimmickUpdates(
  def: AvatarDef,
  prev: GimmickState | null,
  next: GimmickState,
): GimmickUpdate[] {
  const index = (st: GimmickState | null) =>
    new Map(st ? playingGimmicks(def, resolved(def, st)).map((p) => [p.gimmick.id, p.index] as const) : []);
  const before = index(prev);
  const after = index(next);
  const out: GimmickUpdate[] = [];
  for (const g of def.gimmicks ?? []) {
    const a = before.get(g.id);
    const b = after.get(g.id);
    if (a === b) continue;
    out.push({
      node: gimmickNodeKey(g.id),
      gimmick: g.id,
      plan: b === undefined ? null : (gimmickAnimPlan(g, b) ?? null),
      rest: nodeRest({ restOpacity: g.rest === 'hidden' ? 0 : 1 }),
    });
  }
  return out;
}
