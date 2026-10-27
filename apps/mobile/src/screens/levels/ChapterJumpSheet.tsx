import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '../../components/Icon';
import { Star, STAR_SIZES } from '../../components/levels/StarRow';
import { ltr } from '../../components/player/format';
import { Sheet } from '../../components/ui';
import { Text } from '../../components/ui/Text';
import { color, radius, size, space, text, tokens } from '../../theme';
import { chapterName } from './levelWording';

/**
 * The chapter list (components.md §19.3, no board: built from C's tokens): the "★ 84/900" chip of the map's
 * header opens it. One row per chapter, its name, "★ 18/30", and a lock while it is closed; a row takes the map
 * to its chapter (`level.map.jump`) as the sheet goes.
 */

export interface ChapterRow {
  chapter: number;
  stars: number;
  max: number;
  open: boolean;
}

export interface ChapterJumpSheetProps {
  visible: boolean;
  chapters: readonly ChapterRow[];
  onClose: () => void;
  onJump: (chapter: number) => void;
  onExited?: () => void;
}

export function ChapterJumpSheet({ visible, chapters, onClose, onJump, onExited }: ChapterJumpSheetProps) {
  const { t } = useTranslation('levels');
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onExited={onExited}
      title={t('jump.title')}
      fill
      testID="chapter-jump"
    >
      <ScrollView style={styles.list} contentContainerStyle={styles.content}>
        {chapters.map((c) => {
          const name = chapterName(c.chapter, t);
          return (
            <Pressable
              key={c.chapter}
              accessibilityRole="button"
              accessibilityLabel={t('jump.rowLabel', {
                n: c.chapter,
                name,
                count: c.stars,
                stars: c.stars,
                max: c.max,
                state: t(c.open ? 'jump.open' : 'jump.locked'),
              })}
              onPress={() => onJump(c.chapter)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              testID={`chapter-jump-${c.chapter}`}
            >
              {c.open ? null : <Icon name="lock" size={size.icon.inline} color={color.textMuted} />}
              <Text style={[styles.name, !c.open && styles.muted]} numberOfLines={1}>
                {t('jump.row', { n: c.chapter, name })}
              </Text>
              <View style={styles.count}>
                <Star filled={c.stars > 0} size={STAR_SIZES.chip + 3} />
                <Text style={styles.countText}>
                  {ltr(t('chapterHeader.stars', { stars: c.stars, max: c.max }))}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { gap: space[3], paddingTop: space[4] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[5],
    minHeight: size.touch + space[4],
    paddingHorizontal: space[6],
    borderRadius: radius.lg,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface2,
  },
  pressed: { backgroundColor: color.border },
  name: { ...text('rowTitle'), color: color.text, flex: 1, minWidth: 0 },
  muted: { color: color.textMuted },
  count: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  countText: { ...text('scoreSm'), color: color.text },
});
