import { color, tokens } from '../../theme';
import { paletteAt } from '../player';

/**
 * The colours of the 5 s effects, all from the tokens (direction C, motion.md §4.4). Interferences are the one
 * place where loud motion is the goal, but they keep C's palette: the sender's seat colour (as this phone
 * shows it, never my P1), gold and white. No glows, no gradients.
 */
export interface EffectColors {
  /** The sender's seat ring colour: who sent it, at a glance. */
  sender: string;
  accent: string;
  /** "White": C's text colour, never a pure white flash (motion.md: no full-screen white flashes). */
  light: string;
  /** Ink [D47]: C's darkest colour, the screen's own ground, for the blots' bodies. */
  ink: string;
}

export function effectColors(fromColorIndex: number): EffectColors {
  return {
    sender: paletteAt(fromColorIndex).ring,
    accent: color.accent,
    light: color.text,
    ink: color.bg,
  };
}

/**
 * A colour of the tokens without its alpha, as #rrggbb: `rgba(7,9,12,0.72)` → `#07090c`, and a hex colour as
 * it is. The board's dim [D46] is the scrim's colour at its own strength (HIT_DIM.opacity), not the scrim's
 * 0.72 on top of it.
 */
export function solidOf(value: string): string {
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
  if (!rgb) return value;
  const hex = (v: string) => Math.min(255, Number(v)).toString(16).padStart(2, '0');
  return `#${hex(rgb[1]!)}${hex(rgb[2]!)}${hex(rgb[3]!)}`;
}

/** The colour of the board's dim during a hit [D46]: color.scrim, solid (#07090c). */
export const HIT_DIM_COLOR = solidOf(color.scrim);

/** One cat's colours. `line` is the outline that keeps it readable on the light board and the dark screen. */
export interface CatPalette {
  body: string;
  shade: string;
  light: string;
  stripe: string;
  line: string;
  eye: string;
  pupil: string;
  shine: string;
  /** Nose, mouth, inner ears and blush. */
  pink: string;
  /** The speed lines and dust behind it. */
  speed: string;
}

export type CatPaletteName = 'tabby' | 'black' | 'gray' | 'snow' | 'ginger';

const P2 = tokens.color.players[1]!;
const board = color.board;

/**
 * Round 1's five cats (Hit-Cats: orange, black, grey, calico, ginger) in C's tokens. The pink is the only pink
 * of the palette (the "legend" league colour); a dedicated `color.effects` group in tokens.json would be the
 * tidier home for these once Moshe has seen them on the phone.
 */
export const CAT_PALETTES: Readonly<Record<CatPaletteName, CatPalette>> = {
  tabby: {
    body: P2.ring,
    shade: P2.digit,
    light: P2.tint,
    stripe: P2.digit,
    line: board.given,
    eye: board.cell,
    pupil: color.bg,
    shine: board.cell,
    pink: color.league.legend,
    speed: color.text,
  },
  black: {
    body: color.surface2,
    shade: color.bg,
    light: color.border,
    stripe: color.bg,
    line: color.textMuted,
    eye: color.accent,
    pupil: color.bg,
    shine: color.text,
    pink: color.league.legend,
    speed: color.text,
  },
  gray: {
    body: color.textMuted,
    shade: color.iconFaint,
    light: board.cellAlt,
    stripe: color.iconFaint,
    line: color.bg,
    eye: board.cell,
    pupil: color.bg,
    shine: board.cell,
    pink: color.league.legend,
    speed: color.text,
  },
  snow: {
    body: board.cell,
    shade: board.grid,
    light: board.cellAlt,
    stripe: P2.ring,
    line: color.bg,
    eye: board.cell,
    pupil: color.bg,
    shine: board.cell,
    pink: color.league.legend,
    speed: color.text,
  },
  ginger: {
    body: color.accent,
    shade: color.accentShadow,
    light: P2.tint,
    stripe: color.accentShadow,
    line: color.bg,
    eye: board.cell,
    pupil: color.bg,
    shine: board.cell,
    pink: color.league.legend,
    speed: color.text,
  },
};
