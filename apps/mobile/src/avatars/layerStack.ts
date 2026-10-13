import {
  type AvatarDef,
  GIMMICK_MIN_SIZE,
  layerSvg,
  type NativeLayers,
  type NativeNode,
  type NativeRect,
  renderStatic,
  type StaticOptions,
} from '@sudoku-fight/avatars';

/**
 * How AvatarArt stacks a moving avatar, as few SvgXml as it can (pure, so it is tested without a renderer).
 *
 * nativeLayers() (packages/avatars native.ts) cuts an avatar into a tree of layers, each a whole <svg> over its
 * own rectangle (what it draws). Every layer as its own view would be a dozen SvgXml per avatar. Only the
 * layers that move now need a view of their own (an Animated.View that a plan turns, scales and fades); every
 * run of layers that stand still between them, in drawing order, is merged into one SvgXml over the union of
 * their rects. A layer that stands still with moving layers inside it (the face while only the eyes blink) is
 * dissolved: its markup joins the run, its children are placed at its level (it has no transform, so nothing
 * changes). A layer hidden at rest (opacity 0) that does not move is left out with what it holds, as
 * renderStatic leaves it out.
 *
 * Each SvgXml is a bitmap on the phone, as big as its rect: that is why the rects are each layer's own.
 * The tile is not a layer here: AvatarArt paints it as the background of the clipping view.
 */

/** One SvgXml: the markup of layers that stand still, merged in drawing order, over `rect`. */
export interface StackSvg {
  kind: 'svg';
  key: string;
  xml: string;
  /** Where it draws, in canvas units (the union of its layers' rects). */
  rect: NativeRect;
}

/** A layer that moves: its own view (keyed by NativeNode.key), with what it holds inside it. */
export interface StackNode {
  kind: 'node';
  key: string;
  node: NativeNode;
  items: StackItem[];
}

export type StackItem = StackSvg | StackNode;

/**
 * Every layer that may move on a stage view (idle): the body, the face and each eye, and each gimmick when
 * gimmicks play at this size (packages/avatars GIMMICK_MIN_SIZE; under it they stay merged in their rest pose).
 */
export function idleMovers(layers: NativeLayers): Set<string> {
  const gimmicks = layers.frame.size >= GIMMICK_MIN_SIZE;
  return new Set(
    layers.nodes
      .filter(
        (n) =>
          n.kind === 'body' || n.kind === 'face' || n.kind === 'eye' || (gimmicks && n.kind === 'gimmick'),
      )
      .map((n) => n.key),
  );
}

/** The stack for `layers` when the layers in `moving` move (see the top of this file). */
export function layerStack(layers: NativeLayers, moving: ReadonlySet<string>): StackItem[] {
  const children = new Map<string | null, NativeNode[]>();
  for (const n of layers.nodes) {
    if (n.kind === 'tile') continue;
    const list = children.get(n.parent) ?? [];
    list.push(n);
    children.set(n.parent, list);
  }

  /** One level: `own`'s markup first (a moving layer's), then its children, each placed or dissolved. */
  const level = (own: NativeNode | null, kids: readonly NativeNode[]): StackItem[] => {
    const out: StackItem[] = [];
    let run: { node: NativeNode; svg: string; rect: NativeRect }[] = [];
    const draw = (node: NativeNode) => {
      if (node.svg && node.drawRect) run.push({ node, svg: node.svg, rect: node.drawRect });
    };
    const flush = () => {
      const [first] = run;
      if (first) {
        // One layer keeps its own <svg>; several share one over the union of what they draw.
        const rect = run.map((r) => r.rect).reduce(unionRect);
        const xml =
          run.length === 1 ? first.svg : layerSvg(layers.frame, rect, run.map((r) => r.node.markup).join(''));
        out.push({ kind: 'svg', key: `svg:${first.node.key}`, xml, rect });
      }
      run = [];
    };
    const place = (n: NativeNode) => {
      if (moving.has(n.key)) {
        flush();
        out.push({ kind: 'node', key: n.key, node: n, items: level(n, children.get(n.key) ?? []) });
        return;
      }
      if (n.restOpacity === 0) return;
      draw(n);
      for (const c of children.get(n.key) ?? []) place(c);
    };
    if (own) draw(own);
    for (const k of kids) place(k);
    flush();
    return out;
  };

  return level(null, children.get(null) ?? []);
}

/** The smallest rectangle that holds both (on the same pixel grid when both are). */
function unionRect(a: NativeRect, b: NativeRect): NativeRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** How many SvgXml a stack draws. */
export const svgCount = (items: readonly StackItem[]): number =>
  items.reduce((n, it) => n + (it.kind === 'svg' ? 1 : svgCount(it.items)), 0);

// ---------------------------------------------------------------------------------------------------------
// Still avatars: one SvgXml, its markup kept for the screens that draw the same avatar again

const STATIC_CACHE_SIZE = 256;
const staticCache = new Map<string, string>();

/**
 * renderStatic(), remembered: a list, a board and the next screen draw the same few avatars at the same sizes
 * again and again. The oldest of STATIC_CACHE_SIZE strings goes first.
 */
export function staticXml(def: AvatarDef | null, opts: StaticOptions): string {
  const key = [def?.id ?? '', opts.size, opts.crop, opts.expression, opts.grayscale ? 'g' : ''].join('|');
  const hit = staticCache.get(key);
  if (hit !== undefined) {
    staticCache.delete(key);
    staticCache.set(key, hit);
    return hit;
  }
  const xml = renderStatic(def, opts);
  staticCache.set(key, xml);
  if (staticCache.size > STATIC_CACHE_SIZE) staticCache.delete(staticCache.keys().next().value!);
  return xml;
}
