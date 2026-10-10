import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { AVATARS, type AvatarId, EMPTY_AVATAR } from '../../assets/avatars';
import { color, text, tokens } from '../../theme';
import type { Presence } from './cardModel';
import { AVATAR_SIZES, type AvatarSize, metrics, paletteAt } from './metrics';

export type GameResultKind = 'win' | 'loss' | 'draw';

export interface AvatarProps {
  /** Null or missing: the empty avatar (av00). */
  avatarId?: AvatarId | null;
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
  label,
  style,
  testID,
}: AvatarProps) {
  const { t } = useTranslation('player');
  const m = AVATAR_SIZES[size];
  const id = avatarId ?? EMPTY_AVATAR;
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
        <View style={inactive ? styles.grayscale : undefined}>
          <Image
            source={AVATARS[id]}
            style={{ width: m.image, height: m.image, borderRadius: m.imageRadius }}
            contentFit="cover"
            accessible={false}
            testID={testID ? `${testID}-image` : undefined}
          />
        </View>
      </View>

      {presence === 'online' || presence === 'reconnecting' ? (
        <View
          testID={`presence-${presence}`}
          style={[
            styles.dot,
            {
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              borderColor: backdrop,
              backgroundColor: presence === 'online' ? color.status.online : color.textMuted,
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

const styles = StyleSheet.create({
  grayscale: { filter: [{ grayscale: 1 }] },
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
