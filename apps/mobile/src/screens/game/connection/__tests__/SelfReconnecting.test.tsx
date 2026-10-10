import { render, screen } from '@testing-library/react-native';

import { color } from '../../../../theme';
import type { SelfReconnectingModel } from '../connectionModel';
import { HURRY_SECONDS, SelfReconnecting } from '../SelfReconnecting';
import { hidden, type Setup, setUp, styleOf, wait } from '../testing/setup';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../../services/feedback', () => ({ cue: jest.fn() }));
const feedback = jest.requireMock<{ cue: jest.Mock }>('../../../../services/feedback');
const cues = (): string[] => feedback.cue.mock.calls.map((c: unknown[]) => String(c[0]));

const lost = (over: Partial<SelfReconnectingModel> = {}): SelfReconnectingModel => ({
  kind: 'selfReconnecting',
  phase: 'lost',
  attempt: 2,
  secondsLeft: 11,
  remainingMs: 10_800,
  graceMs: 15_000,
  syncItems: ['board', 'score', 'locks', 'timers'],
  ...over,
});
const back = (phase: 'syncing' | 'synced'): SelfReconnectingModel =>
  lost({ phase, attempt: null, secondsLeft: null, remainingMs: null });

let env: Setup;
afterEach(() => env.restore());

describe('SelfReconnecting (Hebrew)', () => {
  beforeEach(async () => {
    env = await setUp('he');
    feedback.cue.mockClear();
  });

  it('renders nothing without a model', async () => {
    const { toJSON } = await render(<SelfReconnecting model={null} />);
    expect(toJSON()).toBeNull();
  });

  it('lost: the banner with the attempt, the locked board and the time left', async () => {
    await render(<SelfReconnecting model={lost()} topInset={0} bottomInset={0} />);
    expect(screen.getByTestId('self-reconnecting-banner-title')).toHaveTextContent('החיבור שלך אבד');
    expect(screen.getByTestId('self-reconnecting-banner-sub')).toHaveTextContent('מתחבר מחדש…');
    expect(screen.getByTestId('self-reconnecting-banner-attempt')).toHaveTextContent('ניסיון2');
    expect(screen.getByTestId('self-reconnecting-banner')).toHaveAccessibleName(
      'החיבור שלך אבד. מתחבר מחדש… ניסיון 2',
    );

    expect(screen.getByTestId('self-reconnecting-card-title', hidden)).toHaveTextContent(
      'הלוח נעול עד שתחזור',
    );
    expect(screen.getByText('כשהחיבור יחזור נסנכרן:', hidden)).toBeOnTheScreen();
    for (const item of ['לוח', 'ניקוד', 'נעילות', 'טיימרים']) {
      expect(screen.getByText(item, hidden)).toBeOnTheScreen();
    }
    expect(screen.getByTestId('self-reconnecting-card')).toHaveAccessibleName(
      'הלוח נעול עד שתחזור. כשהחיבור יחזור נסנכרן: לוח, ניקוד, נעילות, טיימרים',
    );

    expect(screen.getByTestId('self-reconnecting-timer-title', hidden)).toHaveTextContent(
      'יש לך עוד 11 שניות לחזור',
    );
    expect(screen.getByTestId('self-reconnecting-timer-seconds', hidden)).toHaveStyle({
      color: color.accent,
    });
    expect(screen.getByText('לפני שהמשחק ייחשב כנטישה', hidden)).toBeOnTheScreen();
    expect(screen.getByRole('timer')).toHaveAccessibleName(
      'יש לך עוד 11 שניות לחזור. לפני שהמשחק ייחשב כנטישה',
    );
  });

  it('blocks the game while lost: modal, touches taken, the board dimmed to 50 %', async () => {
    await render(<SelfReconnecting model={lost()} />);
    const root = screen.getByTestId('self-reconnecting');
    expect(root).toHaveProp('pointerEvents', 'auto');
    expect(root).toHaveProp('accessibilityViewIsModal', true);
    expect(styleOf(screen.getByTestId('self-reconnecting-scrim', hidden))).toMatchObject({
      backgroundColor: color.bg,
      opacity: 0.5,
    });
  });

  it('puts the banner under the safe area and the timer above it', async () => {
    await render(<SelfReconnecting model={lost()} topInset={40} bottomInset={30} />);
    expect(styleOf(screen.getByTestId('self-reconnecting-banner')).top).toBeGreaterThan(40);
    const slot = screen.getByTestId('self-reconnecting-timer', hidden).parent;
    expect(styleOf(slot as never).bottom).toBeGreaterThan(30);
  });

  it('says one second in the singular', async () => {
    await render(<SelfReconnecting model={lost({ secondsLeft: 1, remainingMs: 600 })} />);
    expect(screen.getByTestId('self-reconnecting-timer-title', hidden)).toHaveTextContent(
      'יש לך עוד 1 שנייה לחזור',
    );
  });

  it('has no timer while the deadline is unknown, nor an attempt without a count', async () => {
    await render(<SelfReconnecting model={lost({ attempt: null, secondsLeft: null, remainingMs: null })} />);
    expect(screen.queryByTestId('self-reconnecting-timer', hidden)).not.toBeOnTheScreen();
    expect(screen.queryByTestId('self-reconnecting-banner-attempt')).not.toBeOnTheScreen();
    expect(env.announced()).toEqual(['החיבור שלך אבד. מתחבר מחדש']);
  });

  it('announces each attempt, and once that time is short; not every second', async () => {
    const { rerender } = await render(<SelfReconnecting model={lost()} />);
    await rerender(<SelfReconnecting model={lost({ secondsLeft: 10, remainingMs: 9800 })} />);
    await rerender(<SelfReconnecting model={lost({ attempt: 3, secondsLeft: 9 })} />);
    await rerender(<SelfReconnecting model={lost({ attempt: 3, secondsLeft: HURRY_SECONDS })} />);
    await rerender(<SelfReconnecting model={lost({ attempt: 3, secondsLeft: HURRY_SECONDS - 1 })} />);
    expect(env.announced()).toEqual([
      'החיבור שלך אבד. מתחבר מחדש, ניסיון 2',
      'החיבור שלך אבד. מתחבר מחדש, ניסיון 3',
      'עוד 5 שניות המשחק ייחשב כנטישה',
    ]);
  });

  it('back and syncing: green, still locked, "חזרת בזמן"', async () => {
    const { rerender } = await render(<SelfReconnecting model={lost()} />);
    await rerender(<SelfReconnecting model={back('syncing')} />);
    expect(screen.getByTestId('self-reconnecting-banner-title')).toHaveTextContent('חזרת למשחק');
    expect(screen.getByTestId('self-reconnecting-banner-sub')).toHaveTextContent('מסנכרן…');
    expect(styleOf(screen.getByTestId('self-reconnecting-banner'))).toMatchObject({
      borderColor: color.success,
    });
    expect(screen.getByTestId('self-reconnecting-card-title', hidden)).toHaveTextContent('מסנכרן…');
    expect(screen.getByText('המשחק נשמר בשרת וממשיך מאותה נקודה', hidden)).toBeOnTheScreen();
    expect(screen.getByTestId('self-reconnecting-timer-title', hidden)).toHaveTextContent('חזרת בזמן');
    expect(screen.getByText('הטיימרים ממשיכים מאותה שנייה', hidden)).toBeOnTheScreen();
    expect(screen.getByTestId('self-reconnecting')).toHaveProp('pointerEvents', 'auto');
    expect(env.announced()).toEqual(['החיבור שלך אבד. מתחבר מחדש, ניסיון 2', 'חזרת למשחק. מסנכרן']);
  });

  it('synced: the banner only, touch-through; the lock fades with the chips done', async () => {
    const { rerender } = await render(<SelfReconnecting model={back('syncing')} />);
    await rerender(<SelfReconnecting model={back('synced')} />);
    expect(screen.getByTestId('self-reconnecting-banner-sub')).toHaveTextContent('הכל סונכרן · המשחק ממשיך');
    const root = screen.getByTestId('self-reconnecting');
    expect(root).toHaveProp('pointerEvents', 'none');
    expect(root).toHaveProp('accessibilityViewIsModal', false);
    // The lock is still fading out, its chips ticked.
    expect(screen.getByTestId('self-reconnecting-card-board', hidden)).toHaveStyle({
      borderColor: color.success,
    });
    expect(screen.queryByTestId('self-reconnecting-card-board-dot', hidden)).not.toBeOnTheScreen();
    await wait(400);
    expect(screen.queryByTestId('self-reconnecting-lock', hidden)).not.toBeOnTheScreen();
    expect(screen.getByTestId('self-reconnecting-banner')).toBeOnTheScreen();
    expect(env.announced()).toEqual(['חזרת למשחק. מסנכרן', 'חזרת למשחק. הלוח והניקוד סונכרנו']);
  });

  it('fades away when the model ends', async () => {
    const { rerender } = await render(<SelfReconnecting model={back('synced')} />);
    await rerender(<SelfReconnecting model={null} />);
    expect(screen.getByTestId('self-reconnecting')).toBeOnTheScreen();
    await wait(400);
    expect(screen.queryByTestId('self-reconnecting')).not.toBeOnTheScreen();
  });

  it('plays the warning as the connection drops and the two tones when all is back', async () => {
    const { rerender } = await render(<SelfReconnecting model={lost()} />);
    await rerender(<SelfReconnecting model={lost({ attempt: 3 })} />);
    await rerender(<SelfReconnecting model={back('syncing')} />);
    await rerender(<SelfReconnecting model={back('synced')} />);
    expect(cues()).toEqual(['disconnect', 'reconnect']);
  });

  it("names the turn in the 'turns' model (D1)", async () => {
    await render(<SelfReconnecting model={lost({ syncItems: ['board', 'score', 'turn', 'timers'] })} />);
    expect(screen.getByText('תור', hidden)).toBeOnTheScreen();
    expect(screen.queryByText('נעילות', hidden)).not.toBeOnTheScreen();
  });

  it('blinks the waiting dots in full motion', async () => {
    await render(<SelfReconnecting model={lost()} />);
    await wait(300);
    expect(screen.getByTestId('self-reconnecting-card-board-dot', hidden)).not.toHaveAnimatedStyle({
      opacity: 1,
    });
  });
});

