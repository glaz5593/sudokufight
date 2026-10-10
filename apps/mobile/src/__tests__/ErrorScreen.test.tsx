import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '../i18n';
import { ErrorScreen } from '../screens/ErrorScreen';
import { crashReporter } from '../services/crashlytics';

const mockRecordError = jest.fn();
jest.mock('../services/crashlytics', () => ({
  crashReporter: jest.fn(() => ({
    enabled: true,
    recordError: mockRecordError,
    setUser: jest.fn(),
    log: jest.fn(),
  })),
}));

describe('the root error boundary’s screen (stage 8: Crashlytics)', () => {
  it('records the error once and offers to try again, in Hebrew and English', async () => {
    await i18n.changeLanguage('he');
    const error = new Error('render failed');
    const retry = jest.fn(async () => undefined);
    await render(<ErrorScreen error={error} retry={retry} />);
    expect(crashReporter).toHaveBeenCalled();
    expect(mockRecordError).toHaveBeenCalledWith(error, 'error boundary');
    expect(screen.getByRole('header', { name: 'משהו השתבש' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'נסה שוב' }));
    expect(retry).toHaveBeenCalledTimes(1);

    await screen.unmount();
    await i18n.changeLanguage('en');
    await render(<ErrorScreen error={error} retry={retry} />);
    expect(screen.getByRole('header', { name: 'Something went wrong' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
  });
});
