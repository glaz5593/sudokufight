import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, StyleSheet, View } from 'react-native';

import { Icon } from '../components/Icon';
import { Button, Spinner } from '../components/ui';
import { Text } from '../components/ui/Text';
import { gameEndConfig } from '../config/gameEnd';
import { crashReporter } from '../services/crashlytics';
import { color, radius, size, space, text, tokens } from '../theme';

/** How long the fallback shows only "רגע…" before it offers a way out (config/gameEnd.ts). */
export const FALLBACK_ACTIONS_MS = gameEndConfig.fallbackActionsMs;

export interface FlowFallbackProps {
  /** Why nothing else could be drawn, for the crash report (never shown). */
  reason: string;
  /** "לבית" (and Android's back, once the actions show). */
  onHome: () => void;
  /** "לתוצאות": only when there are results to go to. */
  onResults?: () => void;
  /** The actions show after this long; until then "רגע…" (a normal way out usually comes first). */
  actionsAfterMs?: number;
  /**
   * Report a non-fatal to Crashlytics when the actions show (once). False when the empty screen is expected; a
   * function is asked at that moment (e.g. "is the route leaving on purpose?").
   */
  report?: boolean | (() => boolean);
  testID?: string;
}

/**
 * Never an empty screen (Moshe's black screens of 1.0.0, 15.10.2026): what a flow's route or screen draws when it
 * has nothing to draw (the game route without its game, the match route without its search, a game without my
 * seat, the results that did not replace the game). At first a spinner and "רגע…": the normal way on usually
 * comes within a frame. If it doesn't, after `actionsAfterMs`: "המסך לא נטען" with "לתוצאות" (when there are
 * results) and "לבית", and a non-fatal goes to Crashlytics with the reason (and the breadcrumbs before it).
 * Static: no animation of its own (the spinner stands still with reduced motion).
 */
export function FlowFallback({
  reason,
  onHome,
  onResults,
  actionsAfterMs = FALLBACK_ACTIONS_MS,
  report = true,
  testID = 'flow-fallback',
}: FlowFallbackProps) {
  const { t } = useTranslation('common');
  const [stuck, setStuck] = useState(actionsAfterMs <= 0);

  useEffect(() => {
    if (stuck) return;
    const timer = setTimeout(() => setStuck(true), actionsAfterMs);
    return () => clearTimeout(timer);
  }, [stuck, actionsAfterMs]);

  // Once, when the way out shows: the reason, with whatever breadcrumbs led here.
  const reported = useRef(false);
  useEffect(() => {
    if (!stuck || reported.current) return;
    reported.current = true;
    if (typeof report === 'function' ? !report() : !report) return;
    crashReporter().recordError(new Error(`flow fallback: ${reason}`), 'flow fallback');
  }, [stuck, report, reason]);

  // Android back goes home once the way out shows (before that, the screen under it decides).
  const home = useRef(onHome);
  useEffect(() => {
    home.current = onHome;
  });
  useEffect(() => {
    if (!stuck) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      home.current();
      return true;
    });
    return () => sub.remove();
  }, [stuck]);

  if (!stuck) {
    return (
      <View style={styles.screen} testID={testID}>
        <View style={styles.waiting}>
          <Spinner color={color.textMuted} size={size.icon.nav} testID={`${testID}-spinner`} />
          <Text style={styles.body} testID={`${testID}-loading`}>
            {t('fallback.loading')}
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.screen} testID={testID}>
      <View style={styles.icon}>
        <Icon name="alert" size={size.icon.nav} color={color.warning} />
      </View>
      <Text style={styles.title} accessibilityRole="header" accessibilityLiveRegion="polite">
        {t('fallback.title')}
      </Text>
      <Text style={styles.body}>{t(onResults ? 'fallback.body' : 'fallback.bodyHome')}</Text>
      <View style={styles.actions}>
        {onResults ? (
          <Button label={t('fallback.results')} size="lg" onPress={onResults} testID={`${testID}-results`} />
        ) : null}
        <Button
          label={t('fallback.home')}
          variant={onResults ? 'secondary' : 'primary'}
          size="lg"
          onPress={onHome}
          testID={`${testID}-home`}
        />
      </View>
    </View>
  );
}

const ICON = size.ctaHero - space[8];

const styles = StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'stretch',
    gap: space[8],
    paddingHorizontal: tokens.layout.gutterGame,
    backgroundColor: color.bg,
  },
  waiting: { alignItems: 'center', gap: space[6] },
  icon: {
    alignSelf: 'center',
    width: ICON,
    height: ICON,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.iconBg.warning,
  },
  title: { ...text('screenTitle'), color: color.text, textAlign: 'center' },
  body: { ...text('bodyLong'), color: color.textMuted, textAlign: 'center' },
  actions: { gap: space[6] },
});
