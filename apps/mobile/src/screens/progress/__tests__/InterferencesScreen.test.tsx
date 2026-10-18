import 'react-native-reanimated';

import { fireEvent, render, screen } from '@testing-library/react-native';

import { ltr } from '../../../components/player';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { InterferencesScreen } from '../InterferencesScreen';

/**
 * The interferences collection (spec §7.1; work plan stage 12): six kinds opening at their levels [D17, D47] with
 * their previews, four locked "בקרוב";
 * a tapped one previews (its art runs), and with reduced motion every preview holds still.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

// The arsenal's token art (tested with the arsenal), as a stand-in that says whether it runs.
jest.mock('../../game/arsenal/TokenArt', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    TokenArt: ({ still, testID }: { still?: boolean; testID?: string }) =>
      createElement(View, { testID, accessibilityHint: still ? 'still' : 'live' }),
  };
});

const hidden = { includeHiddenElements: true };
/** Whether a token's art runs (TokenArt's `still` is false). */
const running = (kind: string) =>
  screen.getByTestId(`interferences-art-${kind}`, hidden).props.accessibilityHint === 'live';

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});

describe('InterferencesScreen', () => {
  it('6 of 10 open at level 14, each with its preview; earthquake, fog, bubbles and the torch locked "בקרוב"', async () => {
    const onBack = jest.fn();
    await render(<InterferencesScreen level={14} onBack={onBack} />);
    expect(screen.getByRole('header', { name: 'הפרעות' })).toBeOnTheScreen();
    expect(screen.getByTestId('interferences-count')).toHaveProp(
      'accessibilityLabel',
      '6 מתוך 10 הפרעות פתוחות',
    );
    expect(screen.getByTestId('interferences-count')).toHaveTextContent(`${ltr('6/10')}נפתחו`);
    expect(screen.getByTestId('interferences-level')).toHaveTextContent('רמה 14');
    for (const kind of ['fireworks', 'cats', 'warp', 'scramble', 'ink', 'keypad'])
      expect(screen.getByTestId(`interferences-art-${kind}`, hidden)).toBeTruthy();
    expect(screen.getByTestId('interferences-open-fireworks')).toHaveProp(
      'accessibilityLabel',
      'זיקוקים, זמין. מטח זיקוקים צבעוני על המסך',
    );
    expect(screen.getByTestId('interferences-open-scramble')).toHaveProp(
      'accessibilityLabel',
      'מספרים מתערבלים, זמין. הספרות בלוח מתערבלות ומתחלפות',
    );
    expect(screen.getByTestId('interferences-open-ink')).toHaveProp(
      'accessibilityLabel',
      'דיו, זמין. כתמי דיו שנמחקים בהדרגה',
    );
    expect(screen.getByTestId('interferences-open-keypad')).toHaveProp(
      'accessibilityLabel',
      'מקלדת מתערבלת, זמין. מקשי הספרות מחליפים מקומות',
    );
    const locked = screen.getAllByTestId(/^interferences-locked-/);
    expect(locked.map((l) => l.props.accessibilityLabel)).toEqual([
      'רעידת אדמה, נעול, בקרוב',
      'ערפל, נעול, בקרוב',
      'בועות, נעול, בקרוב',
      'פנס, נעול, בקרוב',
    ]);
    await fireEvent.press(screen.getByRole('button', { name: 'חזרה' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('at level 1, the scramble, ink and the keypad wait for levels 2, 3 and 4 [D17]', async () => {
    await render(<InterferencesScreen level={1} onBack={jest.fn()} />);
    expect(screen.getByTestId('interferences-count')).toHaveProp(
      'accessibilityLabel',
      '3 מתוך 10 הפרעות פתוחות',
    );
    expect(screen.getAllByTestId(/^interferences-open-/)).toHaveLength(3);
    const locked = screen.getAllByTestId(/^interferences-locked-/);
    expect(locked.slice(0, 3).map((l) => l.props.accessibilityLabel)).toEqual([
      'מספרים מתערבלים, נעול, נפתח ברמה 2',
      'דיו, נעול, נפתח ברמה 3',
      'מקלדת מתערבלת, נעול, נפתח ברמה 4',
    ]);
    expect(screen.getByTestId('interferences-locked-ink')).toHaveTextContent('כתמי דיו שנמחקים בהדרגה', {
      exact: false,
    });
  });

  it('the rules in short: 5 seconds, 2·4·8…, two taps (no drag) [D45]', async () => {
    await render(<InterferencesScreen level={1} onBack={jest.fn()} />);
    expect(screen.getByLabelText('5 שניות לכל הפרעה')).toBeOnTheScreen();
    expect(screen.getByLabelText(`${ltr('2·4·8…')} העלות מוכפלת בכל שיגור`)).toBeOnTheScreen();
    expect(screen.getByLabelText('2 הקשות: "הפרעה" בכרטיס היריב, ואז ההפרעה')).toBeOnTheScreen();
    expect(screen.getByText('במשחק: הקש על "הפרעה" בכרטיס היריב, ובחר הפרעה.')).toBeOnTheScreen();
    expect(screen.queryByText(/גרירה|גרור/)).toBeNull();
  });

  it('a tap previews that one; the others hold still', async () => {
    await render(<InterferencesScreen level={1} onBack={jest.fn()} />);
    expect(running('fireworks')).toBe(true);
    expect(running('cats')).toBe(false);
    await fireEvent.press(screen.getByTestId('interferences-open-cats'));
    expect(running('cats')).toBe(true);
    expect(running('fireworks')).toBe(false);
    expect(screen.getByTestId('interferences-open-cats')).toHaveProp('accessibilityState', {
      selected: true,
    });
  });

  it('reduced motion: every preview holds still', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    await render(<InterferencesScreen level={1} onBack={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('interferences-open-warp'));
    expect(['fireworks', 'cats', 'warp'].some(running)).toBe(false);
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await render(<InterferencesScreen level={null} onBack={jest.fn()} />);
    expect(screen.getByRole('header', { name: 'Interferences' })).toBeOnTheScreen();
    expect(screen.getByTestId('interferences-locked-fog')).toHaveProp(
      'accessibilityLabel',
      'Fog, locked, Coming soon',
    );
    expect(screen.getByTestId('interferences-locked-keypad')).toHaveProp(
      'accessibilityLabel',
      'Scrambled keypad, locked, Opens at level 4',
    );
    expect(
      screen.getByLabelText("2 taps: “Interfere” on an opponent's card, then the interference"),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('interferences-level')).toBeNull();
  });
});
