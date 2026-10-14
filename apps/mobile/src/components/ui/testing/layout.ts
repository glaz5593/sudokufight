import { act } from '@testing-library/react-native';
import { Dimensions, type ScaledSize, StyleSheet, type ViewStyle } from 'react-native';

import { isAvatarArtRoot } from '../../../avatars/testing/avatarTesting';

/** The part of a rendered test node these helpers read (RNTL's host elements). */
interface TreeNode {
  type: unknown;
  props: { style?: unknown };
  children: readonly (TreeNode | string)[];
}

function walk(node: TreeNode, out: TreeNode[]): TreeNode[] {
  // An avatar is a picture: its layers sit left to right in either language, on purpose (as the board's cells).
  if (isAvatarArtRoot(node)) return out;
  if (typeof node.type === 'string') out.push(node);
  for (const child of node.children) if (typeof child !== 'string') walk(child, out);
  return out;
}

/**
 * The flattened style of every host element under `root`, except the SVG icons (they mirror on purpose) and
 * the avatars' pictures (they never mirror).
 */
export function hostStyles(root: TreeNode): ViewStyle[] {
  return walk(root, [])
    .filter((n) => !String(n.type).startsWith('RNSVG'))
    .map((n) => (StyleSheet.flatten(n.props.style as ViewStyle) ?? {}) as ViewStyle);
}

/**
 * Layout must follow the app direction by itself: rows are plain `row` (React Native mirrors them in RTL),
 * nothing forces a direction, and nothing pins one side only with left/right.
 */
export function directionProblems(root: TreeNode): string[] {
  return hostStyles(root).flatMap((s) => {
    const problems: string[] = [];
    if (s.flexDirection === 'row-reverse') problems.push('row-reverse');
    if (s.direction !== undefined) problems.push(`direction: ${String(s.direction)}`);
    if ((s.left === undefined) !== (s.right === undefined)) problems.push('one-sided left/right');
    if ((s.marginLeft ?? s.paddingLeft) !== undefined || (s.marginRight ?? s.paddingRight) !== undefined) {
      problems.push('left/right margin or padding');
    }
    return problems;
  });
}

/** The phone Moshe tests on (Samsung S22: 360 × 780 dp), at the normal text size. */
export const PHONE: ScaledSize = { width: 360, height: 780, scale: 3, fontScale: 1 };

/**
 * Sets the window the next renders read (useWindowDimensions): a phone's width, a larger system text size.
 * Returns the way back, to await (Jest's default window is 750 × 1334 at fontScale 2).
 */
export function setWindow(window: Partial<ScaledSize>): () => Promise<void> {
  const before = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
  Dimensions.set({ window: { ...before.window, ...window }, screen: before.screen });
  // A screen still on show hears the way back (useWindowDimensions): inside act, as any update in a test.
  return async () => {
    await act(async () => Dimensions.set(before));
  };
}

/** Generous widths of a character, in em: Rubik (every word) and Teko (every number), the app's two fonts. */
function charEm(ch: string, font: 'Rubik' | 'Teko'): number {
  if (/\s/.test(ch)) return 0.28;
  if (/\d/.test(ch)) return font === 'Teko' ? 0.5 : 0.62;
  if (/[֐-׿]/.test(ch)) return 0.64;
  if (/[A-Z]/.test(ch)) return 0.74;
  if (/[a-z]/.test(ch)) return 0.6;
  if (/[.,:;'’!|·]/.test(ch)) return 0.32;
  return 0.75;
}

/**
 * About how wide one line of text is, in dp. Jest can't measure text, so this errs on the wide side: a test
 * that says a label fits passes only with room to spare on the phone. Bidi marks (LRI, PDI…) take no room.
 */
export function textWidth(
  line: string,
  fontSize: number,
  {
    fontScale = 1,
    bold = false,
    font = 'Rubik',
  }: { fontScale?: number; bold?: boolean; font?: 'Rubik' | 'Teko' } = {},
): number {
  const ems = [...line.replace(/[‎‏⁦-⁩]/g, '')].reduce((sum, ch) => sum + charEm(ch, font), 0);
  return ems * fontSize * fontScale * (bold ? 1.06 : 1);
}
