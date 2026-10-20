import { I18nManager } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { color, size } from '../theme';

/**
 * The stroke icons of direction C (docs/design/screens/Dir-C-*.dc.html), 24×24, stroke 2, round caps.
 * Icons are decoration: give the button around them the accessibility label.
 */
const ICONS = {
  settings: (
    <>
      <Path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <Circle cx="16" cy="7" r="2" />
      <Circle cx="10" cy="17" r="2" />
    </>
  ),
  home: (
    <>
      <Path d="M4 11l8-7 8 7" />
      <Path d="M6 9.5V20h12V9.5" />
      <Path d="M10 20v-5h4v5" />
    </>
  ),
  leaderboard: (
    <>
      <Path d="M3 21h18" />
      <Path d="M9 21V9h6v12" />
      <Path d="M3 21v-7h6M15 21v-4h6v4" />
    </>
  ),
  history: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 7v5l3 2" />
    </>
  ),
  trophy: (
    <>
      <Path d="M8 4h8v5a4 4 0 0 1-8 0V4z" />
      <Path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4" />
      <Path d="M12 13v4M8 21h8M9.5 17h5" />
    </>
  ),
  surrender: (
    <>
      <Path d="M5 21V4" />
      <Path d="M5 4h11l-2 4 2 4H5" />
    </>
  ),
  reactions: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M8.5 14.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2" />
      <Path d="M9 9.5h.01M15 9.5h.01" />
    </>
  ),
  bolt: <Path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
  /**
   * "הפרעה" on an opponent's card [D45]: an outline bolt with impact sparks. The filled 'bolt' stays for the
   * cost pills and the hit chip.
   */
  interfere: (
    <>
      <Path d="M13.5 2.5L6 13h5.5l-1.5 8.5L17.5 11H12l1.5-8.5z" />
      <Path d="M19.5 5l2-1.5M20.5 9H23M4.5 15l-2 1M3.5 19.5l-2 .5" />
    </>
  ),
  cancel: (
    <>
      <Rect x="4" y="4" width="16" height="16" rx="3" />
      <Path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  refresh: (
    <>
      <Path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <Path d="M20 4v7h-7" />
    </>
  ),
  /** Points the way reading goes: left in Hebrew, right in English. */
  chevronForward: <Path d="M15 5l-7 7 7 7" />,
  lock: (
    <>
      <Rect x="5" y="11" width="14" height="10" rx="2" />
      <Path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  close: <Path d="M6 6l12 12M18 6L6 18" />,
  check: <Path d="M5 12l5 5 9-10" />,
  wifiOff: (
    <>
      <Path d="M2 8.8a15 15 0 0 1 4.2-2.6M9.5 5.2A15 15 0 0 1 22 8.8" />
      <Path d="M5 12.5a10 10 0 0 1 3.2-2M15 10.3a10 10 0 0 1 4 2.2" />
      <Path d="M8.5 16a5 5 0 0 1 7 0" />
      <Path d="M12 20h.01" />
      <Path d="M3 3l18 18" />
    </>
  ),
  /** An exclamation mark in a circle: the error toast (components.md §15.1). */
  alert: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 7.5v5.5" />
      <Path d="M12 16.5h.01" />
    </>
  ),
  /** An exclamation mark in a triangle: the warning toast, so it differs from an error by shape too. */
  warning: (
    <>
      <Path d="M12 3.5L2.5 20h19L12 3.5z" />
      <Path d="M12 10v4.5" />
      <Path d="M12 17.5h.01" />
    </>
  ),
  /**
   * The bot: the Modes card's practice against a bot, Match-Timeout's "play a bot", the results' opponents of a
   * bot game. After DS-Components' bot chip, with a mouth and eyes twice as large (Moshe's device test,
   * 15.10.2026: the old one was not clear enough). The r=1 circles under a 2 stroke are solid 4-unit dots.
   */
  bot: (
    <>
      <Rect x="4.5" y="7.5" width="15" height="13" rx="3.5" />
      <Path d="M12 7.5V5" />
      <Circle cx="12" cy="4" r="1" />
      <Circle cx="9" cy="12.5" r="1" />
      <Circle cx="15" cy="12.5" r="1" />
      <Path d="M9.5 16.5h5" />
      <Path d="M1.5 12v4M22.5 12v4" />
    </>
  ),
  /** The lock strip's "בחר משבצת" (components.md §10). */
  target: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Circle cx="12" cy="12" r="4.5" />
      <Path d="M12 12h.01" />
    </>
  ),
  /** A stopped lock timer (components.md §10, §11.3 #10). */
  pause: <Path d="M9 5.5v13M15 5.5v13" />,
  /** Account screens (stage 8): the email field (Login, Register-Account). */
  mail: (
    <>
      <Rect x="3" y="5" width="18" height="14" rx="2" />
      <Path d="M3.5 6.5L12 13l8.5-6.5" />
    </>
  ),
  /** The password field. */
  key: (
    <>
      <Circle cx="8" cy="15" r="4" />
      <Path d="M10.8 12.2L19 4M16 7l2.5 2.5M14 9l1.8 1.8" />
    </>
  ),
  /** "הצג סיסמה". */
  eye: (
    <>
      <Path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <Circle cx="12" cy="12" r="3" />
    </>
  ),
  /** "הסתר סיסמה". */
  eyeOff: (
    <>
      <Path d="M10.6 5.1A10.5 10.5 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.2 3.1" />
      <Path d="M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6" />
      <Path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <Path d="M3 3l18 18" />
    </>
  ),
  /** "עריכה" (the fighter on Register-Account, the profile card). */
  edit: (
    <>
      <Path d="M4 20h4L19 9l-4-4L4 16v4z" />
      <Path d="M13.5 6.5l4 4" />
    </>
  ),
  /** "התנתקות". */
  logout: (
    <>
      <Path d="M10 4H5v16h5" />
      <Path d="M14 8l4 4-4 4M18 12H9" />
    </>
  ),
  /** "מחיקת חשבון". */
  trash: (
    <>
      <Path d="M4 7h16M9 7V4h6v3" />
      <Path d="M6 7l1 13h10l1-13" />
      <Path d="M10 11v5M14 11v5" />
    </>
  ),
  /** The country search. */
  search: (
    <>
      <Circle cx="11" cy="11" r="6.5" />
      <Path d="M16 16l4.5 4.5" />
    </>
  ),
  /** A picker that opens a list (the country). */
  chevronDown: <Path d="M6 9l6 6 6-6" />,
  /** "הזמן חברים" (the leaderboard's friends tab, D27). */
  share: (
    <>
      <Circle cx="18" cy="5" r="2.5" />
      <Circle cx="6" cy="12" r="2.5" />
      <Circle cx="18" cy="19" r="2.5" />
      <Path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" />
    </>
  ),
  /** A win streak (the player card, D28). */
  flame: <Path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .5 2 1.5 3 2.5 3 0-3-1-5 0-8z" />,
  /** A best move, a peak. */
  star: <Path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3z" />,
  /** "מדיניות פרטיות" (settings, stage 14). */
  shield: (
    <>
      <Path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z" />
      <Path d="M9 12l2 2 4-4" />
    </>
  ),
  /** "תנאי שימוש". */
  document: (
    <>
      <Path d="M6 3h8l4 4v14H6V3z" />
      <Path d="M14 3v4h4M9 12h6M9 16h6" />
    </>
  ),
  /** "דווח על שחקן" (spec §3.5): a flag on its pole. */
  flag: (
    <>
      <Path d="M5 21V4" />
      <Path d="M5 4h11l-2 4 2 4H5" />
    </>
  ),
  /** "חסום שחקן" (spec §3.5): a circle struck through. */
  block: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M5.6 5.6l12.8 12.8" />
    </>
  ),
  /** "רישיונות". */
  copyright: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M14.8 9.4a4 4 0 1 0 0 5.2" />
    </>
  ),
  /** Staged practice (components.md §19): a boss stage, on its node and in its panel. */
  crown: <Path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />,
  /** A chain (Idea-3): two links. */
  links: (
    <>
      <Path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <Path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  /** "מלא את הריבוע": a box of the board, 3 × 3. */
  gridBox: (
    <>
      <Rect x="4" y="4" width="16" height="16" rx="2" />
      <Path d="M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16" />
    </>
  ),
  /** "מלא את השורה" (1.0.3): one row of the board, three cells wide. */
  gridRow: (
    <>
      <Rect x="2.5" y="8.5" width="19" height="7" rx="1.5" />
      <Path d="M8.8 8.5v7M15.2 8.5v7" />
    </>
  ),
  /** "מלא את העמודה" (1.0.3): one column of the board, three cells tall. */
  gridCol: (
    <>
      <Rect x="8.5" y="2.5" width="7" height="19" rx="1.5" />
      <Path d="M8.5 8.8h7M8.5 15.2h7" />
    </>
  ),
  /** "פאזל" (1.0.3): two boxes trading places, an arrow each way. */
  puzzle: (
    <>
      <Rect x="3" y="3" width="8" height="8" rx="1.5" />
      <Rect x="13" y="13" width="8" height="8" rx="1.5" />
      <Path d="M13.5 7H16a2.5 2.5 0 0 1 2.5 2.5V11M16.5 9.5l2 2 2-2" />
      <Path d="M10.5 17H8a2.5 2.5 0 0 1-2.5-2.5V13M7.5 14.5l-2-2-2 2" />
    </>
  ),
  /** "דו־קרב ל־30": two crossed swords. */
  swords: (
    <>
      <Path d="M14.5 17.5L3 6V3h3l11.5 11.5" />
      <Path d="M13 19l6-6M16 16l4 4M19 21l2-2" />
      <Path d="M14.5 6.5L18 3h3v3l-3.5 3.5" />
      <Path d="M5 14l4 4M7 17l-3 3M3 19l2 2" />
    </>
  ),
  /** An open gate ("פרק 5 פתוח"): the lock with its shackle up. */
  unlock: (
    <>
      <Rect x="5" y="11" width="14" height="10" rx="2" />
      <Path d="M8 11V8a4 4 0 0 1 7.5-1.9" />
    </>
  ),
  /** "למפה" (a stage's result): a folded map. */
  map: (
    <>
      <Path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" />
      <Path d="M9 4v14M15 6v14" />
    </>
  ),
} as const;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

/** Drawn for right-to-left; mirrored when the layout runs left to right. */
const MIRRORED_IN_LTR: readonly IconName[] = ['chevronForward'];
/** Filled shapes rather than outlines. */
const FILLED: readonly IconName[] = ['bolt'];

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Fills the shape in its colour as well (a star earned, components.md §19.5); 'bolt' always is. */
  filled?: boolean;
}

export function Icon({
  name,
  size: px = size.icon.card,
  color: tint = color.textMuted,
  strokeWidth,
  filled: fill = false,
}: IconProps) {
  const filled = fill || FILLED.includes(name);
  const mirror = MIRRORED_IN_LTR.includes(name) && !I18nManager.isRTL;
  return (
    <Svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill={filled ? tint : 'none'}
      stroke={tint}
      strokeWidth={strokeWidth ?? (filled ? 1.5 : size.iconStroke)}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={mirror ? { transform: [{ scaleX: -1 }] } : undefined}
      testID={`icon-${name}`}
    >
      {ICONS[name]}
    </Svg>
  );
}
