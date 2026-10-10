import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, I18nManager, StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { color, size, space } from '../../../theme';
import { motion } from '../../../theme/motion';
import { directionProblems, hostStyles } from '../testing/layout';
import { realToastTimer, Toast, type ToastTimer, ToastViewport } from '../Toast';
import { toastHoldMs, toastLook, type ToastVariant } from '../toastModel';
import { useToast } from '../toastStore';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const styleOf = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as ViewStyle) ?? {};

/** A clock the test runs by hand. */
function manualTimer() {
  const started: { ms: number; done: () => void; cancelled: boolean }[] = [];
  const timer: ToastTimer = {
    start: (done, ms) => {
      const entry = { ms, done, cancelled: false };
      started.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
  };
  const fire = () =>
    act(async () => {
      for (const s of started) if (!s.cancelled) s.done();
    });
  return { timer, started, fire };
}

/** Lets the enter or exit animation finish (Jest fake timers drive Reanimated). */
const settle = () => act(async () => void jest.advanceTimersByTime(motion.duration.stateChange * 2));

const VARIANTS: ToastVariant[] = ['success', 'warning', 'error', 'connection', 'info'];

describe('toastModel', () => {
  it('keeps each variant for its time, and the connection toast until resolved', () => {
    expect(VARIANTS.map((v) => toastHoldMs(v))).toEqual([2500, 3000, 4000, null, 2000]);
  });

  it('lets the caller choose, but never keeps a warning past 3 s', () => {
    expect(toastHoldMs('success', 1000)).toBe(1000);
    expect(toastHoldMs('error', null)).toBeNull();
    expect(toastHoldMs('warning', 1500)).toBe(1500);
    expect(toastHoldMs('warning', 9000)).toBe(3000);
    expect(toastHoldMs('warning', null)).toBe(3000);
  });

  it('colors each variant from the tokens, and only an error interrupts', () => {
    expect(toastLook('success')).toMatchObject({
      border: color.toast.border.success,
      iconColor: color.success,
    });
    expect(toastLook('warning')).toMatchObject({
      border: color.toast.border.warning,
      iconColor: color.warning,
    });
    expect(toastLook('error')).toMatchObject({ border: color.toast.border.error, iconColor: color.danger });
    expect(toastLook('connection').iconColor).toBe(color.toast.iconInfo);
    // The info icon is muted, not the border color (which would be 1.2:1).
    expect(toastLook('info')).toMatchObject({
      border: color.toast.border.info,
      iconColor: color.toast.iconInfo,
    });
    expect(VARIANTS.filter((v) => toastLook(v).role === 'alert')).toEqual(['error']);
  });
});

describe('Toast', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
    useSettings.setState({ reduceMotion: 'off' });
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows one line in a 40-high box with the variant border', async () => {
    await render(
      <Toast variant="success" message="חזרת למשחק. הלוח והניקוד סונכרנו" timer={manualTimer().timer} />,
    );
    const toast = screen.getByRole('status', { name: 'חזרת למשחק. הלוח והניקוד סונכרנו' });
    expect(styleOf(toast)).toMatchObject({ height: size.toast, borderColor: color.toast.border.success });
    expect(screen.getByTestId('icon-check', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('is an alert for errors', async () => {
    await render(
      <Toast variant="error" message="אין מספיק נקודות להפרעה הבאה (8 נק׳)" timer={manualTimer().timer} />,
    );
    expect(screen.getByRole('alert')).toHaveProp('accessibilityLiveRegion', 'assertive');
  });

  it('announces the message on iOS once, not every countdown second', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    announce.mockClear();
    const { timer } = manualTimer();
    await render(<Toast variant="connection" message="היריב מתנתק…" countdown={12} timer={timer} />);
    await screen.rerender(<Toast variant="connection" message="היריב מתנתק…" countdown={11} timer={timer} />);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('היריב מתנתק…');
  });

  it('shows the countdown pill and reads the seconds in its label', async () => {
    await render(
      <Toast variant="connection" message="היריב מתנתק…" countdown={12} timer={manualTimer().timer} />,
    );
    expect(screen.getByText('12')).toBeOnTheScreen();
    expect(screen.getByRole('status', { name: 'היריב מתנתק…, נותרו 12 שניות' })).toBeOnTheScreen();
    await screen.rerender(
      <Toast variant="connection" message="היריב מתנתק…" countdown={1} timer={manualTimer().timer} />,
    );
    expect(screen.getByRole('status', { name: 'היריב מתנתק…, נותרה שנייה אחת' })).toBeOnTheScreen();
  });

  it('leaves on its own after the injected timer, then reports it', async () => {
    const { timer, started, fire } = manualTimer();
    const onHide = jest.fn();
    await render(<Toast variant="success" message="נשמר" timer={timer} onHide={onHide} />);
    await settle();
    expect(started.map((s) => s.ms)).toEqual([2500]);
    expect(onHide).not.toHaveBeenCalled();
    await fire();
    await settle();
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('stays until hidden when it has no hold time', async () => {
    const { timer, started } = manualTimer();
    const onHide = jest.fn();
    await render(<Toast variant="connection" message="היריב מתנתק…" timer={timer} onHide={onHide} />);
    await settle();
    expect(started).toEqual([]);
    await screen.rerender(
      <Toast variant="connection" message="היריב מתנתק…" timer={timer} onHide={onHide} hidden />,
    );
    await settle();
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('cancels its timer when the owner hides it first', async () => {
    const { timer, started } = manualTimer();
    await render(<Toast variant="error" message="שגיאה" timer={timer} />);
    await screen.rerender(<Toast variant="error" message="שגיאה" timer={timer} hidden />);
    expect(started[0]?.cancelled).toBe(true);
  });

  it('fades without sliding under reduced motion, and still reports the exit', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    const { timer, fire } = manualTimer();
    const onHide = jest.fn();
    await render(<Toast variant="info" message="זיקוקים ← NinaVolt" timer={timer} onHide={onHide} />);
    await settle();
    await fire();
    await settle();
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('uses the real clock by default', async () => {
    const done = jest.fn();
    const cancel = realToastTimer.start(done, 1000);
    jest.advanceTimersByTime(999);
    expect(done).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
    const other = jest.fn();
    realToastTimer.start(other, 10)();
    jest.advanceTimersByTime(20);
    expect(other).not.toHaveBeenCalled();
    cancel();
  });

  it('is a plain row, the same in RTL and LTR', async () => {
    const layouts: unknown[] = [];
    for (const rtl of [true, false]) {
      jest.replaceProperty(I18nManager, 'isRTL', rtl);
      await render(
        <Toast variant="warning" message="עוד 3 שניות" countdown={3} timer={manualTimer().timer} />,
      );
      expect(styleOf(screen.getByRole('status')).flexDirection).toBe('row');
      expect(directionProblems(screen.container)).toEqual([]);
      layouts.push(hostStyles(screen.container));
      await screen.unmount();
    }
    expect(layouts[0]).toEqual(layouts[1]);
  });
});

describe('useToast and ToastViewport', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
    useSettings.setState({ reduceMotion: 'off' });
    useToast.getState().clear();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('queues toasts and shows one at a time', () => {
    const { show, hide, remove } = useToast.getState();
    const a = show({ variant: 'success', message: 'א' });
    const b = show({ variant: 'error', message: 'ב' });
    const c = show({ variant: 'info', message: 'ג' });
    expect(useToast.getState().current?.message).toBe('א');
    expect(useToast.getState().queue.map((q) => q.message)).toEqual(['ב', 'ג']);

    hide(c);
    expect(useToast.getState().queue.map((q) => q.message)).toEqual(['ב']);
    hide(a);
    expect(useToast.getState().current).toMatchObject({ id: a, hiding: true });
    remove(a);
    expect(useToast.getState().current).toMatchObject({ id: b, message: 'ב', hiding: false });
    remove(b);
    expect(useToast.getState().current).toBeNull();
  });

  it('updates a toast in place (the countdown)', () => {
    const id = useToast.getState().show({ variant: 'connection', message: 'היריב מתנתק…', countdown: 12 });
    useToast.getState().update(id, { countdown: 11 });
    expect(useToast.getState().current?.countdown).toBe(11);
  });

  it('renders the current toast under the safe area, and the next one after it leaves', async () => {
    const { timer, fire } = manualTimer();
    await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, bottom: 34, left: 0, right: 0 },
        }}
      >
        <ToastViewport timer={timer} />
      </SafeAreaProvider>,
    );
    expect(screen.queryByRole('status')).not.toBeOnTheScreen();

    await act(async () => {
      useToast.getState().show({ variant: 'success', message: 'ראשון' });
      useToast.getState().show({ variant: 'warning', message: 'שני' });
    });
    const first = screen.getByRole('status', { name: 'ראשון' });
    expect(styleOf(first.parent!)).toMatchObject({ top: 47 + space[4], left: space[8], right: space[8] });

    await settle();
    await fire();
    await settle();
    expect(screen.queryByText('ראשון')).not.toBeOnTheScreen();
    expect(screen.getByRole('status', { name: 'שני' })).toBeOnTheScreen();
  });

  it('lets the owner hide the current toast', async () => {
    await render(<ToastViewport timer={manualTimer().timer} />);
    let id = 0;
    await act(async () => {
      id = useToast.getState().show({ variant: 'connection', message: 'היריב מתנתק…' });
    });
    await settle();
    await act(async () => useToast.getState().hide(id));
    await settle();
    expect(useToast.getState().current).toBeNull();
    expect(screen.queryByText('היריב מתנתק…')).not.toBeOnTheScreen();
  });
});
