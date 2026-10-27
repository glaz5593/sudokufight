import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { flatten } from '../../../../../scripts/lib/i18n-locales.mjs';
import PluralsRoute from '../../../app/dev/plurals';
import { ltr } from '../../components/player/format';
import { directionProblems } from '../../components/ui/testing/layout';
import { thisBuild } from '../../config/testing';
import i18n, { localeBundle } from '../../i18n';
import { pluralKeys, pseudoText } from '../../i18n/pseudo';
import { registerPseudoLanguages } from '../../i18n/pseudoLanguages';
import { pluralCategory } from '../../services/pluralRules';
import { APP_LOCALES, readLocales } from '../../testing/localeFiles';
import { PLURAL_COUNTS, PluralCheckScreen, pluralCheckKeys, pluralSamples } from '../PluralCheckScreen';

/**
 * The plural check screen (localization plan 0יג, 6.2; doc 5.4): every plural key with 0, 1, 2, 5, 11, 21, 100
 * and 1.5 in the app's language, the form each took, a date and a decimal; open in development and staging
 * builds only (app/dev/plurals.tsx).
 */

jest.mock('../../config/testing', () => ({
  ...jest.requireActual<object>('../../config/testing'),
  thisBuild: jest.fn(() => ({ server: 'local', dev: true })),
}));
jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    const { Text: Shown } = jest.requireActual<typeof import('react-native')>('react-native');
    return <Shown testID="redirect">{href}</Shown>;
  },
  router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

registerPseudoLanguages();

const NOW = new Date(2026, 9, 23, 12);
const keys = pluralKeys(localeBundle('en')!);

/** A key's card: each count's line, its form and its words. */
function linesOf(key: string) {
  return PLURAL_COUNTS.map((count) => {
    const line = screen.getByTestId(`plural-${key}-${count}`);
    return within(line)
      .getAllByText(/./)
      .map((t) => String(t.props.children));
  });
}

afterAll(async () => {
  await i18n.changeLanguage('he');
});

describe('the plural check screen', () => {
  it('in Hebrew: the forms of its rule, a date in words and in digits, a decimal and a percent', async () => {
    await i18n.changeLanguage('he');
    await render(<PluralCheckScreen onClose={jest.fn()} now={NOW} />);
    expect(screen.getByRole('header', { name: 'ריבוי ומספרים' })).toBeOnTheScreen();
    expect(screen.getByText(`${ltr('he')} · ${ltr('one, two, other')}`)).toBeOnTheScreen();
    expect(screen.getByTestId('plurals-date-value')).toHaveTextContent('23 באוקטובר 2026');
    expect(screen.getByTestId('plurals-digits-value')).toHaveTextContent('23.10.2026');
    expect(screen.getByTestId('plurals-decimal-value')).toHaveTextContent(ltr('39.5'));
    expect(screen.getByTestId('plurals-percent-value')).toHaveTextContent(ltr('57%'));
    // Its rows follow the app's direction by themselves (CLAUDE.md: RTL).
    expect(directionProblems(screen.getByTestId('plural-check'))).toEqual([]);
  });

  it('every count of a key with the form it took: Hebrew’s "two" shows for 2', async () => {
    await i18n.changeLanguage('he');
    await render(<PluralCheckScreen onClose={jest.fn()} now={NOW} />);
    const first = keys[0]!;
    expect(screen.getByTestId(`plural-${first}`)).toBeOnTheScreen();
    const lines = linesOf(first);
    expect(lines.map((line) => line[0])).toEqual(PLURAL_COUNTS.map((n) => ltr(String(n))));
    const zero = i18n.exists(`${first}_zero`);
    expect(lines.map((line) => line[1])).toEqual(
      PLURAL_COUNTS.map((n) => ltr(`_${n === 0 && zero ? 'zero' : pluralCategory('he', n)}`)),
    );
    expect(lines[2]![1]).toBe(ltr('_two'));
    expect(lines[2]![2]).toBe(i18n.t(first, { ...pluralSamples(first), count: 2 }));
    expect(lines[2]![2]).not.toMatch(/\{\{/);
    // No form falls back to another language.
    expect(screen.queryByText(/לא בשפה הזו/)).toBeNull();
  });

  it('lists every plural key of the app, in Hebrew without a fallback', async () => {
    await i18n.changeLanguage('he');
    // Read from the files themselves: every key with an _other form, in every namespace.
    const files = readLocales(APP_LOCALES).en!;
    const fromFiles = Object.entries(files).flatMap(([ns, tree]) =>
      flatten(tree)
        .map(([key]) => key)
        .filter((key) => key.endsWith('_other'))
        .map((key) => `${ns}:${key.slice(0, -'_other'.length)}`),
    );
    expect([...pluralCheckKeys()].sort()).toEqual(fromFiles.sort());
    expect(fromFiles.length).toBeGreaterThan(50);
    for (const key of keys) {
      for (const count of PLURAL_COUNTS) {
        const found = i18n.t(key, { count, returnDetails: true }) as unknown as { usedLng: string };
        expect([key, count, found.usedLng]).toEqual([key, count, 'he']);
      }
    }
  });

  it('in ar-XB: Arabic’s six forms (5 is "few", 11 and 21 "many"), none from English', async () => {
    await i18n.changeLanguage('ar-XB');
    await render(<PluralCheckScreen onClose={jest.fn()} now={NOW} />);
    expect(
      screen.getByText(`${ltr('ar-XB')} · ${ltr('zero, one, two, few, many, other')}`),
    ).toBeOnTheScreen();
    const lines = linesOf(keys[0]!);
    expect(lines.map((line) => line[1])).toEqual(
      ['zero', 'one', 'two', 'few', 'many', 'many', 'other', 'other'].map((form) => ltr(`_${form}`)),
    );
    expect(screen.queryByText(/Not in this language/)).toBeNull();
  });

  it('in en-XA: the accented words', async () => {
    await i18n.changeLanguage('en-XA');
    await render(<PluralCheckScreen onClose={jest.fn()} now={NOW} />);
    expect(
      screen.getByRole('header', { name: pseudoText('Plurals and numbers', 'en-XA') }),
    ).toBeOnTheScreen();
    expect(linesOf(keys[0]!)[1]![2]).toMatch(/^\[.*\]$/);
  });

  it('the back button closes it', async () => {
    await i18n.changeLanguage('en');
    const onClose = jest.fn();
    await render(<PluralCheckScreen onClose={onClose} now={NOW} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('its route, /dev/plurals', () => {
  it('a development or staging build shows the screen', async () => {
    jest.mocked(thisBuild).mockReturnValue({ server: 'staging', dev: false });
    await render(<PluralsRoute />);
    expect(screen.getByTestId('plural-check')).toBeOnTheScreen();
  });

  it('a production build goes Home', async () => {
    for (const build of [
      { server: 'production', dev: false },
      { server: 'production', dev: true },
    ]) {
      jest.mocked(thisBuild).mockReturnValue(build);
      await render(<PluralsRoute />);
      expect(screen.queryByTestId('plural-check')).toBeNull();
      expect(screen.getByTestId('redirect')).toHaveTextContent('/');
    }
  });
});
