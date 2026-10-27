import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatScore, ltr } from '../components/player/format';
import { Text } from '../components/ui/Text';
import i18n, { localeBundle } from '../i18n';
import { dateFormat, decimalSeparator, listOf, percent } from '../i18n/compose';
import { pluralKeys } from '../i18n/pseudo';
import { pluralCategories } from '../services/pluralRules';
import { color, radius, space, text, tokens } from '../theme';
import { GUTTER, ScreenHeader, SectionLabel } from './home/parts';

/**
 * Settings → "בדיקה" → "ריבוי ומספרים" (localization plan 0יג, 6.2; doc 5.4), development and staging builds only
 * (app/dev/plurals.tsx): every plural key of the app with 0, 1, 2, 5, 11, 21, 100 and 1.5 in the language the
 * app runs in, each with the form i18next picked (_one, _two, _few…), and where a form is missing in the language,
 * the language it fell back to. Above them, a date in words and in digits and a decimal number and a percent as
 * the app writes them (D108: Western digits, the language's separator). So Moshe sees on his phone that the
 * plural rules (services/pluralRules.ts) and the digits work, in Hebrew and in the pseudo languages before any
 * translation. Its words are the dev namespace's (D109: Hebrew and English only).
 */

/** The counts of the check (doc 5.4), and a half: a decimal takes the "other" form in most languages. */
export const PLURAL_COUNTS = [0, 1, 2, 5, 11, 21, 100, 1.5] as const;

/** The keys the screen lists: every plural key of the app, as English has them (each language has the same). */
export function pluralCheckKeys(): string[] {
  const english = localeBundle('en');
  return english ? pluralKeys(english) : [];
}

/** A placeholder's sample value besides the count: a name for a person or a thing, else a number. */
const NAMED = /name|who|player|bot|title|kind|mode|type|text|word/i;

/** The other placeholders of a key (its English _other form's), each with a sample value. */
export function pluralSamples(key: string): Record<string, string | number> {
  const colon = key.indexOf(':');
  const english = i18n.getResource('en', key.slice(0, colon), `${key.slice(colon + 1)}_other`) as unknown;
  const out: Record<string, string | number> = {};
  if (typeof english !== 'string') return out;
  for (const [, name] of english.matchAll(/\{\{\s*(\w+)/g)) {
    if (name && name !== 'count') out[name] = NAMED.test(name) ? 'Nina' : 7;
  }
  return out;
}

interface Line {
  count: number;
  /** The form i18next used: "one", "few", "zero"… */
  form: string;
  words: string;
  /** The language it came from, when not the app's (a form missing in it). */
  from: string | null;
}

/** A key with every count, as i18next resolves it in `lang`. */
function linesOf(key: string, lang: string): Line[] {
  const samples = pluralSamples(key);
  return PLURAL_COUNTS.map((count) => {
    const found = i18n.t(key, { ...samples, count, lng: lang, returnDetails: true }) as unknown as {
      res: string;
      exactUsedKey: string;
      usedLng: string;
    };
    const form = /_(zero|one|two|few|many|other)$/.exec(found.exactUsedKey)?.[1] ?? '';
    return { count, form, words: found.res, from: found.usedLng === lang ? null : found.usedLng };
  });
}

/** Formats with Intl, or a dash where the phone's Intl can't read the tag (it would throw). */
function safely(format: () => string): string {
  try {
    return format();
  } catch {
    return '—';
  }
}

export interface PluralCheckScreenProps {
  onClose: () => void;
  /** The date shown; today's by default. */
  now?: Date;
}

export function PluralCheckScreen({ onClose, now = new Date() }: PluralCheckScreenProps) {
  const { t } = useTranslation('dev');
  const { top, bottom } = useSafeAreaInsets();
  const lang = i18n.language;
  const keys = useMemo(() => pluralCheckKeys(), []);
  const decimal = decimalSeparator(t);

  const numbers: [string, string, string][] = [
    [
      'date',
      t('plurals.dateLong'),
      safely(() => dateFormat(lang, { year: 'numeric', month: 'long', day: 'numeric' }).format(now)),
    ],
    [
      'digits',
      t('plurals.dateDigits'),
      safely(() => dateFormat(lang, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)),
    ],
    ['decimal', t('plurals.decimal'), ltr(formatScore(39.5, decimal))],
    ['percent', t('plurals.percent'), ltr(percent(57, t))],
  ];

  const header = (
    <View style={styles.head}>
      <View style={styles.section}>
        <SectionLabel title={t('plurals.numbers')} />
        <View style={styles.card}>
          {numbers.map(([id, label, value]) => (
            <View key={id} style={styles.line} testID={`plurals-${id}`}>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.value} testID={`plurals-${id}-value`}>
                {value}
              </Text>
            </View>
          ))}
        </View>
      </View>
      <SectionLabel title={t('plurals.keys')} />
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: top }]} testID="plural-check">
      <ScreenHeader
        title={t('plurals.title')}
        subtitle={t('plurals.subtitle', {
          language: ltr(lang),
          forms: ltr(listOf([...pluralCategories(lang)], t)),
        })}
        onBack={onClose}
        style={styles.header}
      />
      <FlatList
        data={keys}
        keyExtractor={(key) => key}
        renderItem={({ item }) => <PluralKey pluralKey={item} lang={lang} decimal={decimal} />}
        ListHeaderComponent={header}
        ItemSeparatorComponent={Gap}
        initialNumToRender={6}
        contentContainerStyle={[styles.content, { paddingBottom: bottom + space[12] }]}
      />
    </View>
  );
}

function PluralKey({ pluralKey, lang, decimal }: { pluralKey: string; lang: string; decimal: string }) {
  const { t } = useTranslation('dev');
  const lines = useMemo(() => linesOf(pluralKey, lang), [pluralKey, lang]);
  return (
    <View style={styles.card} testID={`plural-${pluralKey}`}>
      <Text style={styles.key}>{ltr(pluralKey)}</Text>
      {lines.map((line) => (
        <View key={line.count} style={styles.count} testID={`plural-${pluralKey}-${line.count}`}>
          <Text style={styles.number}>{ltr(formatScore(line.count, decimal))}</Text>
          <Text style={styles.form}>{ltr(`_${line.form}`)}</Text>
          <View style={styles.words}>
            <Text style={styles.value}>{line.words}</Text>
            {line.from ? (
              <Text style={styles.fallback}>{t('plurals.fallback', { language: ltr(line.from) })}</Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const Gap = () => <View style={styles.gap} />;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { paddingHorizontal: GUTTER.screen },
  content: { paddingHorizontal: GUTTER.screen, paddingTop: space[6] },
  head: { gap: space[11], paddingBottom: space[5] },
  section: { gap: space[5] },
  card: {
    gap: space[3],
    padding: space[6],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  gap: { height: space[4] },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: space[5] },
  label: { ...text('caption'), color: color.textMuted, flexShrink: 0 },
  value: { ...text('body'), color: color.text, flexShrink: 1 },
  key: { ...text('label'), color: color.accent },
  count: { flexDirection: 'row', alignItems: 'baseline', gap: space[4] },
  number: { ...text('label'), color: color.text, minWidth: space[11] },
  form: { ...text('caption'), color: color.textFaint, minWidth: space[12] },
  words: { flex: 1, minWidth: 0, gap: space[1] },
  fallback: { ...text('caption'), color: color.warning },
});
