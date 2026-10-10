import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { paletteAt } from '../../player';
import { FieldSection, RowSection, StateSection } from '../StateSection';

/**
 * Stage 13 design QA of /dev/design-system against DS-Components: its "מצב ריק", "שורות וניווט" (the rows) and
 * "שדות" boards now have sections, in Hebrew and in English.
 */

const hidden = { includeHiddenElements: true };

beforeEach(() => {
  useSettings.setState({ reduceMotion: 'on' });
});

describe.each([
  ['he', 'עוד אין משחקים', 'שחק', 'אין חיבור לאינטרנט', 'נסה שוב', 'טוען…'],
  ['en', 'No games yet', 'Play', 'No internet connection', 'Try again', 'Loading…'],
] as const)('states in %s', (lng, emptyTitle, play, offlineTitle, retry, loading) => {
  it('empty with one gold action; no connection and connection error with their support codes; the skeleton', async () => {
    await i18n.changeLanguage(lng);
    await render(<StateSection />);

    const empty = screen.getByTestId('ds-state-empty');
    expect(within(empty).getByRole('header', { name: emptyTitle })).toBeOnTheScreen();
    expect(within(empty).getByRole('button', { name: play })).toBeOnTheScreen();

    const offline = screen.getByTestId('ds-state-offline');
    expect(within(offline).getByRole('header', { name: offlineTitle })).toBeOnTheScreen();
    expect(within(offline).getByTestId('ds-state-offline-code')).toHaveTextContent('offline');
    expect(within(offline).getByRole('button', { name: retry })).toBeOnTheScreen();

    expect(screen.getByTestId('ds-state-error-code')).toHaveTextContent('unavailable-503');

    const skeleton = screen.getByTestId('ds-skeleton');
    expect(skeleton).toHaveProp('accessibilityLabel', loading);
    expect(skeleton).toHaveProp('accessibilityState', { busy: true });
  });
});

describe.each([
  ['he', 'מייל', 'סיסמה', 'השם הזה כבר תפוס'],
  ['en', 'Email', 'Password', 'That name is taken'],
] as const)('fields in %s', (lng, email, password, taken) => {
  it('email and password are LTR; the eye shows the password; the error is said with the field', async () => {
    await i18n.changeLanguage(lng);
    await render(<FieldSection />);

    const mail = screen.getByTestId('ds-field-email');
    expect(mail).toHaveProp('accessibilityLabel', email);
    expect((StyleSheet.flatten(mail.props.style) as TextStyle).writingDirection).toBe('ltr');

    const secret = screen.getByTestId('ds-field-password');
    expect(secret).toHaveProp('secureTextEntry', true);
    await fireEvent.press(screen.getByTestId('ds-field-password-eye'));
    expect(screen.getByTestId('ds-field-password')).toHaveProp('secureTextEntry', false);
    expect(screen.getByLabelText(password)).toBeTruthy();

    expect(screen.getByTestId('ds-field-error-error', hidden)).toHaveTextContent(taken);
    expect(screen.getByTestId('ds-field-disabled')).toHaveProp('editable', false);
  });
});

describe.each([
  ['he', 'הפסד', 'מקום 2', 'מקום 8', 'MosheG (אתה)'],
  ['en', 'Loss', 'Place 2', 'Place 8', 'MosheG (you)'],
] as const)('rows in %s', (lng, loss, second, eighth, meName) => {
  it('a history card, a leaderboard row, my pinned row (P1, ●), and the skeleton row', async () => {
    await i18n.changeLanguage(lng);
    await render(<RowSection />);
    expect(screen.getByTestId('history-card-ds-history')).toHaveProp(
      'accessibilityLabel',
      expect.stringContaining(loss),
    );
    expect(screen.getByTestId('ds-row-leader')).toHaveProp(
      'accessibilityLabel',
      expect.stringContaining(second),
    );
    const me = screen.getByTestId('ds-row-me');
    expect(me).toHaveProp('accessibilityLabel', expect.stringContaining(eighth));
    expect(me).toHaveProp('accessibilityLabel', expect.stringContaining(meName));
    expect(within(me).getByTestId(`glyph-${paletteAt(0).shapeName}`, hidden)).toBeTruthy();
    expect(screen.getByTestId('ds-row-skeleton')).toHaveProp('accessibilityState', { busy: true });
  });
});
