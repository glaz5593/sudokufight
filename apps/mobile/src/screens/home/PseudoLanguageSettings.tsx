import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ConfirmModal, RowButton } from '../../components/ui';
import { Text } from '../../components/ui/Text';
import { languageName, PSEUDO_LANGUAGES } from '../../i18n/languages';
import type { LanguageSetting } from '../../i18n/languageRules';
import { chooseLanguage, predictLanguage } from '../../i18n/languageSync';
import { cue } from '../../services/feedback';
import { useSettings } from '../../state/settings';
import { color, radius, space, text } from '../../theme';
import { Choice, type ChoiceOption } from './SettingControls';

/**
 * The settings' "בדיקה" section, its localization part (plan 0יג), in development and staging builds only (the
 * section is not drawn elsewhere, and i18n/pseudoLanguages.ts registers the languages only there):
 * - "שפה מדומה": "ללא" (back to "שפת המכשיר"), en-XA (accented English, about 40 % longer, between brackets)
 *   or ar-XB (English right to left). A choice goes the way of the language picker's (LanguagePicker): it asks first, since the
 *   app restarts (D104), then i18n/languageSync.ts chooseLanguage saves it and the root layout restarts. The
 *   picker field then shows the pseudo language by its code; any language there leaves it.
 * - "ריבוי ומספרים": the plural check screen (/dev/plurals).
 * Its words are the dev namespace's (D109: Hebrew and English only).
 */

const openPlurals = () => router.push('/dev/plurals');

export function PseudoLanguageSettings({ onOpenPlurals = openPlurals }: { onOpenPlurals?: () => void }) {
  const { t, i18n } = useTranslation('dev');
  const setting = useSettings((s) => s.language);
  // The choice waiting for the dialog's answer (kept while the dialog closes, for its title).
  const [pending, setPending] = useState<{ setting: LanguageSetting; open: boolean } | null>(null);

  const options: ChoiceOption<LanguageSetting>[] = [
    // None: back to the phone's language ("שפת המכשיר"); named apart from the picker's row of that name.
    { value: 'system', label: t('pseudo.none') },
    ...PSEUDO_LANGUAGES.map((lang) => ({ value: lang, label: languageName(lang) })),
  ];

  const choose = (next: LanguageSetting) => {
    if (next === setting) return;
    if (predictLanguage(next) === i18n.language) {
      chooseLanguage(next);
      cue('toggle');
      return;
    }
    setPending({ setting: next, open: true });
  };

  const answer = (confirmed: boolean) => {
    if (confirmed && pending) {
      chooseLanguage(pending.setting);
      cue('toggle');
    }
    setPending((p) => p && { ...p, open: false });
  };

  return (
    <View style={styles.block} testID="settings-pseudo">
      <View style={styles.card}>
        <View style={styles.texts}>
          <Text style={styles.title}>{t('pseudo.title')}</Text>
          <Text style={styles.hint}>{t('pseudo.hint')}</Text>
        </View>
        <Choice
          label={t('pseudo.title')}
          options={options}
          value={setting}
          onChange={choose}
          testID="setting-pseudo"
        />
      </View>
      <RowButton
        icon="document"
        title={t('pseudo.plurals')}
        accessibilityHint={t('pseudo.pluralsHint')}
        onPress={onOpenPlurals}
        testID="setting-plurals"
      />
      <ConfirmModal
        visible={pending?.open === true}
        placement="center"
        icon="refresh"
        title={
          pending?.setting === 'system'
            ? t('home:settings.languageConfirm.titleDevice')
            : t('home:settings.languageConfirm.title', {
                language: pending ? languageName(pending.setting) : '',
              })
        }
        body={t('home:settings.languageConfirm.body')}
        confirmLabel={t('home:settings.languageConfirm.confirm')}
        onConfirm={() => answer(true)}
        onCancel={() => answer(false)}
        testID="pseudo-confirm"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space[5] },
  card: {
    gap: space[5],
    paddingHorizontal: space[8],
    paddingVertical: space[6],
    backgroundColor: color.surface,
    borderRadius: radius.card,
  },
  texts: { gap: space[2], alignItems: 'flex-start' },
  title: { ...text('rowTitle'), color: color.text },
  hint: { ...text('caption'), color: color.textMuted },
});
