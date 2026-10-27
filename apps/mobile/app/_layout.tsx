import '../src/services/hermesPolyfills';

import { type ErrorBoundaryProps, type NativeStackNavigationOptions, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { I18nManager, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useAuthGate } from '../src/auth';
import { InviteLinkPrompt } from '../src/auth/InviteLinkPrompt';
import { ToastViewport } from '../src/components/ui';
import { displayConfig } from '../src/config/display';
import { openPracticeStorage } from '../src/game/storage';
import i18n from '../src/i18n';
import { syncLanguageWithSystem, useLanguageLifecycle } from '../src/i18n/languageSync';
import { installPseudoLanguages } from '../src/i18n/pseudoLanguages';
import { startProgress } from '../src/progress';
import { SplashOverlay } from '../src/screens/account/SplashScreen';
import { ErrorScreen } from '../src/screens/ErrorScreen';
import { track } from '../src/services/analytics';
import { useKeepScreenOn } from '../src/services/keepAwake';
import { logFirstScreen, useAfterFirstScreen } from '../src/services/startup';
import { startTelemetry } from '../src/services/telemetry';
import { useScreenViews } from '../src/services/telemetry/useScreenViews';
import { color } from '../src/theme';
import { useAppFonts } from '../src/theme/fonts';
import { motion, useReduceMotion } from '../src/theme/motion';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
// Development and staging builds: the pseudo languages en-XA and ar-XB (plan 0יג); elsewhere a saved one goes.
installPseudoLanguages();
// The language from the first frame (localization plan 0א): the saved setting (read synchronously), after the
// system's word (a language chosen for the app in the system settings wins), saved; i18n/index.ts started in it.
void i18n.changeLanguage(syncLanguageWithSystem());

export default function RootLayout() {
  const fontsReady = useAppFonts();
  const reduceMotion = useReduceMotion();
  // Accounts (stage 8): who is signed in, and the screens their status allows (login, registration, Home).
  const { splash } = useAuthGate();

  // Spec §22 (open in under 2 s): the work the first screen doesn't need starts once it is up (docs/PERF.md).
  useAfterFirstScreen(fontsReady && !splash, startBackgroundWork);
  useEffect(() => {
    if (fontsReady && !splash) logFirstScreen();
  }, [fontsReady, splash]);
  // Spec §22: one app_open per run.
  useEffect(() => track('app_open'), []);
  // Spec §27.1: a screen_view for each screen entered (its route pattern; not the dev tools).
  useScreenViews();
  // Spec §22 (Moshe's device test, 15.10.2026): the screen stays on while the app is open, on every screen.
  useKeepScreenOn(displayConfig.keepScreenOn);

  // The language and its direction: a direction React Native didn't start with needs a restart (once, D104's
  // guard); a change while running restarts (D104), and so does one made in the system settings, read on every
  // return to the foreground (i18n/languageSync.ts).
  useLanguageLifecycle();

  useEffect(() => {
    if (fontsReady) void SplashScreen.hideAsync().catch(() => undefined);
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
          {/* Staged practice (1.0.2): a stage, its "מוכן?" and its result are one flow; no back swipe mid-stage. */}
          <Stack.Screen name="levels/play" options={{ ...moves.flow, gestureEnabled: false }} />
          <Stack.Screen name="leaderboard" options={moves.tab} />
          <Stack.Screen name="history" options={moves.tab} />
          <Stack.Screen name="achievements" options={moves.tab} />
        </Stack>
      </View>
      {/* Spec §4.2: the Splash while the sign-in loads (and its "try again" when the profile can't). */}
      <SplashOverlay visible={splash} />
      {/* 1.0.4 (friends-room.md §6.6): a room link while the app runs, in or asked first; a waiting invite. */}
      <InviteLinkPrompt />
      {/* The one toast viewport of the app (components.md §15.1): screens call useToast().show(). */}
      <ToastViewport />
    </GestureHandlerRootView>
  );
}

/**
 * What waits for the first screen (spec §22: open in under 2 s): each waits on the disk or the network, and the
 * first screen needs none of them. Returns what stops them.
 */
function startBackgroundWork(): () => void {
  // Spec §27.1: usage reports to our server. Loads the events earlier runs left, sends them, and keeps sending.
  // (track() queues in memory until then: app_open is not lost.)
  startTelemetry();
  // Stage 12 [D41]: the practice XP waiting on the phone goes to the server, and my progress is read, when a
  // player is signed in (and again each time the app comes back to the foreground).
  const stopProgress = startProgress();
  // The practice database [D25]: open it once per run, which marks games the last run left playing as
  // interrupted. Nothing waits for it (a screen that needs it first opens it itself, the same promise); a
  // failure is logged, and practice then plays without saving.
  openPracticeStorage().catch((error: unknown) =>
    console.warn('[practice] could not open the local database', error),
  );
  return stopProgress;
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
