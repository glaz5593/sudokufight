import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { Text } from '../../components/ui/Text';
import { color, size, text, tokens } from '../../theme';
import type { OutOfGame } from './model';

export interface OutStripProps {
  out: OutOfGame;
  /** Online: "לבית" leaves the room (the game goes on without me; my place is fixed already). */
  onLeave?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const row = tokens.layout.game.lockStatusRow;

/**
 * Out of a game of 3–4 that goes on (spec §6.6, §6.7, D36): in place of my lock strip, "נכנעת · מקום 4" and
 * "המשחק ממשיך עד הסוף". I keep watching (the board, the cards and the live region go on; the board and the
 * keypad take nothing), my solved cells keep my colour, and the results open when the game ends, with the
 * full ranking. Online, "לבית" leaves now instead. One accessible line; static (nothing moves).
 */
export function OutStrip({ out, onLeave, style, testID = 'out-strip' }: OutStripProps) {
  const { t } = useTranslation('game');
  const title = t(`out.${out.how}`, { place: out.place });
  const goesOn = t('out.goesOn');
  return (
    <View style={[styles.strip, style]} testID={testID}>
      <View
        style={styles.text}
        accessible
        accessibilityRole="text"
        accessibilityLabel={t('out.label', { title, goesOn })}
      >
        <Icon name="surrender" size={size.icon.inline} color={color.textMuted} />
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {goesOn}
        </Text>
      </View>
      {onLeave ? (
        <Button
          label={t('out.home')}
          variant="ghost"
          icon="home"
          accessibilityHint={t('out.homeHint')}
          onPress={onLeave}
          testID={`${testID}-home`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    minHeight: row.height,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: row.gap,
  },
  text: { flexDirection: 'row', alignItems: 'center', gap: row.innerGap, flexShrink: 1 },
  title: { ...text('label'), color: color.text, flexShrink: 0 },
  muted: { ...text('label'), color: color.textMuted, flexShrink: 1 },
});
