import 'react-native-reanimated';
import { COUNTRY_CODES } from '@sudoku-fight/protocol';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { flagEmoji } from '../../../components/player';
import { directionProblems } from '../../../components/ui/testing/layout';
import i18n from '../../../i18n';
import { size } from '../../../theme';
import { CountryPicker, countryOptions, countryRowHeight, filterCountries } from '../CountryPicker';

/**
 * The country (spec §3.1 [D21]; Moshe's device test, 14.10.2026: "only 2 letters"): a field like the name's,
 * and a tall sheet with every country by its flag and its full name in the app's language, sorted by that
 * name, with a search. The names come from our own tables, so the phone needs no Intl.DisplayNames.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const HEBREW = /[א-ת]/;

beforeEach(async () => {
  await i18n.changeLanguage('he');
});

describe('the options', () => {
  it.each(['he', 'en'] as const)(
    'in %s: every country, its flag and full name, sorted by that name',
    (lng) => {
      const options = countryOptions(lng);
      expect(options.map((o) => o.code).sort()).toEqual([...COUNTRY_CODES].sort());
      const collator = new Intl.Collator(lng);
      const names = options.map((o) => o.name);
      expect(names).toEqual([...names].sort(collator.compare));
      for (const o of options) {
        expect(o.flag).toBe(flagEmoji(o.code));
        expect(o.name).not.toBe(o.code);
        expect([o.code, HEBREW.test(o.name)]).toEqual([o.code, lng === 'he']);
      }
    },
  );

  it('finds a country by part of its name, its English name, or its code', () => {
    const he = countryOptions('he');
    const codes = (q: string) => filterCountries(he, q).map((o) => o.code);
    expect(codes('ישר')).toEqual(['IL']);
    expect(codes('  ישראל ')).toEqual(['IL']);
    expect(codes('Israel')).toEqual(['IL']);
    expect(codes('germ')).toEqual(['DE']);
    expect(codes('il')).toContain('IL');
    expect(codes('zzzz')).toEqual([]);
    expect(filterCountries(he, '')).toHaveLength(COUNTRY_CODES.length);
    expect(codes('צרפת')).toContain('FR');
  });

  it('as a phone keyboard types it: Hebrew ׳ and ״ as \' and ", or left out; Latin without its accents', () => {
    const he = countryOptions('he');
    const codes = (q: string) => filterCountries(he, q).map((o) => o.code);
    // The tables write the geresh and gershayim (צ׳כיה, ארה״ב); the Hebrew keyboards type ASCII marks.
    expect(codes("צ'כיה")).toEqual(['CZ']);
    expect(codes('צ׳כיה')).toEqual(['CZ']);
    expect(codes('צכיה')).toEqual(['CZ']);
    expect(codes("צ'ילה")).toEqual(['CL']);
    expect(codes("ג'מייקה")).toEqual(['JM']);
    expect(codes('ארה"ב')[0]).toBe('US');
    expect(codes('ארה"ב')).toContain('UM');
    // Accents and curly apostrophes.
    expect(codes('turk')).toContain('TR');
    expect(codes('türkiye')).toEqual(['TR']);
    expect(codes('cote')).toEqual(['CI']);
    expect(codes("cote d'ivoire")).toEqual(['CI']);
    expect(codes('curacao')).toEqual(['CW']);
    expect(codes('reunion')).toEqual(['RE']);
    expect(codes('sao tome')).toEqual(['ST']);
    expect(codes('aland')).toContain('AX');
    expect(codes('aland islands')).toEqual(['AX']);
    expect(codes('st barthelemy')).toEqual(['BL']);
    expect(codes('saint lucia')).toEqual(['LC']);
    expect(codes('trinidad and tobago')).toEqual(['TT']);
    expect(codes('timor-leste')).toEqual(['TL']);
  });

  it('the other names people use find a country too, an exact one first', () => {
    const he = countryOptions('he');
    const codes = (q: string) => filterCountries(he, q).map((o) => o.code);
    expect(codes('usa')).toEqual(['US']);
    expect(codes('USA')).toEqual(['US']);
    expect(codes('america')[0]).toBe('US');
    expect(codes('אמריקה')).toEqual(['US']);
    expect(codes('uk')[0]).toBe('GB');
    expect(codes('uk')).toContain('UA');
    expect(codes('england')).toEqual(['GB']);
    expect(codes('אנגליה')).toEqual(['GB']);
    expect(codes('turkey')).toEqual(['TR']);
    expect(codes('czech republic')).toEqual(['CZ']);
    expect(codes('ivory coast')).toEqual(['CI']);
    expect(codes('holland')).toEqual(['NL']);
    // A code is an exact match: "il" puts Israel first, then the names that contain it.
    expect(codes('il')[0]).toBe('IL');
  });

  it('a row holds two lines of a long name, and grows with the phone’s text size', () => {
    expect(countryRowHeight(1)).toBe(size.listRow);
    expect(countryRowHeight(2)).toBeGreaterThan(size.listRow);
  });
});

describe('CountryPicker', () => {
  it('a field like the others: the flag, the full name and "שינוי"; one button', async () => {
    await render(<CountryPicker value="IL" onChange={jest.fn()} hint="hint" />);
    const field = screen.getByRole('button', { name: 'מדינה: ישראל' });
    expect(field).toHaveTextContent('🇮🇱ישראלשינוי');
    expect(field).toHaveProp('accessibilityHint', 'בחר מדינה');
    expect(screen.getByText('מדינה')).toBeOnTheScreen();
    expect(StyleSheet.flatten(field.props.style).minHeight).toBe(size.input);
    expect(directionProblems(field)).toEqual([]);
  });

  it('the sheet: tall, a search, rows of flag and name (two lines for a long one); a tap picks and closes', async () => {
    const onChange = jest.fn();
    await render(<CountryPicker value="IL" onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: 'מדינה: ישראל' }));
    const sheet = await screen.findByTestId('country-sheet');
    expect(within(sheet).getByRole('header', { name: 'בחר מדינה' })).toBeOnTheScreen();
    expect(within(sheet).getByTestId('country-search')).toBeOnTheScreen();
    const il = within(sheet).getByTestId('country-option-IL');
    expect(il).toHaveProp('accessibilityState', { selected: true });
    expect(il).toHaveProp('accessibilityLabel', 'ישראל');
    expect(within(il).getByText('ישראל')).toHaveProp('numberOfLines', 2);
    await fireEvent.changeText(within(sheet).getByTestId('country-search'), 'סנדוויץ');
    const gs = within(sheet).getByTestId('country-option-GS');
    expect(gs).toHaveTextContent('ג׳ורג׳יה הדרומית ואיי סנדוויץ׳ הדרומיים', { exact: false });
    await fireEvent.press(gs);
    expect(onChange).toHaveBeenCalledWith('GS');
  });

  it('works where the phone has no Intl.DisplayNames (Hermes)', async () => {
    const real = Object.getOwnPropertyDescriptor(Intl, 'DisplayNames')!;
    Object.defineProperty(Intl, 'DisplayNames', { ...real, value: undefined });
    try {
      await render(<CountryPicker value="DE" onChange={jest.fn()} />);
      expect(screen.getByRole('button', { name: 'מדינה: גרמניה' })).toHaveTextContent('🇩🇪גרמניהשינוי');
    } finally {
      Object.defineProperty(Intl, 'DisplayNames', real);
    }
  });

  it('nothing chosen: "בחר מדינה", and an error says so', async () => {
    await render(<CountryPicker value={null} onChange={jest.fn()} error="בחר מדינה" />);
    expect(screen.getByRole('button', { name: 'בחר מדינה, בחר מדינה' })).toHaveTextContent('בחר מדינהשינוי');
    expect(screen.getByTestId('country-error')).toHaveTextContent('בחר מדינה');
    // As the name field shows its errors: after the alert icon, and announced as it appears (TalkBack
    // ignores the alert role; a live region it reads).
    const row = screen.getByTestId('country-message');
    expect(row).toHaveProp('accessibilityLiveRegion', 'polite');
    // (The icon itself is hidden from screen readers.)
    expect(within(row).getByTestId('icon-alert', { includeHiddenElements: true })).toBeTruthy();
    expect(within(row).getByTestId('country-error')).toHaveTextContent('בחר מדינה');
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await render(<CountryPicker value="GB" onChange={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Country: United Kingdom' })).toHaveTextContent(
      '🇬🇧United KingdomChange',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Country: United Kingdom' }));
    const sheet = await screen.findByTestId('country-sheet');
    expect(within(sheet).getByRole('header', { name: 'Choose a country' })).toBeOnTheScreen();
    await fireEvent.changeText(within(sheet).getByTestId('country-search'), 'ישראל');
    expect(within(sheet).getByTestId('country-option-IL')).toHaveTextContent('🇮🇱Israel');
  });
});
