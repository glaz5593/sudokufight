import { ENGINE_VERSION } from '@sudoku-fight/engine';
import Constants from 'expo-constants';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmModal } from '../../components/ui';
import type { Language } from '../../i18n';
import { cue } from '../../services/feedback';
import { type ReduceMotionSetting, useSettings } from '../../state/settings';
import { AccountSettings } from '../account/AccountSettings';
import { color, radius, space, text, tokens } from '../../theme';
import { goBack } from './navigation';
import { GUTTER, ScreenHeader, SectionLabel } from './parts';
import { Choice, SwitchRow } from './SettingControls';

const REDUCE_MOTION: readonly ReduceMotionSetting[] = ['system', 'on', 'off'];
const LANGUAGES: readonly Language[] = ['he', 'en'];

/**
 * "הגדרות" (spec §4.1; no board yet, built in direction C with the design-system pieces): sound, haptics,
 * reduced motion and language, kept in the persisted settings store. A language that flips the layout direction
 * restarts the app (the root layout does it), so the switch asks first (work plan stage 13). Stage 8 adds the
 * account: edit profile, sign out, and delete the account (spec §3.3, §23: deletion inside the app).
 */
/** The app's version from its config (app.json), or null where the config is not embedded. */
export const appVersion = (): string | null => Constants.expoConfig?.version ?? null;

export interface SettingsScreenProps {
  /** The version line; by default the app's own. Null hides the line. */
  version?: string | null;
}

export function SettingsScreen({ version = appVersion() }: SettingsScreenProps) {
  const { t } = useTranslation('home');
  const { top, bottom } = useSafeAreaInsets();
  const sound = useSettings((s) => s.sound);
  const haptics = useSettings((s) => s.haptics);
  const reduceMotion = useSettings((s) => s.reduceMotion);
  const language = useSettings((s) => s.language);
  // The language the player tapped, until they confirm the restart (kept while the dialog closes).
  const [switchTo, setSwitchTo] = useState<{ language: Language; asking: boolean } | null>(null);

  // The cue comes after the change, so it follows the new setting: turning sound on is heard, turning it off is not.
  const changed =
    <T,>(apply: (value: T) => void) =>
    (value: T) => {
      apply(value);
      cue('toggle');
    };

  return (
    <View style={[styles.screen, { paddingTop: top }]}>
      <ScreenHeader title={t('settings.title')} onBack={goBack} style={styles.header} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom + space[12] }]}>
        <Section title={t('settings.feedback')}>
          <View style={styles.card}>
            <SwitchRow
              title={t('settings.sound')}
              hint={t('settings.soundHint')}
              value={sound}
              onChange={changed(useSettings.getState().setSound)}
              testID="setting-sound"
            />
            <View style={styles.rule} />
            <SwitchRow
              title={t('settings.haptics')}
              hint={t('settings.hapticsHint')}
              value={haptics}
              onChange={changed(useSettings.getState().setHaptics)}
              testID="setting-haptics"
            />
          </View>
        </Section>

        <Section title={t('settings.motion')} hint={t('settings.motionHint')}>
          <Choice
            label={t('settings.motion')}
            options={REDUCE_MOTION.map((value) => ({ value, label: t(`settings.reduceMotion.${value}`) }))}
            value={reduceMotion}
            onChange={changed(useSettings.getState().setReduceMotion)}
            testID="setting-motion"
          />
        </Section>

        <Section title={t('settings.language')} hint={t('settings.languageHint')}>
          <Choice
            label={t('settings.language')}
            options={LANGUAGES.map((value) => ({ value, label: t(`settings.languages.${value}`) }))}
            value={language}
            onChange={(value) => setSwitchTo({ language: value, asking: true })}
            testID="setting-language"
          />
        </Section>

        <AccountSettings />

        {version ? (
          <Text style={styles.version} testID="app-version">
            {t('settings.version', { version, engine: ENGINE_VERSION })}
          </Text>
        ) : null}
      </ScrollView>

      {/* The new direction needs a restart (the root layout does it once the setting changes). */}
      <ConfirmModal
        visible={switchTo?.asking ?? false}
        placement="center"
        icon="refresh"
        title={t('settings.languageConfirm.title', {
          language: switchTo ? t(`settings.languages.${switchTo.language}`) : '',
        })}
        body={t('settings.languageConfirm.body')}
        confirmLabel={t('settings.languageConfirm.confirm')}
        onConfirm={() => {
          if (switchTo) changed(useSettings.getState().setLanguage)(switchTo.language);
          setSwitchTo((s) => s && { ...s, asking: false });
        }}
        onCancel={() => setSwitchTo((s) => s && { ...s, asking: false })}
        testID="language-confirm"
      />
    </View>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <SectionLabel title={title} />
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { paddingHorizontal: GUTTER.screen },
  content: { paddingHorizontal: GUTTER.screen, paddingTop: space[6], gap: space[11] },
  section: { gap: space[5] },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  rule: { height: tokens.border.hairline, backgroundColor: color.border, marginHorizontal: space[8] },
  hint: { ...text('caption'), color: color.textMuted },
  version: { ...text('caption'), color: color.textMuted, textAlign: 'center' },
});
