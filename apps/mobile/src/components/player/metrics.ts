import type { TextStyle } from 'react-native';

import { size, tokens, type PlayerPalette } from '../../theme';

/**
 * Dimensions of the player components from docs/design/components.md (§2–§10) that tokens.json does not name
 * yet. They live here, in one place and derived from tokens where a token exists, so the components hold no
 * raw numbers and the values can move into tokens.json later. Each entry cites its section.
 */

/** Teko's line box is about .8 of its size (components.md §0.4: "line-height: .8"). */
const TEKO_LINE = 0.8;
/** Rubik single-line text in C uses line-height 1.2 (Dir-C-Game "16px/1.2"). */
const RUBIK_LINE = 1.2;

type TekoWeight = keyof typeof tokens.font.load.Teko;
type RubikWeight = keyof typeof tokens.font.load.Rubik;

/** A Teko number style at a size the type tokens do not have (always tabular and LTR). */
export function tekoStyle(px: number, weight: TekoWeight = '600'): TextStyle {
  return {
    fontFamily: tokens.font.load.Teko[weight],
    fontSize: px,
    lineHeight: Math.round(px * TEKO_LINE),
    fontVariant: ['tabular-nums'],
    writingDirection: 'ltr',
    includeFontPadding: false,
  };
}

/** A Rubik style at a size the type tokens do not have. */
export function rubikStyle(px: number, weight: RubikWeight = '500'): TextStyle {
  return {
    fontFamily: tokens.font.load.Rubik[weight],
    fontSize: px,
    lineHeight: Math.round(px * RUBIK_LINE),
    includeFontPadding: false,
  };
}

export interface AvatarMetrics {
  frame: number;
  image: number;
  border: number;
  padding: number;
  frameRadius: number;
  imageRadius: number;
}

const unframed = (s: { size: number; radius: number }): AvatarMetrics => ({
  frame: s.size,
  image: s.size,
  border: 0,
  padding: 0,
  frameRadius: s.radius,
  imageRadius: s.radius,
});
const framed = (s: {
  frame: number;
  image: number;
  border: number;
  padding: number;
  frameRadius: number;
  imageRadius: number;
}): AvatarMetrics => ({ ...s });

/** §2: avatar sizes. 52 and 96 are not in tokens.json (size.avatar). */
export const AVATAR_SIZES = {
  cell: unframed(size.avatar.cell),
  compact: framed(size.avatar.compact),
  list: unframed(size.avatar.list),
  card: framed(size.avatar.card),
  row: framed({ frame: 52, image: 44, border: 2, padding: 2, frameRadius: 16, imageRadius: 12 }),
  home: framed(size.avatar.home),
  profile: framed({ frame: 96, image: 86, border: 2, padding: 3, frameRadius: 24, imageRadius: 19 }),
} as const satisfies Record<string, AvatarMetrics>;
export type AvatarSize = keyof typeof AVATAR_SIZES;

