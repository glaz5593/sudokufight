/**
 * Renders an avatar to a complete <svg> string. Pure: the same string on the server, in the admin site, in the
 * preview page and (through react-native-svg's SvgXml) in the app.
 *
 * Structure, so motions can move parts (motion.ts) and a new expression can replace only the face:
 *
 *   <svg class="sfa [sfa-small] [sfa-idle]" data-avatar data-expression style="--sfa-pivot:…; --sfa-base:…; --sfa-eyes:…">
 *     <defs><clipPath id="{p}-clip">tile</clipPath></defs>
 *     <rect class="sfa-tile"/>                       the tile never moves
 *     <g clip-path="url(#{p}-clip)">
 *       <g id="{p}-body" class="sfa-body">           the whole character (spin, bounce, squash…)
 *         <g class="sfa-gimmick sfa-g-{id}"/>…       gimmicks with z 'behind'
 *         <g class="sfa-back">layers.back</g>
 *         <g class="sfa-gimmick sfa-g-{id}"/>…       gimmicks with z 'back'
 *         [<g class="sfa-gimmick sfa-g-{id}">markup   the gimmick with z 'face', if any, holds the face
 *         <g id="{p}-face" class="sfa-face">         renderFace() rebuilds what is inside
 *           <g id="{p}-cheeks"/> <g id="{p}-eyes"/> <g id="{p}-brows"/> <g id="{p}-mouth"/>
 *           [<g id="{p}-art"/>] <g id="{p}-extras"/>
 *         </g>[</g>]
 *         <g class="sfa-front">layers.front</g>
 *         <g class="sfa-gimmick sfa-g-{id}"/>…       gimmicks with z 'front' (the default)
 *       </g>
 *     </g>
 *   </svg>
 *
 * Inside g#{p}-eyes each eye has its own <g class="sfa-eye"> (rig.ts drawEyes). `sfa-small` marks a render
 * under GIMMICK_MIN_SIZE, where no gimmick plays; `sfa-idle` (option `idle`) lets the gimmicks idle.
 *
 * Ids start with `idPrefix` (default `sfa-{avatar id}`). Two different avatars never clash; to show the same
 * avatar twice on one page, give each copy its own prefix.
 */

import { drawBrows, drawCheeks, drawExtras, drawEyes, drawMouth, eyeCentres } from './rig';
import { esc, f } from './svg';
import type { AvatarDef, Box, Expression, GimmickDef, GimmickZ, Point } from './types';

export const CANVAS = 100;
/** Tile corner radius: the same proportion as the app's avatar frames (docs/design/components.md §2). */
export const TILE_RADIUS = 18;
/** Under this on-screen size (px) no gimmick plays: it stays in its rest pose (gimmick.ts). */
export const GIMMICK_MIN_SIZE = 48;

export interface RenderOptions {
  expression?: Expression;
  /** Width and height in px. Small sizes simplify the face (rig.ts SMALL_SIZE). Default 100. */
  size?: number;
  /** Prefix of every id in the SVG. Default `sfa-{id}`. */
  idPrefix?: string;
  /** Accessible name. Default: the English name; `false` hides the SVG from screen readers. */
  label?: string | false;
  /** `head`: zoom to the avatar's headBox (tiny sizes). Avatars without one show the whole tile. */
  crop?: 'tile' | 'head';
  /** A big stage view: let the `idle` gimmicks loop (class `sfa-idle`). Never in a grid. Default false. */
  idle?: boolean;
}

const FULL: Box = { x: 0, y: 0, size: CANVAS };

/** The part of the 100 x 100 canvas a render shows. */
export function viewBoxOf(def: AvatarDef, crop: RenderOptions['crop'] = 'tile'): Box {
  return crop === 'head' && def.headBox ? def.headBox : FULL;
}

export function defaultIdPrefix(def: AvatarDef): string {
  return `sfa-${def.id}`;
}

/** The base y of an avatar: where it stands. */
export function baseOf(def: AvatarDef): number {
  return def.base ?? CANVAS;
}

/** The middle of the eyes the rig draws: the eye line for two eyes (each eye blinks around its own centre). */
export function eyeLineOf(def: AvatarDef): Point {
  const cs = eyeCentres(def.face);
  const n = cs.length || 1;
  return { x: cs.reduce((s, c) => s + c.x, 0) / n, y: cs.reduce((s, c) => s + c.y, 0) / n };
}

