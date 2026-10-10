/* Test-only: an accessibility audit of a rendered screen (spec §22; work plan stage 13). */
import { isHiddenFromAccessibility } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import type { TestInstance } from 'test-renderer';

import { tokens } from '../theme/tokens.generated';

/** Spec §22 and components.md: every touch target is at least 44 × 44 (with its hitSlop). */
export const MIN_TARGET = 44;

/**
 * A colour as `r,g,b,a` (a rounded to 2 places), whatever its notation: '#36c9f0', '#36c9f0ff' and
 * 'rgba(54, 201, 240, 1)' (what an animated colour comes out as) are the same colour. Null if unreadable.
 */
export function canonicalColour(colour: string): string | null {
  const c = colour.trim().toLowerCase();
  if (c === 'transparent') return '0,0,0,0';
  const hex = c.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    const a = h.length === 8 ? n(6) / 255 : 1;
    return `${n(0)},${n(2)},${n(4)},${Math.round(a * 100) / 100}`;
  }
  const rgb = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((x) => Math.round(Number(x)));
    const a = rgb[4] === undefined ? 1 : Number(rgb[4]);
    return `${r},${g},${b},${Math.round(a * 100) / 100}`;
  }
  return null;
}

/** Every colour the theme defines (tokens.json, all groups): the only colours text may have. */
export const THEME_COLOURS: ReadonlySet<string> = (() => {
  const out = new Set<string>([canonicalColour('transparent')!]);
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      const c = canonicalColour(v);
      if (c) out.add(c);
    } else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(tokens);
  return out;
})();

export const isThemeColour = (colour: string): boolean => {
  const c = canonicalColour(colour);
  return c !== null && THEME_COLOURS.has(c);
};

type Insets = { top?: number; bottom?: number; left?: number; right?: number };

function hitSlopOf(value: unknown): Required<Insets> {
  if (typeof value === 'number') return { top: value, bottom: value, left: value, right: value };
  const v = (value ?? {}) as Insets;
  return { top: v.top ?? 0, bottom: v.bottom ?? 0, left: v.left ?? 0, right: v.right ?? 0 };
}

const styleOf = (node: TestInstance): ViewStyle & TextStyle =>
  (StyleSheet.flatten(node.props.style as ViewStyle) ?? {}) as ViewStyle & TextStyle;

/**
 * A size the style fixes: the width (or at least the minWidth), as a number; null when the layout decides
 * (a percentage, flex, the content).
 */
function knownSize(style: ViewStyle, dim: 'width' | 'height'): number | null {
  const fixed = style[dim];
  const min = style[dim === 'width' ? 'minWidth' : 'minHeight'];
  const floor = typeof min === 'number' ? min : 0;
  if (typeof fixed === 'number') return Math.max(fixed, floor);
  return floor >= MIN_TARGET ? floor : null;
}

