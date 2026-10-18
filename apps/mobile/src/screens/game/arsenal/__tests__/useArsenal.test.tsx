import { act, render, renderHook, screen } from '@testing-library/react-native';

import { useToast } from '../../../../components/ui';
import i18n from '../../../../i18n';
import { useSettings } from '../../../../state/settings';
import { TokenArt } from '../TokenArt';
import { type Measurable, useArsenal } from '../useArsenal';
import { useSenderFeedback } from '../useSenderFeedback';
import { isolate } from '../wording';

jest.mock('../../../../services/feedback', () => ({ cue: jest.fn() }));
jest.mock('../../../../services/analytics', () => ({ track: jest.fn() }));
const feedback = jest.requireMock<{ cue: jest.Mock }>('../../../../services/feedback');
const analytics = jest.requireMock<{ track: jest.Mock }>('../../../../services/analytics');
const cues = (): string[] => feedback.cue.mock.calls.map((c: unknown[]) => String(c[0]));

const NINA = 'nina';
const AIKO = 'aiko';

beforeEach(async () => {
  jest.clearAllMocks();
  useToast.getState().clear();
  await i18n.changeLanguage('he');
});

async function controller() {
  const onLaunch = jest.fn();
  const hook = await renderHook(() => useArsenal({ onLaunch }));
  const run = (fn: () => void) => act(async () => fn());
  return { ...hook, onLaunch, run };
}

