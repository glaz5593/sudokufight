import { fireEvent, render, screen } from '@testing-library/react-native';

import { type Setup, setUp, wait } from '../../game/connection/testing/setup';
import { type JoinOutcome, JoinCodeScreen } from '../JoinCodeScreen';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/feedback', () => ({ cue: jest.fn() }));

const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);

let env: Setup;
afterEach(() => env.restore());

const box = (i: number) => screen.getByTestId(`friends-code-input-${i}`);
const typeCode = async (code: string) => {
  for (const [i, d] of [...code].entries()) await fireEvent.changeText(box(i), d);
};

describe('"הצטרף עם קוד" (friends-room.md §3.3)', () => {
  beforeEach(async () => {
    env = await setUp('he');
  });

  it('asks for the 6 digits, and joins by itself once the sixth is in', async () => {
    const onJoin = jest.fn(async (): Promise<JoinOutcome> => ({ ok: true }));
    await render(<JoinCodeScreen onJoin={onJoin} onBack={jest.fn()} />);
    expect(screen.getByRole('header', { name: 'הצטרף עם קוד' })).toBeOnTheScreen();
    expect(screen.getByText('הקלד את 6 הספרות שקיבלת')).toBeOnTheScreen();
    expect(screen.getByTestId('friends-join-submit')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ disabled: true }),
    );
    await typeCode('123456');
    await wait(0);
    expect(onJoin).toHaveBeenCalledTimes(1);
    expect(onJoin).toHaveBeenCalledWith('123456');
  });

  it('says a refusal under the boxes, keeps the digits, and "הצטרף" tries again', async () => {
    const onJoin = jest
      .fn<Promise<JoinOutcome>, [string]>()
      .mockResolvedValueOnce({ ok: false, failure: 'notFound' })
      .mockResolvedValueOnce({ ok: false, failure: 'tooManyRequests', retryAfterSec: 240 });
    await render(<JoinCodeScreen onJoin={onJoin} onBack={jest.fn()} />);
    await typeCode('123456');
    await wait(0);
    // A block reads exactly as a wrong code [D85c].
    expect(screen.getByTestId('friends-code-input-error')).toHaveTextContent(
      `לא מצאנו חדר עם הקוד ${LRI}123 456${PDI}. בדוק את הספרות.`,
    );
    expect(box(5)).toHaveProp('value', '6');
    await fireEvent.press(screen.getByRole('button', { name: 'הצטרף' }));
    await wait(0);
    expect(onJoin).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('friends-code-input-error')).toHaveTextContent(
      'יותר מדי ניסיונות. נסה שוב בעוד 4 דקות.',
    );
  });

  it('nothing can be typed while joining; a second press does not join twice', async () => {
    let finish: (o: JoinOutcome) => void = () => undefined;
    const onJoin = jest.fn(() => new Promise<JoinOutcome>((resolve) => (finish = resolve)));
    await render(<JoinCodeScreen onJoin={onJoin} onBack={jest.fn()} />);
    await typeCode('123456');
    expect(box(0)).toHaveProp('editable', false);
    await fireEvent.press(screen.getByTestId('friends-join-submit'));
    expect(onJoin).toHaveBeenCalledTimes(1);
    finish({ ok: true });
    await wait(0);
  });

  it('with autoJoin off, it waits for "הצטרף"', async () => {
    const onJoin = jest.fn(async (): Promise<JoinOutcome> => ({ ok: true }));
    await render(<JoinCodeScreen onJoin={onJoin} onBack={jest.fn()} settings={{ autoJoin: false }} />);
    await typeCode('654321');
    await wait(0);
    expect(onJoin).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'הצטרף' }));
    expect(onJoin).toHaveBeenCalledWith('654321');
  });

  it('"הדבק" with the whole message joins its code', async () => {
    const onJoin = jest.fn(async (): Promise<JoinOutcome> => ({ ok: true }));
    await render(
      <JoinCodeScreen
        onJoin={onJoin}
        onBack={jest.fn()}
        readClipboard={async () => 'בוא לשחק איתי סודוקו פייט! קוד החדר: 777888\nhttps://x.fly.dev/r/777888'}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'הדבק' }));
    await wait(0);
    expect(onJoin).toHaveBeenCalledWith('777888');
  });

  it('a code from a link comes prefilled', async () => {
    await render(<JoinCodeScreen onJoin={jest.fn()} onBack={jest.fn()} initialCode="246810" />);
    expect([0, 1, 2, 3, 4, 5].map((i) => box(i).props.value)).toEqual(['2', '4', '6', '8', '1', '0']);
  });
});

describe('"Join with code" (English)', () => {
  beforeEach(async () => {
    env = await setUp('en');
  });

  it('says it in English', async () => {
    const onJoin = jest.fn(async (): Promise<JoinOutcome> => ({ ok: false, failure: 'roomFull' }));
    await render(<JoinCodeScreen onJoin={onJoin} onBack={jest.fn()} readClipboard={async () => null} />);
    expect(screen.getByRole('header', { name: 'Join with code' })).toBeOnTheScreen();
    expect(box(0)).toHaveProp('accessibilityLabel', 'Digit 1 of 6');
    expect(screen.getByRole('button', { name: 'Paste' })).toBeOnTheScreen();
    await typeCode('123456');
    await wait(0);
    expect(screen.getByTestId('friends-code-input-error')).toHaveTextContent('The room is full (4 of 4).');
  });
});
