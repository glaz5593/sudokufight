import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import { gameEndConfig } from '../config/gameEnd';
import i18n from '../i18n';
import { FALLBACK_ACTIONS_MS, FlowFallback } from '../screens/FlowFallback';

/**
 * Never an empty screen (Moshe's black screens of 1.0.0, 15.10.2026): what a route or screen draws when it has
 * nothing to draw. A spinner and "רגע…" first; after a moment the way out, and a non-fatal for Crashlytics.
 */

jest.mock('../services/crashlytics', () => {
  const reporter = { enabled: true, recordError: jest.fn(), setUser: jest.fn(), log: jest.fn() };
  return { crashReporter: () => reporter };
});
const crash = jest
  .requireMock<{ crashReporter: () => { recordError: jest.Mock } }>('../services/crashlytics')
  .crashReporter();

let backs: jest.SpyInstance;

beforeEach(async () => {
  jest.useFakeTimers();
  crash.recordError.mockClear();
  backs = jest.spyOn(BackHandler, 'addEventListener');
  await i18n.changeLanguage('he');
});

afterEach(() => {
  backs.mockRestore();
  jest.useRealTimers();
});

async function wait(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

/** Android back: the newest handler first, until one takes it. */
async function pressBack() {
  const handlers = backs.mock.calls
    .filter(([event]) => event === 'hardwareBackPress')
    .map(([, handler]) => handler as () => boolean | null | undefined)
    .reverse();
  await act(async () => {
    for (const handler of handlers) if (handler()) return;
  });
}

describe('FlowFallback', () => {
  it('a spinner and "רגע…" first; after a moment "לתוצאות" and "לבית", and one report', async () => {
    const onHome = jest.fn();
    const onResults = jest.fn();
    await render(<FlowFallback reason="a test" onHome={onHome} onResults={onResults} />);
    expect(FALLBACK_ACTIONS_MS).toBe(gameEndConfig.fallbackActionsMs);
    expect(screen.getByTestId('flow-fallback')).toBeOnTheScreen();
    expect(screen.getByText('רגע…')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
    expect(crash.recordError).not.toHaveBeenCalled();

    await wait(FALLBACK_ACTIONS_MS);
    expect(screen.getByRole('header', { name: 'המסך לא נטען' })).toBeOnTheScreen();
    expect(screen.getByText('אפשר להמשיך לתוצאות או לחזור לבית.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'לתוצאות' }));
    expect(onResults).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(crash.recordError).toHaveBeenCalledTimes(1);
    expect(crash.recordError).toHaveBeenCalledWith(new Error('flow fallback: a test'), 'flow fallback');
    await wait(10_000);
    expect(crash.recordError).toHaveBeenCalledTimes(1);
  });

  it('without results: "לבית" alone, with its own words', async () => {
    await render(<FlowFallback reason="a test" onHome={jest.fn()} actionsAfterMs={0} />);
    expect(screen.getByText('אפשר לחזור לבית ולהמשיך משם.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'לתוצאות' })).toBeNull();
    expect(screen.getByRole('button', { name: 'לבית' })).toBeOnTheScreen();
  });

  it('Android back goes home once the way out shows (before that the screen under it decides)', async () => {
    const onHome = jest.fn();
    await render(<FlowFallback reason="a test" onHome={onHome} />);
    await pressBack();
    expect(onHome).not.toHaveBeenCalled();
    await wait(FALLBACK_ACTIONS_MS);
    await pressBack();
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('no report when the empty screen is expected (false, or a function that says so then)', async () => {
    await render(<FlowFallback reason="a test" onHome={jest.fn()} report={false} actionsAfterMs={0} />);
    await wait(100);
    let leaving = true;
    await render(<FlowFallback reason="another" onHome={jest.fn()} report={() => !leaving} />);
    await wait(FALLBACK_ACTIONS_MS);
    expect(crash.recordError).not.toHaveBeenCalled();
    leaving = false;
    await render(<FlowFallback reason="stuck" onHome={jest.fn()} report={() => !leaving} />);
    await wait(FALLBACK_ACTIONS_MS);
    expect(crash.recordError).toHaveBeenCalledWith(new Error('flow fallback: stuck'), 'flow fallback');
  });

  it('English', async () => {
    await i18n.changeLanguage('en');
    await render(<FlowFallback reason="a test" onHome={jest.fn()} onResults={jest.fn()} />);
    expect(screen.getByText('One moment…')).toBeOnTheScreen();
    await wait(FALLBACK_ACTIONS_MS);
    expect(screen.getByRole('header', { name: "This screen didn't load" })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'To the results' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Home' })).toBeOnTheScreen();
  });
});
