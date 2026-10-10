import Svg, { Path, Rect } from 'react-native-svg';

import { color, size } from '../../../theme';

/**
 * Icons the connection screens need that the app's set (components/Icon) doesn't have yet, drawn the same
 * way: 24 × 24, stroke 2, round caps and joins. Decorative: the control around them carries the label.
 */
const GLYPHS = {
  /** "המשחק נשמר בשרת" (Opponent-Reconnecting). */
  server: (
    <>
      <Rect x="3" y="4" width="18" height="7" rx="2" />
      <Rect x="3" y="13" width="18" height="7" rx="2" />
      <Path d="M7 7.5h.01M7 16.5h.01" />
    </>
  ),
  /** Share the room code. */
  share: (
    <>
      <Path d="M12 3v12" />
      <Path d="M7.5 7.5L12 3l4.5 4.5" />
      <Path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </>
  ),
  /** Copy the room code. */
  copy: (
    <>
      <Rect x="8" y="8" width="12" height="12" rx="2" />
      <Path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  /** A cable unplugged: the connection error. */
  plug: (
    <>
      <Path d="M9 7V3M15 7V3" />
      <Path d="M6 7h12v3a6 6 0 0 1-6 6v0a6 6 0 0 1-6-6V7z" />
      <Path d="M12 16v5" />
      <Path d="M3 3l18 18" />
    </>
  ),
} as const;

export type ConnectionIconName = keyof typeof GLYPHS;

export interface ConnectionIconProps {
  name: ConnectionIconName;
  size?: number;
  color?: string;
}

export function ConnectionIcon({
  name,
  size: px = size.icon.card,
  color: tint = color.textMuted,
}: ConnectionIconProps) {
  return (
    <Svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke={tint}
      strokeWidth={size.iconStroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={`icon-${name}`}
    >
      {GLYPHS[name]}
    </Svg>
  );
}
