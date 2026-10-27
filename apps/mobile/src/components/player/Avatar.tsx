import type { Expression } from '@sudoku-fight/avatars';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AvatarArt, type AvatarIdOrNone, type AvatarReaction } from '../../avatars';
import { color, text, tokens } from '../../theme';
import { Text } from '../ui/Text';
import type { Presence } from './cardModel';
import { AVATAR_SIZES, type AvatarSize, metrics, paletteAt } from './metrics';

export type GameResultKind = 'win' | 'loss' | 'draw';

export interface AvatarProps {
  /** Null or missing: the "no avatar" placeholder (av00). */
  avatarId?: AvatarIdOrNone | null;
  /** components.md §2: cell 22 · compact 34 · list 36 · card 44 · row 52 · home 72 · profile 96. */
  size?: AvatarSize;
  /**
   * The frame in a seat's ring colour (0 = me, P1). Null: the neutral frame, for other players outside a
   * game. Ignored by the unframed sizes (22, 36).
   */
  colorIndex?: number | null;
  /** Presence dot at the bottom-end corner; "left" shows none. */
  presence?: Presence | null;
  /** The colour behind the avatar, for the presence dot's ring. */
  backdrop?: string;
  bot?: boolean;
  /** The result badge of Home's recent games. */
  result?: GameResultKind | null;
  /** Reconnecting, left or surrendered: grayscale, dimmed, offline frame. */
  inactive?: boolean;
  /** The face (AvatarArt): the base expression, a reaction to play, and whether it idles on a stage view. */
  expression?: Expression;
  reaction?: AvatarReaction | null;
  /** A stage view (where: avatars AVATAR_STAGES): idle gimmicks and the blink, while its screen is shown. */
  idle?: boolean;
  /**
   * Alone on screen, the avatar speaks the player's name. Next to the name (almost always), leave it out and
   * the avatar is decorative.
   */
  label?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A player's picture in a frame (components.md §2). The frame is a border, not a filled plate. */
export function Avatar({
  avatarId,
  size = 'card',
  colorIndex = null,
  presence = null,
  backdrop = color.bg,
  bot = false,
  result = null,
  inactive = false,
  expression,
  reaction,
  idle = false,
  label,
  style,
  testID,
}: AvatarProps) {
  const { t } = useTranslation('player');
  const m = AVATAR_SIZES[size];
  const frameColor = inactive
    ? color.status.offline
    : colorIndex === null
      ? color.border
      : paletteAt(colorIndex).ring;
  const dot =
    m.frame >= metrics.presenceDot.largeFrom ? metrics.presenceDot.large : metrics.presenceDot.small;
  const standalone = label !== undefined;

  return (
    <View
      style={[{ width: m.frame, height: m.frame }, style]}
      accessible={standalone}
      accessibilityRole={standalone ? 'image' : undefined}
      accessibilityLabel={label}
      accessibilityElementsHidden={!standalone}
      importantForAccessibility={standalone ? 'yes' : 'no-hide-descendants'}
      testID={testID}
    >
      <View
        style={{
          width: m.frame,
          height: m.frame,
          borderRadius: m.frameRadius,
          borderWidth: m.border,
          borderColor: frameColor,
          padding: m.padding,
          opacity: inactive ? metrics.avatarDisconnectedOpacity : 1,
        }}
      >
        <AvatarArt
          avatarId={avatarId}
          size={m.image}
          radius={m.imageRadius}
          // The 22 dp one (a locked cell, a small list) shows the head: a whole character is lost that small.
          crop={size === 'cell' ? 'head' : 'tile'}
          expression={expression}
          reaction={reaction}
          idle={idle}
          inactive={inactive}
          testID={testID ? `${testID}-image` : undefined}
        />
      </View>

      {presence === 'online' || presence === 'unstable' || presence === 'reconnecting' ? (
        <View
          testID={`presence-${presence}`}
          style={[
            styles.dot,
            {
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              borderColor: backdrop,
              backgroundColor: PRESENCE_DOT[presence],
            },
          ]}
        />
      ) : null}

      {bot ? (
        <View style={styles.botChip} testID="bot-chip">
          <Text style={[metrics.botChip.text, styles.botText]}>{t('bot')}</Text>
        </View>
      ) : null}

      {result ? (
        <View style={styles.result} testID={`result-${result}`}>
          <Text style={[text('badge'), styles.resultText]}>{t(`result.${result}Short`)}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** The presence dot (components.md §2): green, amber while the connection is lost in its soft phase [D42], grey. */
const PRESENCE_DOT = {
  online: color.status.online,
  unstable: color.status.unstable,
  reconnecting: color.textMuted,
} as const;

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    bottom: metrics.presenceDot.offset,
    end: metrics.presenceDot.offset,
    borderWidth: metrics.presenceDot.border,
  },
  botChip: {
    position: 'absolute',
    top: metrics.botChip.top,
    start: metrics.botChip.start,
    height: metrics.botChip.height,
    paddingHorizontal: metrics.botChip.paddingX,
    borderRadius: metrics.botChip.radius,
    backgroundColor: color.bg,
    borderWidth: tokens.border.hairline,
    borderColor: color.textMuted,
    flexDirection: 'row',
    alignItems: 'center',
  },
  botText: { color: color.text },
  result: {
    position: 'absolute',
    top: metrics.resultBadge.offset,
    end: metrics.resultBadge.offset,
    width: metrics.resultBadge.size,
    height: metrics.resultBadge.size,
    borderRadius: metrics.resultBadge.size / 2,
    backgroundColor: color.resultBadge.bg,
    borderWidth: metrics.resultBadge.ring,
    borderColor: color.resultBadge.ring,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultText: { color: color.resultBadge.text, textAlign: 'center' },
});
