/* Test-only: the common setup of the connection components' tests. */
import { act } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, type ViewStyle } from 'react-native';

import i18n from '../../../../i18n';
import { useSettings } from '../../../../state/settings';

/** A Latin name inside a sentence, as the components isolate it (FSI … PDI). */
export const iso = (name: string): string => `⁨${name}⁩`;

export const styleOf = (el: { props: { style?: unknown } }): ViewStyle =>
  (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as ViewStyle;

export const hidden = { includeHiddenElements: true } as const;

export interface Setup {
  /** What iOS was told to announce, in order. */
  announced(): string[];
  restore(): void;
}

/** Hebrew (or the language given), full motion, fake timers, and a spy on the iOS announcements. */
export async function setUp(lang: 'he' | 'en' = 'he', reduceMotion: 'on' | 'off' = 'off'): Promise<Setup> {
  await i18n.changeLanguage(lang);
  useSettings.setState({ reduceMotion });
  jest.useFakeTimers();
  const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  return {
    announced: () => spy.mock.calls.map((c) => String(c[0])),
    restore: () => {
      spy.mockRestore();
      jest.useRealTimers();
    },
  };
}

/** Lets the phone's timers (and the animations on them) run. */
export async function wait(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}
