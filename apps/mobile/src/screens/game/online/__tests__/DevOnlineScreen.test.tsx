import { act, fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '../../../../i18n';
import type { NetIdentity } from '../../../../net/onlineClient';
import type { OnlineInfo } from '../../../../net/remoteGameHost';
import { DevOnlineScreen, type DevOnlineScreenProps } from '../DevOnlineScreen';

/** /dev/online (stage 7, development builds): a private room by code, without matchmaking. */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const dev: NetIdentity = { kind: 'dev', devUserId: 'dev-1234', name: 'MosheG' };

async function show(over: Partial<DevOnlineScreenProps> = {}) {
  const props: DevOnlineScreenProps = {
    serverAddress: 'ws://192.168.1.20:2567',
    identity: () => Promise.resolve(dev),
    onCreate: jest.fn(),
    onJoin: jest.fn(),
    onMetrics: jest.fn(),
    onClose: jest.fn(),
    ...over,
  };
  await render(<DevOnlineScreen {...props} />);
  await act(async () => {
    await Promise.resolve();
  });
  return props;
}

beforeEach(async () => {
  await i18n.changeLanguage('he');
});

describe('DevOnlineScreen', () => {
  it('says which server and who this phone is; creates a room of the chosen type', async () => {
    const p = await show();
    expect(screen.getByRole('header', { name: 'משחק מקוון' })).toBeOnTheScreen();
    expect(screen.getByTestId('dev-online-server')).toHaveTextContent('שרת: ⁦ws://192.168.1.20:2567⁩');
    expect(screen.getByTestId('dev-online-identity')).toHaveTextContent('אתה: ⁦MosheG⁩');
    expect(screen.getByText('מזהה פיתוח: ⁦dev-1234⁩')).toBeOnTheScreen();
    expect(screen.getByText('מספר שחקנים')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '2 שחקנים' })).toBeSelected();

    await fireEvent.press(screen.getByRole('button', { name: 'צור חדר' }));
    expect(p.onCreate).toHaveBeenLastCalledWith('fast', 2);
    await fireEvent.press(screen.getByRole('button', { name: 'קשה' }));
    expect(screen.getByRole('button', { name: 'קשה' })).toBeSelected();
    await fireEvent.press(screen.getByRole('button', { name: 'צור חדר' }));
    expect(p.onCreate).toHaveBeenLastCalledWith('hard', 2);
  });

  it('stage 10: rooms of 3 and of 4 players', async () => {
    const p = await show();
    await fireEvent.press(screen.getByRole('button', { name: '3 שחקנים' }));
    expect(screen.getByRole('button', { name: '3 שחקנים' })).toBeSelected();
    expect(screen.getByRole('button', { name: '2 שחקנים' })).not.toBeSelected();
    await fireEvent.press(screen.getByRole('button', { name: 'צור חדר' }));
    expect(p.onCreate).toHaveBeenLastCalledWith('fast', 3);
    await fireEvent.press(screen.getByRole('button', { name: '4 שחקנים' }));
    await fireEvent.press(screen.getByRole('button', { name: 'רגיל' }));
    await fireEvent.press(screen.getByRole('button', { name: 'צור חדר' }));
    expect(p.onCreate).toHaveBeenLastCalledWith('normal', 4);
  });

  it('joins by code as typed (case, spaces and dashes don’t matter); a bad code says why', async () => {
    const p = await show();
    const input = screen.getByTestId('dev-online-code');
    expect(screen.getByRole('button', { name: 'הצטרף' })).toBeDisabled();
    await fireEvent.changeText(input, 'abc-1o4');
    await fireEvent.press(screen.getByRole('button', { name: 'הצטרף' }));
    expect(p.onJoin).not.toHaveBeenCalled();
    expect(screen.getByText('זה לא קוד חדר. 6 תווים, בלי 0, O, 1, I ו־L')).toBeOnTheScreen();

    await fireEvent.changeText(input, ' abc-234 ');
    expect(screen.queryByText('זה לא קוד חדר. 6 תווים, בלי 0, O, 1, I ו־L')).toBeNull();
    await fireEvent(input, 'submitEditing');
    expect(p.onJoin).toHaveBeenCalledWith('ABC234');
  });

  it('a signed-in phone is known by its account: no token on the screen', async () => {
    await show({ identity: () => Promise.resolve({ kind: 'token', token: 'secret-token' }) });
    expect(screen.getByTestId('dev-online-identity')).toHaveTextContent(
      'מחובר לחשבון: השרת מזהה אותך לפי החשבון',
    );
    expect(screen.queryByText(/secret-token/)).toBeNull();
  });

  it('the online game already open, the measures, and close (English)', async () => {
    await i18n.changeLanguage('en');
    const current = { status: 'lobby', code: 'ABC234' } as OnlineInfo;
    const onBackToGame = jest.fn();
    const p = await show({ current, onBackToGame });
    expect(screen.getByTestId('dev-online-current')).toHaveTextContent(
      'Room ⁦ABC234⁩ · In the room, waiting for players',
      { exact: false },
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Back to the game' }));
    expect(onBackToGame).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Network measures' }));
    expect(p.onMetrics).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(p.onClose).toHaveBeenCalled();
  });
});
