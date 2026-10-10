import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, type ViewStyle } from 'react-native';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { auditA11y } from '../../../testing/a11yAudit';
import { color } from '../../../theme';
import { motion } from '../../../theme/motion';
import { Skeleton, SKELETON_OPACITY, SkeletonCard, SkeletonGroup, SkeletonRows } from '../Skeleton';
import { supportCodeOf } from '../stateModel';
import { StateView } from '../StateView';
import { directionProblems } from '../testing/layout';

/**
 * The shared state pieces of stage 13 (spec §4.1 "מצבים ריקים", "מצבי שגיאה", "טעינה"; §16.3): StateView (an
 * empty state, no connection, an error with its support code) and the skeleton (motion.md `skeleton`: an
 * opacity pulse, still under reduced motion), in Hebrew and English.
 */

const styleOf = (el: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as ViewStyle;
const hidden = { includeHiddenElements: true } as const;

let announce: jest.SpyInstance;

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});

afterEach(() => {
  announce.mockRestore();
  jest.useRealTimers();
});

describe('supportCodeOf (spec §16.3: the small code for support)', () => {
  it('takes an error’s own support code, or its code and HTTP status', () => {
    expect(supportCodeOf({ supportCode: 'alreadyQueued-4215', code: 'x' })).toBe('alreadyQueued-4215');
    expect(supportCodeOf({ code: 'unavailable', status: 503 })).toBe('unavailable-503');
    expect(supportCodeOf({ code: 'network', status: null })).toBe('network');
    expect(supportCodeOf({ code: 'auth/network-request-failed' })).toBe('auth/network-request-failed');
  });

  it('never prints a message, a URL or anything that is not a short code', () => {
    expect(supportCodeOf(new Error('Network request failed'))).toBeNull();
    expect(supportCodeOf({ code: 'https://example.com/v1/me?token=abc' })).toBeNull();
    expect(supportCodeOf({ code: 'timeout', status: 'a b' })).toBe('timeout');
    expect(supportCodeOf(null)).toBeNull();
    expect(supportCodeOf('network')).toBeNull();
  });
});

