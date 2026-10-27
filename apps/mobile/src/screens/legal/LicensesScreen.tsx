import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import { ltr } from '../../components/player';
import { Text } from '../../components/ui/Text';
import {
  type LicensesData,
  licensesData,
  licenseTexts,
  type PackageRow,
  packageRows,
} from '../../legal/licenses';
import { color, radius, size, space, text, tokens } from '../../theme';
import { goBack } from '../home/navigation';
import { GUTTER, ScreenHeader, SectionLabel } from '../home/parts';

/**
 * Settings → "רישיונות" (spec §23 "רישיונות"; work plan stage 14): the fonts (Rubik, Teko: SIL OFL 1.1, with
 * the license's text), every open-source package in the app with its license and copyright, and the full text
 * of the common licenses. The data: src/legal/third-party-licenses.json (scripts/licenses.mjs). Names and
 * license texts are English, so they always read left to right.
 */
export interface LicensesScreenProps {
  /** Tests pass a small file; by default the generated one. */
  data?: LicensesData;
}

export function LicensesScreen({ data: given }: LicensesScreenProps) {
  const { t } = useTranslation('home');
  const { top, bottom } = useSafeAreaInsets();
  const data = given ?? licensesData();
  const rows = useMemo(() => packageRows(data), [data]);
  const texts = useMemo(() => licenseTexts(data), [data]);

  const header = (
    <View style={styles.head}>
      <Text style={styles.intro}>{t('licenses.intro')}</Text>
      <View style={styles.section}>
        <SectionLabel title={t('licenses.fonts')} />
        {data.fonts.map((font) => (
          <View key={font.family} style={styles.card} testID={`font-${font.family}`}>
            <Text style={styles.name}>{font.family}</Text>
            <Text style={styles.meta}>{t('licenses.fontLicense')}</Text>
            {font.copyright.map((line) => (
              <Text key={line} style={styles.copyright}>
                {line}
              </Text>
            ))}
          </View>
        ))}
        <Expandable title={t('licenses.fontLicense')} body={data.ofl} testID="license-text-OFL-1.1" />
      </View>
      <SectionLabel title={t('licenses.packages', { count: rows.length })} />
    </View>
  );

  const footer = (
    <View style={styles.section}>
      <SectionLabel title={t('licenses.texts')} />
      <Text style={styles.hint}>{t('licenses.textsHint')}</Text>
      {texts.map(({ id, text: body }) => (
        <Expandable key={id} title={id} body={body} testID={`license-text-${id}`} />
      ))}
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: top }]}>
      <ScreenHeader title={t('licenses.title')} onBack={goBack} style={styles.header} />
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item }) => <PackageItem row={item} />}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ItemSeparatorComponent={Separator}
        initialNumToRender={20}
        windowSize={11}
        contentContainerStyle={[styles.content, { paddingBottom: bottom + space[12] }]}
        testID="licenses-list"
      />
    </View>
  );
}

function PackageItem({ row }: { row: PackageRow }) {
  const { t } = useTranslation('home');
  return (
    <View
      accessible
      accessibilityLabel={t('licenses.packageLabel', {
        name: ltr(row.name),
        version: ltr(row.version),
        license: ltr(row.license),
      })}
      style={styles.row}
      testID={`package-${row.key}`}
    >
      <View style={styles.rowTop}>
        <Text style={[styles.name, styles.shrink]} numberOfLines={2}>
          {row.name}
        </Text>
        <Text style={styles.meta}>{row.version}</Text>
      </View>
      <Text style={styles.license}>{row.license}</Text>
      {row.copyright.map((line) => (
        <Text key={line} style={styles.copyright}>
          {line}
        </Text>
      ))}
    </View>
  );
}

function Separator() {
  return <View style={styles.rule} />;
}

/** A license's name; pressing it shows or hides its text (no animation: nothing moves for reduced motion). */
function Expandable({ title, body, testID }: { title: string; body: string; testID: string }) {
  const { t } = useTranslation('home');
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t(open ? 'licenses.hide' : 'licenses.show', { license: ltr(title) })}
        onPress={() => setOpen((o) => !o)}
        style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
        testID={testID}
      >
        <Text style={[styles.name, styles.shrink]}>{title}</Text>
        <View style={open ? styles.chevronOpen : styles.chevronClosed}>
          <Icon name="chevronDown" size={size.icon.chevron} color={color.iconFaint} />
        </View>
      </Pressable>
      {open ? (
        <Text style={styles.legalText} selectable testID={`${testID}-body`}>
          {body}
        </Text>
      ) : null}
    </View>
  );
}

/** Names, versions, copyright lines and license texts are English: left to right in either layout. */
const LTR = { writingDirection: 'ltr', textAlign: 'left' } as const;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { paddingHorizontal: GUTTER.screen },
  content: { paddingHorizontal: GUTTER.screen, paddingTop: space[6] },
  head: { gap: space[11], paddingBottom: space[5] },
  section: { gap: space[5], paddingTop: space[11] },
  intro: { ...text('body'), color: color.textMuted },
  hint: { ...text('caption'), color: color.textMuted },
  card: {
    gap: space[2],
    padding: space[6],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  row: { gap: space[1], paddingVertical: space[5] },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: space[4] },
  shrink: { flexShrink: 1 },
  name: { ...text('rowTitle'), color: color.text, ...LTR },
  meta: { ...text('caption'), color: color.textMuted, ...LTR },
  license: { ...text('label'), color: color.accent, ...LTR },
  copyright: { ...text('caption'), color: color.textFaint, ...LTR },
  rule: { height: tokens.border.hairline, backgroundColor: color.border },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[4],
    minHeight: size.touch,
  },
  pressed: { backgroundColor: color.pressedOverlay },
  chevronClosed: {},
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  legalText: { ...text('caption'), color: color.textMuted, ...LTR },
});
