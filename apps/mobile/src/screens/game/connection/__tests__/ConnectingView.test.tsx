import { fireEvent, render, screen } from '@testing-library/react-native';

import { ltr } from '../../../../components/player/format';
import { color } from '../../../../theme';
import { ConnectingView } from '../ConnectingView';
import type { ConnectingStep } from '../connectionModel';
import { matchLoadingOf, tipOf } from '../loadingModel';
import { iso, type Setup, setUp, styleOf, wait } from '../testing/setup';

let env: Setup;
afterEach(() => env.restore());

describe('ConnectingView (Hebrew)', () => {
  beforeEach(async () => {
    env = await setUp('he');
  });

  it.each<[ConnectingStep, number, string]>([
    ['server', 1, 'מתחבר לשרת המשחק…'],
    ['room', 2, 'נכנס לחדר…'],
    ['sync', 3, 'מסנכרן ניקוד וטיימרים…'],
  ])('shows the %s step as step %i of 3', async (step, n, text) => {
    await render(<ConnectingView model={{ kind: 'connecting', step }} />);
    expect(screen.getByText('בכניסה למשחק')).toBeOnTheScreen();
    expect(screen.getByTestId('connecting-step')).toHaveTextContent(text);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAccessibleName(`טעינת המשחק, שלב ${n} מתוך 3`);
    expect(bar).toHaveAccessibilityValue({ min: 1, max: 3, now: n, text });
  });

  it('marks the steps done, current and to come', async () => {
    await render(<ConnectingView model={{ kind: 'connecting', step: 'room' }} />);
    expect(styleOf(screen.getByTestId('connecting-mark-server'))).toMatchObject({
      backgroundColor: color.textMuted,
    });
    expect(styleOf(screen.getByTestId('connecting-mark-room'))).toMatchObject({
      backgroundColor: color.accent,
    });
    expect(styleOf(screen.getByTestId('connecting-mark-sync'))).toMatchObject({
      backgroundColor: color.border,
    });
  });

  it('announces each step', async () => {
    const { rerender } = await render(<ConnectingView model={{ kind: 'connecting', step: 'server' }} />);
    await rerender(<ConnectingView model={{ kind: 'connecting', step: 'room' }} />);
    expect(env.announced()).toEqual(['מתחבר לשרת המשחק…', 'נכנס לחדר…']);
  });

  it('cancels when it can', async () => {
    const { unmount } = await render(<ConnectingView model={{ kind: 'connecting', step: 'server' }} />);
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
    await unmount();
    const onCancel = jest.fn();
    await render(<ConnectingView model={{ kind: 'connecting', step: 'server' }} onCancel={onCancel} />);
    await fireEvent.press(screen.getByRole('button', { name: 'ביטול' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('ticks the new step in, without a scale under reduced motion', async () => {
    env.restore();
    env = await setUp('he', 'on');
    const { rerender } = await render(<ConnectingView model={{ kind: 'connecting', step: 'server' }} />);
    await rerender(<ConnectingView model={{ kind: 'connecting', step: 'sync' }} />);
    await wait(20);
    expect(screen.getByTestId('connecting-step')).toHaveAnimatedStyle({ transform: [{ scale: 1 }] });
  });
});

describe('ConnectingView, a ranked match’s room (Loading.dc.html)', () => {
  beforeEach(async () => {
    env = await setUp('he');
  });

  const PROFILES = {
    me: { avatarId: 'lava-lamp', country: 'IL', name: 'Moshe', rating: 1287, provisional: false },
    nina: { avatarId: 'maya', country: 'DE', name: 'NinaVolt', rating: 1305, provisional: true },
  };
  const loading = (step: ConnectingStep, seed = 'online-1') =>
    matchLoadingOf({ profiles: PROFILES, myId: 'me', gameType: 'normal', step, seed })!;
  const hidden = { includeHiddenElements: true };

  it('the tag, both players with their ratings, who is ready, the small board and the percent', async () => {
    await render(<ConnectingView model={{ kind: 'connecting', step: 'room' }} match={loading('room')} />);
    expect(screen.getByTestId('connecting-tag')).toHaveTextContent('מדורג · רגיל');
    // Me first ("אני", P1), not in the room yet; NinaVolt in her match already.
    expect(screen.getByTestId('connecting-player-me')).toHaveAccessibleName('אני, דירוג 1287, מתחבר…');
    expect(screen.getByTestId('connecting-player-nina')).toHaveAccessibleName(
      `${iso('NinaVolt')}, דירוג 1305, זמני, מוכן!`,
    );
    expect(screen.getByTestId('connecting-player-nina-state')).toHaveStyle({ color: color.success });
    expect(screen.getByTestId('connecting-player-nina')).toHaveTextContent('1305', { exact: false });
    expect(screen.getByTestId('flag-DE', hidden)).toBeTruthy();
    // The small board is decorative; the steps' bar is still the one progress bar.
    expect(screen.getByTestId('connecting-mini-board', hidden)).toHaveProp(
      'accessibilityElementsHidden',
      true,
    );
    expect(screen.getByTestId('connecting-percent')).toHaveTextContent(ltr('33%'));
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('טעינת המשחק, שלב 2 מתוך 3');
  });

  it('"מוכן!" under me too once my phone is in the room (D37)', async () => {
    await render(<ConnectingView model={{ kind: 'connecting', step: 'sync' }} match={loading('sync')} />);
    expect(screen.getByTestId('connecting-player-me-state')).toHaveTextContent('מוכן!');
    expect(screen.getByTestId('connecting-percent')).toHaveTextContent(ltr('67%'));
  });

  it('a tip from the list, with the bank’s numbers for the game’s type: up to 9.5 a cell in normal, not 13.5', async () => {
    const seed = Array.from({ length: 40 }, (_, k) => `online-${k}`).find((s) => tipOf(s) === 'score')!;
    const view = await render(
      <ConnectingView model={{ kind: 'connecting', step: 'server' }} match={loading('server', seed)} />,
    );
    const tip = screen.getByTestId('connecting-tip');
    expect(screen.getByTestId('connecting-tip-text')).toHaveTextContent(
      'ככל שהשורה, הטור והריבוע ריקים יותר, המהלך שווה יותר: עד 9.5 נק׳ למשבצת.',
    );
    expect(tip).toHaveAccessibleName(
      'טיפ: ככל שהשורה, הטור והריבוע ריקים יותר, המהלך שווה יותר: עד 9.5 נק׳ למשבצת.',
    );
    expect(tip).not.toHaveTextContent('13.5', { exact: false });
    // A fast game's boards have more givens: a move there is worth 6.5 at most.
    const fast = matchLoadingOf({ profiles: PROFILES, myId: 'me', gameType: 'fast', step: 'server', seed })!;
    await view.rerender(<ConnectingView model={{ kind: 'connecting', step: 'server' }} match={fast} />);
    expect(screen.getByTestId('connecting-tip-text')).toHaveTextContent(
      'ככל שהשורה, הטור והריבוע ריקים יותר, המהלך שווה יותר: עד 6.5 נק׳ למשבצת.',
    );
  });

  it('a room by code: the steps alone', async () => {
    await render(<ConnectingView model={{ kind: 'connecting', step: 'room' }} match={null} />);
    for (const id of ['connecting-tag', 'connecting-percent', 'connecting-tip', 'connecting-mini-board'])
      expect(screen.queryByTestId(id, hidden)).toBeNull();
  });

  it('speaks English', async () => {
    env.restore();
    env = await setUp('en');
    const seed = Array.from({ length: 40 }, (_, k) => `online-${k}`).find((s) => tipOf(s) === 'lastCell')!;
    await render(
      <ConnectingView model={{ kind: 'connecting', step: 'sync' }} match={loading('sync', seed)} />,
    );
    expect(screen.getByTestId('connecting-tag')).toHaveTextContent('Ranked · Normal');
    expect(screen.getByTestId('connecting-player-me')).toHaveAccessibleName('Me, Rating 1287, Ready!');
    expect(screen.getByTestId('connecting-tip-text')).toHaveTextContent(
      'The last cell on the board is always worth just 1.5 points: everything around it is full.',
    );
  });
});

describe('ConnectingView (English)', () => {
  beforeEach(async () => {
    env = await setUp('en');
  });

  it('says it in English', async () => {
    await render(<ConnectingView model={{ kind: 'connecting', step: 'sync' }} onCancel={jest.fn()} />);
    expect(screen.getByText('Entering the game')).toBeOnTheScreen();
    expect(screen.getByTestId('connecting-step')).toHaveTextContent('Syncing scores and timers…');
    expect(screen.getByRole('progressbar')).toHaveAccessibleName('Loading the game, step 3 of 3');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeOnTheScreen();
  });
});
