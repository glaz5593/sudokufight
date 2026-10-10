import { fireEvent, render, screen } from '@testing-library/react-native';
import { Share } from 'react-native';

import { color } from '../../../../theme';
import { type LobbyInfo, lobbyOf } from '../connectionModel';
import { COPIED_HOLD_MS, LobbyView } from '../LobbyView';
import { iso, type Setup, setUp, styleOf, wait } from '../testing/setup';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const ME = { id: 'me', name: 'MosheG' };
const NINA = { id: 'nina', name: 'NinaVolt' };
const AIKO = { id: 'aiko', name: 'Aiko_M' };

const lobby = (over: Partial<LobbyInfo> = {}) =>
  lobbyOf({ code: 'ABC234', gameType: 'normal', playerCount: 2, players: [ME], playerId: ME.id, ...over });

let env: Setup;
afterEach(() => env.restore());

describe('LobbyView (Hebrew)', () => {
  beforeEach(async () => {
    env = await setUp('he');
  });

  it('shows the room code big, left to right, spelled out for screen readers and selectable', async () => {
    await render(<LobbyView model={lobby()} onLeave={jest.fn()} />);
    expect(screen.getByRole('header', { name: 'חדר פרטי' })).toBeOnTheScreen();
    expect(screen.getByText('רגיל · 2 שחקנים')).toBeOnTheScreen();
    const code = screen.getByTestId('lobby-code');
    expect(code).toHaveTextContent('ABC234');
    expect(code).toHaveProp('selectable', true);
    expect(code).toHaveAccessibleName('קוד החדר: A B C 2 3 4');
    expect(styleOf(code)).toMatchObject({ writingDirection: 'ltr' });
  });

  it('lists the seats: me marked "אני", and the empty ones waiting', async () => {
    await render(<LobbyView model={lobby({ playerCount: 3, players: [NINA, ME] })} onLeave={jest.fn()} />);
    expect(screen.getByTestId('lobby-seat-0')).toHaveAccessibleName(iso('NinaVolt'));
    expect(screen.getByTestId('lobby-seat-1')).toHaveAccessibleName(`${iso('MosheG')}, אני`);
    expect(screen.getByTestId('lobby-seat-2')).toHaveAccessibleName('מקום פנוי, ממתין לשחקן');
    expect(screen.getByText('אני')).toHaveStyle({ color: color.players[0].onRing });
    expect(screen.getByText('ממתין לשחקן…')).toBeOnTheScreen();
    expect(screen.getByTestId('lobby-status')).toHaveTextContent('מחכים לעוד שחקן אחד');
  });

  it.each([
    [2, 'מחכים לעוד 2 שחקנים'],
    [3, 'מחכים לעוד 3 שחקנים'],
  ])('counts %i missing players', async (missing, line) => {
    await render(<LobbyView model={lobby({ playerCount: 1 + missing })} onLeave={jest.fn()} />);
    expect(screen.getByTestId('lobby-status')).toHaveTextContent(line);
  });

  it('says the game is starting once every seat is taken', async () => {
    await render(<LobbyView model={lobby({ players: [ME, NINA] })} onLeave={jest.fn()} />);
    expect(screen.getByTestId('lobby-status')).toHaveTextContent('כולם כאן! המשחק מתחיל…');
    expect(screen.getByText('כולם כאן! המשחק מתחיל…')).toHaveStyle({ color: color.success });
  });

  it('announces who came in and how many are missing, as it changes', async () => {
    const { rerender } = await render(<LobbyView model={lobby({ playerCount: 3 })} onLeave={jest.fn()} />);
    await rerender(<LobbyView model={lobby({ playerCount: 3, players: [ME, NINA] })} onLeave={jest.fn()} />);
    await rerender(
      <LobbyView model={lobby({ playerCount: 3, players: [ME, NINA, AIKO] })} onLeave={jest.fn()} />,
    );
    expect(env.announced()).toEqual([
      'מחכים לעוד 2 שחקנים',
      `${iso('NinaVolt')} בחדר. מחכים לעוד שחקן אחד`,
      `${iso('Aiko_M')} בחדר. כולם כאן! המשחק מתחיל…`,
    ]);
  });

  it('shares the invitation through the system sheet by default', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    await render(<LobbyView model={lobby()} onLeave={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'שיתוף הקוד' }));
    expect(share).toHaveBeenCalledWith({ message: 'בוא לשחק איתי סודוקו פייט! קוד החדר: ABC234' });
    share.mockRestore();
  });

  it('shares through the given function, and survives a failed share', async () => {
    const onShare = jest.fn().mockRejectedValue(new Error('dismissed'));
    await render(<LobbyView model={lobby()} onLeave={jest.fn()} onShare={onShare} />);
    await fireEvent.press(screen.getByRole('button', { name: 'שיתוף הקוד' }));
    await wait(0);
    expect(onShare).toHaveBeenCalledWith('בוא לשחק איתי סודוקו פייט! קוד החדר: ABC234');
  });

  it('copies only when the app can, then says so for a moment', async () => {
    const { unmount } = await render(<LobbyView model={lobby()} onLeave={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'העתקה' })).not.toBeOnTheScreen();
    await unmount();

    const onCopy = jest.fn().mockResolvedValue(undefined);
    await render(<LobbyView model={lobby()} onLeave={jest.fn()} onCopy={onCopy} />);
    await fireEvent.press(screen.getByRole('button', { name: 'העתקה' }));
    await wait(0);
    expect(onCopy).toHaveBeenCalledWith('ABC234');
    expect(screen.getByTestId('lobby-copied')).toHaveTextContent('הקוד הועתק');
    expect(env.announced()).toContain('הקוד הועתק');
    await wait(COPIED_HOLD_MS);
    expect(screen.queryByTestId('lobby-copied')).not.toBeOnTheScreen();
  });

  it('leaves the room', async () => {
    const onLeave = jest.fn();
    await render(<LobbyView model={lobby()} onLeave={onLeave} />);
    await fireEvent.press(screen.getByRole('button', { name: 'יציאה מהחדר' }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('blinks an empty seat in full motion only', async () => {
    await render(<LobbyView model={lobby()} onLeave={jest.fn()} />);
    await wait(300);
    expect(screen.getByTestId('lobby-seat-1-dot')).not.toHaveAnimatedStyle({ opacity: 1 });
  });
});

describe('LobbyView, reduced motion', () => {
  beforeEach(async () => {
    env = await setUp('he', 'on');
  });

  it('keeps an empty seat still', async () => {
    await render(<LobbyView model={lobby()} onLeave={jest.fn()} />);
    await wait(300);
    expect(screen.getByTestId('lobby-seat-1-dot')).toHaveAnimatedStyle({ opacity: 1 });
  });
});

describe('LobbyView (English)', () => {
  beforeEach(async () => {
    env = await setUp('en');
  });

  it('says it all in English', async () => {
    await render(
      <LobbyView
        model={lobby({ playerCount: 4, gameType: 'hard' })}
        onLeave={jest.fn()}
        onCopy={jest.fn()}
      />,
    );
    expect(screen.getByRole('header', { name: 'Private room' })).toBeOnTheScreen();
    expect(screen.getByText('Hard · 4 players')).toBeOnTheScreen();
    expect(screen.getByTestId('lobby-code')).toHaveAccessibleName('Room code: A B C 2 3 4');
    expect(screen.getByTestId('lobby-seat-0')).toHaveAccessibleName(`${iso('MosheG')}, me`);
    expect(screen.getByTestId('lobby-status')).toHaveTextContent('Waiting for 3 more players');
    for (const name of ['Share the code', 'Copy', 'Leave the room']) {
      expect(screen.getByRole('button', { name })).toBeOnTheScreen();
    }
  });

  it('waits for one more in English', async () => {
    await render(<LobbyView model={lobby()} onLeave={jest.fn()} />);
    expect(screen.getByTestId('lobby-status')).toHaveTextContent('Waiting for one more player');
  });
});
