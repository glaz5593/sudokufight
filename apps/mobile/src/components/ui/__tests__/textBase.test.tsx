import { render, screen } from '@testing-library/react-native';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { ENABLED_LANGUAGES } from '../../../i18n/languages';
import { typefaceFor } from '../../../theme';
import { languageTextProps, Text } from '../Text';

/**
 * The base Text (localization plan 0ט): Korean on iOS breaks lines between words ("hangul-word"); every other
 * language renders exactly as React Native's Text. Until Korean was in the app (enabled-languages.json, 1.1.0),
 * screens could still use React Native's Text; from then on none may, or Korean would break inside words there.
 */

const MOBILE = join(__dirname, '..', '..', '..', '..');

/** Every app source file with JSX: src/ and app/, without tests, test helpers and the developer screens. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!['__tests__', '__fixtures__', 'testing', 'dev', 'node_modules'].includes(name))
        sourceFiles(path, out);
    } else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) out.push(path);
  }
  return out;
}

/** Whether a file's source imports React Native's own Text (`import { …, Text, … } from 'react-native'`). */
function importsNativeText(source: string): boolean {
  return [...source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'react-native'/g)].some((m) =>
    m[1]!.split(',').some((name) => /^\s*Text(\s+as\s+\w+)?\s*$/.test(name)),
  );
}

/** The files that still render React Native's Text, relative to apps/mobile. */
function nativeTextFiles(): string[] {
  return [...sourceFiles(join(MOBILE, 'src')), ...sourceFiles(join(MOBILE, 'app'))]
    .filter((path) => !path.endsWith(join('components', 'ui', 'Text.tsx')))
    .filter((path) => importsNativeText(readFileSync(path, 'utf8')))
    .map((path) => relative(MOBILE, path).replace(/\\/g, '/'))
    .sort();
}

describe('the base Text', () => {
  it('Korean on iOS: lines break between words', () => {
    expect(languageTextProps(typefaceFor('ko', 'ios'))).toEqual({ lineBreakStrategyIOS: 'hangul-word' });
  });

  it.each(['he', 'en', 'ar', 'ja', 'zh-Hans', 'th', 'vi'])(
    '%s, and Korean on Android: nothing added',
    (lang) => {
      expect(languageTextProps(typefaceFor(lang, 'ios'))).toEqual({});
      expect(languageTextProps(typefaceFor('ko', 'android'))).toEqual({});
    },
  );

  it('renders React Native’s Text with the caller’s props, and nothing more in Hebrew and English', async () => {
    await render(
      <Text testID="line" numberOfLines={1} style={{ fontSize: 13 }}>
        שלום
      </Text>,
    );
    const line = screen.getByTestId('line');
    expect(line).toHaveTextContent('שלום');
    expect(line.props.numberOfLines).toBe(1);
    expect(line.props.lineBreakStrategyIOS).toBeUndefined();
  });
});

describe('React Native’s Text in the app (plan 0ט)', () => {
  it('the check finds an import of Text, and not of TextInput or TextStyle', () => {
    expect(importsNativeText("import { StyleSheet, Text, View } from 'react-native';")).toBe(true);
    expect(importsNativeText("import {\n  Text as NativeText,\n  View,\n} from 'react-native';")).toBe(true);
    expect(importsNativeText("import { TextInput, type TextStyle } from 'react-native';")).toBe(false);
    expect(importsNativeText("import { Text } from '../components/ui';")).toBe(false);
    // On a real file: the base Text itself renders React Native's (the one file the scan leaves out).
    expect(importsNativeText(readFileSync(join(MOBILE, 'src', 'components', 'ui', 'Text.tsx'), 'utf8'))).toBe(
      true,
    );
  });

  it('none is left once Korean is an enabled language (else it breaks Korean inside words on iOS)', () => {
    const korean = (ENABLED_LANGUAGES as readonly string[]).includes('ko');
    expect(korean ? nativeTextFiles() : []).toEqual([]);
  });
});