export const metrics = {
  /** §4: the sheet subtitle flag (12); emoji sit on a line of 1.2. */
  flagSheet: 12,
  flagLine: RUBIK_LINE,
  /** §2 "Disconnected: image grayscale with opacity .7". */
  avatarDisconnectedOpacity: 0.7,
  /** §2 badges on the avatar. */
  presenceDot: { small: 10, large: 12, largeFrom: size.avatar.card.frame, offset: -3, border: 2 },
  botChip: { height: 18, paddingX: 5, radius: 9, icon: 11, top: -7, start: -9, text: rubikStyle(10, '700') },
  resultBadge: {
    size: size.resultBadge.size,
    offset: size.resultBadge.offset,
    ring: tokens.border.badgeRing,
  },
  /** §3.2 and §7.2: the seat glyph next to the name; §9.2: in the lead tag. */
  glyph: { name: 7, leadTag: 6, gap: 4 },
  /** §3.4 and motion.md §4.2–4.3: score bump, mistake pop and flash, the compact gain float. */
  scoreBump: 1.08,
  mistakePopFrom: 0.8,
  mistakeFlashMs: 600,
  gainRise: 14,
  /** §3.2: the 2-player card. */
  card: {
    nameGap: 6,
    glyphGap: 4,
    statusGap: 6,
    hitChipOffset: -6,
    scoreRowGap: tokens.layout.game.playerCard.scoreGap,
    ratingStyle: tekoStyle(16),
    /** A bot's level under its name (Game-Bot), as tall as the provisional chip. */
    levelChipHeight: 18,
    levelChipPaddingX: 5,
  },
  /** §3.3: the activity timer ring (2P) and §7.2 (compact, with seconds inside). */
  timerRing: { card: 14, compact: 16, stroke: 2, secondsStyle: tekoStyle(11) },
  /** §3.3: the reconnect pill that replaces ⚡. */
  reconnectPill: { height: 30, compactHeight: 26, paddingX: 10, gap: 6, icon: 14 },
  /** §3.4: hit chip on a player under interference. */
  hitChip: { height: 18, radius: 9, paddingX: 5, gap: 3, icon: 12, offset: -6, secondsStyle: tekoStyle(14) },
  /**
   * §3.4: the target frame around the card the interference picker is open from [D45]: a static 2 dp accent
   * outline 6 dp outside the card, and an "יעד" chip on its bottom edge.
   */
  targetFrame: {
    padding: 6,
    outline: 2,
    chipHeight: 20,
    chipPaddingX: 8,
    chipStyle: rubikStyle(12, '700'),
  },
  /** §5.1 rating sizes 22 (lists) and 16 (2P card); 44 and 15 are type tokens. */
  rating: { listStyle: tekoStyle(22), provisionalChipHeight: 18, provisionalPaddingX: 6 },
  /** §5.2 league hexagon. */
  league: { hexWidth: 16, hexHeight: 18, gap: 6 },
  /** §6 rank badge. */
  rankBadge: { height: 22, minWidth: 30, paddingX: 6, top: -10, start: -6, slide: 8, style: tekoStyle(18) },
  /** §7.2 compact card. */
  compact: {
    /** §7.1: card widths at 390 (3 players: 114 each, gap 8; 4 players: me 106, others 78, gap 6). */
    widthThree: 114,
    widthFourMe: 106,
    widthFour: 78,
    gapThree: 8,
    gapFour: 6,
    height: size.playerCard.height,
    gainStyle: tekoStyle(22),
    scoreGap: 3,
    paddingTop: 7,
    nameTop: 5,
    namePaddingX: 5,
    ratingTop: 2,
    scoreTop: 2,
    scoreRowHeight: 24,
    activityTop: 3,
    activityHeight: 16,
    activityGap: 3,
    cellStyle: tekoStyle(17),
    flagBottom: -5,
    flagStart: -10,
    actionInset: 5,
    actionBottom: 4,
    actionHeight: 32,
    actionGap: 4,
    actionRadius: 8,
    actionIcon: 17,
    /** Makes the 32-dp action strip a 44-dp target (§7.2). */
    hitSlop: 6,
    pip: { height: 14, paddingX: 3, radius: 4, gap: 2, style: tekoStyle(13) },
    /**
     * §7.2: two penalty pips beside the score need about 100–111 dp (Teko 28 and 13, half points: "−15.5"
     * with −8 −7.5); a narrower card, or one with "×n" too, shows the last one only (penalty design, decision 3).
     */
    twoPipsMinWidth: 110,
  },
  /**
   * §8.1 the "הפרעה" button [D45]: as tall as the reactions button (44; compact 32 with a 44-dp target through
   * hitSlop), the 'interfere' glyph and the word only, no price. The compact label shrinks to fit a 4-player
   * opponent card (68 dp of strip) in English.
   */
  interfere: {
    paddingX: 10,
    gap: 6,
    icon: 20,
    compactIcon: 16,
    compactGap: 3,
    compactPaddingX: 3,
    labelStyle: rubikStyle(14, '600'),
    compactLabelStyle: rubikStyle(12, '600'),
    minFontScale: 0.75,
    /** The reconnect pill's seconds in the compact strip (Badges), in the slot the button leaves. */
    compactCostStyle: tekoStyle(18),
  },
  /** §9 lead bar and its tag. */
  lead: {
    tagTop: 3,
    tagHeight: 15,
    tagPaddingX: 5,
    tagRadius: 4,
    tagGap: 3,
    edgeMin: 24,
    tagStyle: tekoStyle(15),
  },
  /** §10 lock strip. */
  lockStrip: {
    height: tokens.layout.game.lockStatusRow.height,
    /** The target icon before "בחר משבצת" (no lock). */
    pickIcon: 16,
    pauseGap: 2,
    pauseBarWidth: 2,
    pauseBarHeight: 7,
  },
  /** §3.5 VS badge. */
  vs: { width: size.vsBadge.width, height: size.vsBadge.height },
} as const;

/** The colors of a palette index (0 = me, P1). */
export const paletteAt = (colorIndex: number): PlayerPalette =>
  tokens.color.players[colorIndex] ?? tokens.color.players[0];

/** The width of a compact card (§7.1): every card the same in 3P, mine wider in 4P. */
export function compactCardWidth(players: number, isMe: boolean): number {
  if (players <= 3) return metrics.compact.widthThree;
  return isMe ? metrics.compact.widthFourMe : metrics.compact.widthFour;
}

/** The gap between compact cards (§7.1). */
export const compactCardGap = (players: number): number =>
  players <= 3 ? metrics.compact.gapThree : metrics.compact.gapFour;
