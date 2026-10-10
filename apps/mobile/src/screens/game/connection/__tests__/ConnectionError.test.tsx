import { fireEvent, render, screen } from '@testing-library/react-native';

import { color } from '../../../../theme';
import { ConnectionError } from '../ConnectionError';
import type { ConnectionErrorModel, ConnectionFailure, RoomRefusal } from '../connectionModel';
import { type Setup, setUp, styleOf, wait } from '../testing/setup';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const model = (over: Partial<ConnectionErrorModel> = {}): ConnectionErrorModel => ({
  kind: 'error',
  failure: 'unreachable',
  code: 'ERR_SOCKET_TIMEOUT · 504',
  attempts: 1,
  retrying: false,
  refusal: null,
  ...over,
});

let env: Setup;
afterEach(() => env.restore());

const handlers = () => ({ onRetry: jest.fn(), onHome: jest.fn(), onPractice: jest.fn() });

describe('ConnectionError (Hebrew)', () => {
  beforeEach(async () => {
    env = await setUp('he');
  });

  it('explains the server error plainly, with the small code for support (§16.3)', async () => {
    await render(<ConnectionError model={model()} {...handlers()} />);
    expect(screen.getByRole('header')).toHaveTextContent('שגיאת חיבור');
    expect(screen.getByTestId('connection-error-body')).toHaveTextContent(
      'לא הצלחנו להתחבר לשרת המשחק. בדוק את החיבור ונסה שוב.',
    );
    expect(screen.getByTestId('connection-error-code')).toHaveAccessibleName(
      'קוד שגיאה: ERR_SOCKET_TIMEOUT · 504',
    );
    expect(screen.getByText('ERR_SOCKET_TIMEOUT · 504')).toHaveStyle({ writingDirection: 'ltr' });
    expect(screen.queryByTestId('connection-error-attempts')).not.toBeOnTheScreen();
    expect(env.announced()).toEqual(['שגיאת חיבור. לא הצלחנו להתחבר לשרת המשחק. בדוק את החיבור ונסה שוב.']);
  });

  it('tells "no internet" apart from a server error', async () => {
    await render(
      <ConnectionError model={model({ failure: 'offline', code: 'NO_NETWORK' })} {...handlers()} />,
    );
    expect(screen.getByRole('header')).toHaveTextContent('אין חיבור לאינטרנט');
    expect(screen.getByTestId('connection-error-body')).toHaveTextContent(
      'למכשיר אין רשת כרגע. התחבר לאינטרנט ונסה שוב.',
    );
  });

  it.each<[ConnectionFailure, string]>([
    ['lost', 'החיבור לשרת המשחק אבד ולא הצלחנו לחזור אליו.'],
    ['refused', 'השרת לא הכניס אותנו לחדר.'],
  ])('explains %s', async (failure, body) => {
    await render(<ConnectionError model={model({ failure })} {...handlers()} />);
    expect(screen.getByTestId('connection-error-body')).toHaveTextContent(body);
  });

  it.each<[RoomRefusal, string]>([
    ['notFound', 'אין חדר עם הקוד הזה. בדוק את הקוד ונסה שוב.'],
    ['full', 'החדר הזה כבר מלא.'],
    ['gameStarted', 'המשחק בחדר הזה כבר התחיל.'],
    ['alreadyInRoom', 'אתה כבר בחדר הזה, ממכשיר אחר.'],
    ['unauthenticated', 'צריך להתחבר לחשבון כדי לשחק מול אחרים.'],
    ['codeTaken', 'כבר יש חדר עם הקוד הזה. נסה קוד אחר.'],
    ['badOptions', 'הגדרות החדר לא תקינות.'],
  ])('explains the refusal %s', async (refusal, body) => {
    await render(
      <ConnectionError model={model({ failure: 'refused', refusal, code: refusal })} {...handlers()} />,
    );
    expect(screen.getByTestId('connection-error-body')).toHaveTextContent(body);
  });

  it('retries (the primary), goes to practice or home', async () => {
    const h = handlers();
    await render(<ConnectionError model={model()} {...h} />);
    expect(screen.getByTestId('connection-error-retry-shadow')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'נסה שוב' }));
    await fireEvent.press(screen.getByRole('button', { name: 'עבור לאימון' }));
    await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
    expect(h.onRetry).toHaveBeenCalledTimes(1);
    expect(h.onPractice).toHaveBeenCalledTimes(1);
    expect(h.onHome).toHaveBeenCalledTimes(1);
    expect(screen.getByText('אימון לבד ומול בוט עובדים גם בלי חיבור')).toBeOnTheScreen();
  });

  it('offers no practice when there is nowhere to go', async () => {
    const { onRetry, onHome } = handlers();
    await render(<ConnectionError model={model()} onRetry={onRetry} onHome={onHome} />);
    expect(screen.queryByRole('button', { name: 'עבור לאימון' })).not.toBeOnTheScreen();
  });

  it('shows the retry as busy while it runs, and says nothing meanwhile', async () => {
    await render(<ConnectionError model={model({ attempts: 2, retrying: true })} {...handlers()} />);
    expect(screen.getByRole('button', { name: 'נסה שוב, טוען' })).toBeBusy();
    expect(screen.queryByTestId('connection-error-attempts')).not.toBeOnTheScreen();
    expect(env.announced()).toEqual([]);
  });

  it('says which attempt failed, and shakes the code once for it', async () => {
    const { rerender } = await render(<ConnectionError model={model()} {...handlers()} />);
    await rerender(<ConnectionError model={model({ retrying: true })} {...handlers()} />);
    await rerender(<ConnectionError model={model({ attempts: 2 })} {...handlers()} />);
    expect(screen.getByTestId('connection-error-attempts')).toHaveTextContent('ניסיון 2 נכשל');
    expect(env.announced()).toEqual([
      'שגיאת חיבור. לא הצלחנו להתחבר לשרת המשחק. בדוק את החיבור ונסה שוב.',
      'שגיאת חיבור. ניסיון 2 נכשל',
    ]);
    await wait(60);
    expect(screen.getByTestId('connection-error-code')).not.toHaveAnimatedStyle({
      transform: [{ translateX: 0 }],
    });
    await wait(500);
    expect(screen.getByTestId('connection-error-code')).toHaveAnimatedStyle({
      transform: [{ translateX: 0 }],
    });
  });
});

