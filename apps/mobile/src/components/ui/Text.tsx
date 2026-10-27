import type { ComponentRef, Ref } from 'react';
import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native';

import { appTypeface, type Typeface } from '../../theme';

export type TextProps = NativeTextProps & { ref?: Ref<ComponentRef<typeof NativeText>> };

/**
 * What every text needs of the app's language beyond its style (localization plan 0ט): Korean on iOS breaks
 * lines between words ("hangul-word"), never inside one. Nothing for any other language, so Hebrew and English
 * render exactly as React Native's Text. Android has no such prop (React Native's TextProps): there a word that
 * breaks badly in a label gets U+200B at the right place in its translation.
 */
export function languageTextProps(typeface: Typeface = appTypeface()): Partial<NativeTextProps> {
  return typeface.lineBreakStrategyIOS ? { lineBreakStrategyIOS: typeface.lineBreakStrategyIOS } : {};
}

/**
 * The app's base Text: React Native's, with languageTextProps under the caller's props (a caller may still set
 * its own). Use it for text that may wrap; textBase.test.tsx lists the files that still use React Native's, and
 * fails on them once Korean is in the app.
 */
export function Text(props: TextProps) {
  return <NativeText {...languageTextProps()} {...props} />;
}
