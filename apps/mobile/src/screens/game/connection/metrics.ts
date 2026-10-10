import { size, space, tokens } from '../../../theme';

/**
 * Sizes of the connection UI, from its designs (390 × 844 reference) translated to direction C: no glows, no
 * gradients and no skew but the primary button's (components.md §0.1), 1 dp borders. Colours, type, radii
 * and spacing come from the theme; these are the few shapes the tokens don't name.
 */
export const metrics = {
  /** The centred cards (Opponent-Reconnecting 280 wide; Opponent-Left and Self-Reconnecting alike). */
  cardMaxWidth: 300,
  /** Opponent-Reconnecting's countdown ring: 124 with a 9 dp arc in round 1, a calmer 6 in C. */
  ring: { size: 124, stroke: 6 },
  /** Self-Reconnecting's banner: as tall as a toast with a subtitle (components.md §15.2: 52). */
  banner: { height: size.buttonMd, icon: tokens.size.avatar.compact.frame },
  /** The lock badge above Self-Reconnecting's card, half out of it. */
  lockBadge: { size: size.buttonMd, overlap: size.buttonMd / 2 },
  /** Self-Reconnecting's bottom timer: a lg button's height, and a 4 dp draining bar (the lead bar's). */
  timer: { height: size.buttonLg, bar: size.dominanceBar.height, icon: space[13] - space[2] },
  /** The pending dots of the sync chips, blinking one after the other (motion.md `self.lost`: 200 apart). */
  dot: { size: space[4], stagger: 200 },
  /** The sync chips' height. */
  chipHeight: size.buttonModal,
  /** Connection-Error's illustration: an icon in a circle. */
  errorIcon: { circle: tokens.size.avatar.home.frame + space[8], glyph: space[12] },
  /** The room code: Teko 64, spaced out. */
  codeLetterSpacing: space[4],
  /** "ניצחת בנטישה" slams in from 1.4 (motion.md §2 `sf-slam` → C). */
  slamFrom: 1.4,
  /** A countdown's number ticks from 1.22 at 0.5 opacity, over 320 ms (motion.md §4.8 `countdown.tick`). */
  tick: { from: 1.22, opacity: 0.5, ms: 320 },
  /** A centred card grows from 96 % as it fades in (components.md §14.2). */
  enterScale: 0.96,
  /** Self-Reconnecting's banner slides 12 dp down as it fades in (motion.md `toast`). */
  bannerDrop: space[6],
} as const;
