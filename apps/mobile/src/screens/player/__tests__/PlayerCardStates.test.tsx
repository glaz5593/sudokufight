import 'react-native-reanimated';

import type { PlayerCard } from '@sudoku-fight/protocol';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { ProgressApiError } from '../../../api/progressApi';
import { card } from '../../../api/testing/fakeProgress';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { PlayerCardScreen, type PlayerCardScreenProps } from '../PlayerCardScreen';

/**
 * The player card's states (work plan stage 13; spec §14.3, §16.3; Loading.dc.html): another player's card as
 * a skeleton while it loads, no connection and the server's error with "נסה שוב" and the support code, a
 * player who isn't there, and mine on the saved card with a note, in Hebrew and English.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  });

const NINA = card({ id: 'nina', displayName: 'NinaVolt', country: 'DE', league: 'diamond', level: 22 });

async function show(load: PlayerCardScreenProps['load'], over: Partial<PlayerCardScreenProps> = {}) {
  await render(<PlayerCardScreen playerId="nina" load={load} myId="me" onBack={jest.fn()} {...over} />);
  await settle();
}

let announce: jest.SpyInstance;

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on' });
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});
afterEach(() => announce.mockRestore());

describe('player card states (stage 13)', () => {
  it('loading: the identity, the ratings and the stats as a skeleton, under the header', async () => {
    let answer: (c: PlayerCard) => void = () => undefined;
    await show(() => new Promise((resolve) => (answer = resolve)));
    expect(screen.getByRole('header', { name: 'כרטיס שחקן' })).toBeOnTheScreen();
    expect(screen.getByRole('progressbar', { name: 'טוען…' })).toHaveProp('accessibilityState', {
      busy: true,
    });
    await act(async () => answer(NINA));
    await settle();
    expect(screen.queryByTestId('player-card-loading')).toBeNull();
    expect(screen.getByTestId('player-card-identity')).toBeOnTheScreen();
  });

  it('no connection: the explanation, the code and "נסה שוב"; it reads again', async () => {
    let fail = true;
    await show(async () => {
      if (fail) throw new ProgressApiError('timeout');
      return NINA;
    });
    expect(screen.getByTestId('player-card-offline-title')).toHaveTextContent('אין חיבור לשרת');
    expect(screen.getByTestId('player-card-offline-body')).toHaveTextContent(
      'הכרטיס נטען מהשרת. נסה שוב כשיחזור החיבור.',
    );
    expect(screen.getByTestId('player-card-offline-code')).toHaveAccessibleName('קוד שגיאה: timeout');
    expect(announce).toHaveBeenCalledWith('אין חיבור לשרת. הכרטיס נטען מהשרת. נסה שוב כשיחזור החיבור.');
    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: 'נסה שוב' }));
    await settle();
    expect(screen.getByTestId('player-card-identity')).toBeOnTheScreen();
  });

  it('the server’s error: "משהו השתבש", what to do, the code with its status', async () => {
    await show(async () => {
      throw new ProgressApiError('badRequest', 400);
    });
    expect(screen.getByTestId('player-card-error-title')).toHaveTextContent('משהו השתבש');
    expect(screen.getByTestId('player-card-error-body')).toHaveTextContent(
      'השרת לא הצליח לענות כרגע. נסה שוב בעוד רגע.',
    );
    expect(screen.getByTestId('player-card-error-code')).toHaveTextContent('badRequest-400');
  });

  it('a player who isn’t there: says so, with nothing to retry', async () => {
    await show(async () => {
      throw new ProgressApiError('notFound', 404);
    });
    expect(screen.getByTestId('player-card-not-found-title')).toHaveTextContent('השחקן לא נמצא');
    expect(screen.queryByRole('button', { name: 'נסה שוב' })).toBeNull();
    expect(screen.queryByTestId('player-card-not-found-code')).toBeNull();
  });

  it('mine offline: the saved card at once, no skeleton, with the note', async () => {
    const mine = card({ id: 'me' });
    await show(
      async () => {
        throw new ProgressApiError('network');
      },
      { playerId: 'me', cached: mine },
    );
    expect(screen.queryByTestId('player-card-loading')).toBeNull();
    expect(screen.getByTestId('player-card-identity')).toBeOnTheScreen();
    expect(screen.getByTestId('player-card-note')).toHaveTextContent('אין חיבור לשרת: מוצג הכרטיס השמור.', {
      exact: false,
    });
  });

  it('speaks English', async () => {
    await i18n.changeLanguage('en');
    await show(() => new Promise(() => undefined));
    expect(screen.getByRole('progressbar', { name: 'Loading…' })).toBeOnTheScreen();
    await show(async () => {
      throw new ProgressApiError('unavailable', 503);
    });
    expect(screen.getByTestId('player-card-offline-title')).toHaveTextContent('No connection to the server');
    expect(screen.getByTestId('player-card-offline-code')).toHaveAccessibleName(
      'Error code: unavailable-503',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
    await show(async () => {
      throw new ProgressApiError('notFound', 404);
    });
    expect(screen.getByTestId('player-card-not-found-title')).toHaveTextContent('Player not found');
  });
});
