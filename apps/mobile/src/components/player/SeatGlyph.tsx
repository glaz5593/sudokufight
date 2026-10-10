import Svg, { Path } from 'react-native-svg';

import { paletteAt } from './metrics';

/** The shapes' common box: every seat shape (● ▲ ■ ◆) sits inside 3–21 of the 24-unit grid. */
const VIEW_BOX = '3 3 18 18';

export interface SeatGlyphProps {
  /** Palette index: 0 = me (●), 1–3 = ▲ ■ ◆. */
  colorIndex: number;
  size: number;
  /** Defaults to the seat's ring colour (for dark backgrounds). */
  color?: string;
}

/**
 * The seat shape that goes with a player's colour, so ownership never depends on colour alone (spec §22,
 * CLAUDE.md). Decorative: the name next to it carries the meaning.
 */
export function SeatGlyph({ colorIndex, size, color }: SeatGlyphProps) {
  const p = paletteAt(colorIndex);
  return (
    <Svg
      width={size}
      height={size}
      viewBox={VIEW_BOX}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={`glyph-${p.shapeName}`}
    >
      <Path d={p.shapePath} fill={color ?? p.ring} />
    </Svg>
  );
}
