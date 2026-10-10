import { type ErrorBoundaryProps, type NativeStackNavigationOptions, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { I18nManager, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useAuthGate } from '../src/auth';
import { ToastViewport } from '../src/components/ui';
import { openPracticeStorage } from '../src/game/storage';
import i18n, { applyDirection } from '../src/i18n';
import { startProgress } from '../src/progress';
import { SplashOverlay } from '../src/screens/account/SplashScreen';
import { ErrorScreen } from '../src/screens/ErrorScreen';
import { track } from '../src/services/analytics';
import { restartApp } from '../src/services/restart';
import { startTelemetry } from '../src/services/telemetry';
import { useScreenViews } from '../src/services/telemetry/useScreenViews';
import { useSettings } from '../src/state/settings';
import { color } from '../src/theme';
import { useAppFonts } from '../src/theme/fonts';
import { motion, useReduceMotion } from '../src/theme/motion';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const fontsReady = useAppFonts();
  const language = useSettings((s) => s.language);
  const reduceMotion = useReduceMotion();
  // Accounts (stage 8): who is signed in, and the screens their status allows (login, registration, Home).
  const { splash } = useAuthGate();

  // Spec §27.1: usage reports to our server. Loads the events earlier runs left, sends them, and keeps sending.
  useEffect(() => startTelemetry(), []);
  // Stage 12 [D41]: the practice XP waiting on the phone goes to the server, and my progress is read, when a
  // player is signed in (and again each time the app comes back to the foreground).
  useEffect(() => startProgress(), []);
  // Spec §22: one app_open per run.
  useEffect(() => track('app_open'), []);
  // Spec §27.1: a screen_view for each screen entered (its route pattern; not the dev tools).
  useScreenViews();

  // The chosen language, and its direction: a flip from LTR to RTL (or back) needs a reload.
  useEffect(() => {
    void i18n.changeLanguage(language);
    if (applyDirection(language)) void restartApp();
  }, [language]);

  useEffect(() => {
    if (fontsReady) void SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsReady]);

  // The practice database [D25]: open it once per run, which marks games the last run left playing as
  // interrupted. Nothing waits for it; a failure is logged, and practice then plays without saving.
  useEffect(() => {
    if (!fontsReady) return;
    openPracticeStorage().catch((error: unknown) =>
      console.warn('[practice] could not open the local database', error),
    );
  }, [fontsReady]);

  if (!fontsReady) return null;
  const moves = transitions(reduceMotion);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.bg }}>
      <StatusBar style="light" />
      {/* Under the Splash, the app is hidden from screen readers until it is the right screen. */}
      <View
        style={{ flex: 1 }}
        accessibilityElementsHidden={splash}
        importantForAccessibility={splash ? 'no-hide-descendants' : 'auto'}
      >
        {/* Screen transitions are animations too: with Reduced Motion they fade (spec §22, motion.md §4.9). */}
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg }, ...moves.menu }}
        >
          <Stack.Screen name="game" options={moves.flow} />
          <Stack.Screen name="results/[id]" options={moves.flow} />
          <Stack.Screen name="leaderboard" options={moves.tab} />
          <Stack.Screen name="history" options={moves.tab} />
          <Stack.Screen name="achievements" options={moves.tab} />
        </Stack>
      </View>
      {/* Spec §4.2: the Splash while the sign-in loads (and its "try again" when the profile can't). */}
      <SplashOverlay visible={splash} />
      {/* The one toast viewport of the app (components.md §15.1): screens call useToast().show(). */}
      <ToastViewport />
    </GestureHandlerRootView>
  );
}

/** A render error anywhere: recorded in Crashlytics, with a way to try again (stage 8). */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <ErrorScreen error={error} retry={retry} />;
}

type Transition = Pick<NativeStackNavigationOptions, 'animation' | 'animationDuration'>;

/**
 * motion.md §4.9. Menus (`stack.push`): the native slide, forward from the left in Hebrew; Android is told so,
 * iOS mirrors its push by itself. A game's flow, game → results (`flow.fade`): a 240 ms cross-fade. The bottom
 * navigation's tabs (`tabs`): a 140 ms cross-fade. Reduced Motion: 200 ms fades, and the tabs switch at once.
 * (The durations are iOS's; Android fades at its own pace.)
 */
function transitions(reduce: boolean): Record<'menu' | 'flow' | 'tab', Transition> {
  const d = motion.duration;
  if (reduce) {
    const fade: Transition = { animation: 'fade', animationDuration: d.reducedFade };
    return { menu: fade, flow: fade, tab: { animation: 'none' } };
  }
  const slide = I18nManager.isRTL ? 'slide_from_left' : 'slide_from_right';
  return {
    menu: { animation: Platform.OS === 'android' ? slide : 'default' },
    flow: { animation: 'fade', animationDuration: d.stateChange },
    tab: { animation: 'fade', animationDuration: d.tapFeedbackMax },
  };
}
