/* Test-only: what the avatars under an element draw (jest.setup.ts keeps each SvgXml as one host element). */
import { NO_AVATAR_ID } from '../catalog';

/** A rendered element (test-renderer's TestInstance, or anything shaped like one). */
export interface RenderedNode {
  type?: unknown;
  props: Record<string, unknown>;
  children: readonly (RenderedNode | string)[];
}
type Node = RenderedNode;

/** Every SvgXml under an element (itself included), in drawing order. */
export function svgXmlsIn(el: Node): Node[] {
  const own = el.type === 'SvgXml' ? [el] : [];
  return [...own, ...el.children.flatMap((c) => (typeof c === 'string' ? [] : svgXmlsIn(c)))];
}

/**
 * The avatar a still picture (renderStatic) draws, by its clip path's id (`sfa-{id}-clip`): one of ours, or
 * av00 for the placeholder. Null for anything else (a layer of a moving avatar has no id).
 */
export function drawnAvatarId(xml: unknown): string | null {
  const id = typeof xml === 'string' ? /id="sfa-([a-z0-9-]+)-clip"/.exec(xml)?.[1] : undefined;
  if (id === undefined) return null;
  return id === 'none' ? NO_AVATAR_ID : id;
}

/** AvatarArt's root: hidden from screen readers, with the face it shows as its accessibilityValue text. */
export function isAvatarArtRoot(el: Node): boolean {
  const value = el.props.accessibilityValue as { text?: unknown } | undefined;
  return el.props.importantForAccessibility === 'no-hide-descendants' && typeof value?.text === 'string';
}

/**
 * The face an avatar shows now (an expression id), from AvatarArt's root (its accessibilityValue, hidden from
 * screen readers) or from Avatar's frame (its first AvatarArt). Null when there is none under the element.
 */
export function shownFace(el: Node): string | null {
  const value = el.props.accessibilityValue as { text?: unknown } | undefined;
  if (isAvatarArtRoot(el) && typeof value?.text === 'string') return value.text;
  for (const c of el.children) {
    if (typeof c === 'string') continue;
    const face = shownFace(c);
    if (face !== null) return face;
  }
  return null;
}

/** The avatars drawn still under an element, in drawing order (see drawnAvatarId). */
export function avatarIdsIn(el: Node): string[] {
  return svgXmlsIn(el).flatMap((x) => {
    const id = drawnAvatarId(x.props.xml);
    return id === null ? [] : [id];
  });
}
