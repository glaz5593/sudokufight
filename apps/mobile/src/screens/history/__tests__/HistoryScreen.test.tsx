import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ltr, scoreText, signedText } from '../../../components/player';
import type { PracticeRepo } from '../../../game/practiceRepo';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { buildReplay, stepView } from '../../replay/replayModel';
import { ReplayScreen } from '../../replay/ReplayScreen';
import { loadReplay, type ReplaySourceDeps } from '../../replay/replaySource';
import { soloGame, T0 } from '../../replay/testing/games';
import {
  botDuelTable,
  fakeHistoryApi,
  memoryRepo,
  rankedDuel,
  savePractice,
} from '../../replay/testing/sources';
import type { HistoryApi } from '../historyApi';
import type { HistoryEntry } from '../historyModel';
import { HistoryScreen } from '../HistoryScreen';

/**
 * The history tab (spec §14.1; work plan stage 11) and its "done": a ranked game and a practice opened from
 * the history and stepped through one step at a time, each step with the right explanation.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const hidden = { includeHiddenElements: true };
const MIN = 60_000;
/** The cards on screen, in order. */
const cardIds = () =>
  screen
    .getAllByRole('button')
    .map((b) => b.props.testID as string | undefined)
    .filter((id): id is string => !!id && id.startsWith('history-card-'));

const settle = () =>
  act(async () => {
    await new Promise((r) => setImmediate(r));
  });

const ranked = rankedDuel('ranked-1', T0 + 10 * MIN);
const solo = soloGame({ id: 'solo-1', at: T0 + 5 * MIN });
const bot = botDuelTable('bot-1', T0);

async function phone(): Promise<PracticeRepo> {
  const repo = await memoryRepo();
  await savePractice(repo, solo);
  await savePractice(repo, bot);
  return repo;
}

async function show(practice: () => Promise<PracticeRepo | null>, api: HistoryApi | null) {
  const onOpen = jest.fn<void, [HistoryEntry]>();
  const onPlay = jest.fn();
  const onTab = jest.fn();
  await render(
    <HistoryScreen
      deps={() => ({ practice, ranked: api })}
      onOpen={onOpen}
      onPlay={onPlay}
      onTab={onTab}
      myAvatar="av07"
      now={() => T0 + 2 * 86_400_000}
    />,
  );
  await settle();
  return { onOpen, onPlay, onTab };
}

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on' });
});

