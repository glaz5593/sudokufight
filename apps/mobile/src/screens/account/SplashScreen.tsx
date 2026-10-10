import { defaultRules, THINK_TIME_MS } from '@sudoku-fight/engine';
import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { retryLoad, signOut, useAuth } from '../../auth/authStore';
import { Button, Spinner } from '../../components/ui';
import { usePresence } from '../../components/ui/motion';
import { color, radius, size, space, text, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { errorMessage } from './messages';
import { AccountApiError } from '../../api/accountApi';
import { Brand, DevModeBadge } from './parts';

const TIPS = ['lock', 'hard', 'mistake', 'drag'] as const;
/** A new tip every few seconds while the arena loads. */
export const TIP_MS = 4_000;

/**
 * A tip's words. The numbers come from the rules, not the copy (the Splash board's "12 שניות במשחק רגיל"
 * is the normal game's think time [D2]; "כל טעות כפולה מהקודמת" says the cap too once [D14] sets one).
 */
export function splashTip(t: TFunction<'account'>, tip: (typeof TIPS)[number]): string {
  if (tip === 'lock')
    return t('splash.tips.lock', {
      seconds: THINK_TIME_MS.normal / 1000,
      type: t('home:gameTypes.normal.name'),
    });
  if (tip === 'mistake') {
    const cap = defaultRules('ranked', 'normal').mistakePenaltyCap;
    return cap === null ? t('splash.tips.mistake') : t('splash.tips.mistakeCapped', { cap });
  }
  return t(`splash.tips.${tip}`);
}

/**
 * The Splash (spec §4.1 #1, §4.2: "Splash → logged in → Home / not logged in → Login"), in direction C: the
 * wordmark with the four seat shapes, the tagline, "טוען את הזירה…" with a spinner, and a tip. It covers the
 * app while the auth status is loading, and fades away once the router has the right screen under it
 * (motion.md: 240 ms; reduced motion: a 200 ms fade).
 *
 * When a sign-in's profile can't be read and none is saved on the phone (first run offline), it says so,
 * with "נסה שוב" and "התנתקות".
 */
export function SplashOverlay({ visible }: { visible: boolean }) {
  const reduce = useReduceMotion();
  const { mounted, progress } = usePresence(visible, {
    inMs: 0,
    outMs: motion.duration.stateChange,
    reduce,
  });
  const fade = useAnimatedStyle(() => ({ opacity: progress.get() }));
  if (!mounted) return null;
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.overlay, visible ? null : fade]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <SplashScreen />
    </Animated.View>
  );
}

export function SplashScreen() {
  const { t } = useTranslation('account');
  const { top, bottom } = useSafeAreaInsets();
  const loadError = useAuth((s) => s.loadError);
  const [tip, setTip] = useState(0);
  const [busy, setBusy] = useState<'retry' | 'signOut' | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setTip((i) => (i + 1) % TIPS.length), TIP_MS);
    return () => clearInterval(timer);
  }, []);

  const act = async (what: 'retry' | 'signOut') => {
    setBusy(what);
    try {
      await (what === 'retry' ? retryLoad() : signOut());
    } finally {
      setBusy(null);
    }
  };

  return (
    <View
      style={[styles.screen, { paddingTop: top + space[13], paddingBottom: bottom + space[10] }]}
      testID="splash"
    >
      <View style={styles.top}>
        <DevModeBadge />
      </View>
      <View style={styles.middle}>
        <Brand />
        <Text style={styles.tagline}>{t('splash.tagline')}</Text>
      </View>

      {loadError ? (
        <View style={styles.bottom} testID="splash-error">
          <Text style={styles.errorTitle} accessibilityRole="header">
            {t('splash.errorTitle')}
          </Text>
          <Text style={styles.errorBody} accessibilityRole="alert">
            {errorMessage(t, new AccountApiError(loadError))}
          </Text>
          <Button
            label={t('splash.retry')}
            size="lg"
            loading={busy === 'retry'}
            onPress={() => void act('retry')}
            testID="splash-retry"
          />
          <Button
            label={t('splash.signOut')}
            variant="ghost"
            icon="logout"
            loading={busy === 'signOut'}
            onPress={() => void act('signOut')}
            testID="splash-sign-out"
          />
        </View>
      ) : (
        <View style={styles.bottom}>
          <View
            style={styles.loading}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={t('splash.loading')}
            testID="splash-loading"
          >
            <Spinner color={color.accent} size={size.icon.header} />
            <Text style={styles.loadingText}>{t('splash.loading')}</Text>
          </View>
          <View style={styles.tip}>
            <View style={styles.tipChip}>
              <Text style={styles.tipChipText}>{t('splash.tipLabel')}</Text>
            </View>
            <Text style={styles.tipText} accessibilityLiveRegion="none" testID="splash-tip">
              {splashTip(t, TIPS[tip]!)}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 10, elevation: 10, backgroundColor: color.bg },
  screen: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: tokens.layout.gutterGame,
    backgroundColor: color.bg,
  },
  top: { minHeight: size.touch, alignItems: 'center' },
  middle: { alignItems: 'center', gap: space[8] },
  tagline: { ...text('bodyLong'), color: color.textMuted, textAlign: 'center' },
  bottom: { gap: space[8] },
  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[4] },
  loadingText: { ...text('status'), color: color.textMuted },
  tip: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: space[4] },
  tipChip: {
    paddingHorizontal: space[4],
    paddingVertical: space[1],
    borderRadius: radius.xs,
    backgroundColor: color.surface2,
  },
  tipChipText: { ...text('micro'), color: color.accent },
  tipText: { ...text('caption'), color: color.textMuted, flexShrink: 1 },
  errorTitle: { ...text('h1'), color: color.text, textAlign: 'center' },
  errorBody: { ...text('body'), color: color.textMuted, textAlign: 'center' },
});
