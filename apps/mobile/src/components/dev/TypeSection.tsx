import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { color, radius, size, space, text, tokens } from '../../theme';
import { Icon, ICON_NAMES } from '../Icon';
import { RADII, TYPE_SCALE, typeSpecLine } from './foundations';
import { columnWidth, DsGroup, Specimen, SpecimenRow, useContentWidth } from './Primitives';

/**
 * Foundations · type, spacing, radii and icons (DS-Foundations, direction C): every type token with a sample in
 * its own style, the 4-dp spacing scale, the radii, and the stroke icon set.
 */
export function TypeSection() {
  const { t } = useTranslation('dev');
  const content = useContentWidth();
  const iconCell = columnWidth(content, 5);
  return (
    <>
      <DsGroup title={t('type.title')}>
        {TYPE_SCALE.map((s) => (
          <View key={s.name} style={styles.typeRow} testID={`type-${s.name}`}>
            <Text style={[text(s.name), styles.sample]} numberOfLines={1}>
              {s.numeric ? t('type.numberSample') : t('type.sample')}
            </Text>
            <View style={styles.typeMeta}>
              <Text style={styles.token}>{s.name}</Text>
              <Text style={styles.muted}>{typeSpecLine(s)}</Text>
            </View>
          </View>
        ))}
      </DsGroup>

      <DsGroup title={t('type.spacing')}>
        {tokens.space.slice(1).map((v, i) => (
          <View key={v} style={styles.spaceRow}>
            <Text style={[styles.token, styles.spaceName]}>{`space[${i + 1}] · ${v}`}</Text>
            <View style={[styles.spaceBar, { width: v }]} />
          </View>
        ))}
      </DsGroup>

      <DsGroup title={t('type.radii')}>
        <SpecimenRow>
          {RADII.map(([name, value]) => (
            <Specimen key={name} label={`${name} · ${value}`}>
              <View style={[styles.radiusBox, { borderRadius: value }]} />
            </Specimen>
          ))}
        </SpecimenRow>
      </DsGroup>

      <DsGroup title={t('type.icons')}>
        <View style={styles.icons}>
          {ICON_NAMES.map((name) => (
            <Specimen key={name} label={name} width={iconCell}>
              <View style={styles.iconBox}>
                <Icon name={name} size={size.icon.nav} color={color.text} />
              </View>
            </Specimen>
          ))}
        </View>
      </DsGroup>
    </>
  );
}

const styles = StyleSheet.create({
  typeRow: {
    gap: space[2],
    paddingVertical: space[4],
    borderBottomWidth: tokens.border.hairline,
    borderBottomColor: color.border,
  },
  sample: { color: color.text, includeFontPadding: false },
  typeMeta: { flexDirection: 'row', justifyContent: 'space-between', gap: space[4] },
  token: { ...text('micro'), color: color.text, writingDirection: 'ltr' },
  muted: { ...text('caption'), color: color.textMuted, writingDirection: 'ltr' },
  spaceRow: { flexDirection: 'row', alignItems: 'center', gap: space[6] },
  spaceName: { width: space[15] + space[12] },
  spaceBar: { height: space[4], borderRadius: radius.bar, backgroundColor: color.players[0].ring },
  radiusBox: {
    width: space[14],
    height: space[14],
    borderWidth: tokens.border.avatarFrame,
    borderColor: color.accent,
    backgroundColor: color.surface2,
  },
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: space[4] },
  iconBox: {
    width: size.iconButton,
    height: size.iconButton,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
});
