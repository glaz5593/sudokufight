import 'react-native-reanimated';

import type { PlayerCard } from '@sudoku-fight/protocol';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { ProgressApiError } from '../../../api/progressApi';
import { card, myProgress, rating } from '../../../api/testing/fakeProgress';
import { ltr } from '../../../components/player';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { PlayerCardScreen, type PlayerCardScreenProps } from '../PlayerCardScreen';

/**
 * The player card (spec §14.3; work plan stage 12): who, league and level, every rating with its trend and
 * peak (3 under B, 9 under A), the stats, the last 10 results, the achievements' empty state; mine with my XP
 * and "עריכת פרופיל", opening offline on the saved card; another player's offline state.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const hidden = { includeHiddenElements: true };
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  });

async function show(load: PlayerCardScreenProps['load'], over: Partial<PlayerCardScreenProps> = {}) {
  const props = {
    onBack: jest.fn(),
    onEditProfile: jest.fn(),
    onOpenReplay: jest.fn<void, [string]>(),
    onLoaded: jest.fn<void, [PlayerCard]>(),
  };
  await render(<PlayerCardScreen playerId="nina" load={load} myId="me" {...props} {...over} />);
  await settle();
  return props;
}

const NINA = card({ id: 'nina', displayName: 'NinaVolt', country: 'DE', league: 'diamond', level: 22 });

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on' });
});

describe('PlayerCardScreen', () => {
  it('another player: name, flag and country, league and level; every rating; the stats; the last results', async () => {
    const { onLoaded, onBack } = await show(async () => NINA);
    expect(screen.getByRole('header', { name: 'כרטיס שחקן' })).toBeOnTheScreen();
    expect(screen.getByTestId('player-card-identity')).toHaveTextContent('NinaVolt', { exact: false });
    expect(screen.getByLabelText('NinaVolt, גרמניה, ליגת יהלום, רמה 22')).toBeOnTheScreen();
    expect(screen.queryByTestId('player-card-xp')).toBeNull();
    expect(screen.queryByRole('button', { name: 'עריכת פרופיל' })).toBeNull();

    expect(screen.getByTestId('player-card-rating-fast')).toHaveProp(
      'accessibilityLabel',
      'דירוג מהיר 1342, שיא 1361, 30 משחקים, עלייה של 17 במשחקים האחרונים',
    );
    expect(screen.getByTestId('player-card-rating-normal')).toHaveTextContent('שיא 1302', { exact: false });
    expect(screen.getByTestId('player-card-spark-hard', hidden)).toBeTruthy();

    expect(screen.getByTestId('player-card-stat-winRate')).toHaveProp(
      'accessibilityLabel',
      `אחוז ניצחונות: ${ltr('57%')}`,
    );
    expect(screen.getByTestId('player-card-stat-bestMove')).toHaveTextContent(ltr('+12.5'), { exact: false });
    expect(screen.getByTestId('player-card-stat-avgMistakes')).toHaveTextContent('2.5', { exact: false });

    const form = screen.getByTestId('player-card-form');
    expect(form).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/^התוצאות האחרונות, מהחדשה: ניצחון, ניצחון, הפסד/),
    );
    expect(within(form).getAllByText(/^[נה]$/, hidden)).toHaveLength(10);
    // Another player's games are not mine to replay.
    expect(screen.getByTestId('player-card-recent-g1')).not.toHaveProp('accessibilityRole', 'button');

    expect(screen.getByTestId('player-card-achievements-empty')).toHaveTextContent('ההישגים מגיעים בקרוב.', {
      exact: false,
    });
    expect(onLoaded).toHaveBeenCalledWith(NINA);
    await fireEvent.press(screen.getByRole('button', { name: 'חזרה' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('option A: all 9 ratings, by game type', async () => {
    const keys = ['fast', 'normal', 'hard'].flatMap((t) => [2, 3, 4].map((n) => `${t}-${n}p`));
    await show(async () => ({ ...NINA, ratings: keys.map((k) => rating(k)) }));
    expect(screen.getAllByTestId(/^player-card-rating-/)).toHaveLength(9);
    expect(screen.getByTestId('player-card-rating-hard-4p')).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/^דירוג קשה · 4 שחקנים 1287/),
    );
  });

  it('mine: the P1 frame and ●, my XP bar, "עריכת פרופיל", and my results open their replay', async () => {
    const mine = card({ id: 'me' });
    const { onEditProfile, onOpenReplay } = await show(async () => mine, {
      playerId: 'me',
      myProgress: myProgress(),
    });
    expect(screen.getByLabelText('MosheG, הכרטיס שלי, ישראל, ליגת זהב, רמה 14')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('player-card-identity')).getByTestId('glyph-circle', hidden),
    ).toBeTruthy();
    expect(screen.getByTestId('player-card-xp')).toHaveTextContent(ltr('2,380 / 3,000 XP'));
    expect(screen.getByRole('progressbar')).toHaveProp('accessibilityValue', { min: 0, max: 100, now: 79 });
    await fireEvent.press(screen.getByRole('button', { name: 'עריכת פרופיל' }));
    expect(onEditProfile).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('player-card-recent-g2'));
    expect(onOpenReplay).toHaveBeenCalledWith('g2');
  });

  it('mine offline: the card saved on the phone, with a note and "נסה שוב"', async () => {
    let fail = true;
    const saved = card({ id: 'me', level: 9 });
    const load = jest.fn(async () => {
      if (fail) throw new ProgressApiError('network');
      return card({ id: 'me', level: 10 });
    });
    await show(load, { playerId: 'me', cached: saved });
    expect(screen.getByTestId('player-card-note')).toHaveTextContent('אין חיבור לשרת: מוצג הכרטיס השמור.', {
      exact: false,
    });
    expect(screen.getByLabelText('MosheG, הכרטיס שלי, ישראל, ליגת זהב, רמה 9')).toBeOnTheScreen();
    fail = false;
    await fireEvent.press(screen.getByTestId('player-card-note-retry'));
    await settle();
    expect(screen.queryByTestId('player-card-note')).toBeNull();
    expect(screen.getByLabelText('MosheG, הכרטיס שלי, ישראל, ליגת זהב, רמה 10')).toBeOnTheScreen();
  });

  it('another player offline: the offline state; not found: says so', async () => {
    await show(async () => {
      throw new ProgressApiError('timeout');
    });
    expect(screen.getByTestId('player-card-offline')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'אין חיבור לשרת' })).toBeOnTheScreen();
    await show(async () => {
      throw new ProgressApiError('notFound', 404);
    });
    expect(screen.getByRole('header', { name: 'השחקן לא נמצא' })).toBeOnTheScreen();
  });

  it('a provisional player with no games: "בדירוג זמני", and the empty results', async () => {
    await show(async () => ({
      ...NINA,
      league: null,
      ratings: [rating('normal', { provisional: true, games: 2, trend: [1200, 1216] })],
      recent: [],
    }));
    expect(screen.getByTestId('player-card-provisional')).toHaveTextContent('בדירוג זמני · רמה 22');
    expect(screen.getByTestId('player-card-rating-normal')).toHaveTextContent('זמני', { exact: false });
    expect(screen.getByTestId('player-card-recent-empty')).toHaveTextContent('עוד אין משחקים מדורגים.');
  });

  it('earned achievements are listed (once the list is approved)', async () => {
    await show(async () => ({ ...NINA, achievements: [{ key: 'firstWin', earnedAt: 1_760_000_000_000 }] }));
    expect(screen.getByTestId('player-card-achievements')).toHaveTextContent('firstWin', { exact: false });
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await show(async () => NINA);
    expect(screen.getByRole('header', { name: 'Player card' })).toBeOnTheScreen();
    expect(screen.getByLabelText('NinaVolt, Germany, Diamond league, Level 22')).toBeOnTheScreen();
    expect(screen.getByTestId('player-card-stat-streak')).toHaveProp('accessibilityLabel', 'Win streak: 3');
  });
});
