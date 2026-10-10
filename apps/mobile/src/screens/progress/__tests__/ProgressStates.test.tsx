import 'react-native-reanimated';

import { fireEvent, render, screen } from '@testing-library/react-native';

import { myProgress } from '../../../api/testing/fakeProgress';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { ProgressScreen, type ProgressScreenProps } from '../ProgressScreen';

/**
 * The "הישגים" tab's states (work plan stage 13; spec §15, §16.3, §4.1 "הישגים לפני שהושג משהו";
 * Loading.dc.html): the level and league as a skeleton while they load, no connection and the server's error
 * with "נסה שוב", the saved numbers with a note, and the achievements before any (the list waits for
 * approval: "בקרוב"), in Hebrew and English.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

async function show(over: Partial<ProgressScreenProps> = {}) {
  const onRetry = jest.fn();
  await render(
    <ProgressScreen
      progress={null}
      status="loading"
      pending={0}
      myAvatar="av07"
      level={null}
      onOpenInterferences={jest.fn()}
      onRetry={onRetry}
      onTab={jest.fn()}
      {...over}
    />,
  );
  return { onRetry };
}

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on' });
});

describe('progress states (stage 13)', () => {
  it('loading: the level and league panels as a skeleton; the rest of the tab is there', async () => {
    await show();
    expect(screen.getByRole('progressbar', { name: 'טוען…' })).toHaveProp('accessibilityState', {
      busy: true,
    });
    expect(screen.queryByTestId('progress-level')).toBeNull();
    expect(screen.getByTestId('progress-xp-rules')).toBeOnTheScreen();
    // Before the first answer the status may still be idle: the same skeleton.
    await show({ status: 'idle' });
    expect(screen.getByTestId('progress-loading')).toBeOnTheScreen();
  });

  it('no connection, nothing saved: the explanation and "נסה שוב"', async () => {
    const { onRetry } = await show({ status: 'offline' });
    expect(screen.getByTestId('progress-offline-title')).toHaveTextContent('אין חיבור לשרת');
    expect(screen.getByTestId('progress-offline-body')).toHaveTextContent(
      'הרמה וה־XP יופיעו כשיהיה חיבור לשרת.',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'נסה שוב' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('the server’s error, nothing saved: "משהו השתבש", not "no connection"', async () => {
    await show({ status: 'error' });
    expect(screen.getByTestId('progress-error-title')).toHaveTextContent('משהו השתבש');
    expect(screen.queryByTestId('progress-offline')).toBeNull();
    expect(screen.getByTestId('progress-retry')).toBeOnTheScreen();
  });

  it('the saved numbers when a refresh fails, with a note', async () => {
    await show({ progress: myProgress(), status: 'error', level: 14 });
    expect(screen.getByTestId('progress-level')).toBeOnTheScreen();
    expect(screen.getByTestId('progress-note-offline')).toHaveTextContent(
      'אין חיבור לשרת: מוצגים הנתונים השמורים.',
      { exact: false },
    );
    expect(screen.queryByTestId('progress-error')).toBeNull();
  });

  it('achievements before any: "בקרוב" and what is coming', async () => {
    await show({ progress: myProgress(), status: 'ok', level: 14 });
    expect(screen.getByTestId('progress-achievements')).toHaveTextContent(
      'בקרוב12 הישגים בדרך: ניצחון ראשון, רצפי ניצחונות, מהלכי שיא ועוד. בקרוב כאן.',
    );
  });

  it('speaks English', async () => {
    await i18n.changeLanguage('en');
    await show();
    expect(screen.getByRole('progressbar', { name: 'Loading…' })).toBeOnTheScreen();
    await show({ status: 'offline' });
    expect(screen.getByTestId('progress-offline-title')).toHaveTextContent('No connection to the server');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
    await show({ status: 'error' });
    expect(screen.getByTestId('progress-error-title')).toHaveTextContent('Something went wrong');
    await show({ progress: myProgress(), status: 'ok', level: 14 });
    expect(screen.getByTestId('progress-achievements')).toHaveTextContent('Coming soon', { exact: false });
  });
});
