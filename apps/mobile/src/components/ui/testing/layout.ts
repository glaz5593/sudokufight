import { StyleSheet, type ViewStyle } from 'react-native';

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
