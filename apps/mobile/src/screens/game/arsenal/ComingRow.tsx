import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '../../../components/Icon';
import { color, radius, size, space, text, tokens } from '../../../theme';
import { FUTURE_INTERFERENCES } from '../../progress/progressModel';

/** Interference-Target's locked chips: 32 high, radius 10, a 12 dp lock and the name. */
const CHIP_HEIGHT = space[12];

export interface ComingRowProps {
  testID?: string;
}

/**
 * "נפתחות בהמשך" at the foot of the arsenal (Arsenal and Interference-Target; components.md §13 "Locked tokens";
 * spec §7.1): the four interferences that come after V1 (דיו, רעידת אדמה, ערפל, בועות), as dashed, faint
 * chips with a lock, never draggable. The boards' "רמה 18" chips are replaced by "בקרוב": the level table
 * comes in V1.1 [D17], as in the interferences collection. The board's "כל ההפרעות" link is left out: it
 * would leave a live game. One element for screen readers.
 */
export function ComingRow({ testID = 'arsenal-coming' }: ComingRowProps) {
  const { t } = useTranslation('game');
  const { t: tp } = useTranslation('progress');
  const names = FUTURE_INTERFERENCES.map((kind) => tp(`interferences.future.${kind}`));
  return (
    <View
      accessible
      accessibilityLabel={t('arsenal.comingLabel', { names: names.join(t('listSep')) })}
      style={styles.root}
      testID={testID}
    >
      <View style={styles.head}>
        <Icon name="lock" size={space[7]} color={color.textMuted} />
        <Text style={styles.title}>{t('arsenal.comingTitle')}</Text>
        <View style={styles.rule} />
        <Text style={styles.note}>{tp('interferences.soon')}</Text>
      </View>
      <View style={styles.chips}>
        {FUTURE_INTERFERENCES.map((kind, i) => (
          <View key={kind} style={styles.chip} testID={`${testID}-${kind}`}>
            <Icon name="lock" size={space[6]} color={color.iconFaint} />
            <Text style={styles.chipText} numberOfLines={1}>
              {names[i]}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[4], marginTop: space[7] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  title: { ...text('micro'), color: color.textMuted },
  rule: { flex: 1, height: tokens.border.hairline, backgroundColor: color.border },
  note: { ...text('micro'), color: color.textMuted },
  chips: { flexDirection: 'row', gap: space[3] },
  chip: {
    flex: 1,
    minWidth: 0,
    height: CHIP_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    paddingHorizontal: space[2],
    borderRadius: radius.md,
    borderWidth: tokens.border.hairline,
    borderStyle: 'dashed',
    borderColor: color.border,
    backgroundColor: color.bg,
  },
  chipText: { ...text('micro'), color: color.textMuted, flexShrink: 1 },
});

/**
 * The window height (640) under which the tray leaves the row out, so that within its 85 % the tokens and the
 * hint always fit (the tray can't scroll: its tokens are dragged).
 */
export const COMING_ROW_MIN_WINDOW = size.listRow * 10;
