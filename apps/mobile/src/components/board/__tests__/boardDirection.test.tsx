import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { DIRECTION_LANGUAGES, layoutLanguages } from '../../ui/testing/layout';
import i18n, { isRtlLanguage } from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { DIGIT_TYPES, text, typefaceFor } from '../../../theme';
import { Board } from '../Board';
import { boardModel, type KeypadModel } from '../boardModel';
import { demoBoard } from '../demo';
import { Keypad } from '../Keypad';

/**
 * The board and the keypad are the same in every language (localization plan 6.1 #12; CLAUDE.md): left to right,
 * Western digits 1–9, the cells named by a row letter and a column number (D5), in a right-to-left language too
 * (Hebrew today; Arabic and ar-XB as they arrive), and their digits' font is the same in every script.
 */

const styleOf = (el: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as ViewStyle & TextStyle;

const keypad: KeypadModel = {
  enabled: true,
  keys: Array.from({ length: 9 }, (_, k) => ({
    digit: (k + 1) as KeypadModel['keys'][number]['digit'],
    remaining: 9 - k,
    state: 'armed' as const,
    disabled: false,
  })),
};

const RTL = layoutLanguages(DIRECTION_LANGUAGES).filter(isRtlLanguage);

describe.each(RTL)('the board and the keypad in %s (right to left)', (lang) => {
  beforeEach(async () => {
    await i18n.changeLanguage(lang);
    useSettings.setState({ reduceMotion: 'off' });
  });

  it('the keypad: keys 1–9 from left to right, Western digits', async () => {
    await render(<Keypad model={keypad} onDigit={jest.fn()} />);
    const row = screen.getByTestId('keypad');
    expect(styleOf(row)).toMatchObject({ direction: 'ltr', flexDirection: 'row' });
    const keys = within(row).getAllByRole('button');
    expect(keys.map((k) => k.props.testID)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `key-${d}`));
    // Each key's digit (then what is left of it): 1–9 in Western digits.
    keys.forEach((key, k) => expect(key).toHaveTextContent(new RegExp(`^${k + 1}`)));
  });

  it('the board: left to right, rows A–I, columns 1–9, its digits Western', async () => {
    const { view, mySeat, now } = demoBoard();
    await render(<Board model={boardModel(view, mySeat, now, {})} />);
    const grid = screen.getByTestId('board');
    expect(styleOf(grid)).toMatchObject({ direction: 'ltr' });
    const cells = within(grid).getAllByRole('button');
    expect(cells.slice(0, 3).map((b) => b.props.testID)).toEqual(['cell-A1', 'cell-A2', 'cell-A3']);
    expect(cells.at(-1)!.props.testID).toBe('cell-I9');
    // A cell's label starts with its name in Latin letters and Western digits, whatever the language.
    expect(cells[0]!.props.accessibilityLabel).toMatch(/^A1\b/);
    // Every digit drawn on the board is 1–9.
    const digits = within(grid)
      .queryAllByText(/^\d$/)
      .map((t) => String(t.props.children));
    expect(digits.length).toBeGreaterThan(0);
    expect(digits.every((d) => /^[1-9]$/.test(d))).toBe(true);
  });
});

describe('the digits’ font is the same in every language', () => {
  it.each([...DIRECTION_LANGUAGES, 'zh-Hans', 'ko'])('%s', (lang) => {
    for (const name of DIGIT_TYPES) {
      for (const os of ['android', 'ios'])
        expect(text(name, typefaceFor(lang, os))).toEqual(text(name, typefaceFor('en', os)));
    }
  });
});
