import 'react-native-reanimated';

import { fireEvent, render, screen } from '@testing-library/react-native';

import { ltr } from '../../../components/player';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { InterferencesScreen } from '../InterferencesScreen';

/**
 * The interferences collection (spec §7.1; work plan stage 12): 3 open with their previews, 4 locked "בקרוב";
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
  it('3 of 7 open: fireworks, cats and warp with previews; ink, earthquake, fog and bubbles locked "בקרוב"', async () => {
    const onBack = jest.fn();
    await render(<InterferencesScreen level={14} onBack={onBack} />);
    expect(screen.getByRole('header', { name: 'הפרעות' })).toBeOnTheScreen();
    expect(screen.getByTestId('interferences-count')).toHaveProp(
      'accessibilityLabel',
      '3 מתוך 7 הפרעות פתוחות',
    );
    expect(screen.getByTestId('interferences-count')).toHaveTextContent(`${ltr('3/7')}נפתחו`);
    expect(screen.getByTestId('interferences-level')).toHaveTextContent('רמה 14');
    for (const kind of ['fireworks', 'cats', 'warp'])
      expect(screen.getByTestId(`interferences-art-${kind}`, hidden)).toBeTruthy();
    expect(screen.getByTestId('interferences-open-fireworks')).toHaveProp(
      'accessibilityLabel',
      'זיקוקים, זמין. מטח זיקוקים צבעוני על המסך',
    );
    for (const [kind, name] of [
      ['ink', 'דיו'],
      ['earthquake', 'רעידת אדמה'],
      ['fog', 'ערפל'],
      ['bubbles', 'בועות'],
    ])
      expect(screen.getByTestId(`interferences-locked-${kind}`)).toHaveProp(
        'accessibilityLabel',
        `${name}, נעול, בקרוב`,
      );
    await fireEvent.press(screen.getByRole('button', { name: 'חזרה' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('the rules in short: 5 seconds, 2·4·8…, drag only', async () => {
    await render(<InterferencesScreen level={1} onBack={jest.fn()} />);
    expect(screen.getByLabelText('5 שניות לכל הפרעה')).toBeOnTheScreen();
    expect(screen.getByLabelText(`${ltr('2·4·8…')} העלות מוכפלת בכל שיגור`)).toBeOnTheScreen();
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
    expect(screen.queryByTestId('interferences-level')).toBeNull();
  });
});