describe('useArsenal: the interference picker’s state for the screen (spec §7.3) [D45]', () => {
  it('closed: no card is the target, none dims, "הפרעה" is not expanded', async () => {
    const { result } = await controller();
    expect(result.current.targetId).toBeNull();
    expect(result.current.cardProps(NINA)).toEqual({
      targeted: false,
      dimmed: false,
      interferenceExpanded: false,
    });
  });

  it('opened from a card: that card is the one target, every other card dims (3–4 players too)', async () => {
    const { result, run } = await controller();
    await run(() => result.current.open(NINA));
    expect(cues()).toEqual(['arsenalOpen']);
    expect(result.current.cardProps(NINA)).toEqual({
      targeted: true,
      dimmed: false,
      interferenceExpanded: true,
    });
    expect(result.current.cardProps(AIKO)).toEqual({
      targeted: false,
      dimmed: true,
      interferenceExpanded: false,
    });
    expect(result.current.cardProps('me')).toMatchObject({ targeted: false, dimmed: true });
  });

  it('toggle: "הפרעה" on the same card closes it, on another card moves the target there', async () => {
    const { result, run } = await controller();
    await run(() => result.current.toggle(NINA));
    expect(result.current.targetId).toBe(NINA);
    await run(() => result.current.toggle(AIKO));
    expect(result.current.targetId).toBe(AIKO);
    await run(() => result.current.toggle(AIKO));
    expect(result.current.targetId).toBeNull();
  });

  it('launch: once, at the card it was opened from, and it closes (a quick double tap sends one)', async () => {
    const { result, run, onLaunch } = await controller();
    await run(() => result.current.open(NINA));
    let first = false;
    let second = true;
    await run(() => {
      first = result.current.launch('scramble');
      // A second tap before the screen updates must not launch again.
      second = result.current.launch('fireworks');
    });
    expect([first, second]).toEqual([true, false]);
    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledWith(NINA, 'scramble');
    expect(cues()).toEqual(['arsenalOpen', 'launch']);
    expect(result.current.targetId).toBeNull();
    expect(result.current.cardProps(NINA)).toMatchObject({ targeted: false, dimmed: false });
  });

  it('launch while closed does nothing', async () => {
    const { result, run, onLaunch } = await controller();
    await run(() => void result.current.launch('cats'));
    await run(() => result.current.open(NINA));
    await run(() => result.current.close());
    await run(() => void result.current.launch('cats'));
    expect(onLaunch).not.toHaveBeenCalled();
    expect(cues()).not.toContain('launch');
  });

  it('measures a card through its ref; an unmounted or empty one says nothing', async () => {
    const { result } = await controller();
    const done = jest.fn();
    const node: Measurable = { measureInWindow: (cb) => cb(16, 48, 159, 160) };
    result.current.cardRef(NINA)(node);
    expect(result.current.cardRef(NINA)).toBe(result.current.cardRef(NINA));
    result.current.measureCard(NINA, done);
    expect(done).toHaveBeenCalledWith({ x: 16, y: 48, width: 159, height: 160 });
    result.current.cardRef(AIKO)({ measureInWindow: (cb) => cb(0, 0, 0, 0) });
    result.current.measureCard(AIKO, done);
    result.current.cardRef(NINA)(null);
    result.current.measureCard(NINA, done);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('"הפרעה" while blocked: a short toast with the reason and a light haptic, never the picker', async () => {
    const { result, run } = await controller();
    await run(() => result.current.blocked({ kind: 'points', cost: 8, missing: 3 }, 'NinaVolt'));
    expect(useToast.getState().current).toMatchObject({
      variant: 'error',
      message: 'אין מספיק נקודות להפרעה הבאה (8 נק׳)',
    });
    useToast.getState().clear();
    await run(() => result.current.blocked({ kind: 'busy', cost: 4, secondsLeft: 2 }, 'NinaVolt'));
    expect(useToast.getState().current).toMatchObject({
      variant: 'warning',
      message: `${isolate('NinaVolt')} כבר תחת הפרעה. אפשר שוב בעוד 2 שניות`,
    });
    useToast.getState().clear();
    await run(() => result.current.blocked({ kind: 'busy', cost: 4, secondsLeft: 1 }, 'NinaVolt'));
    expect(useToast.getState().current?.message).toBe(
      `${isolate('NinaVolt')} כבר תחת הפרעה. אפשר שוב בעוד שנייה`,
    );
    useToast.getState().clear();
    await run(() => result.current.blocked({ kind: 'notRunning', cost: 2 }, 'NinaVolt'));
    expect(useToast.getState().current).toMatchObject({ variant: 'info', message: 'אי אפשר להפריע כרגע' });
    expect(cues()).toEqual(['nudge', 'nudge', 'nudge', 'nudge']);
    expect(result.current.targetId).toBeNull();
  });

  it('in English', async () => {
    await i18n.changeLanguage('en');
    const { result, run } = await controller();
    await run(() => result.current.blocked({ kind: 'busy', cost: 4, secondsLeft: 3 }, 'Aiko_M'));
    expect(useToast.getState().current?.message).toBe(
      `${isolate('Aiko_M')} is already under interference. Try again in 3 seconds`,
    );
  });

  it('a hidden button (disconnected, out) says nothing', async () => {
    const { result, run } = await controller();
    await run(() => result.current.blocked({ kind: 'out', cost: 2 }, 'NinaVolt'));
    await run(() => result.current.blocked({ kind: 'disconnected', cost: 2 }, 'NinaVolt'));
    expect(useToast.getState().current).toBeNull();
    expect(cues()).toEqual([]);
  });
});

describe('useSenderFeedback (spec §7.4)', () => {
  it('"זיקוקים ← NinaVolt" as the info toast, and the interference_sent event (spec §22)', async () => {
    const { result } = await renderHook(() => useSenderFeedback());
    await act(async () => result.current({ kind: 'fireworks', targetName: 'NinaVolt', cost: 8 }));
    expect(useToast.getState().current).toMatchObject({
      variant: 'info',
      message: `זיקוקים ← ${isolate('NinaVolt')}`,
    });
    expect(analytics.track).toHaveBeenCalledWith('interference_sent', { kind: 'fireworks', cost: 8 });
  });

  it('in English', async () => {
    await i18n.changeLanguage('en');
    const { result } = await renderHook(() => useSenderFeedback());
    await act(async () => result.current({ kind: 'cats', targetName: 'Aiko_M', cost: 2 }));
    expect(useToast.getState().current?.message).toBe(`Cats → ${isolate('Aiko_M')}`);
  });
});

describe('TokenArt: the token’s live preview (static with reduced motion)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useSettings.setState({ reduceMotion: 'off' });
  });
  afterEach(() => jest.useRealTimers());

  const frames = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));

  it.each(['fireworks', 'cats', 'warp'] as const)('%s loops on its own clock', async (kind) => {
    await render(<TokenArt kind={kind} size={56} />);
    const part = screen.getByTestId('token-art-motion', { includeHiddenElements: true });
    await frames(200);
    const early = JSON.stringify(part.props.jestAnimatedStyle?.value ?? part.props.style);
    await frames(500);
    const later = JSON.stringify(part.props.jestAnimatedStyle?.value ?? part.props.style);
    expect(later).not.toEqual(early);
  });

  it.each(['fireworks', 'cats', 'warp'] as const)('%s, still: one fixed frame', async (kind) => {
    await render(<TokenArt kind={kind} size={56} still />);
    const part = screen.getByTestId('token-art-motion', { includeHiddenElements: true });
    await frames(200);
    const early = JSON.stringify(part.props.jestAnimatedStyle?.value ?? part.props.style);
    await frames(900);
    expect(JSON.stringify(part.props.jestAnimatedStyle?.value ?? part.props.style)).toEqual(early);
  });

  it('is decorative: hidden from screen readers', async () => {
    await render(<TokenArt kind="cats" size={34} />);
    expect(screen.queryByTestId('token-art-cats')).not.toBeOnTheScreen();
    expect(screen.getByTestId('token-art-cats', { includeHiddenElements: true })).toBeOnTheScreen();
  });
});
