/**
 * The avatars' colours (docs/avatars/STYLE.md, "Palette").
 *
 * One palette for the whole set, so 60 characters by different hands still look like one family:
 * - TILE: the background of the rounded square. Mid-tone on purpose: every tile keeps at least 4.5:1 against
 *   the dark app (#0f1218) and 2.4:1 against white, so the tile edge reads on both (palette.test.ts checks).
 * - SKIN, HAIR, FUR: ramps of three steps. `base` is the surface, `shade` the depth shapes (under the chin,
 *   inside the ear, the far side of a snout), `light` an optional highlight.
 * - OBJECT, CLOTH: flat colours for things and clothes. Use `shade()` for their depth shapes.
 * - FACE: the rig's colours (ink, eye white, mouth, tongue, blush, tear, sparkle).
 *
 * Pick colours from here. A new colour is fine when a character needs it (a fox's orange), but add it here
 * first, with a name, so the next artist can reuse it.
 */

export interface Ramp {
  base: string;
  shade: string;
  light: string;
}

const ramp = (base: string, shade: string, light: string): Ramp => ({ base, shade, light });

/** Tile backgrounds. Neighbours in the grid should differ in hue. */
export const TILE = {
  teal: '#3fa59b',
  jade: '#3fa883',
  leaf: '#62a64a',
  sky: '#4a9fd8',
  cobalt: '#5b8def',
  iris: '#7f7fe6',
  violet: '#9a76dd',
  orchid: '#b87ad6',
  rose: '#e46f9a',
  berry: '#c9668a',
  coral: '#ef6f61',
  tangerine: '#e47d36',
  mustard: '#cf9a1f',
  slate: '#8394b0',
} as const;

export const SKIN = {
  porcelain: ramp('#ffe1cb', '#f1c2a3', '#fff1e6'),
  peach: ramp('#f8cba3', '#e7ab80', '#fde2c9'),
  tan: ramp('#e2aa7b', '#c98c5b', '#efc39d'),
  caramel: ramp('#c4875a', '#a66d43', '#d9a47b'),
  bronze: ramp('#9a623d', '#7c4b2c', '#b27c55'),
  umber: ramp('#6c4229', '#55321d', '#86573a'),
} as const;

export const HAIR = {
  black: ramp('#2b2427', '#1b1619', '#463b40'),
  espresso: ramp('#4a3024', '#352117', '#654334'),
  chestnut: ramp('#7b4a2b', '#5f3820', '#9a643f'),
  auburn: ramp('#a8452b', '#86331e', '#c4613f'),
  ginger: ramp('#e0782f', '#c25f1c', '#f29a55'),
  honey: ramp('#d9a441', '#b8852b', '#ecc066'),
  blonde: ramp('#f2cf6b', '#d9b14a', '#fae39a'),
  platinum: ramp('#eee3c4', '#d6c8a3', '#faf4e2'),
  silver: ramp('#c4c6cc', '#a4a7af', '#dfe0e4'),
  blue: ramp('#3f6fd8', '#2d55b3', '#6a91ea'),
  pink: ramp('#f07aa8', '#d65d8c', '#f8a3c4'),
} as const;

export const FUR = {
  fox: ramp('#f0823a', '#d06523', '#f7a265'),
  tawny: ramp('#c98a4b', '#a86e35', '#ddaa72'),
  brown: ramp('#8a5a3c', '#6d4429', '#a6754f'),
  chocolate: ramp('#5a3a2a', '#432a1d', '#74503b'),
  golden: ramp('#e8b553', '#cc963a', '#f4cd7c'),
  cream: ramp('#f6e7cf', '#e3cfae', '#fdf5e8'),
  white: ramp('#f7f4ee', '#e1dbd0', '#ffffff'),
  grey: ramp('#9aa1ad', '#7e8592', '#b9bec7'),
  charcoal: ramp('#4a4650', '#36333b', '#625d69'),
  black: ramp('#2e2a30', '#1d1a1f', '#48424b'),
  pink: ramp('#f4a9b5', '#e48a99', '#f9c6ce'),
  green: ramp('#7cc46a', '#5ea64e', '#9fd78f'),
} as const;

/** Things: digits, letters, cups, fruit. */
export const OBJECT = {
  gold: ramp('#ffcf3f', '#e8ae1c', '#ffe48a'),
  red: ramp('#e8524a', '#c63b34', '#f27d76'),
  orange: ramp('#f28b30', '#d6701a', '#f7a85f'),
  green: ramp('#5cbf6a', '#45a153', '#82d18d'),
  blue: ramp('#4d8fe6', '#3873c7', '#79acee'),
  purple: ramp('#9b6fe0', '#7f53c7', '#b693eb'),
  pink: ramp('#f48fb8', '#e06d9b', '#f8b1ce'),
  cream: ramp('#f7ecd8', '#e6d5b6', '#fdf7ec'),
  white: ramp('#fbfbfd', '#e2e4ea', '#ffffff'),
  coffee: ramp('#6b4430', '#53321f', '#8a5d44'),
  steel: ramp('#aab4c3', '#8c97a8', '#c7cfda'),
} as const;

/** Clothes: muted so the face stays the focus. */
export const CLOTH = {
  navy: ramp('#34477a', '#26365f', '#4a5f96'),
  denim: ramp('#4f74b3', '#3c5d95', '#6f91c9'),
  forest: ramp('#3f7d5c', '#2f6247', '#57997a'),
  mustard: ramp('#e0b23a', '#c39424', '#ecc865'),
  brick: ramp('#c2553f', '#a0402d', '#d6765f'),
  plum: ramp('#7a4a86', '#5f376a', '#9465a0'),
  cream: ramp('#f3e6cc', '#dccaa8', '#fbf3e3'),
  charcoal: ramp('#3b3f4a', '#2b2e37', '#525765'),
  white: ramp('#f6f7f9', '#dcdfe5', '#ffffff'),
} as const;

/** The rig's colours. */
export const FACE = {
  ink: '#2b2230',
  white: '#ffffff',
  mouth: '#6e2436',
  tongue: '#ff8a98',
  teeth: '#ffffff',
  blush: '#ff8f86',
  tear: '#8fd3ff',
  sparkle: '#fff4b8',
} as const;

// ---------------------------------------------------------------------------------------------------------
// Colour helpers

function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb: readonly number[]): string {
  return (
    '#' +
    rgb
      .map((v) =>
        Math.round(Math.min(255, Math.max(0, v)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** Mixes two #rrggbb colours: `t` = 0 gives `a`, 1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex(x.map((v, i) => v + ((y[i] ?? 0) - v) * t));
}

/** Darker (`amount` < 0, toward black) or lighter (`amount` > 0, toward white). -0.12 is a typical shade. */
export function shade(hex: string, amount: number): string {
  return amount < 0 ? mix(hex, '#000000', -amount) : mix(hex, '#ffffff', amount);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const lin = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (lin[0] ?? 0) + 0.7152 * (lin[1] ?? 0) + 0.0722 * (lin[2] ?? 0);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The app's background (docs/design/tokens.json color.bg) and white, the two grounds a tile must read on. */
export const GROUND = { dark: '#0f1218', light: '#ffffff' } as const;
export const TILE_CONTRAST = { dark: 4.5, light: 2.4 } as const;