describe('HistoryScreen', () => {
  it('merges the ranked game from the server and the practices from the phone, newest first', async () => {
    const repo = await phone();
    await show(async () => repo, fakeHistoryApi([ranked]));
    expect(screen.getByRole('header', { name: 'היסטוריה' })).toBeOnTheScreen();
    expect(cardIds()).toEqual(['history-card-ranked-1', 'history-card-solo-1', 'history-card-bot-1']);

    const result = ranked.state.result!;
    const me = result.ranking.find((r) => r.playerId === 'me')!;
    const nina = result.ranking.find((r) => r.playerId === 'nina')!;
    const delta = result.ratingChanges.find((c) => c.playerId === 'me')!;
    expect(screen.getByTestId('history-card-ranked-1-stripe-win', hidden)).toBeOnTheScreen();
    expect(screen.getByTestId('history-card-ranked-1-score', hidden)).toHaveTextContent(
      ltr(`${me.score} : ${nina.score}`),
    );
    expect(screen.getByTestId('history-card-ranked-1-rating', hidden)).toHaveTextContent(
      signedText(Math.round(delta.after - delta.before)),
    );
    expect(screen.getByTestId('history-card-ranked-1')).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/^ניצחון, NinaVolt\. מדורג · מהיר\. .+\. דירוג .+\. \S/),
    );
    expect(screen.getByTestId('history-card-solo-1')).toHaveProp(
      'accessibilityLabel',
      expect.stringContaining(
        `האימון הסתיים, לבד. אימון לבד · מהיר. ${scoreText(solo.state.players[0]!.score)} נק׳. ללא דירוג.`,
      ),
    );
    expect(screen.getByTestId('history-card-bot-1')).toHaveProp(
      'accessibilityLabel',
      expect.stringContaining('ניצחון, Mr. Hoot. אימון מול בוט · מהיר.'),
    );
    expect(screen.queryByTestId('history-more')).toBeNull();
  });

  it('a card opens its replay; the filters show ranked or practice only, with the practice note', async () => {
    const repo = await phone();
    const { onOpen } = await show(async () => repo, fakeHistoryApi([ranked]));
    await fireEvent.press(screen.getByTestId('history-card-ranked-1'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'ranked-1', source: 'ranked' }));

    await fireEvent.press(screen.getByTestId('history-filter-ranked'));
    await settle();
    expect(cardIds()).toEqual(['history-card-ranked-1']);
    await fireEvent.press(screen.getByTestId('history-filter-practice'));
    await settle();
    expect(cardIds()).toEqual(['history-card-solo-1', 'history-card-bot-1']);
    expect(screen.getByTestId('history-note-practice')).toHaveTextContent(
      'משחקי אימון לא משנים את הדירוג, אבל הצפייה החוזרת עובדת גם בהם.',
    );
  });

  it('offline: the practices, a note and a way to try again', async () => {
    const repo = await phone();
    await show(async () => repo, fakeHistoryApi([ranked], { failWith: 'network' }));
    expect(screen.getByTestId('history-note-offline')).toHaveTextContent(
      'אין חיבור לשרת: מוצגים רק האימונים שבמכשיר.',
      { exact: false },
    );
    expect(screen.queryByTestId('history-card-ranked-1')).toBeNull();
    expect(screen.getByTestId('history-card-solo-1')).toBeOnTheScreen();
    expect(screen.getByTestId('history-retry-offline')).toBeOnTheScreen();
  });

  it('empty: "עוד אין משחקים כאן" and "שחק את המשחק הראשון"; the bottom navigation', async () => {
    const { onPlay, onTab } = await show(memoryRepo, fakeHistoryApi([]));
    expect(screen.getByRole('header', { name: 'עוד אין משחקים כאן' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'שחק את המשחק הראשון' }));
    expect(onPlay).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('nav-home'));
    expect(onTab).toHaveBeenCalledWith('home');
  });

  it('loads 20 more at a time', async () => {
    const many = Array.from({ length: 25 }, (_, k) => rankedDuel(`m${k}`, T0 + k * MIN));
    const api = fakeHistoryApi(many);
    await show(memoryRepo, api);
    expect(cardIds()).toHaveLength(20);
    await fireEvent.press(screen.getByTestId('history-more'));
    await settle();
    // The second page came (the list draws its cards as they scroll into view), and it was the last.
    expect(screen.queryByTestId('history-more')).toBeNull();
    expect(api.calls).toEqual(['games:', 'games:20']);
  });

  it('speaks English', async () => {
    await i18n.changeLanguage('en');
    const repo = await phone();
    await show(async () => repo, null);
    expect(screen.getByRole('header', { name: 'History' })).toBeOnTheScreen();
    expect(screen.getByTestId('history-note-signedOut')).toHaveTextContent(
      'Ranked games show up here once you sign in.',
    );
    expect(screen.getByTestId('history-card-bot-1')).toHaveProp(
      'accessibilityLabel',
      expect.stringContaining('Win, Mr. Hoot. Practice vs bot · Fast.'),
    );
    expect(screen.getByRole('button', { name: 'All' })).toBeOnTheScreen();
  });
});

describe('“done” (work plan stage 11): from the history to the replay, step by step', () => {
  /** Opens a card's replay as the route does, and steps through it checking every explanation. */
  async function stepThrough(
    entry: HistoryEntry,
    deps: ReplaySourceDeps,
    log: readonly import('@sudoku-fight/engine').GameEvent[],
  ) {
    await render(
      <ReplayScreen gameId={entry.id} load={(id) => loadReplay(id, entry.source, deps)} onBack={jest.fn()} />,
    );
    await settle();
    const replay = buildReplay(log, { me: 'me' });
    for (let k = 0; k < replay.steps.length; k++) {
      expect(screen.getByTestId('replay-counter')).toHaveTextContent(
        `שלב ${k + 1} מתוך ${replay.steps.length}`,
      );
      for (const x of stepView(replay, k, 'he').explanations) {
        if (x.status === 'none') continue;
        // The right digit for the cell, and the engine's explanation of why.
        expect(x.answer).toBe(Number(replay.solution![x.cell!]));
        expect(screen.getByTestId(`replay-explain-${x.playerId}-text`, hidden)).toHaveTextContent(x.text!);
      }
      if (k < replay.steps.length - 1) await fireEvent.press(screen.getByTestId('replay-next'));
    }
    expect(screen.getByTestId('replay-next')).toBeDisabled();
  }

  it('a ranked game and a practice', async () => {
    const repo = await phone();
    const api = fakeHistoryApi([ranked]);
    const { onOpen } = await show(async () => repo, api);
    await fireEvent.press(screen.getByTestId('history-card-ranked-1'));
    await fireEvent.press(screen.getByTestId('history-card-bot-1'));
    const [rankedEntry, botEntry] = onOpen.mock.calls.map(([e]) => e);
    const deps: ReplaySourceDeps = { practice: async () => repo, ranked: api, myAvatar: 'av07' };
    await stepThrough(rankedEntry!, deps, ranked.log);
    expect(api.calls).toContain('replay:ranked-1');
    await stepThrough(botEntry!, deps, bot.log);
  }, 120_000);
});
