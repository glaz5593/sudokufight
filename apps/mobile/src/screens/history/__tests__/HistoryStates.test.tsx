import 'react-native-reanimated';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import type { PracticeRepo } from '../../../game/practiceRepo';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { soloGame, T0 } from '../../replay/testing/games';
import { fakeHistoryApi, memoryRepo, rankedDuel, savePractice } from '../../replay/testing/sources';
import { type HistoryApi, HistoryApiError } from '../historyApi';
import { HistoryScreen } from '../HistoryScreen';

/**
 * The history's states (work plan stage 13; spec §14.1, §4.1 "מצבים ריקים" and "מצבי שגיאה", §16.3;
 * History-Empty.dc.html, Loading.dc.html): the cards' skeleton while the first page loads, "עוד אין משחקים
 * כאן" only when there are none, and when nothing shows because a source failed (no connection, the server's
 * error, the phone's database) that failure, with "נסה שוב" and the support code, in Hebrew and English.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  });

const MIN = 60_000;
const ranked = rankedDuel('ranked-1', T0 + 10 * MIN);

/** A server that fails with `code` (and `status`) until `heal()`. */
function failingApi(code: HistoryApiError['code'], status: number | null = null) {
  const ok = fakeHistoryApi([ranked]);
  let failing = true;
  const api: HistoryApi = {
    myGames: (cursor) => (failing ? Promise.reject(new HistoryApiError(code, status)) : ok.myGames(cursor)),
    replay: (id) => ok.replay(id),
  };
  return { api, heal: () => (failing = false) };
}

async function show(practice: () => Promise<PracticeRepo | null>, api: HistoryApi | null) {
  const onPlay = jest.fn();
  await render(
    <HistoryScreen
      deps={() => ({ practice, ranked: api })}
      onOpen={jest.fn()}
      onPlay={onPlay}
      onTab={jest.fn()}
      myAvatar="lava-lamp"
      now={() => T0 + 2 * 86_400_000}
    />,
  );
  await settle();
  return { onPlay };
}

let announce: jest.SpyInstance;

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on' });
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});
afterEach(() => announce.mockRestore());