/** The CSS custom properties that motion.ts's CSS uses as transform origins. */
export function originVars(def: AvatarDef): string {
  const e = eyeLineOf(def);
  return (
    `--sfa-pivot:${f(def.pivot.x)}px ${f(def.pivot.y)}px;` +
    `--sfa-base:${f(def.pivot.x)}px ${f(baseOf(def))}px;` +
    `--sfa-eyes:${f(e.x)}px ${f(e.y)}px`
  );
}

/**
 * What goes inside g#face for one expression: replace the group's content to change the face.
 * `size` is the on-screen size of the whole 100-unit canvas; for a `crop: 'head'` render pass
 * size × 100 / headBox.size, as renderAvatar does, so the lines stay the same weight.
 */
export function renderFace(
  def: AvatarDef,
  expression: Expression,
  opts: Pick<RenderOptions, 'size' | 'idPrefix'> = {},
): string {
  const p = opts.idPrefix ?? defaultIdPrefix(def);
  const rig = { size: opts.size ?? CANVAS };
  const face = def.face;
  const g = (part: string, body: string) => `<g id="${p}-${part}" class="sfa-${part}">${body}</g>`;
  const art = face.art ? (face.art[expression] ?? face.art.default) : undefined;
  return (
    g('cheeks', drawCheeks(face, expression, rig)) +
    g('eyes', drawEyes(face, expression, rig)) +
    g('brows', drawBrows(face, expression, rig)) +
    g('mouth', drawMouth(face, expression, rig)) +
    (art === undefined ? '' : g('art', art)) +
    g('extras', drawExtras(face, expression, rig))
  );
}

/** A gimmick's group in its rest pose, around `inner` (gimmick.ts plays it). */
function gimmickGroup(g: GimmickDef, inner = ''): string {
  const rest = g.rest === 'hidden' ? ' opacity="0"' : '';
  return `<g class="sfa-gimmick sfa-g-${esc(g.id)}"${rest}>${g.markup}${inner}</g>`;
}

/** The gimmicks at one depth, each in its rest pose (the `face` one is drawn with the face). */
export function renderGimmicks(def: AvatarDef, z: Exclude<GimmickZ, 'face'>): string {
  return (def.gimmicks ?? [])
    .filter((g) => (g.z ?? 'front') === z)
    .map((g) => gimmickGroup(g))
    .join('');
}

/** The face group, held by the `face` gimmick if the avatar has one. */
function faceGroup(def: AvatarDef, face: string): string {
  const holder = def.gimmicks?.find((g) => g.z === 'face');
  return holder ? gimmickGroup(holder, face) : face;
}

export function renderAvatar(def: AvatarDef, opts: RenderOptions = {}): string {
  const expression = opts.expression ?? 'neutral';
  const size = opts.size ?? CANVAS;
  const p = opts.idPrefix ?? defaultIdPrefix(def);
  const label = opts.label ?? def.name.en;
  const a11y = label === false ? 'aria-hidden="true"' : `role="img" aria-label="${esc(label)}"`;
  const box = viewBoxOf(def, opts.crop);
  // The rig sizes its lines for the screen: a cropped render shows the face bigger.
  const faceSize = (size * CANVAS) / box.size;
  const tile =
    `<rect x="${f(box.x)}" y="${f(box.y)}" width="${f(box.size)}" height="${f(box.size)}" ` +
    `rx="${f((TILE_RADIUS * box.size) / CANVAS)}"`;
  const viewBox = `${f(box.x)} ${f(box.y)} ${f(box.size)} ${f(box.size)}`;
  const small = size < GIMMICK_MIN_SIZE;
  const cls = `sfa${small ? ' sfa-small' : ''}${opts.idle && !small ? ' sfa-idle' : ''}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${f(size)}" height="${f(size)}" ` +
    `class="${cls}" data-avatar="${esc(def.id)}" data-expression="${expression}" ${a11y} style="${originVars(def)}">` +
    `<defs><clipPath id="${p}-clip">${tile}/></clipPath></defs>` +
    `${tile} class="sfa-tile" fill="${def.tile}"/>` +
    `<g clip-path="url(#${p}-clip)">` +
    `<g id="${p}-body" class="sfa-body">` +
    renderGimmicks(def, 'behind') +
    `<g class="sfa-back">${def.layers.back}</g>` +
    renderGimmicks(def, 'back') +
    faceGroup(
      def,
      `<g id="${p}-face" class="sfa-face">${renderFace(def, expression, { size: faceSize, idPrefix: p })}</g>`,
    ) +
    (def.layers.front ? `<g class="sfa-front">${def.layers.front}</g>` : '') +
    renderGimmicks(def, 'front') +
    `</g></g></svg>`
  );
}
