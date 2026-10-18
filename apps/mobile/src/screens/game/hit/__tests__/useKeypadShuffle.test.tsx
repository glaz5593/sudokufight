import { type Digit, ManualClock } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ViewStyle } from 'react-native';

import type { KeypadModel } from '../../../../components/board';
import { Keypad } from '../../../../components/board/Keypad';
import { KEYPAD, keypadPlan } from '../../../../components/interference';
import i18n from '../../../../i18n';
import { size } from '../../../../theme';
import { type HitInfo, hitSeedOf } from '../hitModel';
import { useKeypadShuffle } from '../useKeypadShuffle';

/** The screen's nudge for a dropped press (GameScreen: cue('nudge')). */
const refused = jest.fn();

/** [D47] "מקלדת מתערבלת" on the game screen: the hook, from the game clock, driving the real keypad. */

const START = 50_000;
const W = 358;
const PITCH = (W + size.keypadGap) / 9;
let clock: ManualClock;

const ARMED: KeypadModel = {
  enabled: true,
  keys: ([1, 2, 3, 4, 5, 6, 7, 8, 9] as Digit[]).map((digit) => ({
    digit,
    remaining: 3,
    state: 'armed' as const,
    disabled: false,
  })),
};

const keypadHit = (over: Partial<HitInfo> = {}): HitInfo => ({
  kind: 'keypad',
  fromId: 'p2',
  fromName: 'NinaVolt',
  endsAt: START + 5000,
  totalMs: 5000,
  gameId: 'g-1',
  id: 7,
  ...over,
});

function Screen({
  hit,
  reduce = false,
  onDigit,
}: {
  hit: HitInfo | null;
  reduce?: boolean;
  onDigit: jest.Mock;
}) {
  const { order, guard } = useKeypadShuffle({ hit, now: clock.now(), clock, reduce, onRefused: refused });
  return <Keypad model={ARMED} onDigit={onDigit} width={W} order={order} guard={guard} />;
}

/** The slot each key stands in now (from its translateX), as the order left to right. */
function shownOrder(): number[] {
  const slots = ([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((digit) => {
    const el = screen.getByTestId(`key-${digit}-place`) as unknown as {
      props: { jestAnimatedStyle?: { value: ViewStyle } };
    };
    const x = (el.props.jestAnimatedStyle?.value.transform as { translateX: number }[])[0]!.translateX;
    return { digit, slot: Math.round(x / PITCH) + digit - 1 };
  });
  return slots.sort((a, b) => a.slot - b.slot).map((s) => s.digit);
}

/** A raw touch event's lists, by finger id (iOS adds `targetTouches`: the fingers on the view it was sent to). */
const touch = (changed: number[], active: number[], target?: number[]) => ({
  nativeEvent: {
    changedTouches: changed.map((identifier) => ({ identifier })),
    touches: active.map((identifier) => ({ identifier })),
    ...(target ? { targetTouches: target.map((identifier) => ({ identifier })) } : {}),
  },
});

/** The game clock and the phone's timers move on together. */
async function together(ms: number) {
  for (let t = 0; t < ms; t += 50) {
    clock.advance(50);
    await act(async () => {
      jest.advanceTimersByTime(50);
    });
  }
}

beforeEach(async () => {
  jest.useFakeTimers();
  clock = new ManualClock(START);
  refused.mockClear();
  await i18n.changeLanguage('he');
});
afterEach(() => jest.useRealTimers());

describe('useKeypadShuffle with the keypad [D47]', () => {
  const plan = keypadPlan(hitSeedOf(keypadHit()), 5000);

  it('moves the keys every 1.5 s from the hit’s seed, and back to 1–9 at the end', async () => {
    const onDigit = jest.fn();
    const { rerender } = await render(<Screen hit={keypadHit()} onDigit={onDigit} />);
    await together(300);
    expect(shownOrder()).toEqual(plan.orders[0]);
    await together(1_500);
    expect(shownOrder()).toEqual(plan.orders[1]);
    await together(3_250);
    await rerender(<Screen hit={keypadHit()} onDigit={onDigit} />);
    await together(300);
    expect(shownOrder()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('only for a keypad hit: another kind leaves the keys in their places', async () => {
    await render(<Screen hit={keypadHit({ kind: 'ink' })} onDigit={jest.fn()} />);
    await together(2_000);
    expect(shownOrder()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('a press enters the printed digit; one that starts while the keys move is dropped with a nudge', async () => {
    const onDigit = jest.fn();
    await render(<Screen hit={keypadHit()} onDigit={onDigit} />);
    // Right at the start the keys are still moving into place.
    const four = screen.getByTestId('key-4');
    await fireEvent(four, 'pressIn');
    await fireEvent.press(four);
    expect(onDigit).not.toHaveBeenCalled();
    expect(refused).toHaveBeenCalledWith(4);
    await together(KEYPAD.moveMs + KEYPAD.guardMs + 50);
    await fireEvent(four, 'pressIn');
    await fireEvent.press(four);
    expect(onDigit).toHaveBeenCalledWith(4);
  });

  it('never moves a key under a finger: the move waits for the lift and a moment after', async () => {
    await render(<Screen hit={keypadHit()} onDigit={jest.fn()} />);
    await together(1_300);
    const row = screen.getByTestId('keypad');
    await fireEvent(row, 'touchStart', touch([1], [1]));
    await together(700); // 2 s in: past the 1.5 s step
    expect(shownOrder()).toEqual(plan.orders[0]);
    await fireEvent(row, 'touchEnd', touch([1], []));
    await together(KEYPAD.freezeMs + KEYPAD.moveMs + 100);
    expect(shownOrder()).toEqual(plan.orders[1]);
  });

  it('iOS: two fingers that land on two keys in one frame leave no phantom: the next hit still shuffles', async () => {
    const onDigit = jest.fn();
    const { rerender } = await render(<Screen hit={null} onDigit={onDigit} />);
    // One event with both fingers, sent once to each key; both copies bubble up to the row. They lift apart.
    await fireEvent(screen.getByTestId('key-2'), 'touchStart', touch([7, 8], [7, 8], [7]));
    await fireEvent(screen.getByTestId('key-5'), 'touchStart', touch([7, 8], [7, 8], [8]));
    await fireEvent(screen.getByTestId('key-2'), 'touchEnd', touch([7], [8], [7]));
    await fireEvent(screen.getByTestId('key-5'), 'touchEnd', touch([8], [], [8]));
    // A keypad hit lands within the 10 s a phantom finger would last: the keys still move at once.
    await together(KEYPAD.freezeMs + 50);
    const hit = keypadHit({ endsAt: clock.now() + 5000 });
    const moved = keypadPlan(hitSeedOf(hit), 5000);
    await rerender(<Screen hit={hit} onDigit={onDigit} />);
    await together(300);
    expect(shownOrder()).toEqual(moved.orders[0]);
    await together(1_500);
    expect(shownOrder()).toEqual(moved.orders[1]);
  });

  it('with reduced motion: one order for the whole hit, faded in, no further moves', async () => {
    await render(<Screen hit={keypadHit()} reduce onDigit={jest.fn()} />);
    await together(400);
    expect(shownOrder()).toEqual(plan.orders[0]);
    await together(4_000);
    expect(shownOrder()).toEqual(plan.orders[0]);
  });
});
