import { COUNTRY_CODES, type CountryCode } from '@sudoku-fight/protocol';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '../../components/Icon';
import { countryName, flagEmoji } from '../../components/player';
import { Sheet } from '../../components/ui';
import { color, radius, size, space, text, tokens } from '../../theme';
import { Field } from './Field';

/**
 * The country (spec §3.1 [D21]: detected from the phone, can change any time; shown as a flag): a picker row
 * like the design's ("🇮🇱 ישראל ⌄"), and a sheet with a search and every country, by name in the app's
 * language.
 */

export interface CountryOption {
  code: CountryCode;
  name: string;
  flag: string;
}

/** Every country with its name in `language`, sorted by that name. */
export function countryOptions(language: string): CountryOption[] {
  return COUNTRY_CODES.map((code) => ({
    code,
    name: countryName(code, language),
    flag: flagEmoji(code) ?? '',
  })).sort((a, b) => a.name.localeCompare(b.name, language));
}

/** The options whose name or code contains the query (case-insensitive). */
export function filterCountries(options: readonly CountryOption[], query: string): CountryOption[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [...options];
  return options.filter((o) => o.name.toLocaleLowerCase().includes(q) || o.code.toLowerCase() === q);
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
  const [query, setQuery] = useState('');
  const options = useMemo(() => countryOptions(i18n.language), [i18n.language]);
  const shown = useMemo(() => filterCountries(options, query), [options, query]);
  const name = value ? countryName(value, i18n.language) : null;

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label} importantForAccessibility="no">
        {t('fields.country')}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={name ? t('country.label', { country: name }) : t('country.choose')}
        accessibilityHint={t('country.sheetTitle')}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.row, error ? styles.rowError : null, pressed && styles.pressed]}
        testID={testID}
      >
        {value ? <Text style={styles.flag}>{flagEmoji(value)}</Text> : null}
        <Text style={[styles.name, !value && styles.placeholder]} numberOfLines={1}>
          {name ?? t('country.choose')}
        </Text>
        <Icon name="chevronDown" size={size.icon.chevron} color={color.textMuted} />
      </Pressable>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert" testID={`${testID}-error`}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}

      <Sheet visible={open} onClose={close} title={t('country.sheetTitle')} testID={`${testID}-sheet`}>
        <View style={styles.sheetBody}>
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
            initialNumToRender={20}
            ListEmptyComponent={<Text style={styles.empty}>{t('country.none')}</Text>}
            renderItem={({ item }) => {
              const on = item.code === value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={item.name}
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    onChange(item.code);
                    close();
                  }}
                  style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && styles.pressed]}
                  testID={`${testID}-option-${item.code}`}
                >
                  <Text style={styles.flag}>{item.flag}</Text>
                  <Text style={styles.optionName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {on ? <Icon name="check" size={size.icon.card} color={color.accent} /> : null}
                </Pressable>
              );
            }}
          />
        </View>
      </Sheet>
    </View>
  );
}

const LIST_HEIGHT = size.listRow * 6;

const styles = StyleSheet.create({
  wrap: { gap: space[4] },
  label: { ...text('label'), color: color.input.label, alignSelf: 'flex-start' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    minHeight: size.input,
    paddingHorizontal: space[6],
    borderRadius: radius.button,
    borderWidth: tokens.border.hairline,
    borderColor: color.input.border,
    backgroundColor: color.input.bg,
  },
  rowError: { borderColor: color.input.borderError },
  pressed: { backgroundColor: color.surface },
  flag: { fontSize: size.flag.home, lineHeight: size.icon.header },
  name: { ...text('input'), color: color.input.text, flex: 1 },
  placeholder: { color: color.input.placeholder },
  error: { ...text('caption'), color: color.danger, alignSelf: 'flex-start' },
  hint: { ...text('caption'), color: color.textMuted, alignSelf: 'flex-start' },
  sheetBody: { gap: space[6] },
  list: { maxHeight: LIST_HEIGHT },
  empty: { ...text('body'), color: color.textMuted, textAlign: 'center', paddingVertical: space[8] },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[6],
    minHeight: size.touch,
    paddingHorizontal: space[6],
    borderRadius: radius.button,
  },
  optionOn: { backgroundColor: color.surface2 },
  optionName: { ...text('rowTitle'), color: color.text, flex: 1 },
});
