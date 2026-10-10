import { render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import i18n from '../../../../i18n';
import { color } from '../../../../theme';
import { COMING_ROW_MIN_WINDOW, ComingRow } from '../ComingRow';

const hidden = { includeHiddenElements: true } as const;
const styleOf = (el: { props: { style?: unknown } }): ViewStyle =>
  (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as ViewStyle;

describe('ComingRow (the arsenal\'s "נפתחות בהמשך", spec §7.1)', () => {
  it.each([
    ['he', 'נפתחות בהמשך: דיו, רעידת אדמה, ערפל, בועות. בקרוב', ['נפתחות בהמשך', 'בקרוב', 'דיו', 'בועות']],
    [
      'en',
      'Coming later: Ink, Earthquake, Fog, Bubbles. Coming soon',
      ['Coming later', 'Coming soon', 'Ink'],
    ],
  ] as const)('reads as one element in %s', async (lang, label, texts) => {
    await i18n.changeLanguage(lang);
    await render(<ComingRow />);
    expect(screen.getByTestId('arsenal-coming')).toHaveAccessibleName(label);
    for (const t of texts) expect(screen.getByText(t, hidden)).toBeTruthy();
  });

  it('draws each future interference as a dashed, faint chip (never a token)', async () => {
    await i18n.changeLanguage('he');
    await render(<ComingRow />);
    expect(styleOf(screen.getByTestId('arsenal-coming-fog', hidden))).toMatchObject({
      borderStyle: 'dashed',
      borderColor: color.border,
      backgroundColor: color.bg,
    });
  });

  it('is left out of the tray on short phones, so the tokens and the hint always fit', () => {
    expect(COMING_ROW_MIN_WINDOW).toBe(640);
  });
});
