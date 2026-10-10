import { render, screen } from '@testing-library/react-native';

import { color } from '../../../../theme';
import type { OpponentReconnectingModel } from '../connectionModel';
import { FrozenBadge, OpponentReconnecting } from '../OpponentReconnecting';
import { hidden, iso, type Setup, setUp, styleOf, wait } from '../testing/setup';

jest.mock('../../../../services/feedback', () => ({ cue: jest.fn() }));
const feedback = jest.requireMock<{ cue: jest.Mock }>('../../../../services/feedback');

const model = (over: Partial<OpponentReconnectingModel> = {}): OpponentReconnectingModel => ({
  kind: 'opponentReconnecting',
  playerId: 'nina',
  name: 'NinaVolt',
  colorIndex: 1,
  secondsLeft: 15,
  remainingMs: 15_000,
  graceMs: 15_000,
  expired: false,
  ...over,
});

let env: Setup;
afterEach(() => env.restore());

describe('OpponentReconnecting (Hebrew)', () => {
  beforeEach(async () => {
    env = await setUp('he');
    feedback.cue.mockClear();
  });

  it('renders nothing without a model', async () => {
    const { toJSON } = await render(<OpponentReconnecting model={null} />);
    expect(toJSON()).toBeNull();
  });

  it('freezes the board: the status, the countdown card and what happens if the time runs out', async () => {
    await render(<OpponentReconnecting model={model()} />);
    expect(screen.getByText('המשחק מוקפא', hidden)).toBeOnTheScreen();
    expect(screen.getByText('כל הטיימרים עצורים', hidden)).toBeOnTheScreen();
    expect(screen.getByText(`${iso('NinaVolt')} איבד חיבור`, hidden)).toBeOnTheScreen();
    expect(screen.getByTestId('opponent-reconnecting-card-title', hidden)).toHaveTextContent('היריב מתנתק…');
    expect(screen.getByTestId('opponent-reconnecting-card-ring-seconds', hidden)).toHaveTextContent('15');
    expect(screen.getByText('שניות', hidden)).toBeOnTheScreen();
    // The spec's ring caption, in English in both languages (§16.2, stage 7 "סיום").
    expect(screen.getByTestId('opponent-reconnecting-card-reconnecting', hidden)).toHaveTextContent(
      'Reconnecting... 15',
    );
    expect(screen.getByText('המשחק נשמר בשרת', hidden)).toBeOnTheScreen();
    expect(screen.getByText('הלוח והניקוד שמורים', hidden)).toBeOnTheScreen();
    expect(screen.getByText('לניצחון בנטישה', hidden)).toBeOnTheScreen();
    expect(screen.getByTestId('opponent-reconnecting-clock', hidden)).toHaveTextContent('0:15');
    expect(screen.getByTestId('opponent-reconnecting-hint', hidden)).toHaveTextContent(
      `אם ${iso('NinaVolt')} לא יחזור בזמן, תנצח בנטישה`,
    );
  });

  it('counts down with the model', async () => {
    const { rerender } = await render(<OpponentReconnecting model={model()} />);
    await rerender(<OpponentReconnecting model={model({ secondsLeft: 9, remainingMs: 8200 })} />);
    expect(screen.getByTestId('opponent-reconnecting-card-ring-seconds', hidden)).toHaveTextContent('9');
    expect(screen.getByTestId('opponent-reconnecting-clock', hidden)).toHaveTextContent('0:09');
    expect(screen.getByTestId('opponent-reconnecting-card-reconnecting', hidden)).toHaveTextContent(
      'Reconnecting... 9',
    );
  });

  it('is one alert for screen readers, in a modal that takes the touches', async () => {
    await render(<OpponentReconnecting model={model({ secondsLeft: 12 })} />);
    expect(screen.getByRole('alert')).toHaveAccessibleName(
      `${iso('NinaVolt')} איבד חיבור. המשחק מוקפא, כל הטיימרים עצורים. זמן לחזרה: 12 שניות. ` +
        `אם ${iso('NinaVolt')} לא יחזור בזמן, תנצח בנטישה`,
    );
    const root = screen.getByTestId('opponent-reconnecting');
    expect(root).toHaveProp('accessibilityViewIsModal', true);
    expect(root).toHaveProp('pointerEvents', 'auto');
  });

  it('starts the freeze where it is told (under the cards)', async () => {
    await render(<OpponentReconnecting model={model()} top={210} bottomInset={20} />);
    expect(styleOf(screen.getByTestId('opponent-reconnecting'))).toMatchObject({ top: 210, bottom: 0 });
  });

  it('announces the freeze once, not every second, and the end of the grace', async () => {
    const { rerender } = await render(<OpponentReconnecting model={model()} />);
    await rerender(<OpponentReconnecting model={model({ secondsLeft: 14, remainingMs: 14_000 })} />);
    await rerender(<OpponentReconnecting model={model({ secondsLeft: 13, remainingMs: 13_000 })} />);
    expect(env.announced()).toEqual([`${iso('NinaVolt')} איבד חיבור. המשחק מוקפא עד שיחזור`]);
    await rerender(<OpponentReconnecting model={model({ secondsLeft: 0, remainingMs: 0, expired: true })} />);
    expect(env.announced()).toEqual([
      `${iso('NinaVolt')} איבד חיבור. המשחק מוקפא עד שיחזור`,
      'הזמן נגמר. בודקים מול השרת',
    ]);
  });

  it('plays the warning cue once per disconnection', async () => {
    const { rerender } = await render(<OpponentReconnecting model={model()} />);
    await rerender(<OpponentReconnecting model={model({ secondsLeft: 10 })} />);
    expect(feedback.cue.mock.calls).toEqual([['disconnect']]);
    await rerender(<OpponentReconnecting model={null} />);
    await rerender(<OpponentReconnecting model={model()} />);
    expect(feedback.cue.mock.calls).toEqual([['disconnect'], ['disconnect']]);
  });

  it('uses the feminine Hebrew forms when asked', async () => {
    await render(<OpponentReconnecting model={model()} gender="female" />);
    expect(screen.getByText(`${iso('NinaVolt')} איבדה חיבור`, hidden)).toBeOnTheScreen();
    expect(screen.getByTestId('opponent-reconnecting-hint', hidden)).toHaveTextContent(
      `אם ${iso('NinaVolt')} לא תחזור בזמן, תנצח בנטישה`,
    );
    expect(env.announced()).toEqual([`${iso('NinaVolt')} איבדה חיבור. המשחק מוקפא עד שתחזור`]);
  });

  it('says "היריב" when the opponent has no name', async () => {
    await render(<OpponentReconnecting model={model({ name: null })} />);
    expect(screen.getByText('היריב איבד חיבור', hidden)).toBeOnTheScreen();
  });

  it('waits for the server once the time is up', async () => {
    await render(<OpponentReconnecting model={model({ secondsLeft: 0, remainingMs: 0, expired: true })} />);
    expect(screen.getByTestId('opponent-reconnecting-card-title', hidden)).toHaveTextContent(
      `${iso('NinaVolt')} לא חזר`,
    );
    expect(screen.getByRole('alert')).toHaveAccessibleName(
      `הזמן נגמר. ${iso('NinaVolt')} לא חזר. בודקים מול השרת…`,
    );
    expect(screen.getByText('בודקים מול השרת…', hidden)).toBeOnTheScreen();
    expect(screen.queryByTestId('opponent-reconnecting-clock', hidden)).not.toBeOnTheScreen();
    expect(screen.queryByTestId('opponent-reconnecting-hint', hidden)).not.toBeOnTheScreen();
    expect(styleOf(screen.getByTestId('opponent-reconnecting-card'))).toMatchObject({
      borderColor: color.accent,
    });
  });

  it('fades out when the model goes, touch-through, then unmounts', async () => {
    const { rerender } = await render(<OpponentReconnecting model={model()} />);
    await rerender(<OpponentReconnecting model={null} />);
    const root = screen.getByTestId('opponent-reconnecting');
    expect(root).toHaveProp('pointerEvents', 'none');
    await wait(400);
    expect(screen.queryByTestId('opponent-reconnecting')).not.toBeOnTheScreen();
  });

  it('blinks the "lost" icon in full motion only; the ring drains in both', async () => {
    await render(<OpponentReconnecting model={model()} />);
    await wait(300);
    expect(screen.getByTestId('opponent-reconnecting-card-pulse', hidden)).not.toHaveAnimatedStyle({
      opacity: 1,
    });
  });
});

