import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { color } from '../../../theme';
import { type Setup, setUp, styleOf, wait } from '../../game/connection/testing/setup';
import { CodeInput } from '../CodeInput';
import { type CodeDigits, EMPTY_CODE } from '../friendsModel';

let env: Setup;
afterEach(() => env.restore());

/** The screen's part: it keeps the boxes. */
function Harness({
  onComplete,
  readClipboard,
  error,
}: {
  onComplete?: (code: string) => void;
  readClipboard?: () => Promise<string | null>;
  error?: string | null;
}) {
  const [digits, setDigits] = useState<CodeDigits>(EMPTY_CODE);
  return (
    <CodeInput
      digits={digits}
      onChange={setDigits}
      onComplete={onComplete}
      readClipboard={readClipboard}
      error={error}
    />
  );
}

const box = (i: number) => screen.getByTestId(`code-input-${i}`);
const values = () => [0, 1, 2, 3, 4, 5].map((i) => box(i).props.value as string);

describe('CodeInput (friends-room.md §3.3)', () => {
  beforeEach(async () => {
    env = await setUp('he');
  });

  it('is six boxes for the number pad, always left to right, each its own field for a screen reader', async () => {
    await render(<Harness />);
    expect(styleOf(screen.getByTestId('code-input-boxes'))).toMatchObject({
      direction: 'ltr',
      flexDirection: 'row',
    });
    expect(values()).toEqual(['', '', '', '', '', '']);
    expect(box(0)).toHaveProp('accessibilityLabel', 'ספרה 1 מתוך 6');
    expect(box(5)).toHaveProp('accessibilityLabel', 'ספרה 6 מתוך 6');
    expect(box(0)).toHaveProp('keyboardType', 'number-pad');
    // Three and three: a wider gap before the fourth.
    expect(styleOf(box(3)).marginStart).toBeGreaterThan(0);
    expect(styleOf(box(2)).marginStart).toBeUndefined();
  });

  it('typing fills the boxes one by one; the sixth digit completes the code', async () => {
    const onComplete = jest.fn();
    await render(<Harness onComplete={onComplete} />);
    for (const [i, d] of [...'12345'].entries()) await fireEvent.changeText(box(i), d);
    expect(values()).toEqual(['1', '2', '3', '4', '5', '']);
    expect(onComplete).not.toHaveBeenCalled();
    await fireEvent.changeText(box(5), '6');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('a digit typed over one replaces it; anything but a digit is dropped', async () => {
    await render(<Harness />);
    await fireEvent.changeText(box(0), '3');
    await fireEvent.changeText(box(0), '35');
    expect(values()[0]).toBe('5');
    await fireEvent.changeText(box(1), 'x');
    expect(values()[1]).toBe('');
  });

  it('backspace in an empty box clears the one before', async () => {
    await render(<Harness />);
    await fireEvent.changeText(box(0), '1');
    await fireEvent.changeText(box(1), '2');
    await fireEvent(box(2), 'keyPress', { nativeEvent: { key: 'Backspace' } });
    expect(values()).toEqual(['1', '', '', '', '', '']);
    // Clearing a box with a digit clears it alone.
    await fireEvent.changeText(box(0), '');
    expect(values()).toEqual(['', '', '', '', '', '']);
  });

  it('a whole WhatsApp message pasted into any box finds the code in it', async () => {
    const onComplete = jest.fn();
    await render(<Harness onComplete={onComplete} />);
    await fireEvent.changeText(
      box(2),
      'בוא לשחק איתי סודוקו פייט! קוד החדר: 654321\nhttps://sudoku-fight-staging.fly.dev/r/654321',
    );
    expect(values()).toEqual(['6', '5', '4', '3', '2', '1']);
    expect(onComplete).toHaveBeenCalledWith('654321');
  });

  it('"הדבק" reads the clipboard, and says so when there is no code in it', async () => {
    const onComplete = jest.fn();
    let clip: string | null = 'Room code: 123 456';
    await render(<Harness onComplete={onComplete} readClipboard={async () => clip} />);
    expect(screen.getByText('אפשר להדביק את כל ההודעה מוואטסאפ')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'הדבק' }));
    await wait(0);
    expect(values()).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(onComplete).toHaveBeenCalledWith('123456');

    clip = 'call me at 054-123-4567';
    await fireEvent.press(screen.getByRole('button', { name: 'הדבק' }));
    await wait(0);
    expect(screen.getByTestId('code-input-error')).toHaveTextContent('לא מצאנו קוד של 6 ספרות בטקסט שהועתק');
    // Typing clears the line.
    await fireEvent.changeText(box(0), '9');
    expect(screen.queryByTestId('code-input-error')).not.toBeOnTheScreen();
  });

  it('shows the screen’s error under the boxes, in red boxes', async () => {
    await render(<Harness error="לא מצאנו חדר עם הקוד הזה." />);
    expect(screen.getByTestId('code-input-error')).toHaveTextContent('לא מצאנו חדר עם הקוד הזה.');
    for (const i of [0, 5]) expect(styleOf(box(i)).borderColor).toBe(color.input.borderError);
  });
});
