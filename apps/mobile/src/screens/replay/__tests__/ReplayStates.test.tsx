import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { ReplayScreen } from '../ReplayScreen';
import type { ReplayLoad } from '../replaySource';

/**
 * Why a replay can't show (work plan stage 13; spec §16.3, §4.1 "מצבי שגיאה"), in the shared state view: no
 * connection and an unreadable game are said as they appear, with "לנסות שוב"; a game that isn't there has
 * nothing to retry. Hebrew and English.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

async function show(result: ReplayLoad) {
  const load = jest.fn(async () => result);
  await render(<ReplayScreen gameId="g1" load={load} onBack={jest.fn()} />);
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
  return load;
}

let announce: jest.SpyInstance;

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on' });
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});
afterEach(() => announce.mockRestore());

describe('replay states (stage 13)', () => {
  it('no connection: said as it appears, and "לנסות שוב" loads again', async () => {
    const load = await show({ kind: 'offline' });
    expect(screen.getByRole('header', { name: 'אין חיבור לשרת. משחק מדורג נטען מהשרת' })).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith('אין חיבור לשרת. משחק מדורג נטען מהשרת');
    await fireEvent.press(screen.getByRole('button', { name: 'לנסות שוב' }));
    await act(async () => {
      await new Promise((r) => setImmediate(r));
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a game that isn’t there: no retry, nothing announced as an error', async () => {
    await show({ kind: 'missing' });
    expect(screen.getByRole('header', { name: 'לא מצאנו את המשחק הזה' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'לנסות שוב' })).toBeNull();
    expect(announce).not.toHaveBeenCalled();
  });

  it('speaks English', async () => {
    await i18n.changeLanguage('en');
    await show({ kind: 'unavailable' });
    expect(screen.getByRole('header', { name: "We couldn't read this game" })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
    await show({ kind: 'offline' });
    expect(
      screen.getByRole('header', { name: 'No connection to the server. Ranked games load from the server' }),
    ).toBeOnTheScreen();
  });
});
