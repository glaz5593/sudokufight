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

describe('useArsenal: the arsenal’s state for the screen (spec §7.3)', () => {
  it('closed: no card is a drop zone, none dims, ⚡ is not expanded', async () => {
    const { result } = await controller();
    expect(result.current.targetId).toBeNull();
    expect(result.current.cardProps(NINA, 'NinaVolt')).toEqual({
      dropTarget: false,
      dropHover: false,
      dimmed: false,
      dropLabel: undefined,
      interferenceExpanded: false,
    });
  });

  it('opened from a card: that card is the one drop zone, every other card dims (3–4 players too)', async () => {
    const { result, run } = await controller();
    await run(() => result.current.open(NINA));
    expect(cues()).toEqual(['arsenalOpen']);
    expect(result.current.cardProps(NINA, 'NinaVolt')).toEqual({
      dropTarget: true,
      dropHover: false,
      dimmed: false,
      dropLabel: `גרור לכאן הפרעה מהארסנל כדי לשגר אל ${isolate('NinaVolt')}`,
      interferenceExpanded: true,
    });
    expect(result.current.cardProps(AIKO, 'Aiko_M')).toMatchObject({ dropTarget: false, dimmed: true });
    expect(result.current.cardProps('me', 'אני')).toMatchObject({ dropTarget: false, dimmed: true });
  });

  it('toggle: ⚡ on the same card closes it, on another card moves the zone there', async () => {
    const { result, run } = await controller();
    await run(() => result.current.toggle(NINA));
    expect(result.current.targetId).toBe(NINA);
    await run(() => result.current.toggle(AIKO));
    expect(result.current.targetId).toBe(AIKO);
    await run(() => result.current.toggle(AIKO));
    expect(result.current.targetId).toBeNull();
  });

  it('a drag: lift, over the zone (one buzz per entry), and the drop label names the token', async () => {
    const { result, run } = await controller();
    await run(() => result.current.open(NINA));
    await run(() => result.current.lift('warp'));
    expect(result.current.dragKind).toBe('warp');
    await run(() => result.current.setHover(true));
    await run(() => result.current.setHover(true));
    expect(result.current.cardProps(NINA, 'NinaVolt')).toMatchObject({
      dropHover: true,
      dropLabel: `שחרר כאן: שיגור עיוות אל ${isolate('NinaVolt')}`,
    });
    await run(() => result.current.setHover(false));
    expect(result.current.hover).toBe(false);
    await run(() => result.current.setHover(true));
    expect(cues()).toEqual(['arsenalOpen', 'tokenLift', 'dropZoneEnter', 'dropZoneEnter']);
  });

  it('a drop on the zone launches once at the card it was opened from, and closes', async () => {
    const { result, run, onLaunch } = await controller();
    await run(() => result.current.open(NINA));
    await run(() => result.current.lift('fireworks'));
    await run(() => {
      result.current.release('fireworks', true);
      // A second drop before the screen updates must not launch again.
      result.current.release('fireworks', true);
    });
    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onLaunch).toHaveBeenCalledWith(NINA, 'fireworks');
    expect(cues()).toContain('launch');
    expect(result.current.targetId).toBeNull();
    // The ghost is still landing; then the drag is over.
    expect(result.current.dragKind).toBe('fireworks');
    await run(() => result.current.settle());
    expect(result.current.dragKind).toBeNull();
  });

  it('a drop elsewhere, or after it closed, launches nothing', async () => {
    const { result, run, onLaunch } = await controller();
    await run(() => result.current.open(NINA));
    await run(() => result.current.release('cats', false));
    expect(result.current.targetId).toBe(NINA);
    await run(() => result.current.close());
    await run(() => result.current.release('cats', true));
    expect(onLaunch).not.toHaveBeenCalled();
    expect(cues()).not.toContain('launch');
  });

  it('closing mid-drag ends the drag: the token left with the tray, nothing is over the zone', async () => {
    const { result, run, onLaunch } = await controller();
    await run(() => result.current.open(NINA));
    await run(() => result.current.lift('warp'));
    await run(() => result.current.setHover(true));
    await run(() => result.current.close());
    expect(result.current).toMatchObject({ targetId: null, dragKind: null, hover: false });
    expect(result.current.cardProps(NINA, 'NinaVolt')).toMatchObject({ dropTarget: false, dropHover: false });
    expect(onLaunch).not.toHaveBeenCalled();
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

  it('⚡ short of points: an error toast with the cost and a light haptic; other blocked states are silent', async () => {
    const { result, run } = await controller();
    await run(() => result.current.blocked({ kind: 'busy', cost: 4, secondsLeft: 3 }));
    expect(useToast.getState().current).toBeNull();
    await run(() => result.current.blocked({ kind: 'points', cost: 8, missing: 3 }));
    expect(useToast.getState().current).toMatchObject({
      variant: 'error',
      message: 'אין מספיק נקודות להפרעה הבאה (8 נק׳)',
    });
    expect(cues()).toEqual(['nudge']);
    expect(result.current.targetId).toBeNull();
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