describe('StateView', () => {
  it('an empty state: a quiet icon, the title as a header, the body and its way on; nothing announced', async () => {
    const onPlay = jest.fn();
    await render(
      <StateView
        icon="history"
        title="עוד אין משחקים כאן"
        body="כל משחק נשמר כאן לצפייה חוזרת."
        actions={[{ label: 'שחק את המשחק הראשון', variant: 'primary', onPress: onPlay, testID: 'play' }]}
        testID="empty"
      />,
    );
    expect(screen.getByRole('header', { name: 'עוד אין משחקים כאן' })).toBeOnTheScreen();
    expect(screen.getByTestId('empty-body')).toHaveTextContent('כל משחק נשמר כאן לצפייה חוזרת.');
    expect(screen.queryByTestId('empty-code')).toBeNull();
    expect(screen.getByTestId('empty-title')).not.toHaveProp('accessibilityLiveRegion', 'polite');
    await fireEvent.press(screen.getByRole('button', { name: 'שחק את המשחק הראשון' }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(announce).not.toHaveBeenCalled();
    expect(directionProblems(screen.getByTestId('empty'))).toEqual([]);
    expect(auditA11y(screen.getByTestId('empty'))).toEqual([]);
  });

  it('no connection: red icon, the support code (LTR) and "נסה שוב"; said as it appears', async () => {
    const onRetry = jest.fn();
    await render(
      <StateView
        tone="danger"
        icon="wifiOff"
        title="אין חיבור לשרת"
        body="הטבלה תתעדכן כשיחזור החיבור."
        code="unavailable-503"
        actions={[{ label: 'נסה שוב', icon: 'refresh', onPress: onRetry, testID: 'retry' }]}
        testID="offline"
      />,
    );
    const code = screen.getByTestId('offline-code');
    expect(code).toHaveAccessibleName('קוד שגיאה: unavailable-503');
    expect(code).toHaveTextContent('unavailable-503');
    expect(styleOf(screen.getByText('unavailable-503'))).toMatchObject({
      writingDirection: 'ltr',
      color: color.textFaint,
    });
    expect(screen.getByTestId('offline-title')).toHaveProp('accessibilityLiveRegion', 'polite');
    expect(announce).toHaveBeenCalledWith('אין חיבור לשרת. הטבלה תתעדכן כשיחזור החיבור.');
    await fireEvent.press(screen.getByRole('button', { name: 'נסה שוב' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(directionProblems(screen.getByTestId('offline'))).toEqual([]);
    expect(auditA11y(screen.getByTestId('offline'))).toEqual([]);
  });

  it('a check under way: the button says so and takes no presses', async () => {
    const onRetry = jest.fn();
    await render(
      <StateView
        tone="danger"
        icon="alert"
        title="משהו השתבש"
        actions={[{ label: 'נסה שוב', onPress: onRetry, loading: true, testID: 'retry' }]}
      />,
    );
    const button = screen.getByTestId('retry');
    expect(button).toBeBusy();
    expect(button).toHaveAccessibleName('נסה שוב, טוען');
    await userEvent.setup().press(button);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('speaks English', async () => {
    await i18n.changeLanguage('en');
    await render(
      <StateView
        tone="danger"
        icon="alert"
        title="Something went wrong"
        body="Try again in a moment."
        code="internal-500"
        testID="error"
      />,
    );
    expect(screen.getByTestId('error-code')).toHaveAccessibleName('Error code: internal-500');
    expect(announce).toHaveBeenCalledWith('Something went wrong. Try again in a moment.');
  });
});

describe('Skeleton (motion.md skeleton)', () => {
  it('one element for screen readers: "loading", busy; its blocks are hidden', async () => {
    await render(
      <SkeletonGroup label="טוען את המשחקים…" testID="loading">
        <SkeletonRows count={3} testID="rows" />
        <SkeletonCard bar />
      </SkeletonGroup>,
    );
    const group = screen.getByRole('progressbar', { name: 'טוען את המשחקים…' });
    expect(group).toHaveProp('accessibilityState', { busy: true });
    expect(group).toHaveProp('accessible', true);
    expect(screen.getByTestId('rows').children).toHaveLength(3);
    expect(directionProblems(group)).toEqual([]);
  });

  it('the blocks are the skeleton colour, and pulse 0.5 ↔ 1 over 1200 ms', async () => {
    jest.useFakeTimers();
    await render(
      <SkeletonGroup label="loading">
        <Skeleton height={20} testID="block" />
      </SkeletonGroup>,
    );
    const block = screen.getByTestId('block', hidden);
    expect(styleOf(block)).toMatchObject({ backgroundColor: color.skeleton.base });
    expect(block).toHaveAnimatedStyle({ opacity: SKELETON_OPACITY.low });
    await act(async () => {
      jest.advanceTimersByTime(motion.loop.skeleton / 2);
    });
    expect(block).toHaveAnimatedStyle({ opacity: SKELETON_OPACITY.high });
    await act(async () => {
      jest.advanceTimersByTime(motion.loop.skeleton / 2);
    });
    expect(block).toHaveAnimatedStyle({ opacity: SKELETON_OPACITY.low });
  });

  it('reduced motion: no pulse and no shimmer, the blocks stand still at 0.7', async () => {
    jest.useFakeTimers();
    useSettings.setState({ reduceMotion: 'on' });
    await render(
      <SkeletonGroup label="loading">
        <Skeleton height={20} testID="block" />
      </SkeletonGroup>,
    );
    const block = screen.getByTestId('block', hidden);
    for (const ms of [0, 300, 600, 900]) {
      await act(async () => {
        jest.advanceTimersByTime(ms);
      });
      expect(block).toHaveAnimatedStyle({ opacity: SKELETON_OPACITY.still });
    }
  });

  it('a block outside a group stands still too, and a circle is as wide as it is tall', async () => {
    await render(<Skeleton height={44} circle testID="dot" />);
    const dot = screen.getByTestId('dot');
    expect(styleOf(dot)).toMatchObject({ width: 44, height: 44, borderRadius: 22 });
    expect(dot).toHaveAnimatedStyle({ opacity: SKELETON_OPACITY.still });
  });
});
