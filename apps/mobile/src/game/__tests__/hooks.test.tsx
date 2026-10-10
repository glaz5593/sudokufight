import { ManualClock, ManualScheduler } from '@sudoku-fight/engine';
import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import type { MatchEffect, UiEffect } from '../effects';
import { allOfflinePuzzles } from '../offlinePool';
import { type PracticeSession, startPractice } from '../session';
import { answerIn, emptyCellsOf, PUZZLE, smallPool, testHost, wrongIn } from '../testing/practice';
import { type EffectSource, useGameEffects, useMatchEffects } from '../useGameEffects';
import { useNow } from '../useNow';

describe('useNow', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function Now({ interval, enabled, clock }: { interval?: number; enabled?: boolean; clock: ManualClock }) {
    const now = useNow(interval, { enabled, clock });
    return <Text testID="now">{String(now)}</Text>;
  }
  const shown = () => Number(screen.getByTestId('now').props.children);

  it('re-renders every 250 ms by default, with the clock’s time', async () => {
    const clock = new ManualClock(1000);
    await render(<Now clock={clock} />);
    expect(shown()).toBe(1000);
    await act(async () => void jest.advanceTimersByTime(0));
    clock.set(1100);
    await act(async () => void jest.advanceTimersByTime(249));
    expect(shown()).toBe(1000);
    await act(async () => void jest.advanceTimersByTime(1));
    expect(shown()).toBe(1100);
  });

  it('takes another interval, stops when disabled, and stops when unmounted', async () => {
    const clock = new ManualClock(0);
    const view = await render(<Now clock={clock} interval={1000} />);
    clock.set(500);
    await act(async () => void jest.advanceTimersByTime(1000));
    expect(shown()).toBe(500);

    await view.rerender(<Now clock={clock} interval={1000} enabled={false} />);
    clock.set(9000);
    await act(async () => void jest.advanceTimersByTime(5000));
    expect(shown()).toBe(500);

    await view.rerender(<Now clock={clock} interval={1000} />);
    await act(async () => void jest.advanceTimersByTime(0));
    expect(shown()).toBe(9000); // enabled again: the time at once, not after a whole interval
    const reads = jest.spyOn(clock, 'now');
    await view.unmount();
    await act(async () => void jest.advanceTimersByTime(5000));
    expect(reads).not.toHaveBeenCalled();
  });

  it('uses the phone’s clock by default', async () => {
    function PhoneNow() {
      return <Text testID="now">{String(useNow())}</Text>;
    }
    await render(<PhoneNow />);
    expect(shown()).toBe(Date.now());
  });
});

describe('useGameEffects', () => {
  async function practice(): Promise<PracticeSession> {
    const clock = new ManualClock(1_700_000_000_000);
    return startPractice(
      { gameType: 'fast' },
      {
        repo: null,
        clock,
        scheduler: new ManualScheduler(clock),
        pool: smallPool(3),
        track: () => undefined,
      },
    );
  }

  function Feedback({
    session,
    onEffects,
  }: {
    session: PracticeSession | null;
    onEffects: (fx: UiEffect[]) => void;
  }) {
    useGameEffects(session, onEffects);
    return null;
  }

  it('hands over every update that has effects, one call each, even several in one render', async () => {
    const session = await practice();
    const calls: UiEffect['kind'][][] = [];
    await render(<Feedback session={session} onEffects={(fx) => calls.push(fx.map((f) => f.kind))} />);
    const puzzle = allOfflinePuzzles().find((p) => p.id === session.puzzleId)!;
    const [a, b] = emptyCellsOf(puzzle) as [number, number];
    await act(async () => {
      session.host.select(a);
      session.host.place(a, wrongIn(puzzle, a));
      session.host.react('😎'); // no effect: no call
      session.host.select(b);
      session.host.place(b, answerIn(puzzle, b));
    });
    expect(calls).toEqual([['locked'], ['wrong', 'released'], ['locked'], ['correct']]);
    session.close();
  });

  it('follows the session it is given, and the latest handler', async () => {
    const first = await practice();
    const second = await practice();
    const seen: string[] = [];
    const view = await render(<Feedback session={first} onEffects={() => seen.push('old')} />);
    await view.rerender(<Feedback session={second} onEffects={() => seen.push('new')} />);
    const cell = emptyCellsOf(allOfflinePuzzles().find((p) => p.id === second.puzzleId)!)[0]!;
    await act(async () => {
      first.host.select(cell);
      second.host.select(cell);
    });
    expect(seen).toEqual(['new']);
    await view.rerender(<Feedback session={null} onEffects={() => seen.push('none')} />);
    await act(async () => second.host.release());
    expect(seen).toEqual(['new']);
    first.close();
    second.close();
  });
});

describe('useMatchEffects', () => {
  function Match({
    session,
    onEffects,
  }: {
    session: EffectSource | null;
    onEffects: (fx: MatchEffect[]) => void;
  }) {
    useMatchEffects(session, onEffects);
    return null;
  }

  it('hands over the reactions and interferences, and nothing else', async () => {
    const t = testHost({ mode: 'bot', players: [{ id: 'me' }, { id: 'bot', isBot: true }] });
    const session: EffectSource = { playerId: 'me', subscribe: (fn) => t.host.subscribe(fn) };
    const calls: MatchEffect['kind'][][] = [];
    await render(<Match session={session} onEffects={(fx) => calls.push(fx.map((f) => f.kind))} />);
    const [a] = emptyCellsOf(PUZZLE) as [number];
    await act(async () => {
      t.host.dispatch({ type: 'select', playerId: 'bot', cell: a });
      t.host.dispatch({ type: 'place', playerId: 'bot', cell: a, digit: answerIn(PUZZLE, a) });
      t.host.dispatch({ type: 'react', playerId: 'bot', emoji: '😂' });
      t.host.dispatch({ type: 'interfere', playerId: 'bot', targetId: 'me', kind: 'fireworks' });
      t.scheduler.advance(5_000);
    });
    expect(calls).toEqual([['reaction'], ['interference'], ['interferenceEnded']]);
    t.host.close();
  });
});
