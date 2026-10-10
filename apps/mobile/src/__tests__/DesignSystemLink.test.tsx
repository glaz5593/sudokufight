import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '../i18n';
import { HelloScreen } from '../screens/HelloScreen';

/** Stage 3: the hello screen links to /dev/design-system in development builds (app/index.tsx passes it). */

jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('@shopify/react-native-skia', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Canvas: View, Circle: () => null };
});
// The echo room never answers here: the link does not need the server.
jest.mock('@colyseus/sdk', () => ({
  Client: jest.fn().mockImplementation(() => ({ joinOrCreate: () => new Promise(() => undefined) })),
}));

describe('design-system link on the hello screen', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
  });

  it('opens the design system when given the way there', async () => {
    const open = jest.fn();
    await render(<HelloScreen onOpenDesignSystem={open} />);
    const link = screen.getByRole('button', { name: 'מערכת עיצוב' });
    expect(link).toHaveProp('accessibilityHint', 'מסך פיתוח: כל הרכיבים בכל המצבים');
    await fireEvent.press(link);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('has no link without it (release builds)', async () => {
    await render(<HelloScreen />);
    expect(screen.queryByTestId('design-system-link')).toBeNull();
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await render(<HelloScreen onOpenDesignSystem={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Design system' })).toBeTruthy();
  });
});
