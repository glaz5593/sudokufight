import { act, fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { color, tokens } from '../../../theme';
import { Field, PasswordField } from '../Field';
import { Checkbox, StrengthMeter } from '../parts';

const SHAKE = tokens.motion.duration.wrongShake;

beforeEach(async () => {
  jest.useFakeTimers();
  useSettings.setState({ reduceMotion: 'off' });
  await i18n.changeLanguage('he');
});
afterEach(() => jest.useRealTimers());

describe('form fields (motion.md form.error)', () => {
  it('an error: red border, the message announced, and a shake', async () => {
    const { rerender } = await render(<Field label="מייל" value="" testID="f" />);
    const box = () => screen.getByTestId('f-box');
    expect(box()).toHaveStyle({ borderColor: color.input.border });

    await rerender(<Field label="מייל" value="" error="כתוב את המייל שלך" shake={1} testID="f" />);
    expect(box()).toHaveStyle({ borderColor: color.input.borderError });
    expect(screen.getByRole('alert')).toHaveTextContent('כתוב את המייל שלך');
    expect(screen.getByLabelText('מייל, כתוב את המייל שלך')).toBeOnTheScreen();
    await act(async () => void jest.advanceTimersByTime(SHAKE / 6));
    expect(box()).not.toHaveAnimatedStyle({ transform: [{ translateX: 0 }] });
    await act(async () => void jest.advanceTimersByTime(1_000));
    expect(box()).toHaveAnimatedStyle({ transform: [{ translateX: 0 }] });
  });

  it('reduced motion: the red border and the message, no shake', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    const { rerender } = await render(<Field label="מייל" value="" testID="f" />);
    await rerender(<Field label="מייל" value="" error="שגיאה" shake={1} testID="f" />);
    await act(async () => void jest.advanceTimersByTime(SHAKE / 6));
    expect(screen.getByTestId('f-box')).toHaveAnimatedStyle({ transform: [{ translateX: 0 }] });
    expect(screen.getByTestId('f-box')).toHaveStyle({ borderColor: color.input.borderError });
  });

  it('the checkbox shakes too, and not with reduced motion', async () => {
    const { rerender } = await render(
      <Checkbox checked={false} onChange={() => undefined} label="x" testID="c" />,
    );
    await rerender(
      <Checkbox checked={false} onChange={() => undefined} label="x" error="חובה" shake={1} testID="c" />,
    );
    const row = () => screen.getByTestId('c-shake');
    await act(async () => void jest.advanceTimersByTime(SHAKE / 4));
    expect(row()).not.toHaveAnimatedStyle({ transform: [{ translateX: 0 }] });

    await act(async () => useSettings.setState({ reduceMotion: 'on' }));
    await rerender(
      <Checkbox checked={false} onChange={() => undefined} label="x" error="חובה" shake={2} testID="c" />,
    );
    await act(async () => void jest.advanceTimersByTime(1_000));
    await rerender(
      <Checkbox checked={false} onChange={() => undefined} label="x" error="חובה" shake={3} testID="c" />,
    );
    await act(async () => void jest.advanceTimersByTime(SHAKE / 4));
    expect(row()).toHaveAnimatedStyle({ transform: [{ translateX: 0 }] });
  });

  it('every touch target is at least 44: the eye, the checkbox row', async () => {
    await render(
      <>
        <PasswordField label="סיסמה" value="" shown={false} onToggleShown={() => undefined} testID="p" />
        <Checkbox checked onChange={() => undefined} label="x" testID="c" />
      </>,
    );
    expect(screen.getByTestId('p-eye')).toHaveStyle({ width: 44, height: 44 });
    expect(screen.getByTestId('c')).toHaveStyle({ minHeight: 44 });
    await fireEvent.press(screen.getByTestId('c'));
  });

  it('the strength meter speaks its level', async () => {
    await render(<StrengthMeter strength={3} testID="m" />);
    expect(screen.getByRole('progressbar', { name: 'חוזק הסיסמה' })).toHaveProp('accessibilityValue', {
      min: 0,
      max: 4,
      now: 3,
      text: 'סיסמה טובה',
    });
  });
});