describe('OpponentReconnecting, reduced motion', () => {
  beforeEach(async () => {
    env = await setUp('he', 'on');
  });

  it('does not blink, and still counts down', async () => {
    const { rerender } = await render(<OpponentReconnecting model={model()} />);
    await wait(300);
    expect(screen.getByTestId('opponent-reconnecting-card-pulse', hidden)).toHaveAnimatedStyle({
      opacity: 1,
    });
    await rerender(<OpponentReconnecting model={model({ secondsLeft: 14, remainingMs: 14_000 })} />);
    expect(screen.getByTestId('opponent-reconnecting-card-ring-seconds', hidden)).toHaveTextContent('14');
    // The tick only fades with reduced motion: no scale.
    await wait(20);
    expect(screen.getByTestId('opponent-reconnecting-card-ring-seconds', hidden)).toHaveAnimatedStyle({
      transform: [{ scale: 1 }],
    });
  });
});

describe('OpponentReconnecting (English)', () => {
  beforeEach(async () => {
    env = await setUp('en');
  });

  it('says it all in English', async () => {
    await render(<OpponentReconnecting model={model({ secondsLeft: 12 })} />);
    expect(screen.getByText('Game frozen', hidden)).toBeOnTheScreen();
    expect(screen.getByText('All timers stopped', hidden)).toBeOnTheScreen();
    expect(screen.getByTestId('opponent-reconnecting-card-title', hidden)).toHaveTextContent(
      'Opponent reconnecting…',
    );
    expect(screen.getByText(`${iso('NinaVolt')} lost connection`, hidden)).toBeOnTheScreen();
    expect(screen.getByTestId('opponent-reconnecting-card-reconnecting', hidden)).toHaveTextContent(
      'Reconnecting... 12',
    );
    expect(screen.getByText('seconds', hidden)).toBeOnTheScreen();
    expect(screen.getByText('Win by abandonment', hidden)).toBeOnTheScreen();
    expect(screen.getByRole('alert')).toHaveAccessibleName(
      `${iso('NinaVolt')} lost connection. Game frozen, all timers stopped. Time to come back: 12 seconds. ` +
        `If ${iso('NinaVolt')} isn't back in time, you win by abandonment`,
    );
  });
});

describe('FrozenBadge', () => {
  it('is one element for screen readers, in Hebrew', async () => {
    env = await setUp('he');
    await render(<FrozenBadge />);
    expect(screen.getByTestId('frozen-badge')).toHaveAccessibleName('המשחק מוקפא, כל הטיימרים עצורים');
  });

  it('and in English', async () => {
    env = await setUp('en');
    await render(<FrozenBadge testID="badge" />);
    expect(screen.getByTestId('badge')).toHaveAccessibleName('Game frozen, all timers stopped');
  });
});
