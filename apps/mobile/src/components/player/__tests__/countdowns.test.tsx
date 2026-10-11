import { act, isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import { Profiler } from 'react';
import { getAnimatedStyle } from 'react-native-reanimated';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { counted, renderCount, resetRenderCounts } from '../../../testing/renderCount';
import { F8, NOW, twoPlayerView, withPlayer } from '../__fixtures__/gameView';
import { cardModel, lockModel, sameCountdown } from '../cardModel';
import { CountUpText } from '../CountUpText';
import { ltr, MINUS, scoreText } from '../format';
import { LockStrip } from '../LockStrip';
import { PlayerCard } from '../PlayerCard';
import { TimerRing } from '../TimerRing';

/**
 * The game's numbers that move on the UI thread (motion.md §6, spec §22: 55 fps): a score's count-up, and the
 * lock timers' ring and bar, which drain toward their deadline and render in React only when what they show
 * changes (whole seconds, a new deadline, a stop), not on each of the screen's 4 re-reads of the time a second.
 */

const hidden = { includeHiddenElements: true };

/** What an animated text shows now: Reanimated's props under Jest, as its toHaveAnimatedProps reads them. */
const shown = (testID: string): string =>
  (screen.getByTestId(testID, hidden).props.jestAnimatedProps as { value: { text: string } }).value.text;

/** The share of my lock's bar still filled (its scaleX). */
const bar = (testID = 'strip-bar'): number => {
  const style = getAnimatedStyle(screen.getByTestId(testID, hidden)) as { transform: { scaleX: number }[] };
  return style.transform[0]!.scaleX;
};

/** The phone's timers, one UI frame (16 ms) at a time. */
async function frames(ms: number, each?: () => void) {
  for (let t = 0; t < ms; t += 16) {
    await act(async () => {
      jest.advanceTimersByTime(16);
    });
    each?.();
  }
}

beforeEach(async () => {
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
  resetRenderCounts();
});
afterEach(() => jest.useRealTimers());

describe('CountUpText (motion.md score.count)', () => {
  let commits = 0;
  const onRender = () => {
    commits += 1;
  };
  const number = (value: number) => (
    <Profiler id="count" onRender={onRender}>
      <CountUpText value={value} format={scoreText} testID="n" />
    </Profiler>
  );

  it('counts in half steps to the new score over 650 ms, with no React render on the way', async () => {
    const { rerender } = await render(number(51.5));
    expect(shown('n')).toBe('51.5');
    await rerender(number(55));
    commits = 0;
    const seen: string[] = [];
    await frames(700, () => seen.push(shown('n')));
    expect(seen.at(-1)).toBe('55');
    const steps = [...new Set(seen)].filter((s) => s !== '51.5' && s !== '55').map(Number);
    expect(steps.length).toBeGreaterThan(2);
    // 51.5 → 55 never shows 53.37: halves only, rising.
    expect(steps.every((v) => v * 2 === Math.round(v * 2) && v > 51.5 && v < 55)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    // Every frame of the count was the UI thread's.
    expect(commits).toBe(0);
  });

  it('starts a new count from the number on screen', async () => {
    const { rerender } = await render(number(0));
    await rerender(number(10));
    await frames(160);
    const mid = Number(shown('n'));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(10);
    await rerender(number(0));
    await frames(16);
    const next = Number(shown('n'));
    expect(next).toBeLessThanOrEqual(mid);
    expect(next).toBeGreaterThan(0);
    await frames(700);
    expect(shown('n')).toBe('0');
  });

  it('keeps the minus before a negative count in Hebrew (an LTR isolate, CLAUDE.md)', async () => {
    const { rerender } = await render(number(0));
    await rerender(number(-2));
    const seen = new Set<string>();
    await frames(700, () => seen.add(shown('n')));
    expect(shown('n')).toBe(ltr(`${MINUS}2`));
    const halves = ['0', ...['0.5', '1', '1.5', '2'].map((v) => ltr(`${MINUS}${v}`))];
    expect([...seen].every((s) => halves.includes(s))).toBe(true);
  });

  it('ends on the value itself, even off the half steps', async () => {
    const { rerender } = await render(number(0));
    await rerender(number(3.25));
    await frames(700);
    expect(shown('n')).toBe(scoreText(3.25));
  });

  it('jumps to the new value with reduced motion: on the next frame, no count', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    const { rerender } = await render(number(51.5));
    await rerender(number(55));
    await frames(16);
    expect(shown('n')).toBe('55');
  });

  it('is display only: no touch, focus or keyboard, and hidden from screen readers', async () => {
    await render(number(55));
    const input = screen.getByTestId('n', hidden);
    expect(input).toHaveProp('editable', false);
    expect(input).toHaveProp('focusable', false);
    expect(isHiddenFromAccessibility(input)).toBe(true);
  });

  it('a card says the final score at once, while the number still counts to it', async () => {
    const view = twoPlayerView();
    const model = (score: number) => ({ ...cardModel(view, 'moshe', 0, NOW), score });
    const { rerender } = await render(<PlayerCard model={model(39.5)} testID="me" />);
    await rerender(<PlayerCard model={model(55)} testID="me" />);
    await frames(96);
    expect(shown('me-score')).not.toBe('55');
    expect(screen.getByLabelText('MosheG · 55 נקודות · טעות אחת, דירוג 1287')).toBeTruthy();
    await frames(700);
    expect(shown('me-score')).toBe('55');
  });
});

describe('sameCountdown', () => {
  it('a running countdown is the same while its deadline is; a stopped one while its time left is', () => {
    expect(sameCountdown({ remainingMs: 6200, expiresAt: 9 }, { remainingMs: 5950, expiresAt: 9 })).toBe(
      true,
    );
    expect(sameCountdown({ remainingMs: 6200, expiresAt: 9 }, { remainingMs: 6200, expiresAt: 10 })).toBe(
      false,
    );
    expect(
      sameCountdown({ remainingMs: 5000, expiresAt: null }, { remainingMs: 5000, expiresAt: null }),
    ).toBe(true);
    expect(
      sameCountdown({ remainingMs: 5000, expiresAt: null }, { remainingMs: 4000, expiresAt: null }),
    ).toBe(false);
    expect(sameCountdown({ remainingMs: 5000, expiresAt: null }, { remainingMs: 5000, expiresAt: 9 })).toBe(
      false,
    );
  });
});

describe('LockStrip: the bar drains on the UI thread (motion.md lock.timer)', () => {
  const view = twoPlayerView(); // my F8: 6.2 s left of 12, until NOW + 6200
  const Strip = counted('strip', LockStrip);

  it('renders once per whole second, not on every re-read of the time', async () => {
    const a = { marginTop: 1 };
    const b = { marginBottom: 1 };
    const { rerender } = await render(<Strip model={lockModel(view, NOW)} style={[a, b]} testID="strip" />);
    resetRenderCounts();
    // 8 re-reads, 250 ms apart (the screen's tick), each with its own style array: 7 → 6 → 5 seconds.
    for (let t = 250; t <= 2000; t += 250) {
      await rerender(<Strip model={lockModel(view, NOW + t)} style={[a, b]} testID="strip" />);
    }
    expect(renderCount('strip')).toBe(2);
    expect(screen.getByTestId('strip-seconds', hidden)).toHaveTextContent('5 שניות');
  });

  it('drains toward the deadline, and a re-read of the time does not start it again', async () => {
    const { rerender } = await render(<Strip model={lockModel(view, NOW)} testID="strip" />);
    await frames(16);
    expect(bar()).toBeCloseTo(6200 / 12000, 2);
    await frames(1000);
    expect(bar()).toBeCloseTo(5200 / 12000, 1);
    // A re-read that is 2 s ahead of the phone (a jumpy clock): the bar keeps its course, toward the same deadline.
    await rerender(<Strip model={lockModel(view, NOW + 3000)} testID="strip" />);
    await frames(16);
    expect(bar()).toBeCloseTo(5200 / 12000, 1);
  });

  it('stands still while frozen, and drains again from the time it had on the resume', async () => {
    const { rerender } = await render(<Strip model={lockModel(view, NOW)} testID="strip" />);
    await frames(1000);
    const frozen = withPlayer(view, 'moshe', { lock: { cell: F8, expiresAt: null, remainingMs: 5000 } });
    await rerender(<Strip model={lockModel(frozen, NOW + 1000)} testID="strip" />);
    await frames(16);
    expect(bar()).toBeCloseTo(5000 / 12000, 2);
    await frames(2000);
    expect(bar()).toBeCloseTo(5000 / 12000, 2);
    expect(screen.getByTestId('strip-seconds', hidden)).toHaveTextContent('מושהה');

    const later = NOW + 3000;
    const resumed = withPlayer(view, 'moshe', {
      lock: { cell: F8, expiresAt: later + 5000, remainingMs: 5000 },
    });
    await rerender(<Strip model={lockModel(resumed, later)} testID="strip" />);
    await frames(2500);
    expect(bar()).toBeCloseTo(2500 / 12000, 1);
  });

  it('a new lock starts full of its own time', async () => {
    const { rerender } = await render(<Strip model={{ kind: 'none' }} testID="strip" />);
    await rerender(<Strip model={lockModel(view, NOW)} testID="strip" />);
    await frames(16);
    expect(bar()).toBeCloseTo(6200 / 12000, 2);
  });
});

describe('TimerRing (components.md §3.3, §7.2)', () => {
  const Ring = counted('ring', TimerRing);
  const ring = (now: number, o: { expiresAt?: number | null; remainingMs?: number } = {}) => {
    const expiresAt = o.expiresAt === undefined ? NOW + 8000 : o.expiresAt;
    const remainingMs = o.remainingMs ?? (expiresAt === null ? 8000 : expiresAt - now);
    return (
      <Ring
        size={16}
        tint="#36c9f0"
        remainingMs={remainingMs}
        expiresAt={expiresAt}
        totalMs={12000}
        seconds={Math.ceil(remainingMs / 1000)}
        testID="ring"
      />
    );
  };

  it('renders when its seconds change, not on every re-read of the time', async () => {
    const { rerender } = await render(ring(NOW));
    resetRenderCounts();
    for (let t = 250; t <= 2000; t += 250) await rerender(ring(NOW + t));
    // 8 → 7 → 6 seconds.
    expect(renderCount('ring')).toBe(2);
    expect(screen.getByTestId('ring', hidden)).toHaveTextContent('6');
  });

  it('renders for a stop and a resume (a new deadline)', async () => {
    const { rerender } = await render(ring(NOW));
    resetRenderCounts();
    await rerender(ring(NOW + 300, { expiresAt: null, remainingMs: 7700 }));
    await rerender(ring(NOW + 900, { expiresAt: null, remainingMs: 7700 }));
    await rerender(ring(NOW + 1000, { expiresAt: NOW + 8700 }));
    expect(renderCount('ring')).toBe(2);
  });
});
