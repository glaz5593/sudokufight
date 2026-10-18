import 'react-native-reanimated';

import { fireEvent, render, screen } from '@testing-library/react-native';

import { myProgress } from '../../../api/testing/fakeProgress';
import { ltr } from '../../../components/player';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { ProgressScreen, type ProgressScreenProps } from '../ProgressScreen';

/**
 * The "הישגים" tab (spec §15; work plan stage 12): my level and XP, my league and the next one, how XP is
 * earned, the achievements ("בקרוב", waiting for the approved list), practice XP waiting to sync [D41], and
 * the way to the interferences collection.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

async function show(over: Partial<ProgressScreenProps> = {}) {
  const props = {
    onOpenMyCard: jest.fn(),
    onOpenInterferences: jest.fn(),
    onRetry: jest.fn(),
    onTab: jest.fn(),
  };
  await render(
    <ProgressScreen
      progress={myProgress()}
      status="ok"
      pending={0}
      myAvatar="lava-lamp"
      level={14}
      {...props}
      {...over}
    />,
  );
  return props;
}

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on' });
});

describe('ProgressScreen', () => {
  it('my level, the XP to the next one, and the bar', async () => {
    await show();
    expect(screen.getByRole('header', { name: 'הישגים והתקדמות' })).toBeOnTheScreen();
    expect(screen.getByLabelText('רמה 14')).toBeOnTheScreen();
    expect(screen.getByTestId('progress-xp')).toHaveTextContent(ltr('2,380 / 3,000 XP'));
    expect(screen.getByTestId('progress-to-go')).toHaveTextContent(`עוד ${ltr('620 XP')} לרמה 15`);
    expect(screen.getByTestId('progress-level-bar')).toHaveProp('accessibilityValue', {
      min: 0,
      max: 100,
      now: 79,
    });
  });

  it('my league on the ladder, with the way to the next one', async () => {
    await show();
    expect(screen.getByTestId('progress-league-line')).toHaveTextContent('כללי 1276 · עוד 124 ליהלום');
    expect(screen.getByTestId('progress-league-gold-current')).toHaveProp(
      'accessibilityLabel',
      'ליגת זהב, מדירוג 1250',
    );
    expect(screen.getByTestId('progress-league-legend')).toHaveTextContent(`אגדה${ltr('1600+')}`);
  });

  it('provisional: no league yet, and why', async () => {
    await show({ progress: myProgress({ league: null, leagueRating: null }) });
    expect(screen.getByTestId('progress-league-line')).toHaveTextContent(
      'הליגה תופיע אחרי 10 משחקים מדורגים באחד מסוגי המשחק',
    );
    expect(screen.queryByTestId(/-current$/)).toBeNull();
  });

  it('how XP is earned (spec §15)', async () => {
    await show();
    expect(screen.getByTestId('progress-xp-rules')).toHaveTextContent(
      `מקום 1 במדורג, או ניצחון מול בוט${ltr('+50 XP')}`,
      { exact: false },
    );
    expect(screen.getByTestId('progress-xp-rules')).toHaveTextContent(`אימון לבד${ltr('+10 XP')}`, {
      exact: false,
    });
  });

  it('the achievements: "בקרוב" (the list waits for approval)', async () => {
    await show();
    expect(screen.getByTestId('progress-achievements')).toHaveTextContent('בקרוב', { exact: false });
  });

  it('the interferences collection, my card, and the bottom navigation', async () => {
    const { onOpenInterferences, onOpenMyCard, onTab } = await show();
    expect(screen.getByTestId('progress-interferences')).toHaveTextContent(
      'אוסף ההפרעות6 פתוחות · 4 נעולות',
      {
        exact: false,
      },
    );
    await fireEvent.press(screen.getByTestId('progress-interferences'));
    expect(onOpenInterferences).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'כרטיס השחקן שלי' }));
    expect(onOpenMyCard).toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: 'הישגים' })).toHaveProp('accessibilityState', { selected: true });
    await fireEvent.press(screen.getByRole('tab', { name: 'בית' }));
    expect(onTab).toHaveBeenCalledWith('home');
  });

  it('practice XP waiting for the server [D41] says so', async () => {
    await show({ pending: 3 });
    expect(screen.getByTestId('progress-pending')).toHaveTextContent('3 אימונים ממתינים לסנכרון עם השרת');
  });

  it('offline: the saved numbers with a note; nothing saved: the offline state and "נסה שוב"', async () => {
    const { onRetry } = await show({ status: 'offline' });
    expect(screen.getByTestId('progress-note-offline')).toBeOnTheScreen();
    await show({ progress: null, status: 'offline', onRetry });
    expect(screen.getByTestId('progress-offline')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('progress-retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await show({ pending: 1 });
    expect(screen.getByRole('header', { name: 'Achievements & progress' })).toBeOnTheScreen();
    expect(screen.getByTestId('progress-to-go')).toHaveTextContent(`${ltr('620 XP')} to level 15`);
    expect(screen.getByTestId('progress-league-line')).toHaveTextContent('General 1276 · 124 to Diamond');
    expect(screen.getByTestId('progress-pending')).toHaveTextContent(
      '1 practice waiting to sync with the server',
    );
  });
});
