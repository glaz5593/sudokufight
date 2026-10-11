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
  /** The avatar's bot chip (components.md §2). */
  bot: (
    <>
      <Rect x="5" y="8" width="14" height="12" rx="3" />
      <Path d="M12 8V4.5" />
      <Path d="M9.5 13.5h.01M14.5 13.5h.01" />
      <Path d="M2.5 13v3M21.5 13v3" />
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
  /** "רישיונות". */
  copyright: (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M14.8 9.4a4 4 0 1 0 0 5.2" />
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
}

export function Icon({
  name,
  size: px = size.icon.card,
  color: tint = color.textMuted,
  strokeWidth,
}: IconProps) {
  const filled = FILLED.includes(name);
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