describe('ConnectionError, reduced motion', () => {
  beforeEach(async () => {
    env = await setUp('he', 'on');
  });

  it('frames the code in red instead of shaking it', async () => {
    const { rerender } = await render(<ConnectionError model={model()} {...handlers()} />);
    await rerender(<ConnectionError model={model({ attempts: 2 })} {...handlers()} />);
    await wait(10);
    expect(styleOf(screen.getByTestId('connection-error-code'))).toMatchObject({ borderColor: color.danger });
    expect(screen.getByTestId('connection-error-code')).toHaveAnimatedStyle({
      transform: [{ translateX: 0 }],
    });
    await wait(400);
    expect(styleOf(screen.getByTestId('connection-error-code'))).toMatchObject({ borderColor: color.border });
  });
});

describe('ConnectionError (English)', () => {
  beforeEach(async () => {
    env = await setUp('en');
  });

  it('says it all in English', async () => {
    await render(<ConnectionError model={model({ attempts: 3 })} {...handlers()} />);
    expect(screen.getByRole('header')).toHaveTextContent('Connection error');
    expect(screen.getByTestId('connection-error-body')).toHaveTextContent(
      "We couldn't reach the game server. Check your connection and try again.",
    );
    expect(screen.getByTestId('connection-error-attempts')).toHaveTextContent('Try 3 failed');
    expect(screen.getByTestId('connection-error-code')).toHaveAccessibleName(
      'Error code: ERR_SOCKET_TIMEOUT · 504',
    );
    for (const name of ['Try again', 'Go to practice', 'Home']) {
      expect(screen.getByRole('button', { name })).toBeOnTheScreen();
    }
  });

  it('and "no internet" in English', async () => {
    await render(<ConnectionError model={model({ failure: 'offline' })} {...handlers()} />);
    expect(screen.getByRole('header')).toHaveTextContent('No internet connection');
  });
});