/** The text a screen reader would read for an element: its label, or the text inside it. */
export function spokenName(node: TestInstance): string {
  const label = node.props.accessibilityLabel ?? node.props['aria-label'];
  if (typeof label === 'string') return label.trim();
  if (node.props.accessibilityLabelledBy ?? node.props['aria-labelledby']) return '(labelled by)';
  const parts: string[] = [];
  const collect = (n: TestInstance | string) => {
    if (typeof n === 'string') parts.push(n);
    else if (!isHiddenFromAccessibility(n)) n.children.forEach(collect);
  };
  node.children.forEach(collect);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** A pressable: a host element that takes taps (Pressable and the Touchables give it onClick). */
export const isPressable = (node: TestInstance): boolean =>
  typeof node.props.onClick === 'function' && !/TextInput/.test(node.type);

const roleOf = (node: TestInstance): string | undefined => node.props.accessibilityRole ?? node.props.role;

/** Where an element is, for the report: the nearest testID up the tree, its type and what it says. */
function describe(node: TestInstance): string {
  let at: TestInstance | null = node;
  while (at && !at.props.testID) at = at.parent;
  const id = at?.props.testID ? `#${String(at.props.testID)}` : '(no testID)';
  const name = spokenName(node).slice(0, 40);
  return `${id} ${node.type}${name ? ` "${name}"` : ''}`;
}

/** Whether an ancestor is itself one screen-reader element (iOS groups its children into it). */
function groupedInto(node: TestInstance): TestInstance | null {
  for (let p = node.parent; p; p = p.parent) {
    if (p.props.accessible === true) return p;
  }
  return null;
}

export interface AuditOptions {
  /** Skip these checks. */
  skip?: readonly ('role' | 'label' | 'target' | 'textColour')[];
  /** Targets allowed under 44 (with the reason in the caller): e.g. the board's cells, which tile the board. */
  smallTargetOk?: (node: TestInstance) => boolean;
}

/**
 * The problems on a rendered screen, one line each:
 * - a pressable without an accessibilityRole, or without a name (accessibilityLabel or text);
 * - a pressable smaller than 44 × 44 with its hitSlop, where the style fixes its size;
 * - a pressable inside another screen-reader element (unreachable on iOS) unless that one is labelled;
 * - text whose colour is not one of the theme's (a raw hex in a component).
 * Elements hidden from screen readers are left out (a scrim, a decorative layer). So is a pressable that opts
 * out on purpose (importantForAccessibility="no": a card's long press, with a screen-reader button of its own
 * next to it), and such a screen-reader-only button (visually hidden, 1 × 1) is no touch target.
 */
export function auditA11y(root: TestInstance, { skip = [], smallTargetOk }: AuditOptions = {}): string[] {
  const problems: string[] = [];
  const all = root.queryAll(() => true, { includeSelf: true });
  for (const node of all) {
    if (typeof node.type !== 'string') continue;
    if (isPressable(node) && !isHiddenFromAccessibility(node)) {
      const where = describe(node);
      const role = roleOf(node);
      const group = groupedInto(node);
      const optedOut = node.props.importantForAccessibility === 'no' && node.props.accessible === false;
      if (node.props.accessible === false && !group && !optedOut) {
        problems.push(`unreachable: ${where} takes taps but is not accessible`);
      }
      if (node.props.accessible !== false && group) {
        problems.push(`nested: ${where} is inside another screen-reader element, ${describe(group)}`);
      }
      if (!group && !optedOut) {
        if (!skip.includes('role') && (!role || role === 'none')) problems.push(`no role: ${where}`);
        if (!skip.includes('label') && !spokenName(node)) problems.push(`no label: ${where}`);
      }
      const style = styleOf(node);
      const w = knownSize(style, 'width');
      const h = knownSize(style, 'height');
      const srOnly = w !== null && h !== null && w <= 1 && h <= 1;
      if (!skip.includes('target') && !srOnly && !smallTargetOk?.(node)) {
        const slop = hitSlopOf(node.props.hitSlop);
        const small: string[] = [];
        if (w !== null && w + slop.left + slop.right < MIN_TARGET - 0.5) {
          small.push(`width ${w}+${slop.left + slop.right}`);
        }
        if (h !== null && h + slop.top + slop.bottom < MIN_TARGET - 0.5) {
          small.push(`height ${h}+${slop.top + slop.bottom}`);
        }
        if (small.length) problems.push(`small target: ${where} (${small.join(', ')})`);
      }
    }
    if (!skip.includes('textColour') && node.type === 'Text') {
      const colour = styleOf(node).color;
      if (typeof colour === 'string' && !isThemeColour(colour)) {
        problems.push(`text colour ${colour} is not a theme colour: ${describe(node)}`);
      }
    }
  }
  return [...new Set(problems)];
}

/**
 * Text in a script the screen's language doesn't use: rendered text, labels and hints. In English, any Hebrew
 * letter is a string that skipped t() (CLAUDE.md: no hard-coded strings), apart from `allowed` (the language
 * switch names Hebrew in Hebrew).
 */
export function hebrewTexts(root: TestInstance, allowed: readonly string[] = []): string[] {
  const out = new Set<string>();
  const check = (value: unknown, node: TestInstance) => {
    if (typeof value !== 'string' || !/[֐-׿]/.test(value)) return;
    const rest = allowed.reduce((v, a) => v.split(a).join(''), value);
    if (/[֐-׿]/.test(rest)) out.add(`${value.trim().slice(0, 60)} (${describe(node)})`);
  };
  for (const node of root.queryAll(() => true, { includeSelf: true })) {
    for (const child of node.children) if (typeof child === 'string') check(child, node);
    check(node.props.accessibilityLabel, node);
    check(node.props.accessibilityHint, node);
    check(node.props.placeholder, node);
  }
  return [...out];
}