describe('history states (stage 13)', () => {
  it('loading: the cards as a skeleton, one "טוען את המשחקים…" for screen readers', async () => {
    let open: (repo: PracticeRepo) => void = () => undefined;
    const repo = await memoryRepo();
    await show(() => new Promise((resolve) => (open = resolve)), fakeHistoryApi([]));
    const loading = screen.getByRole('progressbar', { name: 'טוען את המשחקים…' });
    expect(loading).toHaveProp('accessibilityState', { busy: true });
    expect(screen.queryByTestId('history-empty')).toBeNull();
    await act(async () => open(repo));
    await settle();
    expect(screen.queryByTestId('history-loading')).toBeNull();
    expect(screen.getByTestId('history-empty')).toBeOnTheScreen();
  });

  it('empty: "עוד אין משחקים כאן" with the gold "שחק את המשחק הראשון"', async () => {
    const { onPlay } = await show(memoryRepo, fakeHistoryApi([]));
    expect(screen.getByTestId('history-empty-title')).toHaveTextContent('עוד אין משחקים כאן');
    expect(screen.getByTestId('history-empty-body')).toHaveTextContent(
      'כל משחק נשמר כאן לצפייה חוזרת: מהלך אחרי מהלך, עם הסבר למה כל מספר נכנס למקומו.',
    );
    expect(screen.getByTestId('history-play-shadow')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'שחק את המשחק הראשון' }));
    expect(onPlay).toHaveBeenCalled();
  });

  it('no connection and nothing on the phone: the offline state with its code, never "no games yet"', async () => {
    const { api, heal } = failingApi('unavailable', 503);
    await show(memoryRepo, api);
    expect(screen.queryByTestId('history-empty')).toBeNull();
    expect(screen.getByTestId('history-offline-title')).toHaveTextContent('אין חיבור לשרת');
    expect(screen.getByTestId('history-offline-body')).toHaveTextContent(
      'המשחקים המדורגים ייטענו כשיחזור החיבור. אימונים מהמכשיר מופיעים כאן גם בלי חיבור.',
    );
    expect(screen.getByTestId('history-offline-code')).toHaveAccessibleName('קוד שגיאה: unavailable-503');
    // The state says it; the note over the list would say it twice.
    expect(screen.queryByTestId('history-note-offline')).toBeNull();
    expect(announce).toHaveBeenCalledWith(expect.stringMatching(/^אין חיבור לשרת\. /));

    heal();
    await fireEvent.press(screen.getByTestId('history-retry'));
    await settle();
    expect(screen.queryByTestId('history-offline')).toBeNull();
    expect(screen.getByTestId('history-card-ranked-1')).toBeOnTheScreen();
  });

  it('"מדורג" offline with practices on the phone: the offline state for that filter', async () => {
    const repo = await memoryRepo();
    await savePractice(repo, soloGame({ id: 'solo-1', at: T0 }));
    await show(async () => repo, failingApi('network').api);
    // "הכל": the practice shows, with the note.
    expect(screen.getByTestId('history-card-solo-1')).toBeOnTheScreen();
    expect(screen.getByTestId('history-note-offline')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('history-filter-ranked'));
    await settle();
    expect(screen.getByTestId('history-offline-code')).toHaveTextContent('network');
    expect(screen.queryByTestId('history-empty')).toBeNull();
  });

  it('the server’s error: "לא הצלחנו לטעון את המשחקים", the code, "לנסות שוב"', async () => {
    await show(memoryRepo, failingApi('badRequest', 400).api);
    expect(screen.getByTestId('history-error-title')).toHaveTextContent('לא הצלחנו לטעון את המשחקים');
    expect(screen.getByTestId('history-error-body')).toHaveTextContent(
      'השרת לא ענה כמו שצריך. נסה שוב בעוד רגע.',
    );
    expect(screen.getByTestId('history-error-code')).toHaveTextContent('badRequest-400');
    expect(screen.getByRole('button', { name: 'לנסות שוב' })).toBeOnTheScreen();
    expect(screen.queryByTestId('history-note-rankedError')).toBeNull();
  });

  it('the phone’s practice games could not be read: says so under "אימון", with "לנסות שוב"', async () => {
    await show(async () => null, fakeHistoryApi([]));
    await fireEvent.press(screen.getByTestId('history-filter-practice'));
    await settle();
    expect(screen.getByTestId('history-practice-title')).toHaveTextContent('לא הצלחנו לקרוא את האימונים');
    expect(screen.queryByTestId('history-practice-code')).toBeNull();
    expect(screen.getByTestId('history-retry')).toBeOnTheScreen();
    expect(screen.queryByTestId('history-note-practiceUnavailable')).toBeNull();
  });

  it('speaks English: loading, empty, offline and the server’s error', async () => {
    await i18n.changeLanguage('en');
    let open: (repo: PracticeRepo) => void = () => undefined;
    const repo = await memoryRepo();
    await show(() => new Promise((resolve) => (open = resolve)), fakeHistoryApi([]));
    expect(screen.getByRole('progressbar', { name: 'Loading your games…' })).toBeOnTheScreen();
    await act(async () => open(repo));
    await settle();
    expect(screen.getByTestId('history-empty-title')).toHaveTextContent('No games here yet');
    expect(screen.getByRole('button', { name: 'Play your first game' })).toBeOnTheScreen();

    await show(memoryRepo, failingApi('timeout').api);
    expect(screen.getByTestId('history-offline-title')).toHaveTextContent('No connection to the server');
    expect(screen.getByTestId('history-offline-code')).toHaveAccessibleName('Error code: timeout');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();

    await show(memoryRepo, failingApi('badRequest', 400).api);
    expect(screen.getByTestId('history-error-title')).toHaveTextContent("We couldn't load your games");
  });
});
