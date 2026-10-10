import { size, space, tokens } from '../../theme';

/**
 * Sizes of the match screens (Match-Search, Match-Found, Match-Countdown, Match-Timeout; 390 × 844 reference)
 * in direction C: no glows, gradients or neon, 1 dp borders, the skew only on the primary button and the VS
 * badge (components.md §0.1). Colours, type, radii and spacing come from the theme; these are the shapes the
 * tokens don't name.
 */
export const metrics = {
  /** The header chip ("מדורג · 2 שחקנים · רגיל"). */
  chipHeight: 30,
  /** The radar around my avatar (Match-Search: 236 in round 1). */
  radar: { size: 220, inner: [0.72, 0.46] as const, arc: tokens.border.focus },
  /** My rating under my avatar, half over the radar's edge. */
  meChipHeight: 24,
  /** The range bar (Match-Search: 280 wide, the band in the middle). */
  rangeBar: { width: 240, height: 6, marker: { width: 4, height: 16 }, minBand: 0.3 },
  /** An empty seat while searching, and a player's tile on the VS (Match-Search 128 tall). */
  slot: { height: 120, maxWidth: 160, glyph: 11 },
  tile: { minHeight: 150, glyph: 12 },
  /** The ready badge on a tile. */
  badgeHeight: 22,
  /** The countdown's digit (Teko, as Match-Countdown's 3). */
  digit: { fontSize: 120, lineHeight: 100, paddingTop: 16 },
  /** The P1 ring that grows around each digit (motion.md `countdown.digit`: 0.6 → 1.6, fading). */
  ring: { size: 140, stroke: tokens.border.focus, from: 0.6, to: 1.6 },
  /** The board behind the countdown: 9 × 9 empty cells, dimmed. */
  ghostBoard: { size: 216, opacity: 0.35 },
  /** The VS badge slams from 1.4 (motion.md `vs.slam`); the "מוכן" badges pop 800 ms later. */
  vs: { from: 1.4, badgesAtMs: 800 },
  /** The error screen's illustration: an icon in a circle. */
  errorIcon: { circle: tokens.size.avatar.home.frame + space[8], glyph: space[12] },
  /** Buttons at the bottom keep to this width on wide screens. */
  actionsMaxWidth: 360,
  touch: size.touch,
} as const;
