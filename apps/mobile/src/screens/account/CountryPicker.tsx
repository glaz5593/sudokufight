import { COUNTRY_CODES, type CountryCode } from '@sudoku-fight/protocol';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Icon } from '../../components/Icon';
import { countryName, flagEmoji } from '../../components/player';
import { Sheet } from '../../components/ui';
import { color, radius, size, space, text } from '../../theme';
import { countrySearchTerms, foldForSearch } from './countrySearch';
import { Field } from './Field';
import { PickerField } from './PickerField';

/**
 * The country (spec §3.1 [D21]: detected from the phone, can change any time; shown as a flag): a field like
 * the name's ("🇮🇱 ישראל · שינוי ⌄"), and a tall sheet with a search and every country, its flag and its full
 * name in the app's language, sorted by that name. The names are our own tables (countryName): the phone's
 * engine has none.
 */

export interface CountryOption {
  code: CountryCode;
  name: string;
  /**
   * What a search may match (countrySearch.ts): its names in both languages and the other names people use,
   * folded, so a search in Latin letters finds it in Hebrew too, and back, as the phone's keyboard types it.
   */
  terms: readonly string[];
  flag: string;
}

/** How much of the list renders at once: a sheet's worth at first, then more as it scrolls. */
export const COUNTRY_LIST = { initialNumToRender: 14, maxToRenderPerBatch: 12, windowSize: 7 };

/** A name's line in the list (rowTitle). */
const NAME_LINE = text('rowTitle').lineHeight ?? size.icon.row;

/** Every country with its name in `language`, sorted by that name (Intl.Collator: Hermes has it). */
export function countryOptions(language: string): CountryOption[] {
  const options = COUNTRY_CODES.map((code) => ({
    code,
    name: countryName(code, language),
    terms: countrySearchTerms(code, [countryName(code, 'he'), countryName(code, 'en')]),
    flag: flagEmoji(code) ?? '',
  }));
  let compare: (a: string, b: string) => number;
  try {
    compare = new Intl.Collator(language).compare;
  } catch {
    compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  }
  return options.sort((a, b) => compare(a.name, b.name));
}

/**
 * The options one of whose names contains the query, or whose code it is, both folded (countrySearch.ts);
 * those the query names exactly ("uk", "usa", "il") first, then the rest in the list's order.
 */
export function filterCountries(options: readonly CountryOption[], query: string): CountryOption[] {
  const q = foldForSearch(query);
  if (!q) return [...options];
  const exact: CountryOption[] = [];
  const partial: CountryOption[] = [];
  for (const o of options) {
    if (o.code.toLowerCase() === q || o.terms.includes(q)) exact.push(o);
    else if (o.terms.some((term) => term.includes(q))) partial.push(o);
  }
  return [...exact, ...partial];
}

/** A row of the list: up to two lines of the name, at the text size the phone asks for. */
export function countryRowHeight(fontScale: number): number {
  return Math.max(size.listRow, Math.ceil(2 * NAME_LINE * fontScale) + 2 * space[4]);
}

export function CountryPicker({
  value,
  onChange,
  error,
  hint,
  testID = 'country',
}: {
  value: CountryCode | null;
  onChange: (code: CountryCode) => void;
  error?: string | null;
  hint?: string | null;
  testID?: string;
}) {
  const { t, i18n } = useTranslation('account');
  const [open, setOpen] = useState(false);
  const name = value ? countryName(value, i18n.language) : null;

  return (
    <>
      <PickerField
        label={t('fields.country')}
        value={name}
        placeholder={t('country.choose')}
        leading={value ? <Text style={styles.flag}>{flagEmoji(value)}</Text> : null}
        accessibilityLabel={name ? t('country.label', { country: name }) : t('country.choose')}
        accessibilityHint={t('country.sheetTitle')}
        onPress={() => setOpen(true)}
        error={error}
        hint={hint}
        testID={testID}
      />
      <CountrySheet
        visible={open}
        value={value}
        onChoose={(code) => {
          setOpen(false);
          onChange(code);
        }}
        onClose={() => setOpen(false)}
        testID={testID}
      />
    </>
  );
}

function CountrySheet({
  visible,
  value,
  onChoose,
  onClose,
  testID,
}: {
  visible: boolean;
  value: CountryCode | null;
  onChoose: (code: CountryCode) => void;
  onClose: () => void;
  testID: string;
}) {
  const { t, i18n } = useTranslation('account');
  const { fontScale } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const options = useMemo(() => countryOptions(i18n.language), [i18n.language]);
  const shown = useMemo(() => filterCountries(options, query), [options, query]);
  const row = countryRowHeight(fontScale);
  // The list opens on the chosen country, a couple of rows down from the top.
  const chosenAt = value ? options.findIndex((o) => o.code === value) : -1;
  const initialIndex = query === '' && chosenAt > 2 ? chosenAt - 2 : undefined;

  const close = () => {
    setQuery('');
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={close} title={t('country.sheetTitle')} fill testID={`${testID}-sheet`}>
      <View style={styles.body}>
        <Field
          label={t('country.search')}
          icon="search"
          value={query}
          onChangeText={setQuery}
          placeholder={t('country.searchPlaceholder')}
          autoCorrect={false}
          autoCapitalize="none"
          testID={`${testID}-search`}
        />
        <FlatList
          data={shown}
          keyExtractor={(o) => o.code}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          getItemLayout={(_, index) => ({ length: row, offset: row * index, index })}
          initialScrollIndex={initialIndex}
          initialNumToRender={COUNTRY_LIST.initialNumToRender}
          maxToRenderPerBatch={COUNTRY_LIST.maxToRenderPerBatch}
          windowSize={COUNTRY_LIST.windowSize}
          ListEmptyComponent={<Text style={styles.empty}>{t('country.none')}</Text>}
          renderItem={({ item }) => {
            const on = item.code === value;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.name}
                accessibilityState={{ selected: on }}
                onPress={() => {
                  setQuery('');
                  onChoose(item.code);
                }}
                style={({ pressed }) => [
                  styles.option,
                  { height: row },
                  on && styles.optionOn,
                  pressed && styles.pressed,
                ]}
                testID={`${testID}-option-${item.code}`}
              >
                <Text style={styles.optionFlag}>{item.flag}</Text>
                <Text style={styles.optionName} numberOfLines={2}>
                  {item.name}
                </Text>
                {on ? <Icon name="check" size={size.icon.card} color={color.accent} /> : null}
              </Pressable>
            );
          }}
          testID={`${testID}-list`}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flag: { fontSize: size.flag.home, lineHeight: size.icon.header },
  body: { flex: 1, gap: space[6] },
  list: { flex: 1 },
  empty: { ...text('body'), color: color.textMuted, textAlign: 'center', paddingVertical: space[8] },
  pressed: { backgroundColor: color.surface2 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[6],
    paddingHorizontal: space[6],
    borderRadius: radius.button,
  },
  optionOn: { backgroundColor: color.surface2 },
  optionFlag: { fontSize: size.icon.header, lineHeight: size.icon.nav + space[2] },
  optionName: { ...text('rowTitle'), color: color.text, flex: 1 },
});
