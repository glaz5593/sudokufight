import { contrast, type PlayerPalette, tokens, type TypeName } from '../../theme';

/**
 * What the Foundations part of the design-system screen lists (DS-Foundations, translated to direction C): the
 * colour tokens with the contrast each one has against the surface it is used on, the four player palettes,
 * and the type scale. Pure data from tokens, so it is tested without rendering.
 */

const c = tokens.color;

/** A colour token next to the colour it is read against. */
export interface SwatchSpec {
  /** Token path, e.g. "color.textMuted". */
  token: string;
  value: string;
  /** The pair the ratio is measured on: text on a ground, or a mark on its background. */
  against: { token: string; value: string };
  /** Which side of the pair the swatch is: a ground (text goes on it) or a foreground. */
  role: 'ground' | 'ink';
}

export type SwatchGroupKey = 'ground' | 'text' | 'brand' | 'status' | 'board' | 'league';

export interface SwatchGroup {
  key: SwatchGroupKey;
  swatches: SwatchSpec[];
}

const ink = (token: string, value: string, onToken: string, on: string): SwatchSpec => ({
  token,
  value,
  against: { token: onToken, value: on },
  role: 'ink',
});
const ground = (token: string, value: string, textToken: string, textValue: string): SwatchSpec => ({
  token,
  value,
  against: { token: textToken, value: textValue },
  role: 'ground',
});

export const SWATCH_GROUPS: readonly SwatchGroup[] = [
  {
    key: 'ground',
    swatches: [
      ground('color.bg', c.bg, 'color.text', c.text),
      ground('color.surface', c.surface, 'color.text', c.text),
      ground('color.surface2', c.surface2, 'color.text', c.text),
      ground('color.border', c.border, 'color.text', c.text),
    ],
  },
  {
    key: 'text',
    swatches: [
      ink('color.text', c.text, 'color.bg', c.bg),
      ink('color.textMuted', c.textMuted, 'color.bg', c.bg),
      ink('color.textFaint', c.textFaint, 'color.bg', c.bg),
      ink('color.iconFaint', c.iconFaint, 'color.bg', c.bg),
    ],
  },
  {
    key: 'brand',
    swatches: [
      ink('color.accent', c.accent, 'color.bg', c.bg),
      ink('color.onAccent', c.onAccent, 'color.accent', c.accent),
      ink('color.accentShadow', c.accentShadow, 'color.bg', c.bg),
      ink('color.danger', c.danger, 'color.bg', c.bg),
      ink('color.success', c.success, 'color.bg', c.bg),
      ink('color.info', c.info, 'color.surface2', c.surface2),
    ],
  },
  {
    key: 'status',
    swatches: [
      ink('color.status.online', c.status.online, 'color.bg', c.bg),
      ink('color.status.offline', c.status.offline, 'color.bg', c.bg),
      ink('color.focusRing', c.focusRing, 'color.bg', c.bg),
    ],
  },
  {
    key: 'board',
    swatches: [
      ground('color.board.cell', c.board.cell, 'color.board.given', c.board.given),
      ground('color.board.cellAlt', c.board.cellAlt, 'color.board.given', c.board.given),
      ink('color.board.grid', c.board.grid, 'color.board.cell', c.board.cell),
      ink('color.board.wrongDigit', c.board.wrongDigit, 'color.board.cell', c.board.cell),
    ],
  },
  {
    key: 'league',
    swatches: (['bronze', 'silver', 'gold', 'diamond', 'legend'] as const).map((tier) =>
      ink(`color.league.${tier}`, c.league[tier], 'color.surface', c.surface),
    ),
  },
];

/** The ratio of a swatch's pair. */
export const swatchRatio = (s: SwatchSpec): number => contrast(s.value, s.against.value);

/**
 * What a ratio is good for (WCAG 2.2): body text needs 4.5:1; large text (≥ 24 dp, or ≥ 18.5 dp bold) and
 * non-text marks need 3:1; below that a colour is decoration only (components.md §0.6).
 */
export type ContrastGrade = 'text' | 'large' | 'decorative';

export function contrastGrade(ratio: number): ContrastGrade {
  if (ratio >= 4.5) return 'text';
  if (ratio >= 3) return 'large';
  return 'decorative';
}

/** "16.56:1", rounded down so a ratio is never shown better than it is (4.499 → "4.49:1"). */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}

/** One seat's colours as the board and the cards use them, with the ratios that matter. */
export interface PaletteSpec {
  index: number;
  palette: PlayerPalette;
  /** Solved digit on its tint (≥ 4.5:1, tokens.json "_contrast"). */
  digitOnTint: number;
  /** Score and ring on the ground. */
  ringOnBg: number;
  /** The lock pill's seconds on the ring. */
  onRingOnRing: number;
  /** The 1 dp lock edge on an empty cell (non-text, ≥ 3:1). */
  edgeOnCell: number;
}

export const PALETTES: readonly PaletteSpec[] = c.players.map((palette, index) => ({
  index,
  palette,
  digitOnTint: contrast(palette.digit, palette.tint),
  ringOnBg: contrast(palette.ring, c.bg),
  onRingOnRing: contrast(palette.onRing, palette.ring),
  edgeOnCell: contrast(palette.lockEdge, c.board.cell),
}));

/** The type scale in the tokens' order, with a short spec line ("Rubik 700 · 22/25"). */
export interface TypeSpec {
  name: TypeName;
  family: string;
  weight: number;
  size: number;
  lineHeight: number;
  /** Teko styles are numbers (scores, ratings, keys, cell names): they get a numeric sample. */
  numeric: boolean;
}

export const TYPE_SCALE: readonly TypeSpec[] = (Object.keys(tokens.type) as TypeName[]).map((name) => {
  const t = tokens.type[name];
  return {
    name,
    family: t.family,
    weight: t.weight,
    size: t.size,
    lineHeight: t.lineHeight,
    numeric: t.family === 'Teko' || ('writingDirection' in t && t.writingDirection === 'ltr'),
  };
});

export const typeSpecLine = (s: TypeSpec): string => `${s.family} ${s.weight} · ${s.size}/${s.lineHeight}`;

/** Radius tokens without the aliases that repeat a value under a component's name. */
export const RADII = (Object.entries(tokens.radius) as [string, number][]).filter(
  ([name, value]) => name !== 'none' && name !== 'pill' && value > 0,
);
