import { Canvas, Circle } from '@shopify/react-native-skia';
import { cellName, ENGINE_VERSION } from '@sudoku-fight/engine';
import { PROTOCOL_VERSION } from '@sudoku-fight/protocol';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../components/ui';
import { serverEndpoint } from '../config/server';
import { type EchoStatus, useEchoRtt } from '../net/useEchoRtt';
import { useHelloStore } from '../state/helloStore';
import { color, radius, space, text } from '../theme';
import { reduceMotionFlag, useReduceMotion } from '../theme/motion';

/**
 * Stage 0: the end-to-end check. The cell name comes from @sudoku-fight/engine (a workspace package in
 * TypeScript source), the circle is drawn by Skia, the bounce runs on Reanimated (and stays still with
 * Reduced Motion), the tap count lives in Zustand, the buzz is expo-haptics, and the round-trip time comes
 * from the server's echo room. Strings come from the translation files. The design system arrives in stage 3.
 */
export interface HelloScreenProps {
  /** Development builds: a link to /dev/design-system (stage 3). Without it, no link. */
  onOpenDesignSystem?: () => void;
}

export function HelloScreen({ onOpenDesignSystem }: HelloScreenProps = {}) {
  const { t } = useTranslation();
  const { t: tDev } = useTranslation('dev');
  const taps = useHelloStore((s) => s.taps);
  const tap = useHelloStore((s) => s.tap);
  const echo = useEchoRtt(serverEndpoint);
  const reduce = useReduceMotion();
  const scale = useSharedValue(1);
  const bounce = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  const onPress = () => {
    tap();
    // The app's setting, not only the phone's (theme/motion.ts): reduced, the circle stays still.
    const spring = { reduceMotion: reduceMotionFlag(reduce) };
    scale.set(withSequence(withSpring(1.15, spring), withSpring(1, spring)));
    void Haptics.selectionAsync();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <Text style={styles.title}>{t('hello.title')}</Text>
      <Canvas style={styles.canvas} testID="skia-circle">
        <Circle cx={40} cy={40} r={32} color={color.players[0].ring} />
      </Canvas>
      <Text style={styles.line} testID="engine-line">
        {t('hello.engineLine', { cell: cellName(31) })}
      </Text>
      <Text style={styles.meta} testID="versions">
        {t('hello.versions', { engine: ENGINE_VERSION, protocol: PROTOCOL_VERSION })}
      </Text>
      <Text style={styles.meta} testID="rtt">
        {rttText(echo, t)}
      </Text>
      <Pressable onPress={onPress} accessibilityRole="button" testID="tap">
        <Animated.View style={[styles.button, bounce]}>
          <Text style={styles.buttonText}>{t('hello.taps', { count: taps })}</Text>
        </Animated.View>
      </Pressable>
      {onOpenDesignSystem ? (
        <Button
          label={tDev('link.designSystem')}
          accessibilityHint={tDev('link.designSystemHint')}
          variant="ghost"
          icon="settings"
          onPress={onOpenDesignSystem}
          testID="design-system-link"
        />
      ) : null}
      <View style={styles.spacer} />
    </SafeAreaView>
  );
}

export function rttText(echo: EchoStatus, t: TFunction): string {
  switch (echo.kind) {
    case 'connecting':
      return t('hello.server.connecting');
    case 'connected':
      return echo.rttMs === null ? t('hello.server.connected') : t('hello.server.rtt', { ms: echo.rttMs });
    case 'error':
      return t('hello.server.error', { message: echo.message });
  }
}

// Colours and type from the design tokens (stage 3).
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[8],
    backgroundColor: color.bg,
  },
  title: { ...text('screenTitle'), color: color.text },
  canvas: { width: 80, height: 80 },
  line: { ...text('rowTitle'), color: color.text },
  meta: { ...text('caption'), color: color.textMuted },
  button: {
    paddingHorizontal: space[11],
    paddingVertical: space[7],
    borderRadius: radius.xl,
    backgroundColor: color.players[0].ring,
  },
  buttonText: { ...text('h2'), color: color.players[0].onRing },
  spacer: { height: space[13] },
});