describe('SelfReconnecting, reduced motion', () => {
  beforeEach(async () => {
    env = await setUp('he', 'on');
  });

  it('keeps the dots still and the banner in place; the timer is still there', async () => {
    await render(<SelfReconnecting model={lost()} />);
    await wait(300);
    expect(screen.getByTestId('self-reconnecting-card-board-dot', hidden)).toHaveAnimatedStyle({
      opacity: 1,
    });
    expect(screen.getByTestId('self-reconnecting-banner')).toHaveAnimatedStyle({ opacity: 1 });
    expect(screen.getByRole('timer')).toBeOnTheScreen();
  });
});

describe('SelfReconnecting (English)', () => {
  beforeEach(async () => {
    env = await setUp('en');
  });

  it('says it all in English', async () => {
    await render(<SelfReconnecting model={lost()} />);
    expect(screen.getByTestId('self-reconnecting-banner')).toHaveAccessibleName(
      'You lost your connection. Reconnecting… Try 2',
    );
    expect(screen.getByTestId('self-reconnecting-card-title', hidden)).toHaveTextContent(
      "The board is locked until you're back",
    );
    for (const item of ['Board', 'Scores', 'Locks', 'Timers'])
      expect(screen.getByText(item, hidden)).toBeOnTheScreen();
    expect(screen.getByRole('timer')).toHaveAccessibleName(
      'You have 11 seconds to get back. Before it counts as abandonment',
    );
    expect(screen.getByTestId('self-reconnecting-timer-title', hidden)).toHaveTextContent(
      'You have 11 seconds to get back',
    );
    expect(env.announced()).toEqual(['You lost your connection. Reconnecting, try 2']);
  });

  it('back in time, in English', async () => {
    await render(<SelfReconnecting model={back('syncing')} />);
    expect(screen.getByTestId('self-reconnecting-banner-title')).toHaveTextContent("You're back in the game");
    expect(screen.getByTestId('self-reconnecting-timer-title', hidden)).toHaveTextContent('Back in time');
  });
});
